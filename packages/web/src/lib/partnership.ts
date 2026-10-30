import { deliveryPriceRange } from '@aldilivery/core';

import { storeConfig } from '../config';
import { money } from './money';

/**
 * The words every shop page and card shares (Anthony, 30 October 2026), so a page and a card
 * never say different things about the same shop.
 *
 * A shop Ozi listed from public details is not a partner: every page and card for it says so,
 * and its hours are typical ones, for the Shopper to check. Prices are the shop's own plus our
 * small item charge, always shown; a café or takeaway sets its own prices, so the line is left
 * off there. Delivery is "from" the lowest price on any plan in config.
 */

export const NOT_A_PARTNER_WORDS = "We don't have a partnership with this shop yet.";

export const TYPICAL_HOURS_WORDS = 'Typical hours, please check with the shop';

export const SHOP_PRICES_WORDS = 'Shop prices plus a small item charge, always shown';

export const REVIEW_POINTS_WORDS = 'Reviewers earn points for any honest rating.';

/** "Delivery from £6.99": the lowest delivery price on any plan, from config. */
export function deliveryFromWords(): string {
  return `Delivery from ${money(deliveryPriceRange(storeConfig.fees).lowestPence)}`;
}

/** Whether the shop-prices line belongs on a place: never a café or takeaway, nor a service. */
export function showsShopPrices(kind: string): boolean {
  return kind === 'shop';
}

/**
 * An award's badge, saying whose award it is: "Ozi Shoppers' Shop of the Month, September
 * 2026". The Shoppers' ratings decide it, and the badge says so.
 */
export function awardWords(title: string): string {
  return `${storeConfig.assistantName} Shoppers' ${title}`;
}

/** 51 becomes "51st", 2 "2nd", 13 "13th": for "every 51st person". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
}
