/**
 * The owner's till screen (docs/STILL_TO_DO.md item 1; ruling 52).
 *
 * Most till totals settle themselves on the Shopper's card the moment the Runner sends them
 * (services/till.ts). The rest wait here for a person: a large extra, an order paid by bank
 * transfer, or a charge or refund the card would not take. For each one the person sees the
 * estimate, what the till came to, the difference and the photo of the receipt, and either:
 *
 * - takes the extra from the saved card, never more than brings the charge up to the till total;
 * - gives the difference back to the card, never more than brings it down to the till total; or
 * - marks it settled by hand: a bank transfer sent back or collected, or an extra let go.
 *
 * The Shopper is told in plain words each time. Only the founder and the finance officer, who
 * hold the Payments tab, can see or do any of it. Paying the Runner back is separate, on the
 * same tab (routes/reimbursements.ts).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import type { Order } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import { tellShopperWords } from '../services/order-updates.js';
import { tillDifferencePence } from '../services/till.js';
import { orderReference } from './runner-account.js';

const amountSchema = z.object({
  /** Less than the whole difference, if the person decides so. Never more. */
  amountPence: z.number().int().min(1).optional(),
  by: z.string().trim().min(1).max(80).default('Staff'),
});

const settleSchema = z.object({
  /**
   * What was done by hand: the difference sent back by bank transfer, the extra collected by
   * bank transfer, or the extra let go (the Shopper does not pay it).
   */
  outcome: z.enum(['refunded_by_hand', 'collected_by_hand', 'let_go']),
  by: z.string().trim().min(1).max(80).default('Staff'),
});

export async function registerTillCaseRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments, now } = app.ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  async function row(order: Order, photos: Set<string>) {
    const shopper = await repository.shoppers.findById(order.shopperId);
    return {
      orderId: order.id,
      reference: orderReference(order.id),
      shopperName: shopper?.displayName ?? 'A Shopper',
      paidBy: order.paidBy,
      bankReference: order.bankReference,
      /** What the Shopper was charged at first: the shopping estimate and the delivery. */
      estimatePence: order.totalEstimatePence,
      /** What it should have come to: the till total and the delivery. */
      tillTotalPence: order.finalTotalPence,
      receiptTotalPence: order.receiptTotalPence,
      /** Positive: more to take. Negative: to give back. */
      differencePence: tillDifferencePence(order),
      reason: order.tillReason,
      status: order.tillStatus,
      settledBy: order.tillSettledBy,
      settledAt: order.tillSettledAt,
      hasReceiptPhoto: photos.has(order.id),
      updatedAt: order.updatedAt,
    };
  }

  async function waitingCase(orderId: string): Promise<Order> {
    const order = await repository.orders.findById(orderId);
    if (!order) throw new NotFoundError('order');
    if (order.tillStatus !== 'needs_person' || order.finalTotalPence === null) {
      throw new ConflictError('That till total is not waiting for anybody.');
    }
    return order;
  }

  async function settled(order: Order, by: string, words: string, log: typeof app.log) {
    const done = await repository.orders.update(order.id, {
      tillStatus: 'settled',
      tillSettledBy: by,
      tillSettledAt: now(),
    });
    await tellShopperWords(app.ctx, done, words, log);
    return done;
  }

  app.get('/staff/till-cases', async (request) => {
    await staffActor(request, 'payments');
    const waiting = await repository.orders.listByTillStatus('needs_person');
    const done = (await repository.orders.listByTillStatus('settled')).slice(0, 20);
    const photos = await repository.receiptPhotos.ordersWithPhotos(
      [...waiting, ...done].map((order) => order.id),
    );
    return {
      waiting: await Promise.all(waiting.map((order) => row(order, photos))),
      settled: await Promise.all(done.map((order) => row(order, photos))),
    };
  });

  /** Take the extra from the saved card: never more than brings the charge up to the till total. */
  app.post('/staff/till-cases/:orderId/charge', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = amountSchema.parse(request.body ?? {});
    const order = await waitingCase(orderId);
    const extra = tillDifferencePence(order);
    if (extra <= 0) throw new ConflictError('The till came to less, so there is nothing to take.');
    if (order.paidBy === 'bank' || !order.stripePaymentIntentId) {
      throw new ConflictError('This order was paid by bank transfer: collect it by hand.');
    }
    const pence = Math.min(body.amountPence ?? extra, extra);
    const shopper = await repository.shoppers.findById(order.shopperId);
    const card = order.paymentMethodId
      ? await repository.paymentMethods.findById(order.paymentMethodId)
      : null;
    if (!shopper || !card || !shopper.stripeCustomerId) {
      throw new ConflictError('There is no saved card on this order to take it from.');
    }
    const by = decidedBy(actor, body.by);
    try {
      await payments.chargeSavedCard({
        amountPence: pence,
        currency: config.store.currency,
        paymentMethodId: card.stripePaymentMethodId,
        customerId: shopper.stripeCustomerId,
        description: `${config.productName} order ${order.id}: what the till said, over the estimate`,
        // Its own reference: the automatic attempt used till:<id> and did not go through.
        reference: `till-person:${order.id}`,
        agreedAt: (order.spokenConfirmationAt ?? order.createdAt).toISOString(),
      });
    } catch (failure) {
      request.log.warn({ err: failure, orderId: order.id }, 'A till extra was refused.');
      throw new ConflictError(
        'The card would not take it. Nothing was taken. You can try again, or settle it by hand.',
      );
    }
    request.log.info({ orderId: order.id, by, pence }, 'A till extra was taken by a person.');
    await settled(
      order,
      by,
      `The shopping came to ${money(extra)} more than we estimated. As you agreed to pay what the till says, ${money(pence)} has now been taken from your card ending ${card.lastFour}.`,
      request.log,
    );
    return { message: `Taken: ${money(pence)} from the card ending ${card.lastFour}.` };
  });

  /** Give the difference back to the card: never more than brings it down to the till total. */
  app.post('/staff/till-cases/:orderId/refund', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = amountSchema.parse(request.body ?? {});
    const order = await waitingCase(orderId);
    const over = -tillDifferencePence(order);
    if (over <= 0)
      throw new ConflictError('The till came to more, so there is nothing to give back.');
    if (order.paidBy === 'bank' || !order.stripePaymentIntentId) {
      throw new ConflictError('This order was paid by bank transfer: send it back by hand.');
    }
    const pence = Math.min(body.amountPence ?? over, over);
    const by = decidedBy(actor, body.by);
    try {
      await payments.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        amountPence: pence,
        reference: `till-person:${order.id}`,
      });
    } catch (failure) {
      request.log.warn({ err: failure, orderId: order.id }, 'A till refund was refused.');
      throw new ConflictError('The refund did not go through. Nothing was sent. Please try again.');
    }
    request.log.info({ orderId: order.id, by, pence }, 'A till refund was given by a person.');
    await settled(
      order,
      by,
      `The shopping came to less than we estimated, so ${money(pence)} is going back to your card. Your bank may take a few days to show it.`,
      request.log,
    );
    return { message: `Given back: ${money(pence)} to the Shopper's card.` };
  });

  /** Settled by hand: a bank transfer sent back or collected, or an extra let go. */
  app.post('/staff/till-cases/:orderId/settle', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = settleSchema.parse(request.body ?? {});
    const order = await waitingCase(orderId);
    const difference = tillDifferencePence(order);
    if (body.outcome === 'refunded_by_hand' && difference >= 0) {
      throw new BadRequestError('The till came to more, so there was nothing to send back.');
    }
    if (body.outcome !== 'refunded_by_hand' && difference <= 0) {
      throw new BadRequestError('The till came to less, so there was nothing to collect.');
    }
    const words = {
      refunded_by_hand: `We have sent back ${money(-difference)}, the difference between our estimate and the till. Your bank may take a few days to show it.`,
      collected_by_hand: `Thank you. The ${money(difference)} extra for your shopping is settled.`,
      let_go: `The shopping came to ${money(difference)} more than we estimated. You do not need to pay the difference.`,
    }[body.outcome];
    const by = decidedBy(actor, body.by);
    request.log.info(
      { orderId: order.id, by, outcome: body.outcome },
      'A till total was settled by hand.',
    );
    await settled(order, by, words, request.log);
    return {
      message: `Settled by hand. ${order.paidBy === 'bank' ? 'Bank transfer order. ' : ''}The Shopper has been told.`,
    };
  });
}
