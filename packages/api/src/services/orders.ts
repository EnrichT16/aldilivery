/**
 * Order rules: the confirmation gate, and repricing to the receipt.
 *
 * Rule One is the whole reason this file exists as something separate from the route. The
 * check that a Shopper confirmed is not a line of code inside a handler where it could be
 * moved, reordered or forgotten during a refactor. It is a named function with its own
 * test, and every path to a payment goes through it.
 */

import { feeForGoodsPence, canTransition, type FeeBand, type OrderStatus } from '@aldilivery/core';

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
 * The Shopper is charged the shelf price, so the estimate never binds them. The fee is
 * recalculated against the receipt total rather than carried over from the estimate, which
 * keeps Rule Three true of the amount really charged and not merely of the amount quoted.
 */
export function repriceToReceipt(
  receiptTotalPence: number,
  goodsEstimatePence: number,
  bands: readonly FeeBand[],
): Repricing {
  if (!Number.isInteger(receiptTotalPence) || receiptTotalPence < 0) {
    throw new BadRequestError('A receipt total must be a whole number of pence.');
  }

  const receiptFeePence = feeForGoodsPence(receiptTotalPence, bands);
  return {
    receiptTotalPence,
    receiptFeePence,
    finalTotalPence: receiptTotalPence + receiptFeePence,
    differenceFromEstimatePence: goodsEstimatePence - receiptTotalPence,
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
