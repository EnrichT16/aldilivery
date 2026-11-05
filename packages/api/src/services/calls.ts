/**
 * What an in-app call costs, and taking it (docs/BUILD_PROMPT.md, Sections B and F; rulings of
 * 2 October 2026).
 *
 * - 5p a minute for each person on the call (`calls.pencePerMinute`).
 * - The Shopper pays: their own minutes, and the minutes of everyone they added. A Runner never
 *   pays (Rule Two), so a Runner's minutes are never counted.
 * - Each person's time is rounded up to a whole minute. A Shopper who never answered pays
 *   nothing.
 * - The charge is taken from the Shopper's card when the call ends. If the card cannot be
 *   charged, it waits as outstanding and is taken the next time a charge succeeds. Above
 *   `calls.maxOutstandingPence` waiting, nobody more can be added to a call until it is paid.
 * - Ruling 90 (2 November 2026): a call the Runner starts is free to the Shopper, who is asked
 *   for no yes and simply answers (`calls.runnerStartedFree`); it costs the Runner nothing either,
 *   and never appears on anything the Shopper pays. Calls about an order are open while it is
 *   under way and for `calls.afterDeliveryMinutes` after delivery; then they are closed.
 */

import { randomBytes } from 'node:crypto';

import type { StoreConfig } from '@aldilivery/core';
import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Call, CallLeg, Order } from '../domain.js';

export function priceStatement(pencePerMinute: number): string {
  return `In-app calls cost ${pencePerMinute}p a minute, paid from your card when the call ends.`;
}

/** What is written on a free, Runner-started call in place of a price the Shopper agreed. */
export const RUNNER_CALL_STATEMENT = 'Your Runner is calling about your order. This call is free.';

/** Said to anybody trying to call about an order whose calls have closed (ruling 90). */
export const CALLS_CLOSED_MESSAGE =
  "This order is finished, so calls about it have closed. For help, say 'person' and customer service will call you.";

/** Orders that can still be talked about without looking at the clock. */
const UNDER_WAY: Order['status'][] = [
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

/**
 * When calls about this order close: never while it is under way; `calls.afterDeliveryMinutes`
 * after the delivery once delivered; already, for an order cancelled, refunded or not yet paid.
 */
export function callsCloseAt(
  order: Pick<Order, 'status' | 'deliveredAt'>,
  config: Pick<StoreConfig, 'calls'>,
): Date | null {
  if (UNDER_WAY.includes(order.status)) return null;
  if ((order.status === 'delivered' || order.status === 'completed') && order.deliveredAt) {
    return new Date(order.deliveredAt.getTime() + config.calls.afterDeliveryMinutes * 60_000);
  }
  return new Date(0);
}

export function callsClosed(
  order: Pick<Order, 'status' | 'deliveredAt'>,
  config: Pick<StoreConfig, 'calls'>,
  now: Date,
): boolean {
  const closeAt = callsCloseAt(order, config);
  return closeAt !== null && now.getTime() >= closeAt.getTime();
}

/** Whether the Shopper pays for this call, and so must have said yes to its price first. */
export function shopperPays(
  call: Pick<Call, 'startedBy'>,
  config: Pick<StoreConfig, 'calls'>,
): boolean {
  // A call a Shop Partner started (ruling 97) is free to both sides, whatever the setting.
  if (call.startedBy === 'partner') return false;
  return call.startedBy === 'shopper' || !config.calls.runnerStartedFree;
}

export function guestPriceStatement(name: string, pencePerMinute: number): string {
  return `Adding ${name} costs ${pencePerMinute}p a minute for them, paid from your card.`;
}

/**
 * The minutes the Shopper pays for: theirs, and each guest's, each rounded up. Not a Runner's,
 * and not a call to the Shopper's own telephone, which they never agreed a price for (ruling 46).
 */
export function billableMinutes(legs: CallLeg[]): number {
  return legs
    .filter((leg) => leg.role === 'shopper' || leg.role === 'guest')
    .reduce((total, leg) => total + Math.ceil(leg.secondsConnected / 60), 0);
}

/** A fresh call about an order, ringing, nothing agreed or billed yet. */
export function newCall(
  order: Pick<Order, 'id' | 'shopperId' | 'runnerId'>,
  startedBy: Call['startedBy'],
  at: Date,
  pencePerMinute: number,
): Omit<Call, 'id'> {
  return {
    orderId: order.id,
    shopperId: order.shopperId,
    runnerId: order.runnerId ?? '',
    roomName: `call-${randomBytes(16).toString('hex')}`,
    startedBy,
    partnerShopId: null,
    status: 'ringing',
    createdAt: at,
    endedAt: null,
    priceStatement: null,
    priceAcceptedAt: null,
    pencePerMinute,
    billedMinutes: 0,
    chargePence: 0,
    chargeStatus: 'pending',
    paymentReference: null,
    chargedAt: null,
  };
}

/**
 * A call the Runner starts (ruling 90): free to the Shopper when `calls.runnerStartedFree`, so
 * it carries no price and asks for no yes; the statement says so in the Shopper's words.
 */
export function runnerCall(
  order: Pick<Order, 'id' | 'shopperId' | 'runnerId'>,
  config: Pick<StoreConfig, 'calls'>,
  at: Date,
): Omit<Call, 'id'> {
  const free = config.calls.runnerStartedFree;
  return {
    ...newCall(order, 'runner', at, free ? 0 : config.calls.pencePerMinute),
    priceStatement: free ? RUNNER_CALL_STATEMENT : null,
  };
}

/** What is written on a free call a Shop Partner started to the Runner (ruling 97). */
export const PARTNER_CALL_STATEMENT = 'Your shop is calling about your order. This call is free.';

/**
 * A call a Shop Partner on a paid plan starts to the Runner of an order (ruling 97): free to both
 * sides, carrying no price and asking for no yes, and naming the shop so the Runner knows who.
 */
export function partnerCall(
  order: Pick<Order, 'id' | 'shopperId' | 'runnerId'>,
  shop: { id: string },
  at: Date,
): Omit<Call, 'id'> {
  return {
    ...newCall(order, 'partner', at, 0),
    partnerShopId: shop.id,
    priceStatement: PARTNER_CALL_STATEMENT,
  };
}

/** What the Runner sees and hears when a shop rings about an order (ruling 97). */
export function partnerCallingWords(shopName: string, orderReference: string): string {
  return `Your shop ${shopName} is calling about order ${orderReference}.`;
}

/** What the Shopper's devices show when their Runner rings, and rings again (ruling 90). */
export function runnerCallingMessage(call: Pick<Call, 'id'>, attempt: number) {
  return {
    title: 'Your Runner is calling about your order',
    body:
      attempt > 1
        ? 'They are still trying to reach you. Open your order to answer.'
        : 'Open your order to answer. This call is free.',
    url: '/my-order',
    // A new tag each time, so the phone buzzes again rather than quietly replacing the first.
    tag: `call-${call.id}-${attempt}`,
  };
}

export async function outstandingPence(ctx: AppContext, shopperId: string): Promise<number> {
  const due = await ctx.repository.calls.listChargesDue(shopperId);
  return due
    .filter((call) => call.chargeStatus === 'outstanding')
    .reduce((total, call) => total + call.chargePence, 0);
}

/** Close any leg still connected at `at`, adding its time. */
export async function closeLegs(ctx: AppContext, callId: string, at: Date): Promise<CallLeg[]> {
  const legs = await ctx.repository.callLegs.listForCall(callId);
  return Promise.all(
    legs.map(async (leg) => {
      if (!leg.connectedSince) return leg;
      const seconds = Math.max(0, Math.round((at.getTime() - leg.connectedSince.getTime()) / 1000));
      return ctx.repository.callLegs.update(leg.id, {
        connectedSince: null,
        secondsConnected: leg.secondsConnected + seconds,
      });
    }),
  );
}

/** End the call, work out what it cost, and try to take it. Safe to call twice. */
export async function finishCall(
  ctx: AppContext,
  call: Call,
  at: Date,
  log: FastifyBaseLogger,
): Promise<Call> {
  if (call.status === 'ended') return call;
  const legs = await closeLegs(ctx, call.id, at);
  // A Runner-started call is free (ruling 90): no minutes billed, nothing due, nothing shown.
  const minutes = shopperPays(call, ctx.config) ? billableMinutes(legs) : 0;
  const chargePence = minutes * call.pencePerMinute;
  const ended = await ctx.repository.calls.update(call.id, {
    status: 'ended',
    endedAt: at,
    billedMinutes: minutes,
    chargePence,
    chargeStatus: chargePence === 0 ? 'not_due' : 'pending',
  });
  if (chargePence === 0) return ended;
  return chargeCalls(ctx, ended.shopperId, log).then(
    async () => (await ctx.repository.calls.findById(ended.id)) ?? ended,
  );
}

/**
 * Take every call charge this Shopper owes: anything pending, then anything outstanding,
 * oldest first. Stops at the first refusal, leaving the rest outstanding. Called when a call
 * ends and after any of their payments succeeds.
 */
export async function chargeCalls(
  ctx: AppContext,
  shopperId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const { repository, payments, config, now } = ctx;
  const shopper = await repository.shoppers.findById(shopperId);
  if (!shopper) return;
  const cards = await repository.paymentMethods.listForShopper(shopperId);
  const card = cards.find((method) => method.isDefault) ?? cards[0];

  const pending = await repository.calls.listChargesDue(shopperId);
  for (const call of pending) {
    if (!card) {
      await repository.calls.update(call.id, { chargeStatus: 'outstanding' });
      continue;
    }
    try {
      const charged = await payments.chargeSavedCard({
        amountPence: call.chargePence,
        currency: config.store.currency,
        paymentMethodId: card.stripePaymentMethodId,
        customerId: shopper.stripeCustomerId,
        description: `${config.productName} call, ${call.billedMinutes} minutes`,
        reference: `call:${call.id}`,
        agreedAt: (call.priceAcceptedAt ?? call.createdAt).toISOString(),
      });
      await repository.calls.update(call.id, {
        chargeStatus: 'paid',
        paymentReference: charged.id,
        chargedAt: now(),
      });
    } catch (failure) {
      log.warn({ err: failure, callId: call.id }, 'A call charge could not be taken; it waits.');
      await repository.calls.update(call.id, { chargeStatus: 'outstanding' });
      // Mark the rest outstanding too, and try again next time.
      for (const rest of pending.slice(pending.indexOf(call) + 1)) {
        await repository.calls.update(rest.id, { chargeStatus: 'outstanding' });
      }
      return;
    }
  }
}
