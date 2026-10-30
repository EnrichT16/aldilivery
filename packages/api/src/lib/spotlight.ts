/**
 * Spotlight and Spotlight Plus (ruling 42): paid mentions by Ozi, for Shop Partners only.
 *
 * Section O still governs: the genuine answer comes first, the mention after it, called an
 * advert, with checkable facts only ("is sold at", "about £3.50"), never "better". It said
 * "in stock at" until nobody could promise the shelf (Anthony, 30 October 2026). A mention is
 * only made when the Shopper is looking for something that shop sells, and the same Shopper
 * hears a given shop at most once a week on Spotlight, or three times on Spotlight Plus. One
 * advert at most per search.
 *
 * An Ozi Preferred Partner (lib/partner-standing.ts, Anthony, 30 October 2026) has its plan
 * treated as paid, so it can run Spotlight, and it has one free Spotlight week each calendar
 * month: it takes it from its dashboard when it likes, or staff give it, and nothing is charged.
 * The week is written down as a payment of nothing with the month in its reference, so it is
 * given once a month only, and shows on the statement.
 */

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PartnerProduct, PartnerShop } from '../domain.js';
import { ConflictError } from '../errors.js';
import { personKey } from './analytics.js';
import { plusPaid, preferredPartner } from './partner-standing.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Advert {
  shopId: string;
  shopName: string;
  productName: string;
  pricePence: number;
  catalogueItemId: string | null;
  words: string;
}

function matches(product: PartnerProduct, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .map((word) => word.replace(/(es|s)$/, ''));
  if (words.length === 0) return false;
  const text = `${product.name} ${product.tags}`.toLowerCase();
  return words.some((word) => text.includes(word));
}

export function spotlightActive(
  shop: PartnerShop,
  now: Date,
  config: AppContext['config'],
): boolean {
  return (
    shop.active &&
    shop.spotlight !== 'none' &&
    shop.spotlightUntil !== null &&
    shop.spotlightUntil > now &&
    plusPaid(shop, now, config)
  );
}

/** "2026-10": the calendar month a free Spotlight week counts for. */
function monthOf(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** The reference a month's free Spotlight week is written down under: once a month only. */
export function freeSpotlightWeekReference(shopId: string, at: Date): string {
  return `free-spotlight-week:${shopId}:${monthOf(at)}`;
}

/** Whether this Preferred Partner may take its free Spotlight week this calendar month. */
export async function freeSpotlightWeekLeft(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  shop: PartnerShop,
): Promise<boolean> {
  if (!preferredPartner(shop, ctx.config)) return false;
  return !(await ctx.repository.partnerPayments.findByReference(
    freeSpotlightWeekReference(shop.id, ctx.now()),
  ));
}

/**
 * Gives a Preferred Partner its free Spotlight week for this calendar month, at no charge: a
 * week of Spotlight from now, or added to a Spotlight already running. Refused, plainly, for a
 * partner that is not a Preferred Partner, one that has had this month's week, and one on
 * Spotlight Plus (the week is there to take once that ends).
 */
export async function takeFreeSpotlightWeek(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  shop: PartnerShop,
  recordedBy: string,
): Promise<PartnerShop> {
  const at = ctx.now();
  if (!preferredPartner(shop, ctx.config)) {
    throw new ConflictError(
      `The free Spotlight week is for ${ctx.config.assistantName} Preferred Partners: restaurants that agree a discount of ${ctx.config.restaurants.preferredDiscountPercent}% or more.`,
    );
  }
  if (!(await freeSpotlightWeekLeft(ctx, shop))) {
    throw new ConflictError(
      'This month’s free Spotlight week has been used. The next one is there from the 1st of next month.',
    );
  }
  const running = shop.spotlightUntil !== null && shop.spotlightUntil > at;
  if (running && shop.spotlight === 'plus') {
    throw new ConflictError(
      'Spotlight Plus is running already. Your free Spotlight week is still there to take this month once it ends.',
    );
  }
  const from =
    running && shop.spotlight === 'spotlight' && shop.spotlightUntil ? shop.spotlightUntil : at;
  const until = new Date(from.getTime() + WEEK_MS);
  const updated = await ctx.repository.partnerShops.update(shop.id, {
    spotlight: 'spotlight',
    spotlightUntil: until,
  });
  await ctx.repository.partnerPayments.create({
    partnerShopId: shop.id,
    kind: 'spotlight',
    amountPence: 0,
    months: 0,
    coversUntil: until,
    recordedBy,
    paidAt: at,
    reference: freeSpotlightWeekReference(shop.id, at),
  });
  return updated;
}

/** The one advert for this search, if any shop has earned it, and records that it was made. */
export async function chooseAdvert(
  ctx: AppContext,
  shopperId: string,
  query: string,
): Promise<Advert | null> {
  const { repository, config, env, now } = ctx;
  const at = now();
  const shopperKey = personKey(shopperId, env.authTokenSecret);
  const heard = await repository.spotlightMentions.listForShopperSince(
    shopperKey,
    new Date(at.getTime() - WEEK_MS),
  );
  const candidates: Array<{ shop: PartnerShop; product: PartnerProduct; heard: number }> = [];
  for (const shop of await repository.partnerShops.list()) {
    if (!spotlightActive(shop, at, config)) continue;
    const limit =
      shop.spotlight === 'plus'
        ? config.extras.spotlightPlusPerWeek
        : config.extras.spotlightPerWeek;
    const times = heard.filter((mention) => mention.partnerShopId === shop.id).length;
    if (times >= limit) continue;
    const product = (await repository.partnerProducts.listForShop(shop.id)).find(
      (row) => row.status === 'approved' && matches(row, query),
    );
    if (product) candidates.push({ shop, product, heard: times });
  }
  if (candidates.length === 0) return null;
  // The shop this Shopper has heard least this week, Spotlight Plus first among equals.
  candidates.sort(
    (a, b) =>
      a.heard - b.heard ||
      Number(b.shop.spotlight === 'plus') - Number(a.shop.spotlight === 'plus'),
  );
  const { shop, product } = candidates[0]!;
  await repository.spotlightMentions.create({
    partnerShopId: shop.id,
    shopperKey,
    query: query.trim().toLowerCase().slice(0, 80),
    at,
  });
  const price = formatPence(product.pricePence, config.store.currencySymbol);
  return {
    shopId: shop.id,
    shopName: shop.name,
    productName: product.name,
    pricePence: product.pricePence,
    catalogueItemId: product.catalogueItemId,
    words: `Advert: ${product.name} is sold at ${shop.name}, about ${price}.`,
  };
}
