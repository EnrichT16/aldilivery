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
 *
 * The fair queue sharpened (ruling 64, Anthony, 16 October 2026; the pure rules are in
 * `@aldilivery/core`, dispatch.ts): the Runner who has earned least today goes first, then the
 * one who has waited longest; the Shopper's regular Runner stays first only while not more than
 * `dispatch.fairShareMaxLeadPence` ahead of the lowest earner on shift; a Runner on the final leg
 * of a job may chain to a job whose pickup is within `dispatch.chainRadiusMiles` of their drop-off,
 * held `dispatch.chainMinutesBeforeDone` minutes, declining it with no penalty; Runners within
 * `dispatch.nearBandMiles` of the pickup are asked first, and the offer widens after
 * `dispatch.bandSeconds`. Each Runner can ask their own place in line (`queuePositionFor`), and
 * is never told anybody else's earnings.
 */

import {
  chainHoldSeconds,
  compareFairShare,
  fairQueue,
  firstBandOnly,
  formatPence,
  isMotorMode,
  lowestEarnedToday,
  maxGoodsFor,
  mayChain,
  modeCarries,
  needsVehicle,
  largeOrderShopperWords as coreLargeOrderShopperWords,
  queuePositionWords,
  splitPartLimitPence,
  splitPartWho,
  vehiclesWords,
  type FairPlace,
  type FairRunner,
  type NotInLine,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { JobOffer, Order, Runner } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import {
  distanceMiles,
  isOfferExpired,
  nextRunnerToOffer,
  offerExpiryAt,
  SERVICE_RADIUS_MILES,
} from './allocation.js';
import { earnedTodayPence } from './earnings.js';
import { hasPlusExtras } from './plans.js';
import { activeOrdersByRunner, mayBeOffered, takesPart } from './runner-pool.js';
import { alertIfSplitPartWaiting, replanStrandedParts, shouldSplit, splitOrder } from './split.js';
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
  const since = order.bankReceivedAt ?? order.spokenConfirmationAt ?? order.createdAt;
  // A booked order (ruling 78) starts waiting at its offer time, not when it was booked.
  return order.offerAt && order.offerAt.getTime() > since.getTime() ? order.offerAt : since;
}

/** A booked order (ruling 78) whose offer time has not come yet: never offered before it. */
function bookedForLater(order: Pick<Order, 'offerAt'>, at: Date): boolean {
  return order.offerAt !== null && order.offerAt.getTime() > at.getTime();
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
  // Booked for a later day (ruling 78): kept until its window's start less the lead time.
  if (bookedForLater(order, at)) {
    return {
      offer: null,
      alreadyOffered: false,
      message: 'This order is booked for a later day, so it is offered to Runners on that day.',
    };
  }
  const existing = await repository.offers.listForOrder(order.id);

  const live = existing.find((offer) => offer.outcome === 'pending' && !isOfferExpired(offer, at));
  if (live) {
    return { offer: live, alreadyOffered: true, holdSeconds, queueLength: 0 };
  }

  // Anything still pending has run out of time. Say so before moving on.
  for (const lapsed of existing.filter((offer) => offer.outcome === 'pending')) {
    await repository.offers.update(lapsed.id, { outcome: 'expired', respondedAt: at });
  }

  // Nobody is offered a second job while they are holding an offer for another order or are in
  // the middle of one: a Runner has one pair of hands and one bag. The one exception is chaining
  // (ruling 64): a Runner on the final leg of a job, with nothing else in hand, may be offered
  // the job next door, below.
  const holding = new Set<string>();
  for (const offer of await repository.offers.listByOutcome('pending')) {
    if (offer.orderId !== order.id && !isOfferExpired(offer, at)) holding.add(offer.runnerId);
  }
  const active = await activeOrdersByRunner(ctx);
  // Nobody is offered a job they could not accept: the Runner agreement comes first (ruling 55),
  // nobody who has left is offered anything, driving waits for in-date insurance (ruling 14),
  // a large order goes only to a Runner who can carry it (rulings 59 and 60), and the demo
  // Runner is never offered a real job.
  const onShift = (await repository.runners.listAvailable()).filter(
    (r) => !holding.has(r.id) && mayBeOffered(r, at) && canCarry(config, r, order, at),
  );
  const free = onShift.filter((r) => !active.has(r.id));
  // Earned-today balance (ruling 64): what each has earned today, compared and told to nobody.
  const earned = new Map<string, number>();
  for (const r of onShift) earned.set(r.id, await earnedTodayPence(ctx, r.id, at));
  const lowest = lowestEarnedToday(
    onShift.map((r) => ({ earnedTodayPence: earned.get(r.id) ?? 0 })),
  );
  const asFair = (r: Runner, distance: number | null): FairRunner => ({
    id: r.id,
    earnedTodayPence: earned.get(r.id) ?? 0,
    lastJobCompletedAt: r.lastJobCompletedAt,
    distanceMiles: distance,
  });

  // Chaining (ruling 64): before the general queue, a Runner on the final leg of a job whose
  // drop-off is within `dispatch.chainRadiusMiles` of this one, not too far ahead in earnings
  // and not asked about this order before, is offered it, held for `chainMinutesBeforeDone`.
  const chain = chainCandidate(
    config,
    order,
    onShift
      .filter((r) => active.has(r.id))
      .map((r) => ({ runner: r, inHand: active.get(r.id) ?? [] })),
    (r, distance) => asFair(r, distance),
    lowest,
    existing,
    at,
  );
  if (chain) {
    const hold = chainHoldSeconds(config.dispatch);
    const offer = await repository.offers.create({
      orderId: order.id,
      runnerId: chain.runnerId,
      expiresAt: offerExpiryAt(at, hold),
      queuePosition: 0,
      distanceMiles: chain.distanceMiles,
      chained: true,
    });
    if (order.status === 'paid') await repository.orders.update(order.id, { status: 'offered' });
    return { offer, alreadyOffered: false, holdSeconds: hold, queueLength: free.length + 1 };
  }

  // The fair queue (ruling 64): the near band first, then everybody else, each in order of
  // least earned today, then longest since their last job. Ozi Plus and Family and Carer: "my
  // regular Runner" where possible (ruling 58), first unless they are more than
  // `fairShareMaxLeadPence` ahead of the lowest earner on shift.
  const regular = await regularRunnerFor(ctx, order, at);
  const here = { latitude: order.latitude, longitude: order.longitude };
  const queue = fairQueue(
    free
      .map((r) => asFair(r, distanceMiles(here, r)))
      // Not a fairness rule, a practicality: a Runner twenty miles away cannot deliver chilled food.
      .filter((r) => r.distanceMiles === null || r.distanceMiles <= SERVICE_RADIUS_MILES),
    at,
    config.dispatch,
    regular,
  );

  const asked = existing.map((offer) => offer.runnerId);
  const declined = existing
    .filter((offer) => offer.outcome === 'declined')
    .map((offer) => offer.runnerId);
  // Distance band first (ruling 64): for `bandSeconds` from the first time the queue was asked,
  // the offer stays with the near band (the regular Runner with them). Somebody in it who let
  // the offer lapse is asked again before it widens; somebody who said no is not.
  const near = queue.filter((place) => place.band === 'near' || place.runnerId === regular);
  // When the queue was first asked: worked back from the first offer's expiry, which this
  // dispatcher set from its own clock, so the band's minute is measured on one clock.
  const firstAsked =
    existing
      .filter((offer) => !offer.chained)
      .map((offer) => new Date(offer.expiresAt.getTime() - holdSeconds * 1000))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? at;
  let next: FairPlace | null = null;
  if (near.length > 0 && firstBandOnly(firstAsked, at, config.dispatch.bandSeconds)) {
    next = nextRunnerToOffer(near, asked) ?? nextRunnerToOffer(near, declined);
  }
  if (!next) next = nextRunnerToOffer(queue, asked);

  // Everybody in the queue has been asked once. Somebody who said no is not asked again, but
  // somebody who simply did not answer in time gets another chance, rather than the order
  // waiting for ever because the only Runner nearby looked away for a minute.
  if (!next && queue.length > 0) next = nextRunnerToOffer(queue, declined);

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
    queuePosition: next.position,
    distanceMiles: next.distanceMiles,
  });

  if (order.status === 'paid') {
    await repository.orders.update(order.id, { status: 'offered' });
  }

  return { offer, alreadyOffered: false, holdSeconds, queueLength: queue.length };
}

/** A Runner on shift with a job in hand, and the orders in hand. */
interface RunnerInHand {
  runner: Runner;
  inHand: Order[];
}

/**
 * Who may chain to this order (ruling 64): a Runner whose only job in hand is on its final leg
 * (`delivering`, "I am on my way": there is no later step before the door), whose drop-off is
 * within `dispatch.chainRadiusMiles` of this order, who is not more than `fairShareMaxLeadPence`
 * ahead of the lowest earner on shift, and who has not been asked about this order already. With
 * more than one, the fairest of them. Null when nobody may.
 */
export function chainCandidate(
  config: AppContext['config'],
  order: Pick<Order, 'id' | 'latitude' | 'longitude'>,
  candidates: readonly RunnerInHand[],
  asFair: (runner: Runner, distance: number | null) => FairRunner,
  lowestEarnedPence: number,
  existing: readonly Pick<JobOffer, 'runnerId'>[],
  at: Date,
): (FairRunner & { runnerId: string }) | null {
  const asked = new Set(existing.map((offer) => offer.runnerId));
  const able: FairRunner[] = [];
  for (const { runner, inHand } of candidates) {
    if (asked.has(runner.id)) continue;
    const [current, ...rest] = inHand.filter((row) => row.id !== order.id);
    if (!current || rest.length > 0 || current.status !== 'delivering') continue;
    const dropOffToPickup = distanceMiles(current, order);
    const fair = asFair(runner, dropOffToPickup);
    if (mayChain(fair, dropOffToPickup, lowestEarnedPence, config.dispatch)) able.push(fair);
  }
  able.sort((a, b) => compareFairShare(a, b, at));
  const chosen = able[0];
  return chosen ? { ...chosen, runnerId: chosen.id } : null;
}

/** What `GET /runners/me/queue-position` answers: their own place, in one sentence, no money. */
export interface QueuePosition {
  /** 0 is first. Null when they are not in line. */
  position: number | null;
  reason: NotInLine | null;
  words: string;
}

/**
 * A Runner's place in the fair queue right now (ruling 64): among the Runners on shift, free
 * and allowed a job, ordered by least earned today, then longest since their last job. With no
 * job to measure distance to, there is one band. The Runner is told their place and nothing about
 * anybody else.
 */
export async function queuePositionFor(
  ctx: DispatchContext,
  runner: Runner,
  at: Date,
): Promise<QueuePosition> {
  const notInLine = (reason: NotInLine): QueuePosition => ({
    position: null,
    reason,
    words: queuePositionWords(null, reason),
  });
  if (!runner.available) return notInLine('off_shift');
  if (!runner.rightToWorkVerified || !runner.criminalRecordCheckVerified) {
    return notInLine('checks_not_done');
  }
  const active = await activeOrdersByRunner(ctx);
  if (active.has(runner.id)) return notInLine('job_in_hand');
  if (!mayBeOffered(runner, at)) return notInLine('not_allowed');

  const free = (await ctx.repository.runners.listAvailable()).filter(
    (r) => !active.has(r.id) && mayBeOffered(r, at),
  );
  const fair: FairRunner[] = [];
  for (const r of free) {
    fair.push({
      id: r.id,
      earnedTodayPence: await earnedTodayPence(ctx, r.id, at),
      lastJobCompletedAt: r.lastJobCompletedAt,
      distanceMiles: null,
    });
  }
  const place = fairQueue(fair, at, ctx.config.dispatch).find((row) => row.runnerId === runner.id);
  if (!place) return notInLine('not_allowed');
  return { position: place.position, reason: null, words: queuePositionWords(place.position) };
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
      (a, b) => (b.deliveredAt ?? b.createdAt).getTime() - (a.deliveredAt ?? a.createdAt).getTime(),
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
  ].filter(
    (order) =>
      order.runnerId === null &&
      order.splitAt === null &&
      !order.isDemo &&
      // A booked order (ruling 78) waits for its day.
      !bookedForLater(order, ctx.now()),
  );

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
