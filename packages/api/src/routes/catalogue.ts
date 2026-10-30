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
import { preferredRankingWords } from '@aldilivery/core';

import { recordSearch } from '../lib/analytics.js';
import { listingRank } from '../lib/partner-standing.js';
import { restaurantsOf } from '../services/basket.js';
import { suggestItem } from '../services/suggest.js';

/**
 * Ozi Preferred Partners' dishes first (Anthony, 30 October 2026), then the things of shops on
 * paid Partner Plus (ruling 75), then the rest of the partners'. Only the places a partner's own
 * products already hold are reordered: the first-ranked partners' things take the first of those
 * places, and everything else stays exactly where it was. The search result says why when a
 * Preferred Partner is in it (`preferredRankingWords`).
 */
export async function plusShopsFirst(
  ctx: Pick<AppContext, 'repository' | 'now' | 'config'>,
  items: CatalogueItem[],
): Promise<CatalogueItem[]> {
  return (await rankedItems(ctx, items)).items;
}

/** The items ranked, and whether a Preferred Partner's dish is among them. */
export async function rankedItems(
  ctx: Pick<AppContext, 'repository' | 'now' | 'config'>,
  items: CatalogueItem[],
): Promise<{ items: CatalogueItem[]; preferred: boolean }> {
  const places: number[] = [];
  const ranked: Array<{ item: CatalogueItem; rank: number; index: number }> = [];
  const rankByShop = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    if (!item.externalRef?.startsWith('partner:')) continue;
    places.push(index);
    const product = await ctx.repository.partnerProducts.findById(
      item.externalRef.slice('partner:'.length),
    );
    let rank = 2;
    if (product) {
      if (!rankByShop.has(product.partnerShopId)) {
        const shop = await ctx.repository.partnerShops.findById(product.partnerShopId);
        rankByShop.set(product.partnerShopId, shop ? listingRank(shop, ctx.now(), ctx.config) : 2);
      }
      rank = rankByShop.get(product.partnerShopId) ?? 2;
    }
    ranked.push({ item, rank, index });
  }
  const preferred = ranked.some((entry) => entry.rank === 0);
  if (new Set(ranked.map((entry) => entry.rank)).size < 2) return { items, preferred };
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const reordered = [...items];
  ranked.forEach((entry, n) => {
    reordered[places[n]!] = entry.item;
  });
  return { items: reordered, preferred };
}

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/** The restaurant a dish is from, as the screen needs it: its id and name, or null. */
function restaurantFields(
  ref: { shopId: string; name: string; markupPercent?: number } | undefined,
) {
  // Whether its prices carry an agreed mark-up (30 October 2026), so the basket can say so.
  return ref
    ? { shopId: ref.shopId, name: ref.name, markedUp: (ref.markupPercent ?? 0) > 0 }
    : null;
}

export async function registerCatalogueRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;

  app.get('/catalogue/search', async (request) => {
    const { q, category, limit } = searchSchema.parse(request.query);

    const { items, preferred } = await rankedItems(
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

    // A restaurant's dish is priced as a restaurant order (Anthony, 30 October 2026): the screen
    // needs to know which restaurant, to price it and keep it apart from other shopping.
    const restaurants = await restaurantsOf(app.ctx, items);
    return {
      query: q,
      count: items.length,
      source: config.store.catalogueSource.mode,
      attribution: config.store.catalogueSource.attribution,
      // Said with the results whenever a Preferred Partner's dish is ranked first (CMA).
      ranking: preferred ? preferredRankingWords(config.assistantName) : null,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        estimatedPricePence: item.estimatedPricePence,
        source: item.source,
        lastSeenAt: item.lastSeenAt,
        restaurant: restaurantFields(restaurants.of.get(item.id)),
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
    const restaurants = await restaurantsOf(app.ctx, [item]);
    return {
      found: true,
      item: { ...item, restaurant: restaurantFields(restaurants.of.get(item.id)) },
    };
  });
}
