/**
 * Business analysis (Anthony, 7 October 2026): "strictly for business analysis ... no names, no
 * personal information".
 *
 * What is kept: what happened, when, at which shop, in which postcode district, how much, what
 * kinds of things, and the age group a person chose to give. People appear only as one-way
 * codes made with a server secret: the same person gets the same code, so patterns can be seen,
 * but the code cannot be turned back into a name or a number, and it is never shown. Nothing
 * here can fail an order: if a record cannot be written, the order goes on.
 *
 * In law the codes are still "pseudonymised" personal data (UK GDPR), so the privacy page says
 * this happens and why, and every figure shown is about at least ten different people
 * (rulings 13, 14 and 16).
 */

import { createHmac } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';

/** A one-way code for a person, the same every time, that cannot be turned back. */
export function personKey(id: string, secret: string): string {
  return createHmac('sha256', `analytics:${secret}`).update(id).digest('base64url').slice(0, 16);
}

/** The postcode district only: "12 Example Street, Gillingham ME7 1AA" gives "ME7". */
export function district(address: string | null | undefined): string | null {
  const match = (address ?? '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  return match?.[1] ?? null;
}

/** Records an order as paid or delivered, once per shop it was bought from. */
export async function recordOrder(
  ctx: AppContext,
  order: Order,
  kind: 'order_paid' | 'order_delivered',
  log?: FastifyBaseLogger,
): Promise<void> {
  try {
    const { repository, env, config } = ctx;
    const shopper = await repository.shoppers.findById(order.shopperId);
    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    const items = await repository.catalogue.findManyByIds(
      order.items.map((item) => item.catalogueItemId ?? '').filter(Boolean),
    );
    const categoryOf = new Map(items.map((item) => [item.id, item.category]));
    // Each Shop Partner's things are under "From <shop>"; everything else is the main store.
    const byShop = new Map<string, { count: number; pence: number; categories: Set<string> }>();
    for (const item of order.items) {
      const category = categoryOf.get(item.catalogueItemId ?? '') ?? 'Other';
      const shop = category.startsWith('From ') ? category.slice(5) : config.store.displayName;
      const entry = byShop.get(shop) ?? { count: 0, pence: 0, categories: new Set<string>() };
      entry.count += item.quantity;
      entry.pence += item.estimatedPricePence * item.quantity;
      entry.categories.add(category);
      byShop.set(shop, entry);
    }
    for (const [shop, entry] of byShop) {
      await repository.analytics.record({
        at: ctx.now(),
        kind,
        shopperKey: personKey(order.shopperId, env.authTokenSecret),
        runnerKey: order.runnerId ? personKey(order.runnerId, env.authTokenSecret) : null,
        shop,
        area: null,
        toArea: district(order.deliveryAddress),
        ageBand: shopper?.ageBand ?? null,
        viaOrganisation: Boolean(shopper?.organisationId),
        itemCount: entry.count,
        goodsPence: entry.pence,
        categories: [...entry.categories].sort().join('|'),
        query: null,
        travelMode: runner?.vehicleType ?? null,
      });
    }
  } catch (failure) {
    log?.warn({ orderId: order.id, err: failure }, 'An analysis record could not be written');
  }
}

/** Records a search, and whether anything was found: what people want that nobody has. */
export async function recordSearch(
  ctx: AppContext,
  query: string,
  found: number,
  shopperId: string | null,
): Promise<void> {
  const words = query.trim().toLowerCase().slice(0, 80);
  if (words.length < 2) return;
  try {
    const shopper = shopperId ? await ctx.repository.shoppers.findById(shopperId) : null;
    await ctx.repository.analytics.record({
      at: ctx.now(),
      kind: found === 0 ? 'search_unmet' : 'search',
      shopperKey: shopperId ? personKey(shopperId, ctx.env.authTokenSecret) : null,
      runnerKey: null,
      shop: null,
      area: null,
      toArea: district(shopper?.deliveryAddress),
      ageBand: shopper?.ageBand ?? null,
      viaOrganisation: Boolean(shopper?.organisationId),
      itemCount: found,
      goodsPence: 0,
      categories: '',
      query: words,
      travelMode: null,
    });
  } catch {
    // Never stops a search.
  }
}
