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
 * Large orders go to Runners with a car (ruling 59, Anthony, 10 October 2026): an order whose
 * shopping at shop prices is over `dispatch.carOnlyAbovePence` (£60) is offered only to a Runner
 * delivering by car or van whose licence and insurance are accepted and in date. Walking and
 * cycling are treated alike, up to that figure. If no such Runner is free, the order waits, and
 * the owner is texted once when it has waited `dispatch.waitingAlertMinutes` (15).
 */

import { formatPence, needsCarRunner, travelModeCarriesLargeOrders } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { JobOffer, Order, Runner } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { buildOfferQueue, isOfferExpired, nextRunnerToOffer, offerExpiryAt } from './allocation.js';
import { drivingPaused } from './insurance.js';
import { hasAgreed } from './runner-agreement.js';
import { hasPlusExtras } from './plans.js';
import { canDrive, orderReference } from '../routes/runner-account.js';

export type OfferResult =
  | { offer: JobOffer; alreadyOffered: boolean; holdSeconds: number; queueLength: number }
  | { offer: null; alreadyOffered: false; message: string };

type DispatchContext = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'env' | 'sendText'>>;

/** What a Runner is told when a large order is not theirs to take (ruling 59). */
export function largeOrderWords(config: AppContext['config']): string {
  const limit = formatPence(config.dispatch.carOnlyAbovePence, config.store.currencySymbol);
  return `This order is over ${limit} of shopping, so it goes to a Runner with a car. Switch to your car to take orders like this.`;
}

/** Whether this order is large enough to need a Runner with a car (ruling 59). */
export function isLargeOrder(
  config: AppContext['config'],
  order: Pick<Order, 'goodsEstimatePence'>,
): boolean {
  return needsCarRunner(order.goodsEstimatePence, config.dispatch.carOnlyAbovePence);
}

/**
 * Whether this Runner may carry this order: anyone for an ordinary one; for a large one, only a
 * Runner delivering by car or van today with a licence and in-date insurance accepted.
 */
export function canCarry(
  config: AppContext['config'],
  runner: Runner,
  order: Pick<Order, 'goodsEstimatePence'>,
  at: Date,
): boolean {
  if (!isLargeOrder(config, order)) return true;
  return travelModeCarriesLargeOrders(runner.vehicleType) && canDrive(runner, at);
}

/** Only an order that has been paid for, and has nobody yet, is ever offered. */
const OFFERABLE = new Set<Order['status']>(['paid', 'offered']);

/** A Runner with an order in one of these has a job in hand. */
const ACTIVE: readonly Order['status'][] = [
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

export async function offerOrder(ctx: DispatchContext, orderId: string): Promise<OfferResult> {
  const { repository, config, now } = ctx;
  const holdSeconds = config.allocation.offerHoldSeconds;

  const order = await repository.orders.findById(orderId);
  if (!order) throw new NotFoundError('order');
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
  for (const status of ACTIVE) {
    for (const active of await repository.orders.listByStatus(status)) {
      if (active.runnerId) busy.add(active.runnerId);
    }
  }
  // Nobody is offered a job they could not accept: the Runner agreement comes first (ruling 55),
  // nobody who has left is offered anything, driving waits for in-date insurance (ruling 14),
  // and a large order goes only to a Runner with a car (ruling 59).
  const runners = (await repository.runners.listAvailable()).filter(
    (r) =>
      !busy.has(r.id) &&
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
      message: isLargeOrder(config, order)
        ? 'This is a large order, so it waits for a Runner with a car. We will keep looking.'
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
  ].filter((order) => order.runnerId === null);

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
      const result = await offerOrder(ctx, order.id);
      if (result.offer && !result.alreadyOffered) offered += 1;
      if (!result.offer) await alertIfLargeOrderWaiting(ctx, order, at);
    } catch (failure) {
      onError(order.id, failure);
    }
  }
  return offered;
}

/**
 * A large order with no Runner with a car free (ruling 59): once it has waited
 * `dispatch.waitingAlertMinutes`, text the owner's alert phone, once only. Recorded on the order
 * either way, so a missing phone or a failed text does not mean a text every ten seconds.
 */
export async function alertIfLargeOrderWaiting(
  ctx: DispatchContext,
  order: Order,
  at: Date,
): Promise<boolean> {
  const { config } = ctx;
  if (order.waitingAlertSentAt || !isLargeOrder(config, order)) return false;
  // Counted from the Shopper's yes, which comes just before payment (Rule One).
  const since = order.spokenConfirmationAt ?? order.createdAt;
  const waitedMinutes = Math.floor((at.getTime() - since.getTime()) / 60_000);
  if (waitedMinutes < config.dispatch.waitingAlertMinutes) return false;

  await ctx.repository.orders.update(order.id, { waitingAlertSentAt: at });
  const phone = ctx.env?.ownerAlertPhone;
  if (!phone || !ctx.sendText) return false;
  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  try {
    await ctx.sendText(
      phone,
      `${config.productName}: order ${orderReference(order.id)}, ${money(order.goodsEstimatePence)} of shopping, has waited ${waitedMinutes} minutes. Orders over ${money(config.dispatch.carOnlyAbovePence)} go only to a Runner with a car, and none is free on shift. Please find one, or ring the Shopper.`,
    );
  } catch {
    return false;
  }
  return true;
}
