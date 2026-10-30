import { ambassadorOrderSharePence, deliveryPriceRange, shareWords } from '@aldilivery/core';

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

/**
 * The badge an Ozi Preferred Partner wears (Anthony, 30 October 2026): a restaurant that gives us
 * a better price. Wherever it is shown first, the list says why (`preferredRankingWords`).
 */
export const PREFERRED_PARTNER_WORDS = 'Preferred Partner';

/** "Restaurant fee £12": a restaurant order's flat fee, in place of delivery, from config. */
export function restaurantFeeShortWords(): string {
  return `Restaurant fee ${money(storeConfig.restaurants.feePence).replace(/\.00$/, '')}`;
}

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

/**
 * What an Ozi Ambassador earns on each order, in plain words with every figure from config
 * (Anthony's final ruling, 30 October 2026), for the Ambassador terms and the dashboard: a
 * restaurant's mark-up and discount, a shop's item charges, mark-up and discount, and the
 * quarter rate on another branch.
 */
export function ambassadorEarningWords(): {
  restaurant: string;
  grocery: string;
  branch: string;
} {
  const rates = storeConfig.ambassador;
  const share = (value: number): string => shareWords(value);
  const quarter = (value: number): string => shareWords(value * rates.branchShareFactor);
  const example = ambassadorOrderSharePence(
    { kind: 'restaurant', markupPence: 500, discountPence: 200, itemChargesPence: 0 },
    rates,
  );
  return {
    restaurant: `On a restaurant's, café's or takeaway's orders: ${share(rates.restaurantMarkupShare)} of the mark-up we keep (what the Shopper pays over the restaurant's own price) and ${share(rates.restaurantDiscountShare)} of the discount we keep (the restaurant's own price less what we pay at the counter). For example, a ${money(1000)} dish with a 50% mark-up and a 20% discount: ${share(rates.restaurantMarkupShare)} of ${money(500)} and ${share(rates.restaurantDiscountShare)} of ${money(200)}, ${money(example)}. Never the item charges or the restaurant fee.`,
    grocery: `On a shop's orders: ${share(rates.groceryItemChargeShare)} of the item charges on its things, and ${share(rates.groceryMarkupShare)} of any mark-up and ${share(rates.groceryDiscountShare)} of any discount we keep. Never the delivery fee.`,
    branch: `Another branch of the same business that joins through your link earns you a quarter of each rate: ${quarter(rates.restaurantMarkupShare)} and ${quarter(rates.restaurantDiscountShare)} on a restaurant, ${quarter(rates.groceryItemChargeShare)} on a shop. A branch that joins without your link earns you nothing.`,
  };
}
