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
import { collectExtraDelivery } from '../services/basket-orders.js';
import { canCarry, largeOrderWords, offerOrder } from '../services/dispatch.js';
import { ensureDoorWord, newDoorWord } from '../services/door-word.js';
import { drivingPaused } from '../services/insurance.js';
import { tellShopper } from '../services/order-updates.js';
import { assertTransitionAllowed } from '../services/orders.js';
import { AGREE_FIRST, hasAgreed } from '../services/runner-agreement.js';
import { loadCardForOrder } from '../services/runner-card.js';
import { splitView, syncSplitParent } from '../services/split.js';

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
    const runner = await repository.runners.findById(session.accountId);

    // Enough to decide whether to take it, and no more. The address, the doorstep
    // instructions and who the Shopper is only reach the Runner who accepts.
    const withOrders = await Promise.all(
      mine.map(async (offer) => {
        const order = await repository.orders.findById(offer.orderId);
        // A large order is not shown to a Runner who has since switched to a way of travelling
        // that cannot carry it (rulings 59 and 60); it lapses and goes on to one who can.
        if (order && runner && !canCarry(config, runner, order, at)) return null;
        return {
          offer,
          secondsLeft: Math.max(0, Math.round((offer.expiresAt.getTime() - at.getTime()) / 1000)),
          job: order
            ? {
                itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
                goodsEstimatePence: order.goodsEstimatePence,
                runnerPaymentPence: order.runnerPaymentPence,
                distanceMiles: offer.distanceMiles,
                // A part of a split job (ruling 60): labelled, with its own pay, shown before
                // anyone says yes, and only its own items.
                split: splitView(config, order),
              }
            : null,
        };
      }),
    );

    return { offers: withOrders.filter((entry) => entry !== null) };
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
            // A part of a split job: which part, and that another Runner brings the rest.
            split: splitView(config, order),
            // Paying them back for the shopping (ruling 55): how much, and where it has got to.
            reimbursementPence: order.reimbursementPence,
            reimbursementStatus: order.reimbursementStatus,
            // Paying at the till with the spending card: what it is loaded with, and has spent.
            payMethodUsed: order.payMethodUsed,
            cardLimitPence: order.cardLimitPence,
            cardSpentPence: order.cardSpentPence,
            // The two words to say at the door, so the Shopper knows it is their Runner (T6).
            doorWord: await ensureDoorWord(repository, order),
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
    if (order.splitAt || order.isDemo) {
      await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
      throw new ConflictError(
        order.isDemo
          ? 'That is a demo order, so there is nothing to deliver.'
          : 'That order has been split into smaller parts, offered as jobs of their own.',
      );
    }

    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    if (!runner.rightToWorkVerified || !runner.criminalRecordCheckVerified) {
      throw new ForbiddenError('We still need to finish your checks before you can take a job.');
    }
    // The agreement, with its pay-back and recovery terms, comes before any job (ruling 55).
    if (!hasAgreed(runner)) throw new ForbiddenError(AGREE_FIRST);
    if (runner.leftAt) throw new ForbiddenError('Your Runner account is closed.');
    // Driving waits for in-date insurance, checked by a person (ruling 14).
    if (drivingPaused(runner, at)) {
      throw new ForbiddenError(
        'Your motor insurance has run out, so jobs by car or motorbike are paused. Switch to walking or bicycle, or send your new certificate.',
      );
    }
    // A large order goes only to a Runner who can carry it (rulings 59 and 60).
    if (!canCarry(config, runner, order, at)) {
      throw new ForbiddenError(largeOrderWords(config, order, runner));
    }

    await repository.offers.update(offer.id, { outcome: 'accepted', respondedAt: at });

    assertTransitionAllowed(order.status, 'accepted');
    const updated = await repository.orders.update(order.id, {
      status: 'accepted',
      runnerId: runner.id,
      acceptedAt: at,
      doorWord: order.doorWord ?? newDoorWord(),
    });
    void tellShopper(app.ctx, updated, 'accepted', request.log);
    await syncSplitParent(app.ctx, updated.splitParentId);

    // A further Runner of a basket kept whole (ruling 61): their delivery is taken from the
    // Shopper's card now that they have collected the job, and not before.
    await collectExtraDelivery(app.ctx, updated.splitParentId ? ((await repository.orders.findById(updated.splitParentId)) ?? updated) : updated, request.log);

    // How they pay at the till: their spending card, loaded for this order now, or their own
    // card, paid back (Anthony, 9 October 2026). Never stops the job being theirs.
    const till = await loadCardForOrder(app.ctx, updated, runner, request.log);

    return {
      order: (await repository.orders.findById(updated.id)) ?? updated,
      till,
      doorstepProtocol: updated.doorstepProtocolSnapshot,
      youWillEarnPence: updated.runnerPaymentPence,
      split: splitView(config, updated),
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
        // Every order in the pool pays in full: £5, or £7 for £120 or more (ruling 60).
        runnerPaymentPence: pool.orderIds.reduce(
          (sum, id) => sum + (found.find((order) => order.id === id)?.runnerPaymentPence ?? 0),
          0,
        ),
      })),
      radiusMiles: config.allocation.poolingRadiusMiles,
    };
  });
}
