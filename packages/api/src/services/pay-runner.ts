/**
 * Paying a Runner their five pounds.
 *
 * This used to live only in the staff payout route, which nothing called, and which could not
 * have worked anyway: no Runner had anywhere for the money to go. Now a Runner sets up a Stripe
 * account of their own from their page, and the payout happens by itself — straight after they
 * mark an order delivered, or, if their account was not ready then, from a sweep that pays
 * what is owed as soon as it is.
 *
 * Rule Two is checked on every payout, not assumed. Rule Ten holds because the money goes from
 * the Shopper's payment straight to the Runner's own account: The service never holds it.
 */

import { formatPence, RUNNER_PAYMENT_PENCE } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, RunnerPayout } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { planPayout, type PayoutPlan } from './payouts.js';
import { paidBackWords } from './reimburse.js';
import { syncSplitParent } from './split.js';

type PayContext = Pick<AppContext, 'repository' | 'config' | 'payments' | 'now'>;

export interface PayoutResult {
  payout: RunnerPayout;
  plan: PayoutPlan;
  order: Order;
  notes: string[];
}

export async function payOutOrder(ctx: PayContext, orderId: string): Promise<PayoutResult> {
  const { repository, config, payments, now } = ctx;
  const symbol = config.store.currencySymbol;

  const order = await repository.orders.findById(orderId);
  if (!order) throw new NotFoundError('order');
  if (!order.runnerId) throw new BadRequestError('That order has no Runner yet.');
  if (order.status !== 'delivered' && order.status !== 'completed') {
    throw new ConflictError('A Runner is paid once the order is delivered.');
  }

  const alreadyPaid = await repository.payouts.findByOrderId(order.id);
  if (alreadyPaid) {
    throw new ConflictError('That order has already been paid out.', { payoutId: alreadyPaid.id });
  }

  const runner = await repository.runners.findById(order.runnerId);
  if (!runner) throw new NotFoundError('Runner');

  // A Runner who has left is paid for a delivery made before they left, but nothing more is held
  // towards a deposit they will never use (services/runner-leaving.ts pays back what is held).
  // What the Runner was shown before taking the job, checked rather than assumed: five pounds
  // on every standard delivery (Rule Two); £7 for an order of £120 or more of shopping
  // delivered whole (Rule Two as amended by ruling 60, `fees.largeOrderRunnerPaymentPence`); a
  // part of a split job its own configured figure (ruling 60, £5).
  const isSplitPart = order.splitParentId !== null;
  const earned = order.runnerPaymentPence;
  const allowed = isSplitPart
    ? earned > 0
    : earned === RUNNER_PAYMENT_PENCE ||
      (order.goodsEstimatePence >= config.fees.largeOrderFromPence &&
        earned === config.fees.largeOrderRunnerPaymentPence);
  if (!allowed) {
    throw new Error(
      'Rule Two: a Runner earns five pounds on every standard delivery, or the large-order pay for £120 or more delivered whole.',
    );
  }
  const plan = planPayout(
    {
      coolBagDepositStatus: runner.leftAt ? 'released' : runner.coolBagDepositStatus,
      coolBagWithheldPence: runner.coolBagWithheldPence,
      completedDeliveryCount: runner.completedDeliveryCount,
    },
    config.fees.coolBag,
    earned,
  );

  // A refund the Runner was found at fault for (rulings of 2 October 2026): a small part of
  // each job's pay, never all of it, oldest first, until it is repaid. The earning stays five
  // pounds (Rule Two); only what is sent today is less, exactly as the cool bag deposit works.
  const owed = await repository.recoveries.listOutstanding(runner.id);
  const cap = Math.floor((plan.earnedPence * config.problems.recoveryPercentOfPay) / 100);
  let recoveryWithheldPence = 0;
  const takes: Array<{ id: string; recoveredPence: number }> = [];
  for (const recovery of owed) {
    const room = Math.min(
      cap - recoveryWithheldPence,
      plan.transferredPence - recoveryWithheldPence,
    );
    if (room <= 0) break;
    const take = Math.min(room, recovery.amountPence - recovery.recoveredPence);
    takes.push({ id: recovery.id, recoveredPence: recovery.recoveredPence + take });
    recoveryWithheldPence += take;
  }
  const transferredPence = plan.transferredPence - recoveryWithheldPence;

  let transferId: string | null = null;
  if (transferredPence > 0) {
    if (!runner.stripeConnectedAccountId) {
      throw new BadRequestError(
        'We cannot pay you until your bank details are set up. Nothing is lost; the money is owed to you.',
      );
    }
    const transfer = await payments.createTransfer({
      amountPence: transferredPence,
      currency: config.fees.currency,
      destinationAccountId: runner.stripeConnectedAccountId,
      orderId: order.id,
      description: `${config.productName} delivery ${order.id}`,
      sourcePaymentIntentId: order.stripePaymentIntentId ?? undefined,
    });
    transferId = transfer.id;
  }

  // Only once the money has gone: a failed transfer recovers nothing.
  for (const take of takes) {
    await repository.recoveries.update(take.id, { recoveredPence: take.recoveredPence });
  }

  const payout = await repository.payouts.create({
    orderId: order.id,
    runnerId: runner.id,
    earnedPence: plan.earnedPence,
    coolBagWithheldPence: plan.coolBagWithheldPence,
    recoveryWithheldPence,
    transferredPence,
    stripeTransferId: transferId,
  });

  await repository.runners.update(runner.id, {
    ...(runner.leftAt
      ? {}
      : {
          coolBagDepositStatus: plan.coolBagDepositStatusAfter,
          coolBagWithheldPence: plan.coolBagWithheldTotalAfter,
        }),
    completedDeliveryCount: plan.completedDeliveryCountAfter,
    lastJobCompletedAt: order.deliveredAt ?? now(),
  });

  const updatedOrder = await repository.orders.update(order.id, {
    status: 'completed',
    completedAt: order.completedAt ?? now(),
    runnerTransferId: transferId,
  });
  await syncSplitParent(ctx, updatedOrder.splitParentId);

  // Paid back for the shopping already (ruling 55): both said together, in plain words.
  const notes = [
    updatedOrder.reimbursementStatus === 'paid' && updatedOrder.reimbursementPence !== null
      ? paidBackWords(updatedOrder.reimbursementPence, symbol, {
          pence: plan.earnedPence,
          paid: true,
        })
      : `You earned ${formatPence(plan.earnedPence, symbol)} for this delivery.`,
  ];
  if (plan.coolBagWithheldPence > 0) {
    notes.push(
      `${formatPence(plan.coolBagWithheldPence, symbol)} is held towards your cool bag deposit. You get it back after ${config.fees.coolBag.releaseAfterCompletedDeliveries} deliveries.`,
    );
  }
  if (plan.coolBagReleasedPence > 0) {
    notes.push(
      `Your cool bag deposit of ${formatPence(plan.coolBagReleasedPence, symbol)} has been paid back to you.`,
    );
  }
  if (recoveryWithheldPence > 0) {
    notes.push(
      `${formatPence(recoveryWithheldPence, symbol)} went towards the refund you were found responsible for. You can see what is left in Money.`,
    );
  }
  notes.push(`${formatPence(transferredPence, symbol)} is on its way to your account.`);

  return { payout, plan, order: updatedOrder, notes };
}

/** Whether money can be sent to this Runner now. */
export async function canBePaid(
  ctx: Pick<AppContext, 'payments'>,
  stripeConnectedAccountId: string | null,
): Promise<boolean> {
  if (!stripeConnectedAccountId) return false;
  const status = await ctx.payments.getConnectedAccount(stripeConnectedAccountId);
  return status.transfersActive;
}

/**
 * Pay every delivered order that has not been paid, where the Runner's account is ready. Run on
 * a timer by the server. Each order on its own, so one failure does not hold up the rest.
 */
export async function sweepPayouts(
  ctx: PayContext,
  onError: (orderId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  const delivered = await ctx.repository.orders.listByStatus('delivered');
  const ready = new Map<string, boolean>();
  let paid = 0;

  for (const order of delivered) {
    if (!order.runnerId) continue;
    try {
      if (await ctx.repository.payouts.findByOrderId(order.id)) continue;
      if (!ready.has(order.runnerId)) {
        const runner = await ctx.repository.runners.findById(order.runnerId);
        ready.set(order.runnerId, await canBePaid(ctx, runner?.stripeConnectedAccountId ?? null));
      }
      if (!ready.get(order.runnerId)) continue;
      await payOutOrder(ctx, order.id);
      paid += 1;
    } catch (failure) {
      onError(order.id, failure);
    }
  }
  return paid;
}
