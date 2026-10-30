/**
 * Order rescue tools for the admin panel (16 October 2026 review).
 *
 * Three things a person can do to an order that has gone wrong, each written in the audit log
 * by the route that calls it, and each open only to a job that holds the Orders tab:
 *
 * - Cancel it. A card payment goes back in full through the payments gateway, by the payment
 *   it came from: no card number is ever seen here (Rule Ten). A bank transfer that has
 *   arrived is marked for a person to send back by hand, on the Payments tab's till cases; one
 *   that has not arrived is simply cancelled, and nothing is taken. The Runner, if there is
 *   one, is told to stop, and the Shopper is told.
 * - A goodwill refund of a stated amount, on a card payment. Never more than the order cost,
 *   counting any complaint refunds already given. Above `admin.ownerOnlyRefundAbovePence` it
 *   is the owner's alone to give, as a complaint refund is (checked by the route).
 * - Reassign a stuck order: the Runner who has it is released and told, and the order is
 *   offered again through the dispatcher, or straight to a named Runner who may carry it.
 */

import type { FastifyBaseLogger } from 'fastify';

import { canTransition, formatPence, ukMoment } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, Runner } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { RefundRefusedError } from '../lib/payments.js';
import { orderReference } from '../routes/admin.js';
import { offerExpiryAt } from './allocation.js';
import { isUkMobile } from '../lib/phone.js';
import { allocatedOrderIds } from './allocate.js';
import { releaseExtraDelivery } from './basket-orders.js';
import { canCarry, offerOrder } from './dispatch.js';
import { tellShopperWords } from './order-updates.js';
import { hasAgreed } from './runner-agreement.js';
import { releaseCard } from './runner-card.js';
import { checksPassed } from './runner-pool.js';
import { syncSplitParent } from './split.js';

/** What the Shopper was charged, less gift card money, which went back to the card already. */
export function orderTotalPence(order: Order): number {
  return (order.finalTotalPence ?? order.totalEstimatePence) - order.creditAppliedPence;
}

/** What has already gone back on this order: complaint refunds and goodwill. */
export async function alreadyRefundedPence(
  ctx: Pick<AppContext, 'repository'>,
  order: Order,
): Promise<number> {
  const problems = await ctx.repository.problems.listForOrder(order.id);
  return (
    problems.reduce((sum, report) => sum + report.refundPence, 0) + order.goodwillRefundedPence
  );
}

/** Statuses where a Runner is holding the order in their hands. */
const WITH_RUNNER: readonly Order['status'][] = [
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

async function tellRunner(
  ctx: AppContext,
  runnerId: string | null,
  body: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!runnerId || !ctx.sendText) return;
  const runner = await ctx.repository.runners.findById(runnerId);
  if (!runner) return;
  await ctx
    .sendText(runner.phone, `${ctx.config.productName}: ${body}`)
    .catch((failure: unknown) => log.warn({ err: failure }, 'The Runner could not be told.'));
}

/**
 * Every offer still open on this order is withdrawn, and so is any job the office sent straight
 * to a Runner for it (ruling 80), queued or offered.
 */
export async function withdrawOffers(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  orderId: string,
): Promise<void> {
  const at = ctx.now();
  for (const offer of await ctx.repository.offers.listForOrder(orderId)) {
    if (offer.outcome === 'pending') {
      await ctx.repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
    }
  }
  for (const allocation of await ctx.repository.allocations.listForOrder(orderId)) {
    if (allocation.status === 'queued' || allocation.status === 'offered') {
      await ctx.repository.allocations.update(allocation.id, {
        status: 'withdrawn',
        settledAt: at,
      });
    }
  }
}

export interface CancelOutcome {
  order: Order;
  /** What went back to the card, if a card had paid. */
  refundedPence: number;
  /** A bank transfer that arrived, now waiting for a person to send it back by hand. */
  bankRefundPence: number;
  message: string;
}

/**
 * Cancel an order that is still live, however far it has got, and give the money back.
 * Delivered and completed orders are not cancelled: a problem decision or a goodwill refund is
 * the way to put those right.
 */
export async function cancelOrder(
  ctx: AppContext,
  order: Order,
  input: {
    reason: string;
    by: string;
    /** The caller tells the Shopper itself (an automatic cancel, 30 October 2026). */
    tellShopper?: boolean;
  },
  log: FastifyBaseLogger,
): Promise<CancelOutcome> {
  const { repository, payments, config } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  if (order.status === 'cancelled' || order.status === 'refunded') {
    throw new ConflictError('That order is already cancelled.');
  }
  if (!canTransition(order.status, 'cancelled')) {
    throw new ConflictError(
      'That order has been delivered, so it cannot be cancelled. Decide a problem on it, or give a goodwill refund.',
    );
  }
  const at = ctx.now();
  const reference = orderReference(order);
  const reason = `Cancelled by ${input.by}: ${input.reason}`;

  // The money first, so a refund that the gateway refuses stops the cancellation.
  let refundedPence = 0;
  let bankRefundPence = 0;
  let noRealPayment = false;
  const paid =
    order.paidBy === 'card'
      ? order.stripePaymentIntentId !== null
      : order.bankReceivedAt !== null || order.status !== 'confirmed';
  if (paid) {
    const owed = orderTotalPence(order) - (await alreadyRefundedPence(ctx, order));
    if (order.paidBy === 'card' && order.stripePaymentIntentId && owed > 0) {
      try {
        await payments.refundPayment({
          paymentIntentId: order.stripePaymentIntentId,
          amountPence: owed,
          reference: `cancel:${order.id}`,
        });
        refundedPence = owed;
      } catch (failure) {
        // Stripe's live account has never heard of this payment: no real money was taken (an
        // order paid while card payments were in test mode), so there is nothing to send back
        // and the order is simply cancelled. Any other refusal stops the cancellation.
        if (!(failure instanceof RefundRefusedError && failure.code === 'resource_missing')) {
          throw refusal(failure, log);
        }
        log.warn({ orderId: order.id }, 'Cancelled with no refund: Stripe has no such payment.');
        noRealPayment = true;
      }
    } else if (order.paidBy === 'bank' && owed > 0) {
      bankRefundPence = owed;
    }
  }

  const withRunner = WITH_RUNNER.includes(order.status) ? order.runnerId : null;
  await withdrawOffers(ctx, order.id);
  const updated = await repository.orders.update(order.id, {
    status: 'cancelled',
    cancelledAt: at,
    cancelReason: reason,
    ...(bankRefundPence > 0
      ? {
          // The till cases on the Payments tab: "to give back", the whole amount, by hand.
          finalTotalPence: 0,
          tillStatus: 'needs_person' as const,
          tillReason: `The order was cancelled. The bank transfer of ${money(bankRefundPence)} must be sent back by hand.`,
        }
      : {}),
    ...(order.extraDeliveryStatus ? { extraDeliveryStatus: 'waived' as const } : {}),
  });

  // The parts of a split order, and the order a part belongs to, follow it.
  if (order.splitAt) {
    for (const part of await repository.orders.listParts(order.id)) {
      if (!canTransition(part.status, 'cancelled') || part.status === 'cancelled') continue;
      await withdrawOffers(ctx, part.id);
      await repository.orders.update(part.id, {
        status: 'cancelled',
        cancelledAt: at,
        cancelReason: reason,
      });
      if (WITH_RUNNER.includes(part.status) && part.runnerId) {
        await tellRunner(
          ctx,
          part.runnerId,
          `Order ${reference} has been cancelled by the office. Please stop, and do not buy anything for it. Ring us if you already have.`,
          log,
        );
      }
    }
  }
  await syncSplitParent(ctx, updated.splitParentId);
  if (order.extraDeliveryStatus) await releaseExtraDelivery(ctx, updated, log);
  if (order.payMethodUsed === 'card') await releaseCard(ctx, order.runnerId, order.id, log);

  if (withRunner) {
    await tellRunner(
      ctx,
      withRunner,
      `Order ${reference} has been cancelled by the office. Please stop, and do not buy anything for it. Ring us if you already have.`,
      log,
    );
  }
  if (input.tellShopper !== false) {
    await tellShopperWords(
      ctx,
      updated,
      refundedPence > 0
        ? `Your order ${reference} has been cancelled, and ${money(refundedPence)} is going back to your card. Your bank may take a few days to show it.`
        : bankRefundPence > 0
          ? `Your order ${reference} has been cancelled. We will send your ${money(bankRefundPence)} back to your bank account.`
          : `Your order ${reference} has been cancelled. Nothing has been taken.`,
      log,
    );
  }

  const message =
    refundedPence > 0
      ? `Cancelled order ${reference}. ${money(refundedPence)} is going back to the card.`
      : bankRefundPence > 0
        ? `Cancelled order ${reference}. The bank transfer of ${money(bankRefundPence)} is on the till cases, to send back by hand.`
        : noRealPayment
          ? `Cancelled order ${reference}. Stripe has no record of a real payment for it, so nothing needed to go back.`
          : `Cancelled order ${reference}. Nothing was taken.`;
  return { order: updated, refundedPence, bankRefundPence, message };
}

export interface GoodwillOutcome {
  order: Order;
  reference: string;
  message: string;
}

/** What staff are told when Stripe refuses a refund, in place of "Something went wrong". */
function refusal(failure: unknown, log: FastifyBaseLogger): unknown {
  if (!(failure instanceof RefundRefusedError)) return failure;
  log.warn({ code: failure.code, err: failure }, 'Stripe refused a refund.');
  switch (failure.code) {
    case 'resource_missing':
      return new ConflictError(
        'Stripe has no record of this payment on the live account, so no real money was taken for it. It was most likely paid while card payments were in test mode. Cancel the order instead: nothing needs to go back.',
      );
    case 'charge_already_refunded':
      return new ConflictError('Stripe says this payment has already been refunded in full.');
    default:
      return new ConflictError(`Stripe did not send the refund. It said: ${failure.message}`);
  }
}

/** A goodwill refund of a stated amount, to the card that paid. */
export async function goodwillRefund(
  ctx: AppContext,
  order: Order,
  input: { amountPence: number; reason: string },
  log: FastifyBaseLogger,
): Promise<GoodwillOutcome> {
  const { repository, payments, config } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  if (order.paidBy !== 'card' || !order.stripePaymentIntentId) {
    throw new ConflictError(
      'There is no card payment on this order to refund. A bank transfer is sent back by hand.',
    );
  }
  const left = orderTotalPence(order) - (await alreadyRefundedPence(ctx, order));
  if (input.amountPence > left) {
    throw new BadRequestError(
      left > 0
        ? `That would refund more than the order cost. Up to ${money(left)} can still go back.`
        : 'Everything this order cost has already gone back.',
    );
  }
  const result = await payments
    .refundPayment({
      paymentIntentId: order.stripePaymentIntentId,
      amountPence: input.amountPence,
      reference: `goodwill:${order.id}`,
    })
    .catch((failure: unknown) => {
      throw refusal(failure, log);
    });
  const updated = await repository.orders.update(order.id, {
    goodwillRefundedPence: order.goodwillRefundedPence + input.amountPence,
  });
  const reference = orderReference(order);
  await tellShopperWords(
    ctx,
    updated,
    `We have sent ${money(input.amountPence)} back to your card for order ${reference}, with our apologies. ${input.reason}`,
    log,
  );
  return {
    order: updated,
    reference: result.id,
    message: `${money(input.amountPence)} is going back to the card for order ${reference}.`,
  };
}

export interface ReassignOutcome {
  order: Order;
  /** The Runner released, by first name. */
  released: string | null;
  /** Who it was offered to next, by first name, if anyone. */
  offeredTo: string | null;
  message: string;
}

/** "Ada Lovelace" gives "Ada". */
function firstName(name: string | null | undefined): string | null {
  return name ? (name.trim().split(/\s+/)[0] ?? null) : null;
}

/** May this Runner be given a job by a person: every check passed, agreed, still with us. */
export function mayBeAssigned(runner: Runner): boolean {
  return checksPassed(runner) && hasAgreed(runner) && !runner.leftAt && !runner.isDemo;
}

/**
 * Takes an order back from whoever has it, before the shopping is bought: every open offer and
 * office allocation withdrawn, the spending card released, the order back to paid with nobody,
 * and the Runner who had it told to stop. Shared by reassigning (below) and by the office
 * sending it straight to another Runner (services/allocate.ts, ruling 80).
 */
export async function releaseRunner(
  ctx: AppContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<{ order: Order; runner: Runner | null }> {
  const { repository } = ctx;
  const releasedRunner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
  await withdrawOffers(ctx, order.id);
  if (order.payMethodUsed === 'card') await releaseCard(ctx, order.runnerId, order.id, log);
  const updated = await repository.orders.update(order.id, {
    status: 'paid',
    runnerId: null,
    acceptedAt: null,
    payMethodUsed: null,
    cardLimitPence: null,
  });
  if (releasedRunner) {
    await tellRunner(
      ctx,
      releasedRunner.id,
      `Order ${orderReference(order)} has been given to another Runner by the office. Please stop, and do not buy anything for it. Ring us if you already have.`,
      log,
    );
  }
  return { order: updated, runner: releasedRunner };
}

/**
 * Release the Runner who has a stuck order, and offer it again: to a named approved Runner, or
 * through the dispatcher's own queue. Not once the till total is in: the shopping has been
 * bought by then, and a person must settle that first.
 */
export async function reassignOrder(
  ctx: AppContext,
  order: Order,
  input: { runnerId?: string | undefined; by: string },
  log: FastifyBaseLogger,
): Promise<ReassignOutcome> {
  const { repository, config } = ctx;
  if (order.status === 'receipt_submitted' || order.status === 'delivering') {
    throw new ConflictError(
      'The shopping has been bought, so this order cannot be given to another Runner. Ring the Runner, or cancel the order.',
    );
  }
  if (!['paid', 'offered', 'accepted', 'shopping'].includes(order.status)) {
    throw new ConflictError('That order is not with a Runner, or waiting for one.');
  }
  if (order.isDemo || order.splitAt) {
    throw new ConflictError('That order is not offered as one job.');
  }
  const at = ctx.now();
  const reference = orderReference(order);

  let chosen: Runner | null = null;
  if (input.runnerId) {
    chosen = await repository.runners.findById(input.runnerId);
    if (!chosen) throw new NotFoundError('Runner');
    if (chosen.id === order.runnerId) {
      throw new BadRequestError('That Runner already has this order.');
    }
    if (!mayBeAssigned(chosen)) {
      throw new BadRequestError(`${chosen.name} is not approved to take jobs.`);
    }
    if (!canCarry(config, chosen, order, at)) {
      throw new BadRequestError(`${chosen.name} cannot carry this order.`);
    }
  }

  const freed = await releaseRunner(ctx, order, log);
  const releasedRunner = freed.runner;
  let updated = freed.order;

  let offeredTo: string | null = null;
  if (chosen) {
    await repository.offers.create({
      orderId: order.id,
      runnerId: chosen.id,
      expiresAt: offerExpiryAt(at, config.allocation.offerHoldSeconds),
      queuePosition: 1,
      distanceMiles: null,
    });
    updated = await repository.orders.update(order.id, { status: 'offered' });
    offeredTo = firstName(chosen.name);
  } else {
    const result = await offerOrder(ctx, order.id);
    if (result.offer) {
      const next = await repository.runners.findById(result.offer.runnerId);
      offeredTo = firstName(next?.name);
    }
    updated = (await repository.orders.findById(order.id)) ?? updated;
  }

  await tellShopperWords(
    ctx,
    updated,
    `Your order ${reference} is being passed to another Runner. We will tell you when one has it.`,
    log,
  );
  const released = firstName(releasedRunner?.name);
  const message = `${released ? `${released} has been released from order ${reference}.` : `Order ${reference} is offered again.`} ${offeredTo ? `It is offered to ${offeredTo} now.` : 'No Runner is free for it yet; the dispatcher keeps looking.'}`;
  return { order: updated, released, offeredTo, message };
}

/* ------------------------------------------------------------------ orders no Runner takes */

/** Why an order no Runner took was cancelled, said to the Shopper as it is (30 October 2026). */
export const NO_RUNNER_REFUND_REASON =
  'No Runner was able to take your order, so it has been cancelled and your money given back in full.';

/** Who the audit log says did it. */
export const AUTOMATIC_ACTOR = 'Ozi (automatic)';

/** Paid, and nobody has it yet. */
const UNTAKEN = new Set<Order['status']>(['paid', 'offered']);

/**
 * When the two hours start for an order no Runner has taken: when it was paid, or for an order
 * booked for a later day (ruling 78), the start of its delivery window, if that is later.
 */
export function untakenSince(order: Order, config: AppContext['config']): Date {
  const paid = order.bankReceivedAt ?? order.spokenConfirmationAt ?? order.createdAt;
  if (!order.deliveryDay || !order.deliveryWindow) return paid;
  const windowStart = ukMoment(
    order.deliveryDay,
    config.scheduled.windows[order.deliveryWindow].from,
  );
  return windowStart.getTime() > paid.getTime() ? windowStart : paid;
}

/**
 * Orders no Runner takes (Anthony, 30 October 2026). A paid order that no Runner has accepted
 * `dispatch.autoRefundAfterMinutes` (120) after it was paid, or after its window starts if it was
 * booked for a later day, is cancelled with a full refund by the same path staff use
 * (`cancelOrder`). The Shopper is told by text and in their inbox, with the reason; the audit log
 * says "Ozi (automatic)". Run on the offer sweep's timer.
 *
 * Left alone: a demo order; an order the office sent to a named Runner (ruling 80), which a
 * person is handling; a part of a split order, because the whole order is what was paid for. A
 * split order is cancelled whole only when no part of it has a Runner; once any part has one, a
 * person decides. Each order is read again before it is cancelled, and a cancelled order is not
 * cancelled twice, so the refund is made once.
 */
export async function refundUntakenOrders(
  ctx: AppContext,
  log: FastifyBaseLogger,
): Promise<string[]> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const limit = config.dispatch.autoRefundAfterMinutes * 60_000;
  const allocated = await allocatedOrderIds(ctx);
  const waiting = [
    ...(await repository.orders.listByStatus('paid')),
    ...(await repository.orders.listByStatus('offered')),
  ];
  const cancelled: string[] = [];
  for (const listed of waiting) {
    try {
      if (listed.isDemo || listed.splitParentId || listed.runnerId) continue;
      if (allocated.has(listed.id)) continue;
      if (at.getTime() - untakenSince(listed, config).getTime() < limit) continue;
      if (listed.splitAt) {
        const parts = await repository.orders.listParts(listed.id);
        if (parts.some((part) => part.runnerId !== null || !UNTAKEN.has(part.status))) continue;
        if (parts.some((part) => allocated.has(part.id))) continue;
      }
      // Read again: a Runner may have taken it a moment ago, or it may already be cancelled.
      const order = await repository.orders.findById(listed.id);
      if (!order || !UNTAKEN.has(order.status) || order.runnerId) continue;
      const outcome = await cancelOrder(
        ctx,
        order,
        { reason: NO_RUNNER_REFUND_REASON, by: AUTOMATIC_ACTOR, tellShopper: false },
        log,
      );
      cancelled.push(order.id);
      await tellShopperNoRunner(ctx, outcome.order, outcome, log);
      await repository.audit.record({
        at,
        actorId: null,
        actorName: AUTOMATIC_ACTOR,
        actorRole: 'automatic',
        action: 'order.auto-cancelled',
        target: `order=${order.id}`,
        detail: `${NO_RUNNER_REFUND_REASON} ${outcome.message}`.slice(0, 500),
        ip: '',
      });
    } catch (failure) {
      log.warn(
        { orderId: listed.id, err: failure },
        'An order no Runner took could not be cancelled',
      );
    }
  }
  return cancelled;
}

/** The Shopper hears why, by text where they have a mobile, and in their inbox. */
async function tellShopperNoRunner(
  ctx: AppContext,
  order: Order,
  outcome: CancelOutcome,
  log: FastifyBaseLogger,
): Promise<void> {
  const { repository, config } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const reference = orderReference(order);
  const words = `${NO_RUNNER_REFUND_REASON} ${
    outcome.refundedPence > 0
      ? `${money(outcome.refundedPence)} is going back to your card. Your bank may take a few days to show it.`
      : outcome.bankRefundPence > 0
        ? `We will send your ${money(outcome.bankRefundPence)} back to your bank account.`
        : 'Nothing has been taken.'
  } Order ${reference}.`;
  const shopper = await repository.shoppers.findById(order.shopperId);
  // A refund is said straight away, as every cancellation is: there is no quiet-hours rule for
  // the texts about an order.
  if (shopper && ctx.sendText && isUkMobile(shopper.phone)) {
    await ctx
      .sendText(shopper.phone, `${config.productName}: ${words}`)
      .catch((failure: unknown) => log.warn({ err: failure }, 'The Shopper could not be texted.'));
  } else {
    await tellShopperWords(ctx, order, words, log);
  }
  try {
    const contact = repository.companyContact;
    const thread = await contact.openThread('shopper', order.shopperId);
    const at = ctx.now();
    await contact.addMessage({
      threadId: thread.id,
      fromStaff: true,
      staffId: null,
      senderName: config.assistantName,
      text: words,
      createdAt: at,
      sentAt: at,
      readAt: null,
      status: 'sent',
      authorisedBy: null,
      authorisedByName: null,
    });
    await contact.updateThread(thread.id, { lastMessageAt: at });
  } catch (failure) {
    log.warn({ err: failure }, 'The Shopper inbox message could not be written.');
  }
}
