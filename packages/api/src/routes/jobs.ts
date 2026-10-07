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

import { requireSession, requireStaff } from '../app.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { isOfferExpired, poolOrders } from '../services/allocation.js';
import { offerOrder } from '../services/dispatch.js';
import { tellShopper } from '../services/order-updates.js';
import { assertTransitionAllowed } from '../services/orders.js';

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;

  /**
   * Offer an order to the next Runner in the rotation.
   *
   * Called when an order is paid, and again whenever an offer lapses. Idempotent in the
   * sense that a live, unexpired offer is returned rather than a second one being made.
   */
  app.post('/jobs/:orderId/offer', async (request) => {
    requireStaff(request, app.ctx.env.staffKey);
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    return offerOrder(app.ctx, orderId);
  });

  /** What is being offered to me right now. */
  app.get('/jobs/mine', async (request) => {
    const session = requireSession(request, 'runner');
    const at = now();
    const pending = await repository.offers.listByOutcome('pending');

    const mine = pending.filter(
      (offer) => offer.runnerId === session.accountId && !isOfferExpired(offer, at),
    );

    // Enough to decide whether to take it, and no more. The address, the doorstep
    // instructions and who the Shopper is only reach the Runner who accepts.
    const withOrders = await Promise.all(
      mine.map(async (offer) => {
        const order = await repository.orders.findById(offer.orderId);
        return {
          offer,
          secondsLeft: Math.max(0, Math.round((offer.expiresAt.getTime() - at.getTime()) / 1000)),
          job: order
            ? {
                itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
                goodsEstimatePence: order.goodsEstimatePence,
                runnerPaymentPence: order.runnerPaymentPence,
                distanceMiles: offer.distanceMiles,
              }
            : null,
        };
      }),
    );

    return { offers: withOrders };
  });

  /**
   * The job I am doing now, with everything needed to do it: the list, where it goes, and the
   * doorstep instructions exactly as the Shopper wrote them. Null when there is none.
   */
  app.get('/jobs/current', async (request) => {
    const session = requireSession(request, 'runner');
    for (const status of ['accepted', 'shopping', 'receipt_submitted', 'delivering'] as const) {
      const order = (await repository.orders.listByStatus(status)).find(
        (candidate) => candidate.runnerId === session.accountId,
      );
      if (order) {
        const shopper = await repository.shoppers.findById(order.shopperId);
        return {
          job: {
            orderId: order.id,
            status: order.status,
            shopperName: shopper?.displayName ?? 'the Shopper',
            deliveryAddress: order.deliveryAddress,
            doorstepProtocol: order.doorstepProtocolSnapshot,
            substitutionDefault: shopper?.substitutionDefault ?? 'ask_me',
            goodsEstimatePence: order.goodsEstimatePence,
            receiptTotalPence: order.receiptTotalPence,
            runnerPaymentPence: order.runnerPaymentPence,
            items: order.items.map((item) => ({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              estimatedPricePence: item.estimatedPricePence,
            })),
          },
        };
      }
    }
    return { job: null };
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
    void tellShopper(app.ctx, updated, 'accepted', request.log);

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
    if (app.ctx.autoOffer) {
      await offerOrder(app.ctx, offer.orderId).catch(() => undefined);
    }
    return { declined: true, message: 'No problem. We will offer it to somebody else.' };
  });

  /**
   * Group paid orders that are close enough to be carried in one trip.
   *
   * Pooling saves the Runner time. It does not save the service money at the Runner's
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
      found.map((order) => ({
        id: order.id,
        latitude: order.latitude,
        longitude: order.longitude,
      })),
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
