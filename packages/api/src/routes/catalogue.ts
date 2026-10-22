/**
 * Searching the catalogue.
 *
 * Rule Six is applied here as well as at basket time. An age restricted item is not
 * returned by search at all in version one, so a Shopper is never offered something we
 * would then have to refuse. The basket check stays regardless, because a catalogue row can
 * change between the search and the order.
 *
 * The catalogue is estimates. Where those estimates come from is configuration — a partner
 * feed or the community — and the attribution text travels with the results so that a
 * screen, or later a voice, can say plainly that the price is an estimate and the Shopper
 * pays the till receipt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppContext } from '../app.js';
import type { CatalogueItem } from '../domain.js';
import { recordSearch } from '../lib/analytics.js';
import { suggestItem } from '../services/suggest.js';

/**
 * Shops on paid Partner Plus are listed above free shops in search (ruling 75). Only the places
 * a shop's own products already hold are reordered: a Plus shop's things take the first of
 * those places, a free shop's the rest, and everything else stays exactly where it was.
 */
export async function plusShopsFirst(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  items: CatalogueItem[],
): Promise<CatalogueItem[]> {
  const places: number[] = [];
  const plus: CatalogueItem[] = [];
  const free: CatalogueItem[] = [];
  const paidByShop = new Map<string, boolean>();
  for (const [index, item] of items.entries()) {
    if (!item.externalRef?.startsWith('partner:')) continue;
    places.push(index);
    const product = await ctx.repository.partnerProducts.findById(
      item.externalRef.slice('partner:'.length),
    );
    let paid = false;
    if (product) {
      if (!paidByShop.has(product.partnerShopId)) {
        const shop = await ctx.repository.partnerShops.findById(product.partnerShopId);
        paidByShop.set(
          product.partnerShopId,
          Boolean(
            shop &&
            shop.kind === 'shop' &&
            shop.plan === 'plus' &&
            shop.active &&
            shop.paidUntil !== null &&
            shop.paidUntil.getTime() > ctx.now().getTime(),
          ),
        );
      }
      paid = paidByShop.get(product.partnerShopId) ?? false;
    }
    (paid ? plus : free).push(item);
  }
  if (plus.length === 0 || free.length === 0) return items;
  const reordered = [...items];
  [...plus, ...free].forEach((item, n) => {
    reordered[places[n]!] = item;
  });
  return reordered;
}

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function registerCatalogueRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;

  app.get('/catalogue/search', async (request) => {
    const { q, category, limit } = searchSchema.parse(request.query);

    const items = await plusShopsFirst(
      app.ctx,
      await repository.catalogue.search(q, {
        // Never true. Rule Six.
        includeAgeRestricted: false,
        ...(category ? { category } : {}),
        limit,
      }),
    );
    // Business analysis: what people look for, and what nobody has (Section O, unmet demand).
    if (q.trim()) {
      void recordSearch(
        app.ctx,
        q,
        items.length,
        request.session?.role === 'shopper' ? request.session.accountId : null,
      );
    }

    return {
      query: q,
      count: items.length,
      source: config.store.catalogueSource.mode,
      attribution: config.store.catalogueSource.attribution,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        estimatedPricePence: item.estimatedPricePence,
        source: item.source,
        lastSeenAt: item.lastSeenAt,
      })),
    };
  });

  /**
   * Something not in the list (19 October 2026): what it is, from the language model, and the
   * row added for it, or the cafés that make it, or why it is never carried.
   */
  app.post('/catalogue/suggest', async (request) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body ?? {});
    const suggestion = await suggestItem(app.ctx, name);
    if (suggestion.outcome === 'found' || suggestion.outcome === 'added') {
      const { item } = suggestion;
      return {
        outcome: suggestion.outcome,
        item: {
          id: item.id,
          name: item.name,
          category: item.category,
          estimatedPricePence: item.estimatedPricePence,
          source: item.source,
          lastSeenAt: item.lastSeenAt,
        },
      };
    }
    return suggestion;
  });

  app.get('/catalogue/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const item = await repository.catalogue.findById(id);

    // An age restricted row is treated as though it is not there at all in version one.
    if (!item || item.ageRestricted || item.retired) {
      return { found: false, item: null };
    }
    return { found: true, item };
  });
}
