/**
 * Regular orders on a clock (Section I, Rule Five; docs/STILL_TO_DO.md item 4).
 *
 * Once a minute the server looks at every active Set:
 *
 * 1. Thirty minutes before an occurrence (a few minutes early, so a minute's sweep can never make
 *    it late), the notice goes to the Shopper by notification, or by text to a mobile, with the
 *    one word that stops it. They can say it to Ozi, press Skip in the app, or text it back.
 * 2. At the time, `mayFire` decides, as before: never without a notice that went out a full
 *    thirty minutes beforehand, never once skipped.
 * 3. A Set the Shopper agreed should send itself is then placed and paid for with their saved
 *    card, through the same checks as POST /orders: today's prices, Rule Six, the most one
 *    delivery carries, their own spending limit, and the confirmation written on the order
 *    before any money moves (Rule One). A Set that is only a reminder is never paid for: it
 *    leaves a draft, and Ozi offers to put it in the basket.
 *
 * Each occurrence happens once only. The order carries the occurrence it was placed for, and the
 * database will not hold two orders for the same one, so a sweep that runs twice, or a server
 * that stops half way, never charges anybody twice.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence, runnerPaymentFor } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, RecurringSet } from '../domain.js';
import { recordOrder } from '../lib/analytics.js';
import { cardAccepted } from '../lib/card-region.js';
import { priceLines } from './basket.js';
import { deliveryPlanFor } from './plans.js';
import { applyCredit } from './credit.js';
import { offerOrder } from './dispatch.js';
import { tellShopperById } from './order-updates.js';
import { assertConfirmedBeforePayment, exceedsBudgetCap } from './orders.js';
import { advanceAfterFiring, isSkipInstruction, mayFire, noticeIsDue } from './sets.js';

/**
 * How early the notice may go, so that a sweep once a minute can never send it late. Rule Five
 * is "at least thirty minutes"; a notice thirty-three minutes before keeps it.
 */
export const NOTICE_LEAD_MINUTES = 3;

const MINUTE_MS = 60_000;

export type SetOutcome =
  | { kind: 'notice-sent'; setId: string }
  | { kind: 'placed'; setId: string; orderId: string }
  | { kind: 'draft'; setId: string; orderId: string }
  | { kind: 'not-placed'; setId: string; because: string }
  | { kind: 'skipped'; setId: string }
  | { kind: 'missed'; setId: string; because: string };

function goodsOf(set: RecurringSet): number {
  return set.items.reduce((sum, item) => sum + item.estimatedPricePence * item.quantity, 0);
}

/** The words of the notice, for a Set that sends itself and for one that only reminds. */
export function noticeWords(
  set: RecurringSet,
  config: AppContext['config'],
  minutes: number,
): string {
  const skip = config.recurringOrders.skipWord;
  const money = formatPence(goodsOf(set), config.store.currencySymbol);
  if (set.autoSendAgreedAt) {
    return (
      `Your regular order "${set.name}" goes in ${minutes} minutes, about ${money} of shopping plus the delivery, paid with your saved card. ` +
      `To stop this one, say "${skip}" to ${config.assistantName}, press Skip in the app, or text ${skip} back.`
    );
  }
  return `Your regular order "${set.name}" is due in ${minutes} minutes. Open the app and ${config.assistantName} will put it in your basket. Nothing is sent or paid until you say so. To stop this reminder, say "${skip}".`;
}

/** Send every notice that is due. A Set that pays is only marked as noticed once it reached them. */
export async function sendDueNotices(
  ctx: AppContext,
  log: FastifyBaseLogger,
): Promise<SetOutcome[]> {
  const at = ctx.now();
  const minutes = ctx.config.recurringOrders.noticeMinutesBefore;
  const early = new Date(at.getTime() + NOTICE_LEAD_MINUTES * MINUTE_MS);
  const outcomes: SetOutcome[] = [];
  for (const set of await ctx.repository.sets.listActive()) {
    // Only for an occurrence still to come: one already past is dealt with by `runDueSets`.
    if (set.nextFireAt.getTime() <= at.getTime()) continue;
    if (!noticeIsDue(set, early, minutes)) continue;
    // A closing account hears nothing more about regular orders, and none is sent.
    const owner = await ctx.repository.shoppers.findById(set.shopperId);
    if (!owner || owner.deletionScheduledFor || owner.erasedAt) continue;
    const left = Math.max(1, Math.round((set.nextFireAt.getTime() - at.getTime()) / MINUTE_MS));
    const reached = await tellShopperById(
      ctx,
      set.shopperId,
      noticeWords(set, ctx.config, left),
      { url: '/weekly-shop', tag: `set-${set.id}` },
      log,
    );
    // Nobody may be charged for a notice that never reached them (Rule Five). A reminder costs
    // nothing, so it counts as given either way: it is also on the screen in the app.
    if (!reached && set.autoSendAgreedAt) continue;
    await ctx.repository.sets.update(set.id, { noticeSentAt: at });
    outcomes.push({ kind: 'notice-sent', setId: set.id });
  }
  return outcomes;
}

/** Fire, skip or pass over every Set whose time has come. */
export async function runDueSets(ctx: AppContext, log: FastifyBaseLogger): Promise<SetOutcome[]> {
  const at = ctx.now();
  const minutes = ctx.config.recurringOrders.noticeMinutesBefore;
  const outcomes: SetOutcome[] = [];
  for (const set of await ctx.repository.sets.listActive()) {
    const decision = mayFire(set, at, minutes);
    if (decision.refusedBecause === 'not_yet_due') continue;
    const advance = async (): Promise<void> => {
      await ctx.repository.sets.update(set.id, advanceAfterFiring(set, set.frequency));
    };

    if (!decision.mayFire) {
      if (decision.refusedBecause === 'skipped_by_shopper') {
        await advance();
        outcomes.push({ kind: 'skipped', setId: set.id });
        continue;
      }
      // No notice in time: this one is passed over, never sent late, and the next one is due.
      await advance();
      outcomes.push({ kind: 'missed', setId: set.id, because: decision.refusedBecause ?? '' });
      if (set.autoSendAgreedAt) {
        await tellShopperById(
          ctx,
          set.shopperId,
          `Your regular order "${set.name}" was not sent this time, because we could not give you ${minutes} minutes' notice. Nothing was taken. The next one comes as usual.`,
          { url: '/weekly-shop', tag: `set-${set.id}` },
          log,
        );
      }
      continue;
    }

    try {
      const outcome = set.autoSendAgreedAt
        ? await placeSetOrder(ctx, set, log)
        : await leaveDraft(ctx, set);
      outcomes.push(outcome);
    } catch (failure) {
      // Logged, and the occurrence moves on: a Set must never be tried again and again.
      log.error({ err: failure, setId: set.id }, 'A regular order could not be placed.');
      outcomes.push({ kind: 'not-placed', setId: set.id, because: 'error' });
    }
    await ctx.repository.sets.update(set.id, {
      ...advanceAfterFiring(set, set.frequency),
      lastFiredAt: at,
    });
  }
  return outcomes;
}

/** A Set that only reminds: a draft order, never paid, once per occurrence. */
async function leaveDraft(ctx: AppContext, set: RecurringSet): Promise<SetOutcome> {
  const existing = await ctx.repository.orders.findBySetOccurrence(set.id, set.nextFireAt);
  if (existing) return { kind: 'draft', setId: set.id, orderId: existing.id };
  const goodsPence = goodsOf(set);
  const order = await ctx.repository.orders.create({
    shopperId: set.shopperId,
    setId: set.id,
    setFireAt: set.nextFireAt,
    status: 'draft',
    goodsEstimatePence: goodsPence,
    runnerPaymentPence: runnerPaymentFor(goodsPence, ctx.config.fees),
    itemChargesPence: 0,
    feePence: 0,
    totalEstimatePence: goodsPence,
    deliveryPlan: 'payg',
    deliveryAddress: set.deliveryAddress,
    latitude: set.latitude,
    longitude: set.longitude,
    paymentMethodId: set.paymentMethodId,
    items: set.items.map((item) => ({
      catalogueItemId: item.catalogueItemId,
      name: item.name,
      quantity: item.quantity,
      estimatedPricePence: item.estimatedPricePence,
    })),
  });
  return { kind: 'draft', setId: set.id, orderId: order.id };
}

/**
 * Place and pay for one occurrence of a Set that sends itself, as POST /orders does, with the
 * saved card charged while the Shopper is not at the screen (they agreed to that when they set it
 * up). Never twice for the same occurrence.
 */
export async function placeSetOrder(
  ctx: AppContext,
  set: RecurringSet,
  log: FastifyBaseLogger,
): Promise<SetOutcome> {
  const { repository, config, payments } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const fireAt = set.nextFireAt;

  const existing = await repository.orders.findBySetOccurrence(set.id, fireAt);
  if (existing) return { kind: 'placed', setId: set.id, orderId: existing.id };

  const notPlaced = async (because: string, words: string): Promise<SetOutcome> => {
    await tellShopperById(
      ctx,
      set.shopperId,
      `Your regular order "${set.name}" was not sent this time: ${words} Nothing was taken.`,
      { url: '/weekly-shop', tag: `set-${set.id}` },
      log,
    );
    return { kind: 'not-placed', setId: set.id, because };
  };

  const shopper = await repository.shoppers.findById(set.shopperId);
  if (!shopper || shopper.erasedAt || shopper.deletionScheduledFor) {
    return { kind: 'not-placed', setId: set.id, because: 'account closing' };
  }
  const card = set.paymentMethodId
    ? await repository.paymentMethods.findById(set.paymentMethodId)
    : null;
  if (!card || card.shopperId !== shopper.id || !shopper.stripeCustomerId) {
    return notPlaced('no saved card', 'there is no saved card to pay with. Please add one.');
  }
  if (!cardAccepted(config.payments.supportedCardRegions, card.region)) {
    return notPlaced('card not accepted', 'we cannot take that card at the moment.');
  }

  // Today's prices, and the same refusals as any order: nothing age restricted (Rule Six), and
  // no more than one delivery carries (Rule Three).
  const lines = set.items
    .filter((item) => item.catalogueItemId)
    .map((item) => ({ catalogueItemId: item.catalogueItemId as string, quantity: item.quantity }));
  let priced;
  try {
    const catalogueItems = await repository.catalogue.findManyByIds(
      lines.map((line) => line.catalogueItemId),
    );
    priced = priceLines(
      lines,
      catalogueItems,
      config.fees,
      await deliveryPlanFor(ctx, shopper, ctx.now()),
    );
  } catch (failure) {
    log.warn({ err: failure, setId: set.id }, 'A regular order could not be priced.');
    return notPlaced(
      'could not price',
      failure instanceof Error ? failure.message : 'something on it could not be priced.',
    );
  }
  if (exceedsBudgetCap(priced.goodsPence, shopper.budgetCapPence)) {
    return notPlaced(
      'over the spending limit',
      `it came to ${money(priced.goodsPence)}, over the limit you set of ${money(shopper.budgetCapPence ?? 0)}.`,
    );
  }

  const at = ctx.now();
  const order = await repository.orders.create({
    shopperId: shopper.id,
    setId: set.id,
    setFireAt: fireAt,
    status: 'draft',
    goodsEstimatePence: priced.goodsPence,
    runnerPaymentPence: runnerPaymentFor(priced.goodsPence, config.fees),
    itemChargesPence: priced.itemChargesPence,
    feePence: priced.feePence,
    totalEstimatePence: priced.totalPence,
    deliveryPlan: priced.plan,
    deliveryAddress: set.deliveryAddress,
    latitude: set.latitude,
    longitude: set.longitude,
    paymentMethodId: card.id,
    doorstepProtocolSnapshot: shopper.doorstepProtocol,
    items: priced.lines.map((line) => ({
      catalogueItemId: line.catalogueItemId,
      name: line.name,
      quantity: line.quantity,
      estimatedPricePence: line.unitPricePence,
    })),
  });

  // Rule One: the Shopper's own agreement to this Set, and the notice they did not stop, written
  // on the order before any money moves.
  const confirmed = await repository.orders.update(order.id, {
    status: 'confirmed',
    spokenConfirmationAt: at,
    confirmationChannel: 'set',
    confirmationStatement: `${set.autoSendStatement ?? ''} (Agreed ${set.autoSendAgreedAt?.toISOString() ?? ''}; notice sent ${set.noticeSentAt?.toISOString() ?? ''}; not skipped.)`,
  });
  assertConfirmedBeforePayment(confirmed);

  let paymentId: string;
  try {
    ({ id: paymentId } = await payments.chargeSavedCard({
      amountPence: confirmed.totalEstimatePence,
      currency: config.fees.currency,
      paymentMethodId: card.stripePaymentMethodId,
      customerId: shopper.stripeCustomerId,
      description: `${config.productName} order ${confirmed.id}, regular order "${set.name}"`,
      // "order" first, so the money ledger files it with the other orders.
      reference: `order:${confirmed.id}`,
      agreedAt: (set.autoSendAgreedAt ?? at).toISOString(),
    }));
  } catch (failure) {
    await repository.orders.update(confirmed.id, { status: 'cancelled', cancelledAt: ctx.now() });
    log.warn({ err: failure, orderId: confirmed.id }, 'A regular order could not be paid for.');
    return notPlaced('payment refused', 'your card did not go through.');
  }

  const placed: Order = await repository.orders.update(confirmed.id, {
    status: 'paid',
    stripePaymentIntentId: paymentId,
  });
  if (ctx.autoOffer) {
    await offerOrder(ctx, placed.id).catch((failure: unknown) => {
      log.warn({ orderId: placed.id, err: failure }, 'Could not offer the order yet');
    });
  }
  await applyCredit(ctx, placed.id, log);
  await recordOrder(ctx, placed, 'order_paid', log);
  await tellShopperById(
    ctx,
    shopper.id,
    `Your regular order "${set.name}" is sent, and ${money(placed.totalEstimatePence)} has been taken from your card ending ${card.lastFour}. You pay what the till says, and we are finding a Runner now.`,
    { url: '/my-order', tag: `order-${placed.id}` },
    log,
  );
  return { kind: 'placed', setId: set.id, orderId: placed.id };
}

/**
 * The skip word, texted back to the notice. Returns the reply, or null when the text was not the
 * skip word or there was nothing waiting to skip.
 */
export async function skipByText(
  ctx: AppContext,
  phone: string,
  text: string,
): Promise<string | null> {
  if (!isSkipInstruction(text, ctx.config.recurringOrders.skipWord)) return null;
  const shopper = await ctx.repository.shoppers.findByPhone(phone);
  if (!shopper) return null;
  const at = ctx.now();
  const waiting = (await ctx.repository.sets.listForShopper(shopper.id)).filter(
    (set) => set.active && set.noticeSentAt !== null && set.nextFireAt.getTime() > at.getTime(),
  );
  if (waiting.length === 0)
    return 'There is no regular order waiting to go, so nothing needed stopping.';
  for (const set of waiting) {
    await ctx.repository.sets.update(set.id, { skipRequestedForFireAt: set.nextFireAt });
  }
  return 'That one is cancelled. Nothing has been charged. Your regular order carries on as normal after this.';
}

/** The once-a-minute sweep: notices first, then anything whose time has come. */
export async function sweepSets(ctx: AppContext, log: FastifyBaseLogger): Promise<SetOutcome[]> {
  const notices = await sendDueNotices(ctx, log);
  const fired = await runDueSets(ctx, log);
  return [...notices, ...fired];
}
