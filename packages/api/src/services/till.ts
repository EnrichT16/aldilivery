/**
 * Settling the till total (Sections H and R; ruling 52, Anthony, 7 October 2026: "fix it").
 *
 * The Shopper agrees to an estimate and is charged it before a Runner is sent (ruling 29); they
 * pay what the till says (Rule Three). When the Runner sends the receipt, the difference is
 * settled on the same card at once:
 *
 * - The till came to less: the difference goes straight back to the card.
 * - The till came to more: the difference is taken from the saved card, up to a small limit
 *   (the larger of £5 or a fifth of the shopping estimate). Anything above that is not taken
 *   automatically; the owner is told, and a person decides.
 *
 * A bank transfer order has no card: the owner is told the difference to refund or collect.
 * The Shopper is told either way, in plain words. Every refund and charge goes in the money
 * ledger. Settling never undoes the receipt: a failure is logged and the owner is told.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { tellShopperWords } from './order-updates.js';

export const EXTRA_FLOOR_PENCE = 500;
export const EXTRA_SHARE = 0.2;

/**
 * The most the till may come to over the shopping estimate before a person must decide: the
 * larger of £5 or a fifth of the estimate. The same limit caps what a Runner is paid back for
 * the shopping without a person looking first (ruling 55, services/reimburse.ts).
 */
export function tillLimitPence(goodsEstimatePence: number): number {
  return Math.max(EXTRA_FLOOR_PENCE, Math.round(goodsEstimatePence * EXTRA_SHARE));
}

export type TillOutcome =
  | { kind: 'even' }
  | { kind: 'refunded'; pence: number }
  | { kind: 'charged'; pence: number }
  | { kind: 'needs-person'; pence: number; reason: string };

export async function settleTill(
  ctx: AppContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<TillOutcome> {
  const { repository, payments, config } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const final = order.finalTotalPence;
  if (final === null) return { kind: 'even' };
  const difference = final - order.totalEstimatePence;
  if (difference === 0) return { kind: 'even' };

  const alertOwner = async (words: string): Promise<void> => {
    if (!ctx.env.ownerAlertPhone || !ctx.sendText) return;
    await ctx
      .sendText(ctx.env.ownerAlertPhone, `${config.productName} till: ${words}`)
      .catch((failure: unknown) => log.warn({ err: failure }, 'The owner could not be told.'));
  };

  // A bank transfer has no card to settle on: a person does it.
  if (order.paidBy === 'bank' || !order.stripePaymentIntentId) {
    const words =
      difference < 0
        ? `refund ${money(-difference)} for bank transfer order ${order.bankReference ?? order.id}.`
        : `collect ${money(difference)} more for bank transfer order ${order.bankReference ?? order.id}.`;
    await alertOwner(words);
    await tellShopperWords(
      ctx,
      order,
      difference < 0
        ? `The shopping came to ${money(-difference)} less than we estimated. We will send that back to you.`
        : `The shopping came to ${money(difference)} more than we estimated. We will be in touch about it.`,
      log,
    );
    return { kind: 'needs-person', pence: Math.abs(difference), reason: 'bank transfer' };
  }

  if (difference < 0) {
    const pence = -difference;
    try {
      await payments.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        amountPence: pence,
        reference: `till:${order.id}`,
      });
    } catch (failure) {
      log.error({ err: failure, orderId: order.id }, 'The till difference could not be refunded.');
      await alertOwner(
        `could not refund ${money(pence)} on order ${order.id}. Please refund by hand.`,
      );
      return { kind: 'needs-person', pence, reason: 'refund failed' };
    }
    await tellShopperWords(
      ctx,
      order,
      `The shopping came to less than we estimated, so ${money(pence)} is going back to your card.`,
      log,
    );
    return { kind: 'refunded', pence };
  }

  const limit = tillLimitPence(order.goodsEstimatePence);
  if (difference > limit) {
    await alertOwner(
      `order ${order.id} came to ${money(difference)} more than estimated, over the ${money(limit)} taken automatically. Please decide.`,
    );
    await tellShopperWords(
      ctx,
      order,
      `The shopping came to ${money(difference)} more than we estimated. Nothing more has been taken; someone from our team will be in touch.`,
      log,
    );
    return { kind: 'needs-person', pence: difference, reason: 'over the limit' };
  }

  const shopper = await repository.shoppers.findById(order.shopperId);
  const card = order.paymentMethodId
    ? await repository.paymentMethods.findById(order.paymentMethodId)
    : null;
  try {
    if (!shopper || !card) throw new Error('No saved card on this order.');
    await payments.chargeSavedCard({
      amountPence: difference,
      currency: config.store.currency,
      paymentMethodId: card.stripePaymentMethodId,
      customerId: shopper.stripeCustomerId,
      description: `${config.productName} order ${order.id}: what the till said, over the estimate`,
      reference: `till:${order.id}`,
      agreedAt: (order.spokenConfirmationAt ?? order.createdAt).toISOString(),
    });
  } catch (failure) {
    log.warn({ err: failure, orderId: order.id }, 'The till difference could not be taken.');
    await alertOwner(
      `could not take ${money(difference)} more on order ${order.id}. Please decide.`,
    );
    return { kind: 'needs-person', pence: difference, reason: 'charge failed' };
  }
  await tellShopperWords(
    ctx,
    order,
    `The shopping came to ${money(difference)} more than we estimated, as you agreed to pay what the till says, so that has been taken from your card.`,
    log,
  );
  return { kind: 'charged', pence: difference };
}
