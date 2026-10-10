/**
 * Getting a paid order to a Runner.
 *
 * Until 27 Sep 2026 the offer logic lived only inside `POST /jobs/:orderId/offer`, and nothing
 * ever called it: not the order route when a payment went through, not the webhook, and
 * nothing when an offer's sixty seconds ran out. Every paid order sat at "finding you a
 * Runner" for ever, however many Runners were on shift. Now it is one function, called
 * straight after a payment succeeds and by a sweep every few seconds that moves lapsed offers
 * on and picks up orders that were waiting when a Runner came on shift.
 *
 * Who may carry what (ruling 59, as changed by ruling 60, Anthony, 10 October 2026): each way of
 * travelling carries up to its own most of shopping at shop prices (`dispatch.maxGoodsPenceByMode`):
 * on foot and by bicycle £60, by motorbike £70, by car and by van any order up to the £150 cap. A
 * motorbike, car or van also needs a licence and in-date insurance a person has accepted. An
 * ordinary order (within what walking and cycling carry) goes to everyone, as before. If nobody
 * who can carry a large order takes it, after `dispatch.splitAfterMinutes` (10) it is split into
 * parts for the fewest Runners possible, motorbike riders first, then Runners on foot or bicycle
 * (services/split.ts, ruling 61), each offered as its own job only to Runners of its kind. The
 * owner is texted when it is split, and once if it (or a part) has waited
 * `dispatch.waitingAlertMinutes` (15).
 *
 * A demo order (the app store reviewers' demo account) is never offered to anybody, and the demo
 * Runner is never offered a real job.
 */

import {
  formatPence,
  isMotorMode,
  maxGoodsFor,
  modeCarries,
  needsVehicle,
  largeOrderShopperWords as coreLargeOrderShopperWords,
  splitPartLimitPence,
  splitPartWho,
  vehiclesWords,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { JobOffer, Order, Runner } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { buildOfferQueue, isOfferExpired, nextRunnerToOffer, offerExpiryAt } from './allocation.js';
import { drivingPaused } from './insurance.js';
import { hasAgreed } from './runner-agreement.js';
import { hasPlusExtras } from './plans.js';
import { runnersWithJobInHand, takesPart } from './runner-pool.js';
import {
  alertIfSplitPartWaiting,
  replanStrandedParts,
  shouldSplit,
  splitOrder,
} from './split.js';
import { canDrive, orderReference } from '../routes/runner-account.js';

export type OfferResult =
  | { offer: JobOffer; alreadyOffered: boolean; holdSeconds: number; queueLength: number }
  | { offer: null; alreadyOffered: false; message: string };

export type DispatchContext = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'env' | 'sendText' | 'sendPush'>>;

/** "a motorbike, car or van": the vehicles that may carry this much shopping. */
export function vehiclesFor(config: AppContext['config'], goodsPence: number): string {
  return vehiclesWords(goodsPence, config.dispatch.maxGoodsPenceByMode);
}

/**
 * What the Shopper is told about a large order before they say yes (rulings 59 and 60): who
 * carries it, and that it may come in parts, for the same price.
 */
export function largeOrderShopperWords(config: AppContext['config'], goodsPence: number): string {
  return coreLargeOrderShopperWords(goodsPence, config.dispatch.maxGoodsPenceByMode);
}

/** What a Runner is told when a large order is not theirs to take. */
export function largeOrderWords(
  config: AppContext['config'],
  order: Pick<Order, 'goodsEstimatePence'> & Partial<Pick<Order, 'splitMode'>>,
  runner?: Pick<Runner, 'vehicleType'>,
): string {
  // A part of a split job goes only to Runners of its kind (ruling 61).
  if (order.splitMode) {
    if (runner && order.splitMode === 'motorbike' && isMotorMode(runner.vehicleType)) {
      return 'Before you can take this part, we need your driving licence and insurance checked and in date.';
    }
    return `This part of a split job goes to ${splitPartWho(order.splitMode)}.`;
  }
  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  const limits = config.dispatch.maxGoodsPenceByMode;
  const goods = order.goodsEstimatePence;
  const yours = runner ? maxGoodsFor(runner.vehicleType, limits) : splitPartLimitPence(limits);
  if (runner && isMotorMode(runner.vehicleType) && goods <= yours) {
    return 'Before you can take orders this large, we need your driving licence and insurance checked and in date.';
  }
  return `This order is ${money(goods)} of shopping, more than ${money(yours)}, so it goes to a Runner with ${vehiclesFor(config, goods)}.`;
}

/** Whether this order is over what walking and cycling carry (ruling 60). */
export function isLargeOrder(
  config: AppContext['config'],
  order: Pick<Order, 'goodsEstimatePence'>,
): boolean {
  return needsVehicle(order.goodsEstimatePence, config.dispatch.maxGoodsPenceByMode);
}

/**
 * Whether this Runner may carry this order: anyone for an ordinary one; for a large one, only a
 * Runner whose way of travelling today carries that much, and for a motorbike, car or van, with
 * a licence and in-date insurance accepted; for a part of a split job, only a Runner of its kind.
 */
export function canCarry(
  config: AppContext['config'],
  runner: Runner,
  order: Pick<Order, 'goodsEstimatePence'> & Partial<Pick<Order, 'splitMode'>>,
  at: Date,
): boolean {
  // A part of a split job (ruling 61): a motorbike part to a motorbike rider (or a car or van
  // Runner) with a licence and insurance checked; a foot part to a Runner on foot or bicycle.
  if (order.splitMode) return takesPart(runner, order.splitMode, at);
  if (!isLargeOrder(config, order)) return true;
  const limits = config.dispatch.maxGoodsPenceByMode;
  if (!modeCarries(runner.vehicleType, order.goodsEstimatePence, limits)) return false;
  return !isMotorMode(runner.vehicleType) || canDrive(runner, at);
}

/**
 * When an order started waiting for a Runner: when a bank transfer arrived, or the Shopper's yes,
 * which comes just before a card payment (Rule One).
 */
export function waitingSince(order: Order): Date {
  return order.bankReceivedAt ?? order.spokenConfirmationAt ?? order.createdAt;
}

/** Only an order that has been paid for, and has nobody yet, is ever offered. */
const OFFERABLE = new Set<Order['status']>(['paid', 'offered']);

export async function offerOrder(ctx: DispatchContext, orderId: string): Promise<OfferResult> {
  const { repository, config, now } = ctx;
  const holdSeconds = config.allocation.offerHoldSeconds;

  const order = await repository.orders.findById(orderId);
  if (!order) throw new NotFoundError('order');
  // A demo order (ruling 60) is never sent to anybody: nothing is bought and nobody goes.
  if (order.isDemo) {
    return {
      offer: null,
      alreadyOffered: false,
      message: 'This is a demo order, so no Runner is sent and nothing is bought.',
    };
  }
  // A split order is offered as its parts, each on its own (ruling 60), never as a whole.
  if (order.splitAt) {
    return {
      offer: null,
      alreadyOffered: false,
      message: 'This order has been split into parts, and each part is offered on its own.',
    };
  }
  if (order.runnerId) throw new ConflictError('That order already has a Runner.');
  if (!OFFERABLE.has(order.status)) {
    // An unpaid, cancelled or refunded order must never reach a Runner, who would spend
    // their own money at the till for it.
    throw new ConflictError('That order is not paid for, so it cannot be offered to a Runner.');
  }

  const at = now();
  const existing = await repository.offers.listForOrder(order.id);

  const live = existing.find((offer) => offer.outcome === 'pending' && !isOfferExpired(offer, at));
  if (live) {
    return { offer: live, alreadyOffered: true, holdSeconds, queueLength: 0 };
  }

  // Anything still pending has run out of time. Say so before moving on.
  for (const lapsed of existing.filter((offer) => offer.outcome === 'pending')) {
    await repository.offers.update(lapsed.id, { outcome: 'expired', respondedAt: at });
  }

  // Nobody is offered a second job while they are holding an offer for another order or
  // are in the middle of one: a Runner has one pair of hands and one bag.
  const busy = new Set<string>();
  for (const offer of await repository.offers.listByOutcome('pending')) {
    if (offer.orderId !== order.id && !isOfferExpired(offer, at)) busy.add(offer.runnerId);
  }
  for (const runnerId of await runnersWithJobInHand(ctx)) busy.add(runnerId);
  // Nobody is offered a job they could not accept: the Runner agreement comes first (ruling 55),
  // nobody who has left is offered anything, driving waits for in-date insurance (ruling 14),
  // a large order goes only to a Runner who can carry it (rulings 59 and 60), and the demo
  // Runner is never offered a real job.
  const runners = (await repository.runners.listAvailable()).filter(
    (r) =>
      !busy.has(r.id) &&
      !r.isDemo &&
      hasAgreed(r) &&
      !r.leftAt &&
      !drivingPaused(r, at) &&
      canCarry(config, r, order, at),
  );
  const fairQueue = buildOfferQueue(
    { latitude: order.latitude, longitude: order.longitude },
    runners.map((runner) => ({
      id: runner.id,
      latitude: runner.latitude,
      longitude: runner.longitude,
      rightToWorkVerified: runner.rightToWorkVerified,
      criminalRecordCheckVerified: runner.criminalRecordCheckVerified,
      available: runner.available,
      lastJobCompletedAt: runner.lastJobCompletedAt,
    })),
    at,
  );
  // Ozi Plus and Family and Carer: "my regular Runner" where possible (ruling 58). Their last
  // good Runner, if on shift and free, is offered the job first; everybody else keeps their
  // place in the fair rotation behind them.
  const regular = await regularRunnerFor(ctx, order, at);
  const queue = regular
    ? [
        ...fairQueue.filter((entry) => entry.runnerId === regular),
        ...fairQueue.filter((entry) => entry.runnerId !== regular),
      ]
    : fairQueue;

  let next = nextRunnerToOffer(
    queue,
    existing.map((offer) => offer.runnerId),
  );

  // Everybody in the queue has been asked once. Somebody who said no is not asked again, but
  // somebody who simply did not answer in time gets another chance, rather than the order
  // waiting for ever because the only Runner nearby looked away for a minute.
  if (!next && queue.length > 0) {
    const declined = existing
      .filter((offer) => offer.outcome === 'declined')
      .map((offer) => offer.runnerId);
    next = nextRunnerToOffer(queue, declined);
  }

  if (!next) {
    return {
      offer: null,
      alreadyOffered: false,
      message: order.splitMode
        ? `This part waits for ${splitPartWho(order.splitMode)}. We will keep looking.`
        : isLargeOrder(config, order)
        ? `This is a large order, so it waits for a Runner with ${vehiclesFor(config, order.goodsEstimatePence)}. We will keep looking.`
        : 'No Runner is free for this order yet. We will keep looking.',
    };
  }

  const offer = await repository.offers.create({
    orderId: order.id,
    runnerId: next.runnerId,
    expiresAt: offerExpiryAt(at, holdSeconds),
    queuePosition: next.queuePosition,
    distanceMiles: next.distanceMiles,
  });

  if (order.status === 'paid') {
    await repository.orders.update(order.id, { status: 'offered' });
  }

  return { offer, alreadyOffered: false, holdSeconds, queueLength: queue.length };
}

/**
 * The Runner who last delivered to this Shopper with no problem reported on that order, when the
 * Shopper is on Ozi Plus or Family and Carer. Null otherwise.
 */
export async function regularRunnerFor(
  ctx: DispatchContext,
  order: Order,
  at: Date,
): Promise<string | null> {
  const shopper = await ctx.repository.shoppers.findById(order.shopperId);
  if (!shopper || !hasPlusExtras(shopper, at)) return null;
  const past = (await ctx.repository.orders.listForShopper(shopper.id))
    .filter(
      (row) =>
        row.id !== order.id &&
        row.runnerId !== null &&
        (row.status === 'delivered' || row.status === 'completed'),
    )
    .sort(
      (a, b) =>
        (b.deliveredAt ?? b.createdAt).getTime() - (a.deliveredAt ?? a.createdAt).getTime(),
    );
  for (const row of past) {
    const problems = await ctx.repository.problems.listForOrder(row.id);
    if (problems.length === 0) return row.runnerId;
  }
  return null;
}

/** Whether this order's Shopper has priority at busy times (Ozi Plus, Family and Carer). */
async function hasPriority(ctx: DispatchContext, order: Order, at: Date): Promise<boolean> {
  const shopper = await ctx.repository.shoppers.findById(order.shopperId);
  return shopper !== null && hasPlusExtras(shopper, at);
}

/**
 * Offer every paid order that has nobody yet. Run on a timer by the server. Each order is
 * tried on its own, so one that fails does not hold up the rest.
 */
export async function sweepOffers(
  ctx: DispatchContext,
  onError: (orderId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  const waiting = [
    ...(await ctx.repository.orders.listByStatus('paid')),
    ...(await ctx.repository.orders.listByStatus('offered')),
  ].filter((order) => order.runnerId === null && order.splitAt === null && !order.isDemo);

  // Priority at busy times (ruling 58): when orders are waiting for Runners, those of Shoppers on
  // Ozi Plus or Family and Carer are offered first; otherwise the oldest first, as before.
  const at = ctx.now();
  const priority = new Set<string>();
  for (const order of waiting) {
    if (await hasPriority(ctx, order, at)) priority.add(order.id);
  }
  waiting.sort(
    (a, b) =>
      Number(priority.has(b.id)) - Number(priority.has(a.id)) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  let offered = 0;
  for (const order of waiting) {
    try {
      // Nobody who could carry it took it in time: split it into parts, motorbike riders first,
      // then foot and bicycle, and offer each part on its own (rulings 60 and 61).
      if (shouldSplit(ctx, order, at)) {
        const parts = await splitOrder(ctx, order, at);
        for (const part of parts) {
          const result = await offerOrder(ctx, part.id);
          if (result.offer && !result.alreadyOffered) offered += 1;
        }
        if (parts.length > 0) continue;
      }
      // A part whose kind of Runner is no longer on shift: the rest is planned again (ruling 61).
      if (order.splitParentId) {
        // Another part's planning may have just replaced this one.
        const fresh = await ctx.repository.orders.findById(order.id);
        if (!fresh || fresh.runnerId || !OFFERABLE.has(fresh.status)) continue;
        const replanned = await replanStrandedParts(ctx, order, at);
        if (replanned) {
          for (const part of replanned) {
            const result = await offerOrder(ctx, part.id);
            if (result.offer && !result.alreadyOffered) offered += 1;
          }
          continue;
        }
      }
      const result = await offerOrder(ctx, order.id);
      if (result.offer && !result.alreadyOffered) offered += 1;
      if (!result.offer) await alertIfLargeOrderWaiting(ctx, order, at);
      // A part that nobody has taken either: the owner is told again, once (ruling 60).
      await alertIfSplitPartWaiting(ctx, order, at);
    } catch (failure) {
      onError(order.id, failure);
    }
  }
  return offered;
}

/**
 * A large order that nobody who can carry it has taken (rulings 59 and 60): once it has waited
 * `dispatch.waitingAlertMinutes`, text the owner's alert phone, once only. Recorded on the order
 * either way, so a missing phone or a failed text does not mean a text every ten seconds.
 */
export async function alertIfLargeOrderWaiting(
  ctx: DispatchContext,
  order: Order,
  at: Date,
): Promise<boolean> {
  const { config } = ctx;
  if (order.waitingAlertSentAt || order.splitParentId || !isLargeOrder(config, order)) return false;
  // Counted from the Shopper's yes, which comes just before payment (Rule One).
  const since = waitingSince(order);
  const waitedMinutes = Math.floor((at.getTime() - since.getTime()) / 60_000);
  if (waitedMinutes < config.dispatch.waitingAlertMinutes) return false;

  await ctx.repository.orders.update(order.id, { waitingAlertSentAt: at });
  const phone = ctx.env?.ownerAlertPhone;
  if (!phone || !ctx.sendText) return false;
  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  try {
    await ctx.sendText(
      phone,
      `${config.productName}: order ${orderReference(order.id)}, ${money(order.goodsEstimatePence)} of shopping, has waited ${waitedMinutes} minutes. Orders over ${money(splitPartLimitPence(config.dispatch.maxGoodsPenceByMode))} go only to a Runner with ${vehiclesFor(config, order.goodsEstimatePence)}, and none has taken it. If nobody does, it is split into parts, motorbike riders first, then Runners on foot or bicycle, ${config.dispatch.splitAfterMinutes} minutes after the Shopper's yes. Please find a Runner, or ring the Shopper.`,
    );
  } catch {
    return false;
  }
  return true;
}
