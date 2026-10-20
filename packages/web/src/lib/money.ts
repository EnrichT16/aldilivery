import {
  allowancePlanWords,
  deliveryPriceRange,
  deliveryStepsWords,
  displayPricePence,
  formatPence,
  productAllowed,
  type AllowancePlan,
  type DeliveryPlan,
} from '@aldilivery/core';

import { storeConfig } from '../config';

/** Money on screen, always through one function, always from configuration. */
export function money(pence: number): string {
  return formatPence(pence, storeConfig.store.currencySymbol);
}

/**
 * The price shown or said for one of a product: its shop price with the item charge already in
 * it (ruling 58). UK pricing law does not let a compulsory charge be added later, so every price
 * a Shopper sees or hears goes through here.
 */
export function shownPrice(shopPricePence: number): number {
  return displayPricePence(shopPricePence, storeConfig.fees);
}

/** Whether a product may be sold at all: no single product over the configured most (£60). */
export function sellable(shopPricePence: number): boolean {
  return productAllowed(shopPricePence, storeConfig.fees);
}

/** What to say when a product is dearer than any one product may be. */
export function tooDearWords(name: string): string {
  return `We can't bring ${name}: no single product can cost more than ${money(storeConfig.fees.maximumProductPence)}.`;
}

/**
 * A plan's delivery prices, by the value of the shopping, in one plain phrase (ruling 63):
 * "£10.99 for shopping up to £30.00, £12.99 up to £60.00, and £14.99 over £60.00".
 */
export function planDeliveryWords(plan: DeliveryPlan): string {
  return deliveryStepsWords(plan, storeConfig.fees, money);
}

/**
 * A plan's monthly order allowance in one plain phrase (ruling 73): "5 orders a month; after
 * that, an extra £5.99 delivery charge on the next order and every 3rd order after it". Empty
 * for pay as you go, which has none.
 */
export function planAllowanceWords(plan: AllowancePlan): string {
  return allowancePlanWords(plan, storeConfig.fees.delivery.allowance, money) ?? '';
}

/** The cheapest and dearest delivery on any plan: "£6.99 to £14.99". */
export function deliveryRangeWords(): string {
  const { lowestPence, highestPence } = deliveryPriceRange(storeConfig.fees);
  return `${money(lowestPence)} to ${money(highestPence)}`;
}

/** How delivery is priced for this Shopper, in one plain sentence (rulings 58 and 63). */
export function deliveryWords(plan: DeliveryPlan): string {
  switch (plan) {
    case 'plus':
      return `Delivery is ${planDeliveryWords('plus')} on your plan.`;
    case 'membership':
      return `Delivery is ${planDeliveryWords('membership')} with membership.`;
    default:
      return `Paying as you go, delivery is ${planDeliveryWords('payg')}.`;
  }
}
