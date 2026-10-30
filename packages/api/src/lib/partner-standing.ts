/**
 * Where a Shop Partner stands, in one place, so every list, search, badge and plan reads the same
 * answer (Anthony, 30 October 2026).
 *
 * - An Ozi Preferred Partner is an approved, active restaurant, café or takeaway whose agreed
 *   discount for Ozi is at least `restaurants.preferredDiscountPercent` (20%). It is listed first
 *   in its area and food type, ranked first in search, suggested first by Ozi, shows a badge, and
 *   has Partner Plus free while it keeps the discount: its plan is treated as paid Plus, and it
 *   is never charged for it. It also has one free Spotlight week each calendar month.
 * - A shop on Partner Plus whose month is paid comes next (ruling 75).
 * - Everybody else after them, each group in its own order.
 *
 * Wherever this ranking changes a list a Shopper sees, the list says so (the CMA's rule that a
 * ranking given for something in return is disclosed): `preferredRankingWords` in core.
 */

import { isPreferredPartner } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PartnerShop } from '../domain.js';

type Standing = Pick<
  PartnerShop,
  'kind' | 'agreedDiscountPercent' | 'active' | 'status' | 'plan' | 'paidUntil'
>;

/** An approved, active restaurant whose agreed discount makes it an Ozi Preferred Partner. */
export function preferredPartner(shop: Standing, config: AppContext['config']): boolean {
  return (
    shop.active &&
    shop.status === 'approved' &&
    isPreferredPartner(
      { kind: shop.kind, discountPercent: shop.agreedDiscountPercent ?? 0 },
      config.restaurants,
    )
  );
}

/**
 * Whether the partner has paid Partner Plus now: a month paid and still running, or free as a
 * Preferred Partner while it keeps the discount.
 */
export function plusPaid(shop: Standing, at: Date, config: AppContext['config']): boolean {
  if (preferredPartner(shop, config)) return true;
  return shop.active && shop.paidUntil !== null && shop.paidUntil.getTime() > at.getTime();
}

/** A shop on Partner Plus whose month is paid (ruling 75). */
function shopOnPaidPlus(shop: Standing, at: Date): boolean {
  return (
    shop.kind === 'shop' &&
    shop.plan === 'plus' &&
    shop.active &&
    shop.paidUntil !== null &&
    shop.paidUntil.getTime() > at.getTime()
  );
}

/** 0 for a Preferred Partner, 1 for a shop on paid Partner Plus, 2 for everybody else. */
export function listingRank(shop: Standing, at: Date, config: AppContext['config']): 0 | 1 | 2 {
  if (preferredPartner(shop, config)) return 0;
  if (shopOnPaidPlus(shop, at)) return 1;
  return 2;
}

/** Preferred Partners first, then paid Partner Plus shops, then the rest, each in its own order. */
export function rankedForListing<T extends Standing>(
  shops: readonly T[],
  at: Date,
  config: AppContext['config'],
): T[] {
  return shops
    .map((shop, index) => ({ shop, index, rank: listingRank(shop, at, config) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.shop);
}
