/**
 * Baskets over £150 (ruling 61, Anthony, 10 October 2026).
 *
 * One order carries at most £150 of shopping at shop prices (`fees.maximumOrderGoodsPence`). A
 * Shopper whose basket is over it is told so, plainly, before paying, and chooses: take
 * something out or swap it to stay with one Runner, or keep everything. Kept, the basket goes as
 * linked orders (`basketGroupId`, order `basketPart` of `basketOf`), the first filled with items
 * up to £150, the next up to £150, and so on, up to `fees.maximumBasketGoodsPence` (£450). Each
 * is an ordinary order from then on: its own Runner, its own Runner pay (£5, or £7 for £120 or
 * more delivered whole), and the carrying limits and split jobs of rulings 60 and 61.
 *
 * The first order keeps the Shopper's own delivery for their plan. Each order after it costs
 * `fees.extraRunnerDeliveryPence` (£13.50) whatever the plan, and a Runner who is not used is
 * never charged for:
 *
 * - On a card, the extra delivery is not part of the payment taken when the order is sent; it is
 *   taken from the saved card only when that order's Runner collects it (`collectExtraDelivery`,
 *   on the Runner's yes). If the order is carried by the first Runner instead, or cancelled
 *   before then, nothing is taken.
 * - In a bank transfer it is paid with the rest. If that Runner is then not used, it is given
 *   back as "Unused Runner fee credit" on the Shopper's account (there is no card to refund),
 *   shown in their account and used on their next order. A card charge already taken is
 *   refunded to the card, or, if that is impossible, kept as the same credit.
 *
 * A tiny extra (an order after the first with under `dispatch.tinyExtraBelowPence`, £5, of
 * shopping) is texted to the owner and listed in the admin panel, so a person can ask the first
 * Runner to carry it; "Carry with the first Runner" then moves its items onto the first order
 * and cancels the extra £13.50 (`carryWithFirstRunner`).
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence, runnerPaymentFor } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { gatewayName } from '../lib/ledger.js';
import { orderReference } from '../routes/runner-account.js';
import { tellShopperWords } from './order-updates.js';

type BasketContext = Pick<AppContext, 'repository' | 'config' | 'now' | 'payments'> &
  Partial<Pick<AppContext, 'env' | 'sendText' | 'sendPush'>>;

/** Every linked order of this order's basket, the first first; just this one when it is alone. */
export async function basketGroup(
  ctx: Pick<AppContext, 'repository'>,
  order: Order,
): Promise<Order[]> {
  if (!order.basketGroupId) return [order];
  const group = (await ctx.repository.orders.listForShopper(order.shopperId)).filter(
    (row) => row.basketGroupId === order.basketGroupId,
  );
  return group.sort((a, b) => (a.basketPart ?? 0) - (b.basketPart ?? 0));
}

/** The extra Runner's delivery on this order not yet taken (it is taken on collection). */
export function deferredExtraPence(order: Pick<Order, 'extraDeliveryStatus' | 'feePence'>): number {
  return order.extraDeliveryStatus === 'pending' ? order.feePence : 0;
}

/** What is taken from the card when the order is sent: everything but the deferred deliveries. */
export function chargedNowPence(order: Pick<Order, 'totalEstimatePence' | 'extraDeliveryStatus' | 'feePence'>): number {
  return order.totalEstimatePence - deferredExtraPence(order);
}

/**
 * The most shopping one delivery may carry, for the Runner's card and pay-back: £150, and a tiny
 * extra more on the first order of a basket, which may have taken one on (ruling 61).
 */
export function mostOneOrderCarries(
  config: AppContext['config'],
  order: Pick<Order, 'basketGroupId'>,
): number {
  return config.fees.maximumOrderGoodsPence + (order.basketGroupId ? config.dispatch.tinyExtraBelowPence : 0);
}

/** Whether this order is a tiny extra a person may ask the first Runner to carry. */
export function isTinyExtra(config: AppContext['config'], order: Order): boolean {
  return (
    (order.basketPart ?? 1) > 1 &&
    order.goodsEstimatePence < config.dispatch.tinyExtraBelowPence &&
    !order.runnerId &&
    ['confirmed', 'paid', 'offered'].includes(order.status)
  );
}

async function textOwner(ctx: BasketContext, body: string): Promise<void> {
  const phone = ctx.env?.ownerAlertPhone;
  if (!phone || !ctx.sendText) return;
  await ctx.sendText(phone, `${ctx.config.productName}: ${body}`).catch(() => undefined);
}

/** The owner is texted for each tiny extra in a basket just sent (ruling 61). */
export async function alertTinyExtras(ctx: BasketContext, group: readonly Order[]): Promise<void> {
  const money = (pence: number) => formatPence(pence, ctx.config.store.currencySymbol);
  const first = group[0];
  if (!first) return;
  for (const order of group) {
    if (!isTinyExtra(ctx.config, order)) continue;
    await textOwner(
      ctx,
      `order ${orderReference(first.id)} was kept whole, and its order ${order.basketPart} of ${order.basketOf} is only ${money(order.goodsEstimatePence)} of shopping. Please ask the first Runner to carry it, then press "Carry with the first Runner" in the admin panel's Payments tab, which cancels the extra ${money(order.feePence)} delivery.`,
    );
  }
}

/** Add to the Shopper's account as "Unused Runner fee credit", used on their next order. */
async function creditUnusedRunnerFee(ctx: BasketContext, order: Order, pence: number): Promise<void> {
  const shopperId = order.payerShopperId ?? order.shopperId;
  const shopper = await ctx.repository.shoppers.findById(shopperId);
  if (!shopper || pence <= 0) return;
  await ctx.repository.shoppers.update(shopper.id, {
    creditPence: shopper.creditPence + pence,
    unusedRunnerFeeCreditPence: shopper.unusedRunnerFeeCreditPence + pence,
  });
}

/**
 * The Runner of a linked order after the first has just collected it: now, and not before, its
 * extra delivery is taken from the saved card. A card that will not pay never stops the job;
 * it is marked and the owner is told, to settle by hand.
 */
export async function collectExtraDelivery(
  ctx: BasketContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<void> {
  const { repository, payments, config } = ctx;
  const fresh = await repository.orders.findById(order.id);
  if (!fresh || fresh.extraDeliveryStatus !== 'pending' || fresh.feePence <= 0) return;
  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  const payer = await repository.shoppers.findById(fresh.payerShopperId ?? fresh.shopperId);
  const card = fresh.paymentMethodId
    ? await repository.paymentMethods.findById(fresh.paymentMethodId)
    : null;
  try {
    if (!payer || !card) throw new Error('No saved card on this order.');
    const charge = await payments.chargeSavedCard({
      amountPence: fresh.feePence,
      currency: config.fees.currency,
      paymentMethodId: card.stripePaymentMethodId,
      customerId: payer.stripeCustomerId,
      description: `${config.productName} order ${fresh.id}: delivery by a further Runner, taken as they collect it`,
      reference: `extra-runner:${fresh.id}`,
      agreedAt: (fresh.spokenConfirmationAt ?? fresh.createdAt).toISOString(),
    });
    await repository.orders.update(fresh.id, {
      extraDeliveryStatus: 'charged',
      extraDeliveryPaymentId: charge.id,
    });
    await repository.income
      .record({
        at: ctx.now(),
        gateway: gatewayName(payments),
        kind: 'order',
        amountPence: fresh.feePence,
        reference: charge.id,
      })
      .catch(() => undefined);
  } catch (failure) {
    log.warn({ err: failure, orderId: fresh.id }, 'The extra Runner delivery could not be taken.');
    await repository.orders.update(fresh.id, { extraDeliveryStatus: 'failed' });
    await textOwner(
      ctx,
      `the extra ${money(fresh.feePence)} delivery on order ${orderReference(fresh.id)} could not be taken from the card when its Runner collected it. Please settle it with the Shopper.`,
    );
  }
}

/**
 * The Runner of a linked order was not used (carried by the first Runner, or the order was
 * cancelled): its extra delivery is never charged, or is given back. Not yet taken: nothing is
 * taken. Taken on the card: refunded to it, or kept as credit if a refund is impossible. Paid by
 * a bank transfer that arrived: added to the account as "Unused Runner fee credit".
 */
export async function releaseExtraDelivery(
  ctx: BasketContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<void> {
  const { repository, payments } = ctx;
  const fresh = await repository.orders.findById(order.id);
  if (!fresh?.extraDeliveryStatus || fresh.feePence <= 0) return;
  switch (fresh.extraDeliveryStatus) {
    case 'pending':
    case 'failed':
      await repository.orders.update(fresh.id, { extraDeliveryStatus: 'waived' });
      return;
    case 'charged': {
      try {
        if (!fresh.extraDeliveryPaymentId) throw new Error('No payment to refund.');
        await payments.refundPayment({
          paymentIntentId: fresh.extraDeliveryPaymentId,
          amountPence: fresh.feePence,
          reference: `extra-runner-unused:${fresh.id}`,
        });
        await repository.orders.update(fresh.id, { extraDeliveryStatus: 'refunded' });
      } catch (failure) {
        log.warn({ err: failure, orderId: fresh.id }, 'The unused Runner fee could not be refunded: kept as credit.');
        await creditUnusedRunnerFee(ctx, fresh, fresh.feePence);
        await repository.orders.update(fresh.id, { extraDeliveryStatus: 'credited' });
      }
      return;
    }
    case 'transfer': {
      // A transfer that never came was never paid: nothing to give back.
      if (!fresh.bankReceivedAt) {
        await repository.orders.update(fresh.id, { extraDeliveryStatus: 'waived' });
        return;
      }
      await creditUnusedRunnerFee(ctx, fresh, fresh.feePence);
      await repository.orders.update(fresh.id, { extraDeliveryStatus: 'credited' });
      return;
    }
    default:
      return;
  }
}

/** Every tiny extra waiting, for the admin panel's Payments tab. */
export async function listTinyExtras(
  ctx: Pick<AppContext, 'repository' | 'config'>,
): Promise<Array<{ order: Order; first: Order | null }>> {
  const rows: Array<{ order: Order; first: Order | null }> = [];
  for (const status of ['confirmed', 'paid', 'offered'] as const) {
    for (const order of await ctx.repository.orders.listByStatus(status)) {
      if (!isTinyExtra(ctx.config, order) || !order.basketGroupId) continue;
      rows.push({ order, first: await ctx.repository.orders.findById(order.basketGroupId) });
    }
  }
  return rows;
}

/** The first order may still take more on: not yet shopped for, and not over. */
const FIRST_CAN_CARRY = new Set<Order['status']>(['confirmed', 'paid', 'offered', 'accepted', 'shopping']);

/**
 * "Carry with the first Runner" (ruling 61): a person has asked the first Runner to carry a tiny
 * extra. Its items move onto the first order (and its shopping and item charges, already paid,
 * with them); the extra order is cancelled, so its extra delivery is never taken, or is given
 * back; the rest of the basket is numbered again.
 */
export async function carryWithFirstRunner(
  ctx: BasketContext,
  extraId: string,
  log: FastifyBaseLogger,
): Promise<{ first: Order; extra: Order }> {
  const { repository, config } = ctx;
  const extra = await repository.orders.findById(extraId);
  if (!extra?.basketGroupId || (extra.basketPart ?? 1) <= 1) {
    throw new NotFoundError('extra order of a basket');
  }
  if (!isTinyExtra(config, extra)) {
    throw new ConflictError('That order is not a tiny extra waiting for a Runner any more.');
  }
  const first = await repository.orders.findById(extra.basketGroupId);
  if (!first || !FIRST_CAN_CARRY.has(first.status)) {
    throw new ConflictError('The first order has already been shopped for, so it cannot take more on.');
  }
  const at = ctx.now();

  for (const item of extra.items) {
    await repository.orders.addItem(first.id, {
      catalogueItemId: item.catalogueItemId,
      name: item.name,
      quantity: item.quantity,
      estimatedPricePence: item.estimatedPricePence,
      ...(item.note ? { note: item.note } : {}),
    });
  }
  const goods = first.goodsEstimatePence + extra.goodsEstimatePence;
  const updatedFirst = await repository.orders.update(first.id, {
    goodsEstimatePence: goods,
    itemChargesPence: first.itemChargesPence + extra.itemChargesPence,
    totalEstimatePence:
      first.totalEstimatePence + extra.goodsEstimatePence + extra.itemChargesPence,
    runnerPaymentPence: Math.max(first.runnerPaymentPence, runnerPaymentFor(goods, config.fees)),
  });

  const cancelled = await repository.orders.update(extra.id, {
    status: 'cancelled',
    cancelledAt: at,
    cancelReason: 'Carried by the first Runner of the basket (ruling 61).',
  });
  for (const offer of await repository.offers.listForOrder(extra.id)) {
    if (offer.outcome === 'pending') {
      await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
    }
  }
  await releaseExtraDelivery(ctx, cancelled, log);

  // The rest of the basket, numbered again.
  const rest = (await basketGroup(ctx, first)).filter((row) => row.status !== 'cancelled');
  for (const [index, row] of rest.entries()) {
    await repository.orders.update(row.id, { basketPart: index + 1, basketOf: rest.length });
  }

  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  await tellShopperWords(
    ctx as AppContext,
    updatedFirst,
    `Good news: your first Runner is bringing the ${money(extra.goodsEstimatePence)} of shopping that was going separately, so there is no extra ${money(extra.feePence)} delivery for it.`,
    log,
  );
  return { first: (await repository.orders.findById(first.id)) ?? updatedFirst, extra: cancelled };
}
