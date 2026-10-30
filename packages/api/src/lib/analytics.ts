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
import type { CheckoutChannel, CheckoutReason, Order } from '../domain.js';

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
    // A Shop Partner's product is in the catalogue as "partner:<product id>": the sure way to
    // the shop's id, kept on the row so commission is matched by id (30 October 2026).
    const partnerShopOf = new Map<string, string>();
    for (const item of items) {
      if (!item.externalRef?.startsWith('partner:')) continue;
      const product = await repository.partnerProducts.findById(item.externalRef.slice(8));
      if (product) partnerShopOf.set(item.id, product.partnerShopId);
    }
    // Each Shop Partner's things are under "From <shop>"; everything else is the main store.
    const byShop = new Map<
      string,
      { count: number; pence: number; categories: Set<string>; partnerShopId: string | null }
    >();
    for (const item of order.items) {
      const category = categoryOf.get(item.catalogueItemId ?? '') ?? 'Other';
      const shop = category.startsWith('From ') ? category.slice(5) : config.store.displayName;
      const entry = byShop.get(shop) ?? {
        count: 0,
        pence: 0,
        categories: new Set<string>(),
        partnerShopId: null,
      };
      entry.partnerShopId ??= partnerShopOf.get(item.catalogueItemId ?? '') ?? null;
      entry.count += item.quantity;
      entry.pence += item.estimatedPricePence * item.quantity;
      entry.categories.add(category);
      byShop.set(shop, entry);
    }
    if (kind === 'order_paid') await recordCheckoutPaid(ctx, order);
    for (const [shop, entry] of byShop) {
      await repository.analytics.record({
        at: ctx.now(),
        kind,
        shopperKey: personKey(order.shopperId, env.authTokenSecret),
        runnerKey: order.runnerId ? personKey(order.runnerId, env.authTokenSecret) : null,
        shop,
        partnerShopId: entry.partnerShopId,
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

/* ------------------------------------------------------------------ checkout insights */

/**
 * Checkout insights (Anthony, 30 October 2026): why people do not pay. When a Shopper reaches the
 * checkout, the breakdown they were shown is written down with the kind of order, the area, the
 * no-Runner warning, whether they have ordered before and how they ordered; when they pay, the
 * same again as paid; and if they leave and choose to say why, their answer. No card details,
 * no names, no addresses: people are one-way codes, places postcode districts. Kept 12 months
 * (services/retention.ts), as the privacy page says. Nobody is texted or emailed about a
 * checkout they left: there is no marketing without consent.
 */

/** Orders that count as having ordered before: paid at some point, not drafts or cancelled. */
const ORDERED = new Set([
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
  'refunded',
]);

/** Whether this Shopper had a paid order before this one: a returning Shopper. */
async function returningShopper(
  ctx: Pick<AppContext, 'repository'>,
  shopperId: string,
  except?: string,
): Promise<boolean> {
  return (await ctx.repository.orders.listForShopper(shopperId)).some(
    (order) => order.id !== except && ORDERED.has(order.status),
  );
}

/** How an order's yes was given: on the screen, to Ozi by voice, or on the telephone. */
export function channelOf(
  order: Pick<Order, 'confirmationChannel' | 'confirmationStatement'>,
): CheckoutChannel {
  if (order.confirmationStatement?.startsWith('By telephone')) return 'phone';
  return order.confirmationChannel === 'voice' ? 'voice' : 'web';
}

export interface CheckoutView {
  shopperId: string;
  goodsPence: number;
  itemChargesPence: number;
  /** Delivery, with any extra delivery charge, or the restaurant fee. */
  feePence: number;
  totalPence: number;
  restaurant: boolean;
  /** The delivery address or its postcode: only the district is kept. */
  area: string | null;
  noRunnerWarning: boolean;
  channel: CheckoutChannel;
}

/** A Shopper reached the checkout, with everything shown to them. Never stops anything. */
export async function recordCheckoutViewed(ctx: AppContext, view: CheckoutView): Promise<void> {
  try {
    await ctx.repository.analytics.record({
      at: ctx.now(),
      kind: 'checkout_viewed',
      shopperKey: personKey(view.shopperId, ctx.env.authTokenSecret),
      runnerKey: null,
      shop: null,
      area: null,
      toArea: district(view.area),
      ageBand: null,
      viaOrganisation: false,
      itemCount: 0,
      goodsPence: view.goodsPence,
      categories: '',
      query: null,
      travelMode: null,
      itemChargesPence: view.itemChargesPence,
      feePence: view.feePence,
      totalPence: view.totalPence,
      restaurant: view.restaurant,
      noRunnerWarning: view.noRunnerWarning,
      returning: await returningShopper(ctx, view.shopperId),
      channel: view.channel,
    });
  } catch {
    // Never stops a checkout.
  }
}

/** An order paid: the checkout it came from was paid. A regular order had no checkout. */
async function recordCheckoutPaid(ctx: AppContext, order: Order): Promise<void> {
  // One row for a basket kept as linked orders, on its first order; none for a Set or a part.
  if (order.setId || order.splitParentId || (order.basketPart ?? 1) > 1) return;
  const group = order.basketGroupId
    ? (await ctx.repository.orders.listForShopper(order.shopperId)).filter(
        (row) => row.basketGroupId === order.basketGroupId,
      )
    : [order];
  const sum = (pick: (row: Order) => number): number =>
    group.reduce((total, row) => total + pick(row), 0);
  await ctx.repository.analytics.record({
    at: ctx.now(),
    kind: 'checkout_paid',
    shopperKey: personKey(order.shopperId, ctx.env.authTokenSecret),
    runnerKey: null,
    shop: null,
    area: null,
    toArea: district(order.deliveryAddress),
    ageBand: null,
    viaOrganisation: false,
    itemCount: 0,
    goodsPence: sum((row) => row.goodsEstimatePence),
    categories: '',
    query: null,
    travelMode: null,
    itemChargesPence: sum((row) => row.itemChargesPence),
    feePence: sum((row) => row.feePence + row.allowanceExtraPence),
    totalPence: sum((row) => row.totalEstimatePence),
    restaurant: order.restaurantShopId !== null,
    noRunnerWarning: null,
    returning: await returningShopper(ctx, order.shopperId, order.id),
    channel: channelOf(order),
  });
}

/** The answer to "Can we ask what stopped you?", once tapped. Skipping writes nothing. */
export async function recordCheckoutReason(
  ctx: AppContext,
  shopperId: string,
  answer: CheckoutReason,
  details: { restaurant: boolean; totalPence: number | null; area: string | null },
): Promise<void> {
  await ctx.repository.analytics.record({
    at: ctx.now(),
    kind: 'checkout_reason',
    shopperKey: personKey(shopperId, ctx.env.authTokenSecret),
    runnerKey: null,
    shop: null,
    area: null,
    toArea: district(details.area),
    ageBand: null,
    viaOrganisation: false,
    itemCount: 0,
    goodsPence: 0,
    categories: '',
    query: null,
    travelMode: null,
    totalPence: details.totalPence,
    restaurant: details.restaurant,
    answer,
  });
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
