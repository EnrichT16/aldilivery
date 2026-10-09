/**
 * Paying a Runner back for the shopping (ruling 55, Anthony, 9 October 2026: "choice 1").
 *
 * The Runner pays at the till with their own card. When they send the till total, the app pays
 * them back straight away, through the same Stripe Connect transfer that pays their five pounds,
 * to their own account. Their five pounds for the delivery still follows when they hand the
 * shopping over (services/pay-runner.ts), and Rule Two is untouched: the pay-back is their own
 * money coming back, never pay.
 *
 * The rules:
 *
 * - Only the till total that was accepted is paid back. Without a person, that is a till total
 *   no more than the estimate plus the larger of £5 or a fifth of it, the same limit the
 *   Shopper's card is settled within (services/till.ts).
 * - Never more than one delivery carries (Rule Three, £60).
 * - When the till needs a person (too far over the estimate, a bank transfer, a refund or charge
 *   that failed), the pay-back waits for a person too. It is shown in the admin panel's
 *   Payments tab with an Approve button, and the owner is texted.
 * - Once only. The transfer carries the reference reimburse:<order id>, so asking twice sends
 *   one transfer, and an order already paid back is never paid again.
 * - Rule Ten: the money goes straight out to the Runner's own account. If their account is not
 *   ready, it is owed, shown to them, and sent by the payout sweep as soon as it is.
 *
 * Everything is written on the order, so the Runner's page and the owner's money page read the
 * same record.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { canBePaid } from './pay-runner.js';
import { tillLimitPence, type TillOutcome } from './till.js';

type ReimburseContext = Pick<
  AppContext,
  'repository' | 'config' | 'payments' | 'now' | 'sendText' | 'env'
>;

export type ReimbursementOutcome =
  | { kind: 'paid'; pence: number; message: string }
  | { kind: 'waiting'; pence: number; reason: string; message: string }
  | { kind: 'owed'; pence: number; message: string };

/** The reference on the transfer, which makes it happen once only. */
export function reimbursementReference(orderId: string): string {
  return `reimburse:${orderId}`;
}

/**
 * How much the Runner is paid back for this till total, and why a person must look first, if
 * they must. Pure, so the limits are proved without a server.
 */
export function planReimbursement(input: {
  receiptTotalPence: number;
  goodsEstimatePence: number;
  maximumGoodsPence: number;
  /** Why the till itself is waiting for a person, if it is. */
  tillNeedsPerson: string | null;
}): { pence: number; waitReason: string | null } {
  const pence = Math.min(input.receiptTotalPence, input.maximumGoodsPence);
  if (input.tillNeedsPerson) return { pence, waitReason: input.tillNeedsPerson };
  if (input.receiptTotalPence > input.maximumGoodsPence) {
    return { pence, waitReason: 'over what one delivery carries' };
  }
  if (
    input.receiptTotalPence >
    input.goodsEstimatePence + tillLimitPence(input.goodsEstimatePence)
  ) {
    return { pence, waitReason: 'over the limit' };
  }
  return { pence, waitReason: null };
}

/**
 * The plain words a Runner is told once the money has gone. With the delivery pay too when it
 * has been paid; otherwise what is still to come.
 */
export function paidBackWords(
  pence: number,
  symbol: string,
  delivery: { pence: number; paid: boolean },
): string {
  return delivery.paid
    ? `You've been paid back ${formatPence(pence, symbol)} for the shopping and ${formatPence(delivery.pence, symbol)} for the delivery.`
    : `You've been paid back ${formatPence(pence, symbol)} for the shopping. Your ${formatPence(delivery.pence, symbol)} for the delivery follows when you hand the shopping over.`;
}

async function alertOwner(
  ctx: ReimburseContext,
  words: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  if (!ctx.env.ownerAlertPhone || !ctx.sendText) return;
  await ctx
    .sendText(ctx.env.ownerAlertPhone, `${ctx.config.productName} Runner pay-back: ${words}`)
    .catch((failure: unknown) => log?.warn({ err: failure }, 'The owner could not be told.'));
}

/**
 * Straight after the till total is in, and after the Shopper's card is settled: pay the Runner
 * back, or hold it for a person. Called once per order; an order already started is left alone.
 */
export async function startReimbursement(
  ctx: ReimburseContext,
  order: Order,
  settled: TillOutcome,
  log?: FastifyBaseLogger,
): Promise<ReimbursementOutcome | null> {
  if (order.receiptTotalPence === null || !order.runnerId) return null;
  const money = (pence: number): string => formatPence(pence, ctx.config.store.currencySymbol);

  if (order.reimbursementStatus !== null) {
    return describe(ctx, order);
  }

  const plan = planReimbursement({
    receiptTotalPence: order.receiptTotalPence,
    goodsEstimatePence: order.goodsEstimatePence,
    maximumGoodsPence: ctx.config.fees.maximumGoodsPence,
    tillNeedsPerson: settled.kind === 'needs-person' ? settled.reason : null,
  });

  if (plan.waitReason !== null) {
    await ctx.repository.orders.update(order.id, {
      reimbursementPence: plan.pence,
      reimbursementStatus: 'waiting',
      reimbursementReason: plan.waitReason,
    });
    await alertOwner(
      ctx,
      `paying back ${money(plan.pence)} for order ${order.id} (${plan.waitReason}) is waiting for you to approve in the Payments tab.`,
      log,
    );
    return {
      kind: 'waiting',
      pence: plan.pence,
      reason: plan.waitReason,
      message: `A person needs to check this till total before we pay you back ${money(plan.pence)} for the shopping. We will do it as soon as we can and let you know.`,
    };
  }

  await ctx.repository.orders.update(order.id, {
    reimbursementPence: plan.pence,
    reimbursementStatus: 'owed',
    reimbursementReason: null,
  });
  return sendReimbursement(ctx, order.id, null, log);
}

/** What has happened so far, in the same shape, for an order already started. */
async function describe(ctx: ReimburseContext, order: Order): Promise<ReimbursementOutcome> {
  const symbol = ctx.config.store.currencySymbol;
  const pence = order.reimbursementPence ?? 0;
  if (order.reimbursementStatus === 'paid') {
    const payout = await ctx.repository.payouts.findByOrderId(order.id);
    return {
      kind: 'paid',
      pence,
      message: paidBackWords(pence, symbol, {
        pence: payout?.earnedPence ?? order.runnerPaymentPence,
        paid: payout !== null,
      }),
    };
  }
  if (order.reimbursementStatus === 'waiting') {
    return {
      kind: 'waiting',
      pence,
      reason: order.reimbursementReason ?? '',
      message: `A person needs to check this till total before we pay you back ${formatPence(pence, symbol)} for the shopping.`,
    };
  }
  return {
    kind: 'owed',
    pence,
    message: `We owe you ${formatPence(pence, symbol)} for the shopping. It is sent as soon as your payout account is ready.`,
  };
}

/**
 * Send the pay-back. For an order that is owed, or one a person has just approved (`approvedBy`).
 * Never for one still waiting for a person, and never twice.
 */
export async function sendReimbursement(
  ctx: ReimburseContext,
  orderId: string,
  approvedBy: string | null,
  log?: FastifyBaseLogger,
): Promise<ReimbursementOutcome> {
  const { repository, config, payments, now } = ctx;
  const symbol = config.store.currencySymbol;
  const order = await repository.orders.findById(orderId);
  if (!order) throw new NotFoundError('order');
  if (order.reimbursementStatus === null || order.reimbursementPence === null) {
    throw new ConflictError('There is no till total to pay back on that order yet.');
  }
  if (order.reimbursementStatus === 'paid') return describe(ctx, order);
  if (order.reimbursementStatus === 'waiting' && approvedBy === null) {
    throw new ConflictError('That pay-back is waiting for a person to approve it.');
  }
  if (!order.runnerId) throw new ConflictError('That order has no Runner.');
  const runner = await repository.runners.findById(order.runnerId);
  if (!runner) throw new NotFoundError('Runner');

  // Never more than one delivery carries, whoever asks.
  const pence = Math.min(order.reimbursementPence, config.fees.maximumGoodsPence);
  const owed = async (): Promise<ReimbursementOutcome> => {
    await repository.orders.update(order.id, {
      reimbursementPence: pence,
      reimbursementStatus: 'owed',
      ...(approvedBy !== null ? { reimbursementApprovedBy: approvedBy } : {}),
    });
    return {
      kind: 'owed',
      pence,
      message: `We owe you ${formatPence(pence, symbol)} for the shopping. Nothing is lost: it is sent as soon as your payout account is ready.`,
    };
  };

  if (
    !(await canBePaid(ctx, runner.stripeConnectedAccountId)) ||
    !runner.stripeConnectedAccountId
  ) {
    return owed();
  }

  // Tied to the Shopper's payment when it can cover this and the delivery pay together, so
  // the Runner is paid from money Stripe is still settling; otherwise from the balance.
  const coverable = order.totalEstimatePence - order.creditAppliedPence;
  const fromShoppersPayment =
    order.stripePaymentIntentId !== null && pence + order.runnerPaymentPence <= coverable;

  let transferId: string;
  try {
    const transfer = await payments.createTransfer({
      amountPence: pence,
      currency: config.fees.currency,
      destinationAccountId: runner.stripeConnectedAccountId,
      orderId: order.id,
      description: `${config.productName} shopping paid back, order ${order.id}`,
      sourcePaymentIntentId: fromShoppersPayment
        ? (order.stripePaymentIntentId ?? undefined)
        : undefined,
      idempotencyKey: reimbursementReference(order.id),
    });
    transferId = transfer.id;
  } catch (failure) {
    log?.warn({ err: failure, orderId: order.id }, 'The Runner could not be paid back yet.');
    return owed();
  }

  await repository.orders.update(order.id, {
    reimbursementPence: pence,
    reimbursementStatus: 'paid',
    reimbursementTransferId: transferId,
    reimbursedAt: now(),
    ...(approvedBy !== null ? { reimbursementApprovedBy: approvedBy } : {}),
  });
  const payout = await repository.payouts.findByOrderId(order.id);
  return {
    kind: 'paid',
    pence,
    message: paidBackWords(pence, symbol, {
      pence: payout?.earnedPence ?? order.runnerPaymentPence,
      paid: payout !== null,
    }),
  };
}

/**
 * Send every pay-back that is owed, where the Runner's account is now ready. Run on the same
 * timer as the payout sweep. Each order on its own, so one failure does not hold up the rest.
 */
export async function sweepReimbursements(
  ctx: ReimburseContext,
  onError: (orderId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  let paid = 0;
  for (const order of await ctx.repository.orders.listByReimbursementStatus('owed')) {
    try {
      const outcome = await sendReimbursement(ctx, order.id, null);
      if (outcome.kind === 'paid') paid += 1;
    } catch (failure) {
      onError(order.id, failure);
    }
  }
  return paid;
}
