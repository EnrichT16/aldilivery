/**
 * Order rules: the confirmation gate, and repricing to the receipt.
 *
 * Rule One is the whole reason this file exists as something separate from the route. The
 * check that a Shopper confirmed is not a line of code inside a handler where it could be
 * moved, reordered or forgotten during a refactor. It is a named function with its own
 * test, and every path to a payment goes through it.
 */

import {
  canTransition,
  counterPricePence,
  shopPriceFromCounterPence,
  shownPriceFromCounterPence,
  type OrderStatus,
} from '@aldilivery/core';

import type { OrderItem } from '../domain.js';
import { BadRequestError, ConfirmationRequiredError, ConflictError } from '../errors.js';

export interface ConfirmableOrder {
  id: string;
  status: OrderStatus;
  spokenConfirmationAt: Date | null;
  confirmationStatement: string | null;
  stripePaymentIntentId: string | null;
}

/**
 * Rule One, in one place.
 *
 * Throws unless the Shopper has already given a single explicit confirmation, recorded on
 * the order, before this moment. Everything that could lead to money moving calls this
 * first.
 */
export function assertConfirmedBeforePayment(order: ConfirmableOrder): void {
  if (order.spokenConfirmationAt === null) {
    throw new ConfirmationRequiredError();
  }
}

/**
 * A confirmation is a single, explicit act. Confirming twice is not a second permission
 * for a second charge; it is refused, because the safest reading of a repeated confirmation
 * is that the Shopper is unsure whether the first one worked.
 */
export function assertNotAlreadyConfirmed(order: ConfirmableOrder): void {
  if (order.spokenConfirmationAt !== null) {
    throw new ConflictError(
      'You have already confirmed this order. We have not charged you twice.',
    );
  }
}

export function assertNotAlreadyPaid(order: ConfirmableOrder): void {
  if (order.stripePaymentIntentId !== null) {
    throw new ConflictError('This order has already been sent for payment.');
  }
}

export function assertTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new ConflictError(`An order cannot go from ${from} to ${to}.`, { from, to });
  }
}

export interface Repricing {
  receiptTotalPence: number;
  receiptFeePence: number;
  finalTotalPence: number;
  /** Positive when the receipt came in under the estimate; the Shopper pays less. */
  differenceFromEstimatePence: number;
}

/** What the order says about a restaurant, if it is from one (Anthony, 30 October 2026). */
interface RestaurantSide {
  goodsEstimatePence: number;
  restaurantShopId?: string | null;
  restaurantDiscountPercent?: number;
  /** Its things, with a partner's shop price and counter price where they were kept. */
  items?: ReadonlyArray<
    Pick<
      OrderItem,
      'estimatedPricePence' | 'quantity' | 'counterPricePence' | 'substitutionOutcome'
    >
  >;
}

/**
 * What Ozi keeps on a partner's things in the order, at the counter, over what the Runner pays:
 * for each thing kept with a counter price, what the Shopper pays less that (the mark-up and the
 * discount, Anthony, 30 October 2026). Things the Runner could not get are left out when
 * `available` is asked for.
 */
function partnerGapPence(order: RestaurantSide, available = false): number {
  return (order.items ?? []).reduce(
    (sum, item) =>
      item.counterPricePence === null ||
      item.counterPricePence === undefined ||
      (available && item.substitutionOutcome === 'unavailable')
        ? sum
        : sum + (item.estimatedPricePence - item.counterPricePence) * item.quantity,
    0,
  );
}

/** Whether every thing in a restaurant order kept its counter price (orders since mark-ups). */
function countersKept(order: RestaurantSide): boolean {
  const items = order.items ?? [];
  return items.length > 0 && items.every((item) => typeof item.counterPricePence === 'number');
}

/**
 * What the till is expected to say: the shopping at shop prices, or, for a restaurant that agreed
 * a discount for Ozi, the shop prices less that discount, which is what the Runner pays at the
 * counter. Every check on the Runner's side reads this: what they are told to pay, the till
 * total check, what their spending card is loaded with and what they are paid back. With
 * mark-ups (Anthony, 30 October 2026) it is the counter price of each partner thing, never the
 * marked-up price the Shopper pays.
 */
export function tillExpectedPence(order: RestaurantSide): number {
  if (order.restaurantShopId && !countersKept(order)) {
    return counterPricePence(order.goodsEstimatePence, order.restaurantDiscountPercent ?? 0);
  }
  return order.goodsEstimatePence - partnerGapPence(order);
}

/**
 * Reprice an order to the receipt the Runner actually got at the till.
 *
 * The Shopper is charged the shelf price, so the estimate never binds them. Delivery, any extra
 * delivery charge for the monthly allowance (ruling 73) and the item charges stay what the
 * Shopper agreed to when they said yes (ruling 58): the till only ever changes the shopping,
 * which goes to the shop. The maximum basket is not applied here: it was checked when the order
 * was placed, and a shelf price a few pence above the estimate must never stop an order that is
 * already in the Runner's hands.
 *
 * A restaurant order (Anthony, 30 October 2026): the receipt is what the Runner paid at the
 * counter, the shop prices less the discount the restaurant agreed for Ozi. The Shopper still
 * pays shop prices: the shop-price value of what was paid (exactly the shop prices agreed to,
 * when it was exactly what was expected). Ozi keeps the difference between the two.
 */
export function repriceToReceipt(
  receiptTotalPence: number,
  order: RestaurantSide & {
    itemChargesPence: number;
    feePence: number;
    allowanceExtraPence?: number;
  },
): Repricing {
  if (!Number.isInteger(receiptTotalPence) || receiptTotalPence < 0) {
    throw new BadRequestError('A receipt total must be a whole number of pence.');
  }

  const receiptFeePence = order.feePence;
  // A restaurant: the shown-price value of what was paid at the counter. A grocery order: the
  // till, plus what Ozi keeps on any partner thing that was bought (Anthony, 30 October 2026).
  const shopGoodsPence = order.restaurantShopId
    ? countersKept(order)
      ? shownPriceFromCounterPence(receiptTotalPence, {
          shownPence: order.goodsEstimatePence,
          counterPence: tillExpectedPence(order),
        })
      : shopPriceFromCounterPence(receiptTotalPence, {
          shopPricePence: order.goodsEstimatePence,
          discountPercent: order.restaurantDiscountPercent ?? 0,
        })
    : receiptTotalPence + partnerGapPence(order, true);
  return {
    receiptTotalPence,
    receiptFeePence,
    finalTotalPence:
      shopGoodsPence + order.itemChargesPence + receiptFeePence + (order.allowanceExtraPence ?? 0),
    differenceFromEstimatePence: tillExpectedPence(order) - receiptTotalPence,
  };
}

/**
 * Would this order take the Shopper past the cap they set for themselves?
 *
 * A budget cap is the Shopper's own limit and it is theirs to raise. It is never a minimum
 * spend and never a reason to refuse a small order (Rule Four).
 */
export function exceedsBudgetCap(goodsPence: number, budgetCapPence: number | null): boolean {
  return budgetCapPence !== null && goodsPence > budgetCapPence;
}
