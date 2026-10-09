import {
  displayPricePence,
  formatPence,
  productAllowed,
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

/** How delivery is priced for this Shopper, in one plain sentence (ruling 58). */
export function deliveryWords(plan: DeliveryPlan): string {
  const delivery = storeConfig.fees.delivery;
  switch (plan) {
    case 'plus':
      return `Delivery is ${money(delivery.plusPence)} on your plan, whatever the size of the shop.`;
    case 'membership':
      return `Delivery is ${money(delivery.membershipPence)} with membership, whatever the size of the shop.`;
    default:
      return `Paying as you go, delivery is ${money(delivery.payAsYouGoSmallOrderPence)} for shopping of ${money(delivery.payAsYouGoSmallOrderUpToPence)} or less, and ${money(delivery.payAsYouGoPence)} above that.`;
  }
}
