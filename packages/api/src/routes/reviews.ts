/**
 * Shop reviews, review points and Shop of the Month (ruling 70): the Shopper's side (which shops
 * to rate, giving a rating, the points balance), the public winners and standings, and the
 * standings for staff. The rules are in services/shop-of-the-month.ts.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { staffActor } from '../lib/staff.js';
import {
  currentAwards,
  monthKey,
  pendingReviews,
  periodAt,
  pointsBalance,
  shopsInOrder,
  standingsFor,
  type PointsBalance,
} from '../services/shop-of-the-month.js';

const reviewSchema = z.object({
  shop: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  message: z.string().trim().max(1000).default(''),
});

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const rules = config.feedback.reviews;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  /** "You have 40 points, worth 40p." */
  function balanceWords(balance: PointsBalance): string {
    const worth = balance.worthPence < 100 ? `${balance.worthPence}p` : money(balance.worthPence);
    const points = `${balance.points} ${balance.points === 1 ? 'point' : 'points'}`;
    const pending =
      balance.pendingPoints > 0 ? ` ${balance.pendingPoints} more are on their way.` : '';
    return `You have ${points}, worth ${worth}.${pending}`;
  }

  const rulesForShoppers = {
    pointsPerReview: rules.pointsPerReview,
    pencePerPoint: rules.pencePerPoint,
    spendFromPoints: rules.spendFromPoints,
    pendingDays: rules.pendingDays,
  };

  /** The shops this Shopper is asked to rate, and where their points stand. */
  app.get('/me/reviews/pending', async (request) => {
    const session = requireSession(request, 'shopper');
    const [pending, balance] = await Promise.all([
      pendingReviews(app.ctx, session.accountId),
      pointsBalance(app.ctx, session.accountId),
    ]);
    return {
      pending,
      balance: { ...balance, words: balanceWords(balance) },
      rules: rulesForShoppers,
    };
  });

  /** The points balance and the reviews given, newest first, for "my points". */
  app.get('/me/reviews', async (request) => {
    const session = requireSession(request, 'shopper');
    const balance = await pointsBalance(app.ctx, session.accountId);
    const reviews = await repository.shopReviews.listForShopper(session.accountId);
    const shops = new Map<string, string>();
    for (const review of reviews) {
      if (!shops.has(review.partnerShopId)) {
        const shop = await repository.partnerShops.findById(review.partnerShopId);
        shops.set(review.partnerShopId, shop?.name ?? 'a shop');
      }
    }
    return {
      balance: { ...balance, words: balanceWords(balance) },
      reviews: reviews.map((review) => ({
        id: review.id,
        orderId: review.orderId,
        shopName: shops.get(review.partnerShopId),
        stars: review.stars,
        points: review.points,
        status: review.status,
        createdAt: review.createdAt,
      })),
      rules: rulesForShoppers,
    };
  });

  /**
   * Rating a shop whose things were in a delivered order. Every honest review earns the same
   * points, one star or five; one rewarded review per shop per month; the points wait their days.
   */
  app.post('/orders/:id/shop-review', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = reviewSchema.parse(request.body ?? {});
    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (order.shopperId !== session.accountId) throw new ForbiddenError('That order is not yours.');
    if (order.status !== 'delivered' && order.status !== 'completed') {
      throw new ConflictError('You can rate the shop once your shopping has arrived.');
    }
    const shop = (await shopsInOrder(app.ctx, order)).find((one) => one.id === input.shop);
    if (!shop) throw new BadRequestError('Nothing in this order came from that shop.');
    if (await repository.shopReviews.findByOrderAndShop(order.id, shop.id)) {
      throw new ConflictError('Thank you, you have already rated that shop for this order.');
    }
    const at = now();
    const thisMonth = (await repository.shopReviews.listForShopper(session.accountId)).some(
      (review) => review.partnerShopId === shop.id && monthKey(review.createdAt) === monthKey(at),
    );
    if (thisMonth) {
      throw new ConflictError(
        `Thank you, you have already rated ${shop.name} this month. You can rate it again next month.`,
      );
    }
    await repository.shopReviews.create({
      orderId: order.id,
      shopperId: session.accountId,
      partnerShopId: shop.id,
      stars: input.stars,
      message: input.message,
      points: rules.pointsPerReview,
      status: 'pending',
      earnedAt: null,
      createdAt: at,
    });
    const balance = await pointsBalance(app.ctx, session.accountId);
    void reply.status(201);
    return {
      points: rules.pointsPerReview,
      pendingDays: rules.pendingDays,
      balance: { ...balance, words: balanceWords(balance) },
      message: `Thank you for rating ${shop.name}. ${rules.pointsPerReview} points are on their way to you and will be yours in ${rules.pendingDays} days. ${balanceWords(balance)}`,
    };
  });

  /** Public: who holds Shop of the Month, of the Quarter and of the Half Year, and this month's top five. */
  app.get('/shops/of-the-month', async () => {
    const awards = await currentAwards(app.ctx);
    const standings = await standingsFor(app.ctx, periodAt('month', now()));
    return {
      awards,
      standings: {
        period: standings.period,
        minimumReviews: standings.minimumReviews,
        rows: standings.rows.slice(0, 5),
      },
    };
  });

  /** Staff: the full standings for the current month, quarter and half year, and the holders. */
  app.get('/staff/shop-of-the-month', async (request) => {
    await staffActor(request, 'partners');
    const at = now();
    const [month, quarter, half] = await Promise.all([
      standingsFor(app.ctx, periodAt('month', at)),
      standingsFor(app.ctx, periodAt('quarter', at)),
      standingsFor(app.ctx, periodAt('half', at)),
    ]);
    return { awards: await currentAwards(app.ctx), standings: { month, quarter, half } };
  });
}
