/**
 * Shop reviews, review points and Shop of the Month (ruling 70, Anthony's decisions of 16 and
 * 17 October 2026).
 *
 * - After a delivered order with a Shop Partner's things in it, the Shopper is asked to rate
 *   that shop, one to five stars, with a few words if they like. Every honest review earns the
 *   same points, one star or five (Section O: never conditional on the review being kind).
 * - The points wait `pendingDays`, and are lost if the order is refunded or cancelled. One
 *   rewarded review per shop per calendar month per Shopper. From `spendFromPoints` they become
 *   delivery credit at `pencePerPoint`, applied to the next order the way gift card credit is.
 *   Points have no cash value.
 * - Shop of the Month, of the Quarter and of the Half Year: among approved Shop Partners on
 *   paid Partner Plus, with at least `shopOfTheMonthMinimumReviews` reviews in the period,
 *   ranked by a balanced score: (reviews × mean + prior × global mean) / (reviews + prior), so
 *   a shop with two five-star reviews does not beat one with forty at 4.8.
 *
 * Every figure comes from `feedback.reviews` in config/store.json. Nothing here names a shop.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order, PartnerShop, ShopReview } from '../domain.js';

const DAY_MS = 24 * 3600 * 1000;

export type PeriodKind = 'month' | 'quarter' | 'half';

export interface Period {
  kind: PeriodKind;
  /** The first moment of the period. */
  since: Date;
  /** The first moment after the period. */
  until: Date;
  /** "October 2026", "July to September 2026", "January to June 2026". */
  words: string;
  /** "Shop of the Month, October 2026". */
  title: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const TITLES: Record<PeriodKind, string> = {
  month: 'Shop of the Month',
  quarter: 'Shop of the Quarter',
  half: 'Shop of the Half Year',
};

/** How many months each kind of period lasts. */
const LENGTH: Record<PeriodKind, number> = { month: 1, quarter: 3, half: 6 };

/** The period of a kind that a moment falls in, by the calendar (UTC). */
export function periodAt(kind: PeriodKind, at: Date): Period {
  const length = LENGTH[kind];
  const year = at.getUTCFullYear();
  const firstMonth = Math.floor(at.getUTCMonth() / length) * length;
  const since = new Date(Date.UTC(year, firstMonth, 1));
  const until = new Date(Date.UTC(year, firstMonth + length, 1));
  const lastMonth = firstMonth + length - 1;
  const words =
    length === 1
      ? `${MONTHS[firstMonth]} ${year}`
      : `${MONTHS[firstMonth]} to ${MONTHS[lastMonth]} ${year}`;
  return { kind, since, until, words, title: `${TITLES[kind]}, ${words}` };
}

/** The period of a kind that finished most recently before a moment: the one with a winner. */
export function lastPeriod(kind: PeriodKind, at: Date): Period {
  const current = periodAt(kind, at);
  return periodAt(kind, new Date(current.since.getTime() - DAY_MS));
}

/** "2026-10": the calendar month a review counts for. */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Approved, not paused, and on Partner Plus with the month paid: the shops that can win (ruling
 * 65). A shop marked Plus whose month has run out, or was never paid, cannot (Anthony, 30
 * October 2026).
 */
export function eligibleForAward(shop: PartnerShop, at: Date): boolean {
  return (
    shop.status === 'approved' &&
    shop.active &&
    shop.plan === 'plus' &&
    shop.paidUntil !== null &&
    shop.paidUntil.getTime() > at.getTime()
  );
}

/**
 * Which Shop Partners' things were in an order. A partner's product is in the catalogue with
 * `externalRef` "partner:<product id>" and the category "From <shop>" (routes/business.ts), so
 * the product is the sure way back to its shop, and the category the fallback for older rows.
 */
export async function shopsInOrder(
  ctx: Pick<AppContext, 'repository'>,
  order: Order,
): Promise<PartnerShop[]> {
  const { repository } = ctx;
  const items = await repository.catalogue.findManyByIds(
    order.items.map((item) => item.catalogueItemId ?? '').filter(Boolean),
  );
  const found = new Map<string, PartnerShop>();
  let allShops: PartnerShop[] | null = null;
  for (const item of items) {
    const productId = item.externalRef?.startsWith('partner:') ? item.externalRef.slice(8) : null;
    let shop: PartnerShop | null = null;
    if (productId) {
      const product = await repository.partnerProducts.findById(productId);
      if (product) shop = await repository.partnerShops.findById(product.partnerShopId);
    }
    if (!shop && item.category.startsWith('From ')) {
      const name = item.category.slice(5);
      allShops ??= await repository.partnerShops.list();
      shop = allShops.find((candidate) => candidate.name === name) ?? null;
    }
    if (shop && !found.has(shop.id)) found.set(shop.id, shop);
  }
  return [...found.values()];
}

export interface PendingReview {
  orderId: string;
  deliveredAt: Date;
  shop: { id: string; name: string };
}

/** Delivered recently, with a Shop Partner's things in it. */
function deliveredMoment(order: Order): Date | null {
  if (order.status !== 'delivered' && order.status !== 'completed') return null;
  return order.deliveredAt ?? order.completedAt ?? null;
}

/**
 * The shops this Shopper is asked to rate: from orders delivered in the last `askWithinDays`,
 * each shop not yet reviewed by them this calendar month, newest delivery first.
 */
export async function pendingReviews(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  shopperId: string,
): Promise<PendingReview[]> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const since = new Date(at.getTime() - config.feedback.reviews.askWithinDays * DAY_MS);
  const orders = (await repository.orders.listForShopper(shopperId))
    .filter((order) => {
      const when = deliveredMoment(order);
      return when !== null && when.getTime() >= since.getTime();
    })
    .sort((a, b) => (deliveredMoment(b)?.getTime() ?? 0) - (deliveredMoment(a)?.getTime() ?? 0));
  if (orders.length === 0) return [];
  const reviewedThisMonth = new Set(
    (await repository.shopReviews.listForShopper(shopperId))
      .filter((review) => monthKey(review.createdAt) === monthKey(at))
      .map((review) => review.partnerShopId),
  );
  const pending: PendingReview[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    for (const shop of await shopsInOrder(ctx, order)) {
      if (reviewedThisMonth.has(shop.id) || seen.has(shop.id)) continue;
      if (shop.status !== 'approved') continue;
      seen.add(shop.id);
      pending.push({
        orderId: order.id,
        deliveredAt: deliveredMoment(order)!,
        shop: { id: shop.id, name: shop.name },
      });
    }
  }
  return pending;
}

export interface PointsBalance {
  /** Points earned and not yet turned into credit. */
  points: number;
  /** Points still waiting their days. */
  pendingPoints: number;
  /** What the balance is worth in pence (no cash value: only ever credit). */
  worthPence: number;
  /** Points needed before the next conversion into credit. */
  pointsToSpend: number;
  reviews: number;
}

export async function pointsBalance(
  ctx: Pick<AppContext, 'repository' | 'config'>,
  shopperId: string,
): Promise<PointsBalance> {
  const { repository, config } = ctx;
  const { pencePerPoint, spendFromPoints } = config.feedback.reviews;
  const reviews = await repository.shopReviews.listForShopper(shopperId);
  const earned = reviews
    .filter((review) => review.status === 'earned')
    .reduce((sum, review) => sum + review.points, 0);
  const pendingPoints = reviews
    .filter((review) => review.status === 'pending')
    .reduce((sum, review) => sum + review.points, 0);
  const spent = await repository.shopReviews.spentPoints(shopperId);
  const points = Math.max(0, earned - spent);
  return {
    points,
    pendingPoints,
    worthPence: points * pencePerPoint,
    pointsToSpend: Math.max(0, spendFromPoints - points),
    reviews: reviews.filter((review) => review.status !== 'void').length,
  };
}

/**
 * Turns whole lots of `spendFromPoints` into delivery credit on the account, which the next
 * order uses the way gift card credit is used (services/credit.ts). Returns the pence given.
 */
export async function convertPointsToCredit(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  shopperId: string,
): Promise<number> {
  const { repository, config } = ctx;
  const { pencePerPoint, spendFromPoints } = config.feedback.reviews;
  const balance = await pointsBalance(ctx, shopperId);
  const lots = Math.floor(balance.points / spendFromPoints);
  if (lots <= 0) return 0;
  const points = lots * spendFromPoints;
  const pence = points * pencePerPoint;
  const shopper = await repository.shoppers.findById(shopperId);
  if (!shopper) return 0;
  await repository.shopReviews.spend({ shopperId, points, pence, createdAt: ctx.now() });
  await repository.shoppers.update(shopperId, { creditPence: shopper.creditPence + pence });
  return pence;
}

/** Refunded or cancelled: the points for it are lost. */
function orderLost(order: Order | null): boolean {
  return order === null || order.status === 'refunded' || order.status === 'cancelled';
}

export interface ReviewSweepReport {
  earned: number;
  voided: number;
  creditedPence: number;
}

/**
 * Hourly: pending reviews whose order was refunded are void; the rest, once their days are up,
 * are earned, and any Shopper who now has enough points gets the credit. Each review is on its
 * own, so one failure does not stop the rest, and running it twice changes nothing more.
 */
export async function settleShopReviews(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  log?: FastifyBaseLogger,
): Promise<ReviewSweepReport> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const ready = at.getTime() - config.feedback.reviews.pendingDays * DAY_MS;
  const report: ReviewSweepReport = { earned: 0, voided: 0, creditedPence: 0 };
  const touched = new Set<string>();
  for (const review of await repository.shopReviews.listByStatus('pending')) {
    try {
      const order = await repository.orders.findById(review.orderId);
      if (orderLost(order)) {
        await repository.shopReviews.update(review.id, { status: 'void' });
        report.voided += 1;
      } else if (review.createdAt.getTime() <= ready) {
        await repository.shopReviews.update(review.id, { status: 'earned', earnedAt: at });
        report.earned += 1;
        touched.add(review.shopperId);
      }
    } catch (failure) {
      log?.error({ err: failure, reviewId: review.id }, 'A shop review could not be settled.');
    }
  }
  for (const shopperId of touched) {
    try {
      report.creditedPence += await convertPointsToCredit(ctx, shopperId);
    } catch (failure) {
      log?.error({ err: failure, shopperId }, 'Review points could not be turned into credit.');
    }
  }
  return report;
}

export interface Standing {
  shop: { id: string; name: string };
  reviews: number;
  /** Mean stars, to one decimal place. */
  average: number;
  /** The balanced score, to two decimal places. */
  score: number;
  /** Enough reviews in the period to win. */
  qualifies: boolean;
}

export interface Standings {
  period: Period;
  minimumReviews: number;
  /** Every eligible shop with a review in the period, best first. */
  rows: Standing[];
  /** The best qualifying shop, or null when none has enough reviews. */
  winner: Standing | null;
}

/** The balanced score: (n × mean + prior × global mean) / (n + prior). */
export function balancedScore(
  reviews: number,
  mean: number,
  globalMean: number,
  prior: number,
): number {
  if (reviews + prior === 0) return 0;
  return (reviews * mean + prior * globalMean) / (reviews + prior);
}

/** The standings for a period, from the reviews that count (not void) of eligible shops. */
export async function standingsFor(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  period: Period,
): Promise<Standings> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const minimumReviews = config.feedback.reviews.shopOfTheMonthMinimumReviews;
  const prior = config.feedback.reviews.shopOfTheMonthPriorWeight;
  const shops = new Map(
    (await repository.partnerShops.list())
      .filter((shop) => eligibleForAward(shop, at))
      .map((shop) => [shop.id, shop] as const),
  );
  const reviews = (await repository.shopReviews.listBetween(period.since, period.until)).filter(
    (review: ShopReview) => review.status !== 'void' && shops.has(review.partnerShopId),
  );
  const globalMean =
    reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.stars, 0) / reviews.length
      : 0;
  const byShop = new Map<string, number[]>();
  for (const review of reviews) {
    byShop.set(review.partnerShopId, [...(byShop.get(review.partnerShopId) ?? []), review.stars]);
  }
  const rows: Standing[] = [...byShop.entries()]
    .map(([shopId, stars]) => {
      const mean = stars.reduce((sum, one) => sum + one, 0) / stars.length;
      return {
        shop: { id: shopId, name: shops.get(shopId)!.name },
        reviews: stars.length,
        average: Math.round(mean * 10) / 10,
        score: Math.round(balancedScore(stars.length, mean, globalMean, prior) * 100) / 100,
        qualifies: stars.length >= minimumReviews,
      };
    })
    .sort(
      (a, b) =>
        Number(b.qualifies) - Number(a.qualifies) ||
        b.score - a.score ||
        b.reviews - a.reviews ||
        a.shop.name.localeCompare(b.shop.name),
    );
  const winner = rows.find((row) => row.qualifies) ?? null;
  return { period, minimumReviews, rows, winner };
}

export interface Award {
  kind: PeriodKind;
  /** "Shop of the Month, September 2026". */
  title: string;
  shop: { id: string; name: string };
  reviews: number;
  average: number;
}

/** The current holders: the winners of the last finished month, quarter and half year. */
export async function currentAwards(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
): Promise<Award[]> {
  const at = ctx.now();
  const awards: Award[] = [];
  for (const kind of ['month', 'quarter', 'half'] as const) {
    const standings = await standingsFor(ctx, lastPeriod(kind, at));
    if (standings.winner) {
      awards.push({
        kind,
        title: standings.period.title,
        shop: standings.winner.shop,
        reviews: standings.winner.reviews,
        average: standings.winner.average,
      });
    }
  }
  return awards;
}

/** The award titles a shop holds right now, for its badge: "Shop of the Month, September 2026". */
export async function awardTitlesByShop(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
): Promise<Map<string, string[]>> {
  const titles = new Map<string, string[]>();
  for (const award of await currentAwards(ctx)) {
    titles.set(award.shop.id, [...(titles.get(award.shop.id) ?? []), award.title]);
  }
  return titles;
}
