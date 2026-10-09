/**
 * Order rules: the confirmation gate, and repricing to the receipt.
 *
 * Rule One is the whole reason this file exists as something separate from the route. The
 * check that a Shopper confirmed is not a line of code inside a handler where it could be
 * moved, reordered or forgotten during a refactor. It is a named function with its own
 * test, and every path to a payment goes through it.
 */

import { canTransition, type OrderStatus } from '@aldilivery/core';

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

/**
 * Reprice an order to the receipt the Runner actually got at the till.
 *
 * The Shopper is charged the shelf price, so the estimate never binds them. Delivery and the
 * item charges stay what the Shopper agreed to when they said yes (ruling 58): the till only
 * ever changes the shopping, which goes to the shop. The maximum basket is not applied here: it
 * was checked when the order was placed, and a shelf price a few pence above the estimate must
 * never stop an order that is already in the Runner's hands.
 */
export function repriceToReceipt(
  receiptTotalPence: number,
  order: { goodsEstimatePence: number; itemChargesPence: number; feePence: number },
): Repricing {
  if (!Number.isInteger(receiptTotalPence) || receiptTotalPence < 0) {
    throw new BadRequestError('A receipt total must be a whole number of pence.');
  }

  const receiptFeePence = order.feePence;
  return {
    receiptTotalPence,
    receiptFeePence,
    finalTotalPence: receiptTotalPence + order.itemChargesPence + receiptFeePence,
    differenceFromEstimatePence: order.goodsEstimatePence - receiptTotalPence,
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
