/**
 * Gift card credit (7 October 2026).
 *
 * The card is charged the whole order, exactly as the Shopper agreed (Rule One), and once
 * the payment has gone through, the credit is given straight back to that same card. That
 * way nothing about how an order is priced, confirmed or paid changes, and a refused card
 * never uses up anybody's credit.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';

/** Gives the Shopper's credit back against a paid order. Returns how much, in pence. */
export async function applyCredit(
  ctx: AppContext,
  orderId: string,
  log?: FastifyBaseLogger,
): Promise<number> {
  const { repository, payments } = ctx;
  const order = await repository.orders.findById(orderId);
  if (!order || !order.stripePaymentIntentId || order.creditAppliedPence > 0) return 0;
  const shopper = await repository.shoppers.findById(order.shopperId);
  if (!shopper || shopper.creditPence <= 0) return 0;

  const amountPence = Math.min(shopper.creditPence, order.totalEstimatePence);
  if (amountPence <= 0) return 0;
  try {
    await payments.refundPayment({
      paymentIntentId: order.stripePaymentIntentId,
      amountPence,
      reference: `credit:${order.id}`,
    });
  } catch (failure) {
    // The credit stays where it is, to use next time. Nothing is lost.
    log?.warn({ orderId, err: failure }, 'Gift card credit could not be given back yet');
    return 0;
  }
  await repository.orders.update(order.id, { creditAppliedPence: amountPence });
  const remaining = shopper.creditPence - amountPence;
  await repository.shoppers.update(shopper.id, {
    creditPence: remaining,
    // "Unused Runner fee credit" (ruling 61) is part of the credit, and is used with it.
    unusedRunnerFeeCreditPence: Math.min(shopper.unusedRunnerFeeCreditPence, remaining),
  });
  return amountPence;
}
