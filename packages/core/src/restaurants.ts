/**
 * Restaurant, café and takeaway pricing (Anthony, 30 October 2026). Separate from groceries:
 * grocery pricing is exactly as it was. Every figure comes from `restaurants` in
 * config/store.json (Rule Nine).
 *
 * For an order from a food partner (a restaurant, café or takeaway; never a shop or a service):
 *
 * - Dishes are priced at the restaurant's own shop price. Nothing is added to the dish for the
 *   Shopper beyond the normal item charge, which applies to every dish, unchanged (Rule Three).
 * - A flat restaurant fee replaces the grocery delivery bands. The Runner's pay comes out of it
 *   as on every delivery (Rule Two); the rest is Ozi's. Changed 30 October 2026 (Anthony, big
 *   restaurant orders): Ozi's share (`ozisSharePence`, £7) is the one figure configured, and the
 *   fee is always the Runner's pay plus it, so Ozi always keeps £7: £12 on an ordinary order
 *   (£5 Runner pay), £14 on an order of £120 or more, whose Runner is paid £7 (Rule Two,
 *   `fees.largeOrderFromPence`). The fee is never configured on its own.
 * - The smallest restaurant order is `minimumOrderPence` (£10) of dishes at shop prices. Below
 *   it, the order cannot be sent, and the Shopper is told so plainly.
 * - Restaurants pay Ozi no commission. A restaurant may instead agree a discount for Ozi: it
 *   sells to Ozi at its shop price less that percentage. The Shopper still sees and pays the
 *   shop price; the Runner pays the restaurant the discounted amount at the counter; Ozi keeps
 *   the difference.
 * - Mark-up (Anthony's final ruling, 30 October 2026): a partner, a restaurant or a grocery shop,
 *   may also have an agreed mark-up percentage, recorded by staff (0 unless set, at most
 *   `maximumMarkupPercent`, 100%). The Shopper sees and pays the shop price with the mark-up on
 *   it (`markedUpPricePence`: £10 at 50% is £15), the item charge is worked out on that shown
 *   price, then the fee. The Runner pays the counter price, the shop price less the discount.
 *   Ozi keeps the mark-up and the discount. Where a mark-up applies, Shoppers are told "Prices
 *   on Ozi may be higher than in the restaurant" (`markupDisclosureWords`).
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
  /** What Ozi keeps of every restaurant fee (£7): the one configured figure. */
  readonly ozisSharePence: number;
  /** The restaurant fee on an ordinary order: the Runner's five pounds plus Ozi's share (£12). */
  readonly feePence: number;
  /** The restaurant fee on a large order: the large-order Runner pay plus Ozi's share (£14). */
  readonly largeOrderFeePence: number;
  /** Dishes at shop prices from which the large-order fee applies (`fees.largeOrderFromPence`). */
  readonly largeOrderFromPence: number;
  /** The smallest restaurant order, in dishes at shop prices (£10). */
  readonly minimumOrderPence: number;
  /** An agreed discount of at least this makes a restaurant a Preferred Partner (20%). */
  readonly preferredDiscountPercent: number;
  /** The largest discount staff may record (keeps a typing slip from giving food away). */
  readonly maximumDiscountPercent: number;
  /** The largest mark-up staff may record on a partner's prices (100%). */
  readonly maximumMarkupPercent: number;
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

/**
 * What the Shopper sees and pays for something at this shop price with this mark-up, to the
 * nearest penny: £10.00 at 50% is £15.00. No mark-up, the shop price.
 */
export function markedUpPricePence(shopPricePence: number, markupPercent: number): number {
  if (!Number.isInteger(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
    throw new TypeError(`A mark-up must be a whole percentage, received ${markupPercent}.`);
  }
  if (!Number.isInteger(shopPricePence) || shopPricePence < 0) {
    throw new TypeError(`A shop price must be whole pence, received ${shopPricePence}.`);
  }
  return Math.round((shopPricePence * (100 + markupPercent)) / 100);
}

/**
 * Where a partner's prices carry a mark-up, what Shoppers are told near them: "Prices on Ozi may
 * be higher than in the restaurant." The name is the assistant's, from config.
 */
export function markupDisclosureWords(assistantName: string, kind: string): string {
  return `Prices on ${assistantName} may be higher than in the ${isRestaurantKind(kind) ? 'restaurant' : 'shop'}.`;
}

/**
 * The shown-price value of what the Runner really paid at the counter, for the Shopper's final
 * bill, from the lines' own figures: paid exactly what was expected, exactly the shown prices
 * agreed to; paid something else (a dish missing, a price changed), that amount scaled up in the
 * same proportion, so the Shopper pays the shown prices and Ozi keeps its agreed share.
 */
export function shownPriceFromCounterPence(
  counterPaidPence: number,
  expected: { readonly shownPence: number; readonly counterPence: number },
): number {
  if (counterPaidPence === expected.counterPence) return expected.shownPence;
  if (expected.counterPence <= 0) return counterPaidPence;
  return Math.round((counterPaidPence * expected.shownPence) / expected.counterPence);
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

/**
 * The restaurant fee for a Runner paid this much: their pay plus Ozi's share, so Ozi always
 * keeps the same (Anthony, 30 October 2026).
 */
export function restaurantFeeForRunnerPay(
  settings: Pick<RestaurantSettings, 'ozisSharePence'>,
  runnerPaymentPence: number,
): number {
  return runnerPaymentPence + settings.ozisSharePence;
}

/**
 * The restaurant fee on this much of dishes at shop prices: £12, or £14 from £120, where the
 * Runner is paid the large-order £7 (Rule Two).
 */
export function restaurantFeePence(
  settings: Pick<RestaurantSettings, 'feePence' | 'largeOrderFeePence' | 'largeOrderFromPence'>,
  goodsPence: number,
): number {
  return goodsPence >= settings.largeOrderFromPence
    ? settings.largeOrderFeePence
    : settings.feePence;
}

/** The restaurant fee split: the Runner's pay, and Ozi's share, which is always the same. */
export function restaurantFeeShares(
  settings: Pick<RestaurantSettings, 'ozisSharePence'>,
  runnerPaymentPence: number,
): { runnerPence: number; ozisPence: number } {
  return { runnerPence: runnerPaymentPence, ozisPence: settings.ozisSharePence };
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
  settings: Pick<
    RestaurantSettings,
    'feePence' | 'largeOrderFeePence' | 'largeOrderFromPence' | 'minimumOrderPence'
  >,
  formatMoney: (pence: number) => string,
): string {
  return `A restaurant, café or takeaway order has a flat restaurant fee of ${shortMoney(settings.feePence, formatMoney)} in place of delivery (${shortMoney(settings.largeOrderFeePence, formatMoney)} for ${shortMoney(settings.largeOrderFromPence, formatMoney)} of dishes or more), and the smallest order is ${shortMoney(settings.minimumOrderPence, formatMoney)} of dishes.`;
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
 * the flat restaurant fee in place of delivery (£14 from £120 of dishes, £12 below). No allowance extra: the restaurant fee is the
 * whole delivery charge. Refuses a dish over the most any one product may cost, a basket over
 * the most one order carries, and a basket below the smallest restaurant order.
 */
export function priceRestaurantBasket(
  lines: readonly PricedUnitLine[],
  plan: DeliveryPlan,
  fees: DeliveryFees,
  settings: Pick<
    RestaurantSettings,
    'feePence' | 'largeOrderFeePence' | 'largeOrderFromPence' | 'minimumOrderPence'
  >,
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
  const feePence = restaurantFeePence(settings, goodsPence);
  return {
    goodsPence,
    itemChargesPence,
    feePence,
    allowanceExtraPence: 0,
    totalPence: goodsPence + itemChargesPence + feePence,
    plan,
  };
}
