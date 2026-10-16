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

import { canTransition, formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, Runner } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { orderReference } from '../routes/admin.js';
import { offerExpiryAt } from './allocation.js';
import { releaseExtraDelivery } from './basket-orders.js';
import { canCarry, offerOrder } from './dispatch.js';
import { tellShopperWords } from './order-updates.js';
import { hasAgreed } from './runner-agreement.js';
import { releaseCard } from './runner-card.js';
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

/** Every offer still open on this order is withdrawn. */
async function withdrawOffers(ctx: Pick<AppContext, 'repository' | 'now'>, orderId: string) {
  const at = ctx.now();
  for (const offer of await ctx.repository.offers.listForOrder(orderId)) {
    if (offer.outcome === 'pending') {
      await ctx.repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
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
  input: { reason: string; by: string },
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
  const paid =
    order.paidBy === 'card'
      ? order.stripePaymentIntentId !== null
      : order.bankReceivedAt !== null || order.status !== 'confirmed';
  if (paid) {
    const owed = orderTotalPence(order) - (await alreadyRefundedPence(ctx, order));
    if (order.paidBy === 'card' && order.stripePaymentIntentId && owed > 0) {
      await payments.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        amountPence: owed,
        reference: `cancel:${order.id}`,
      });
      refundedPence = owed;
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

  const message =
    refundedPence > 0
      ? `Cancelled order ${reference}. ${money(refundedPence)} is going back to the card.`
      : bankRefundPence > 0
        ? `Cancelled order ${reference}. The bank transfer of ${money(bankRefundPence)} is on the till cases, to send back by hand.`
        : `Cancelled order ${reference}. Nothing was taken.`;
  return { order: updated, refundedPence, bankRefundPence, message };
}

export interface GoodwillOutcome {
  order: Order;
  reference: string;
  message: string;
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
  const result = await payments.refundPayment({
    paymentIntentId: order.stripePaymentIntentId,
    amountPence: input.amountPence,
    reference: `goodwill:${order.id}`,
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

/** May this Runner be given a job by a person: approved, agreed, still with us. */
export function mayBeAssigned(runner: Runner): boolean {
  return (
    runner.rightToWorkVerified &&
    runner.criminalRecordCheckVerified &&
    hasAgreed(runner) &&
    !runner.leftAt &&
    !runner.isDemo
  );
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

  const releasedRunner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
  await withdrawOffers(ctx, order.id);
  if (order.payMethodUsed === 'card') await releaseCard(ctx, order.runnerId, order.id, log);
  let updated = await repository.orders.update(order.id, {
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
      `Order ${reference} has been given to another Runner by the office. Please stop, and do not buy anything for it. Ring us if you already have.`,
      log,
    );
  }

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
