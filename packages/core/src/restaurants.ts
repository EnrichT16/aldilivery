/**
 * Restaurant, café and takeaway pricing (Anthony, 30 October 2026). Separate from groceries:
 * grocery pricing is exactly as it was. Every figure comes from `restaurants` in
 * config/store.json (Rule Nine).
 *
 * For an order from a food partner (a restaurant, café or takeaway; never a shop or a service):
 *
 * - Dishes are priced at the restaurant's own shop price. Nothing is added to the dish for the
 *   Shopper beyond the normal item charge, which applies to every dish, unchanged (Rule Three).
 * - A flat restaurant fee (`feePence`, £12) replaces the grocery delivery bands. The Runner's
 *   pay comes out of it as on every delivery (Rule Two); the rest is Ozi's. Ozi's share is never
 *   configured on its own: it is the fee less the Runner's pay, so there is one source of truth.
 * - The smallest restaurant order is `minimumOrderPence` (£10) of dishes at shop prices. Below
 *   it, the order cannot be sent, and the Shopper is told so plainly.
 * - Restaurants pay Ozi no commission. A restaurant may instead agree a discount for Ozi: it
 *   sells to Ozi at its shop price less that percentage. The Shopper still sees and pays the
 *   shop price; the Runner pays the restaurant the discounted amount at the counter; Ozi keeps
 *   the difference.
 * - A restaurant whose agreed discount is at least `preferredDiscountPercent` (20%) is an Ozi
 *   Preferred Partner: listed first, with a badge, and the commercial reason said where it is
 *   listed (the CMA's rule that a ranking paid for in any way is disclosed).
 *
 * The functions here are pure: same inputs, same outputs, no clock, no I/O, whole pence only.
 */

import {
  assertProductAllowed,
  BasketOverMaximumError,
  itemChargesForLines,
  type BasketPricing,
  type DeliveryFees,
  type DeliveryPlan,
  type PricedUnitLine,
} from './fees.js';

/** What restaurant pricing reads from config/store.json. */
export interface RestaurantSettings {
  /** The flat restaurant fee on every restaurant order, in place of delivery (£12). */
  readonly feePence: number;
  /** The smallest restaurant order, in dishes at shop prices (£10). */
  readonly minimumOrderPence: number;
  /** An agreed discount of at least this makes a restaurant a Preferred Partner (20%). */
  readonly preferredDiscountPercent: number;
  /** The largest discount staff may record (keeps a typing slip from giving food away). */
  readonly maximumDiscountPercent: number;
}

/** The partner kinds whose orders are restaurant orders: food only, never a shop or a service. */
export function isRestaurantKind(kind: string): boolean {
  return kind === 'food';
}

/** A basket below the smallest restaurant order. It cannot be sent. */
export class RestaurantBelowMinimumError extends Error {
  constructor(
    readonly goodsPence: number,
    readonly minimumPence: number,
  ) {
    super(`A restaurant order of ${goodsPence}p is below the ${minimumPence}p smallest order.`);
    this.name = 'RestaurantBelowMinimumError';
  }
}

function assertPercent(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= 100) {
    throw new TypeError(`${label} must be a whole percentage from 0 to 99, received ${value}.`);
  }
}

/**
 * What the Runner pays the restaurant at the counter for this much at shop prices, with the
 * agreed discount taken off, to the nearest penny: £10.00 at 20% is £8.00.
 */
export function counterPricePence(shopPricePence: number, discountPercent: number): number {
  assertPercent(discountPercent, 'A restaurant discount');
  if (!Number.isInteger(shopPricePence) || shopPricePence < 0) {
    throw new TypeError(`A shop price must be whole pence, received ${shopPricePence}.`);
  }
  return Math.round((shopPricePence * (100 - discountPercent)) / 100);
}

/** What Ozi keeps on this much at shop prices: the shop price less the counter price. */
export function restaurantDiscountPence(shopPricePence: number, discountPercent: number): number {
  return shopPricePence - counterPricePence(shopPricePence, discountPercent);
}

/**
 * The shop-price value of what the Runner really paid at the counter, for the Shopper's final
 * bill. Paid exactly what was expected, it is exactly the shop prices agreed to; paid something
 * else (a dish was not available, or a price had changed), it is that amount grossed back up by
 * the discount, so the Shopper always pays shop prices and Ozi's share stays the agreed one.
 */
export function shopPriceFromCounterPence(
  counterPaidPence: number,
  expected: { readonly shopPricePence: number; readonly discountPercent: number },
): number {
  assertPercent(expected.discountPercent, 'A restaurant discount');
  if (counterPaidPence === counterPricePence(expected.shopPricePence, expected.discountPercent)) {
    return expected.shopPricePence;
  }
  if (expected.discountPercent === 0) return counterPaidPence;
  return Math.round((counterPaidPence * 100) / (100 - expected.discountPercent));
}

/** The restaurant fee split: the Runner's pay, and Ozi's share, which is the rest. */
export function restaurantFeeShares(
  settings: Pick<RestaurantSettings, 'feePence'>,
  runnerPaymentPence: number,
): { runnerPence: number; ozisPence: number } {
  return { runnerPence: runnerPaymentPence, ozisPence: settings.feePence - runnerPaymentPence };
}

/** Whether a restaurant with this agreed discount is an Ozi Preferred Partner. */
export function isPreferredPartner(
  place: { readonly kind: string; readonly discountPercent: number },
  settings: Pick<RestaurantSettings, 'preferredDiscountPercent'>,
): boolean {
  return isRestaurantKind(place.kind) && place.discountPercent >= settings.preferredDiscountPercent;
}

/** "£10" from 1000, "£10.50" from 1050: whole pounds without the pence, as Anthony says it. */
function shortMoney(pence: number, formatMoney: (pence: number) => string): string {
  return formatMoney(pence).replace(/\.00$/, '');
}

/**
 * What the Shopper is told, on the screen and aloud, when a restaurant basket is below the
 * smallest order: "The smallest restaurant order is £10. Please add something more."
 */
export function restaurantMinimumWords(
  settings: Pick<RestaurantSettings, 'minimumOrderPence'>,
  formatMoney: (pence: number) => string,
): string {
  return `The smallest restaurant order is ${shortMoney(settings.minimumOrderPence, formatMoney)}. Please add something more.`;
}

/**
 * What the Shopper is told when a basket has restaurant dishes and other shopping together, or
 * dishes from two restaurants. Each restaurant order goes on its own, with its own Runner.
 */
export const RESTAURANT_MIXED_WORDS =
  'Restaurant dishes go as their own order, from one restaurant at a time, separate from other shopping. Please send the dishes and the rest as separate orders.';

/** The restaurant fee in one plain phrase, for the screens, the terms and Ozi. */
export function restaurantFeeWords(
  settings: Pick<RestaurantSettings, 'feePence' | 'minimumOrderPence'>,
  formatMoney: (pence: number) => string,
): string {
  return `A restaurant, café or takeaway order has a flat restaurant fee of ${shortMoney(settings.feePence, formatMoney)} in place of delivery, and the smallest order is ${shortMoney(settings.minimumOrderPence, formatMoney)} of dishes.`;
}

/**
 * The Preferred Partner disclosure, said next to every list it changes (CMA): "Preferred
 * Partners, who give Ozi a better price, are shown first." The name is the assistant's, from
 * config.
 */
export function preferredRankingWords(assistantName: string): string {
  return `Preferred Partners, who give ${assistantName} a better price, are shown first.`;
}

/**
 * Price a restaurant basket: dishes at shop prices, the normal item charge on every dish, and
 * the flat restaurant fee in place of delivery. No allowance extra: the restaurant fee is the
 * whole delivery charge. Refuses a dish over the most any one product may cost, a basket over
 * the most one order carries, and a basket below the smallest restaurant order.
 */
export function priceRestaurantBasket(
  lines: readonly PricedUnitLine[],
  plan: DeliveryPlan,
  fees: DeliveryFees,
  settings: Pick<RestaurantSettings, 'feePence' | 'minimumOrderPence'>,
): BasketPricing {
  for (const line of lines) assertProductAllowed(line.shopPricePence, fees);
  const goodsPence = lines.reduce((sum, line) => sum + line.shopPricePence * line.quantity, 0);
  if (goodsPence > fees.maximumOrderGoodsPence) {
    throw new BasketOverMaximumError(goodsPence, fees.maximumOrderGoodsPence);
  }
  if (goodsPence < settings.minimumOrderPence) {
    throw new RestaurantBelowMinimumError(goodsPence, settings.minimumOrderPence);
  }
  const itemChargesPence = itemChargesForLines(lines, fees);
  return {
    goodsPence,
    itemChargesPence,
    feePence: settings.feePence,
    allowanceExtraPence: 0,
    totalPence: goodsPence + itemChargesPence + settings.feePence,
    plan,
  };
}

/**
 * Ozi's profit on a restaurant order, the base an Ambassador's share is worked from: the
 * restaurant's discount plus the item charges. Never the restaurant fee.
 */
export function restaurantProfitPence(
  shopPricePence: number,
  discountPercent: number,
  itemChargesPence: number,
): number {
  return restaurantDiscountPence(shopPricePence, discountPercent) + itemChargesPence;
}
