/**
 * Getting a paid order to a Runner.
 *
 * Until 27 Sep 2026 the offer logic lived only inside `POST /jobs/:orderId/offer`, and nothing
 * ever called it: not the order route when a payment went through, not the webhook, and
 * nothing when an offer's sixty seconds ran out. Every paid order sat at "finding you a
 * Runner" for ever, however many Runners were on shift. Now it is one function, called
 * straight after a payment succeeds and by a sweep every few seconds that moves lapsed offers
 * on and picks up orders that were waiting when a Runner came on shift.
 */

import type { AppContext } from '../app.js';
import type { JobOffer, Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { buildOfferQueue, isOfferExpired, nextRunnerToOffer, offerExpiryAt } from './allocation.js';

export type OfferResult =
  | { offer: JobOffer; alreadyOffered: boolean; holdSeconds: number; queueLength: number }
  | { offer: null; alreadyOffered: false; message: string };

type DispatchContext = Pick<AppContext, 'repository' | 'config' | 'now'>;

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
  const runners = (await repository.runners.listAvailable()).filter((r) => !busy.has(r.id));
  const queue = buildOfferQueue(
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
      message: 'No Runner is free for this order yet. We will keep looking.',
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

  let offered = 0;
  for (const order of waiting) {
    try {
      const result = await offerOrder(ctx, order.id);
      if (result.offer && !result.alreadyOffered) offered += 1;
    } catch (failure) {
      onError(order.id, failure);
    }
  }
  return offered;
}
