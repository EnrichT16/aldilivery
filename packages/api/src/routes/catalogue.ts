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

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function registerCatalogueRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;

  app.get('/catalogue/search', async (request) => {
    const { q, category, limit } = searchSchema.parse(request.query);

    const items = await repository.catalogue.search(q, {
      // Never true. Rule Six.
      includeAgeRestricted: false,
      ...(category ? { category } : {}),
      limit,
    });

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

  app.get('/catalogue/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const item = await repository.catalogue.findById(id);

    // An age restricted row is treated as though it is not there at all in version one.
    if (!item || item.ageRestricted) {
      return { found: false, item: null };
    }
    return { found: true, item };
  });
}
