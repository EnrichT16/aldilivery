/**
 * Offering jobs to Runners.
 *
 * The queue is a rotation, not a race. A job goes to the nearest available Runner who has
 * waited longest since their last job, and it is held for them for sixty seconds. If they
 * do not answer, it passes to the next. Nobody has to sit refreshing a screen to earn.
 *
 * Every offer is written down with the position the Runner held in the rotation, so that if
 * a Runner ever asks why they are not getting work, there is an honest answer.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import {
  buildOfferQueue,
  isOfferExpired,
  nextRunnerToOffer,
  offerExpiryAt,
  poolOrders,
} from '../services/allocation.js';
import { assertTransitionAllowed } from '../services/orders.js';

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const holdSeconds = config.allocation.offerHoldSeconds;

  /**
   * Offer an order to the next Runner in the rotation.
   *
   * Called when an order is paid, and again whenever an offer lapses. Idempotent in the
   * sense that a live, unexpired offer is returned rather than a second one being made.
   */
  app.post('/jobs/:orderId/offer', async (request) => {
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);

    const order = await repository.orders.findById(orderId);
    if (!order) throw new NotFoundError('order');
    if (order.runnerId) {
      throw new ConflictError('That order already has a Runner.');
    }

    const at = now();
    const existing = await repository.offers.listForOrder(order.id);

    const live = existing.find((offer) => offer.outcome === 'pending' && !isOfferExpired(offer, at));
    if (live) {
      return { offer: live, alreadyOffered: true };
    }

    // Anything still pending has run out of time. Say so before moving on.
    for (const lapsed of existing.filter((offer) => offer.outcome === 'pending')) {
      await repository.offers.update(lapsed.id, { outcome: 'expired', respondedAt: at });
    }

    const runners = await repository.runners.listAvailable();
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

    const next = nextRunnerToOffer(
      queue,
      existing.map((offer) => offer.runnerId),
    );

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

    return { offer, holdSeconds, queueLength: queue.length };
  });

  /** What is being offered to me right now. */
  app.get('/jobs/mine', async (request) => {
    const session = requireSession(request, 'runner');
    const at = now();
    const pending = await repository.offers.listByOutcome('pending');

    const mine = pending.filter(
      (offer) => offer.runnerId === session.accountId && !isOfferExpired(offer, at),
    );

    const withOrders = await Promise.all(
      mine.map(async (offer) => ({
        offer,
        secondsLeft: Math.max(
          0,
          Math.round((offer.expiresAt.getTime() - at.getTime()) / 1000),
        ),
        order: await repository.orders.findById(offer.orderId),
      })),
    );

    return { offers: withOrders };
  });

  app.post('/jobs/:offerId/accept', async (request) => {
    const session = requireSession(request, 'runner');
    const { offerId } = z.object({ offerId: z.string().min(1) }).parse(request.params);

    const offer = await repository.offers.findById(offerId);
    if (!offer) throw new NotFoundError('offer');
    if (offer.runnerId !== session.accountId) {
      throw new ForbiddenError('That job was offered to another Runner.');
    }

    const at = now();
    if (offer.outcome !== 'pending') {
      throw new ConflictError('That job is no longer open.');
    }
    if (isOfferExpired(offer, at)) {
      await repository.offers.update(offer.id, { outcome: 'expired', respondedAt: at });
      throw new ConflictError(
        `The sixty seconds ran out and the job has gone to the next Runner. Another will come.`,
      );
    }

    const order = await repository.orders.findById(offer.orderId);
    if (!order) throw new NotFoundError('order');
    if (order.runnerId) {
      await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
      throw new ConflictError('Another Runner took that one first.');
    }

    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    if (!runner.rightToWorkVerified || !runner.criminalRecordCheckVerified) {
      throw new ForbiddenError('We still need to finish your checks before you can take a job.');
    }

    await repository.offers.update(offer.id, { outcome: 'accepted', respondedAt: at });

    assertTransitionAllowed(order.status, 'accepted');
    const updated = await repository.orders.update(order.id, {
      status: 'accepted',
      runnerId: runner.id,
      acceptedAt: at,
    });

    return {
      order: updated,
      doorstepProtocol: updated.doorstepProtocolSnapshot,
      youWillEarnPence: updated.runnerPaymentPence,
    };
  });

  app.post('/jobs/:offerId/decline', async (request) => {
    const session = requireSession(request, 'runner');
    const { offerId } = z.object({ offerId: z.string().min(1) }).parse(request.params);

    const offer = await repository.offers.findById(offerId);
    if (!offer) throw new NotFoundError('offer');
    if (offer.runnerId !== session.accountId) {
      throw new ForbiddenError('That job was offered to another Runner.');
    }
    if (offer.outcome !== 'pending') {
      throw new ConflictError('That job is no longer open.');
    }

    await repository.offers.update(offer.id, { outcome: 'declined', respondedAt: now() });
    return { declined: true, message: 'No problem. We will offer it to somebody else.' };
  });

  /**
   * Group paid orders that are close enough to be carried in one trip.
   *
   * Pooling saves the Runner time. It does not save Aldilivery money at the Runner's
   * expense: every order in a pool still pays five pounds, so a pool of three pays fifteen.
   */
  app.post('/jobs/pool', async (request) => {
    const body = z
      .object({ orderIds: z.array(z.string().min(1)).min(2) })
      .parse(request.body ?? {});

    const orders = await Promise.all(body.orderIds.map((id) => repository.orders.findById(id)));
    const found = orders.filter((order): order is NonNullable<typeof order> => order !== null);
    if (found.length !== body.orderIds.length) throw new NotFoundError('order');

    if (found.some((order) => order.latitude === null || order.longitude === null)) {
      throw new BadRequestError('We need a delivery point for every order before pooling them.');
    }

    const pools = poolOrders(
      found.map((order) => ({ id: order.id, latitude: order.latitude, longitude: order.longitude })),
      config.allocation.poolingRadiusMiles,
    );

    for (const pool of pools) {
      if (pool.orderIds.length < 2) continue;
      const poolId = pool.orderIds.join(':');
      for (const id of pool.orderIds) {
        await repository.orders.update(id, { poolId });
      }
    }

    return {
      pools: pools.map((pool) => ({
        orderIds: pool.orderIds,
        runnerPaymentPence: pool.runnerPaymentPence,
      })),
      radiusMiles: config.allocation.poolingRadiusMiles,
    };
  });
}
