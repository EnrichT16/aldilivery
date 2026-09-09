/**
 * Allocation: the rotating fair queue, and pooling.
 *
 * A Runner should not have to be fast, or lucky, or watching their phone at the right
 * moment, to earn. The queue offers each job to the nearest available Runner who has waited
 * longest since their last job, holds that offer for sixty seconds, and then passes it on.
 *
 * The ranking functions in the first half of this file are pure. They take plain data and a
 * time, and return an order. Everything about fairness can therefore be proved by tests
 * that need no database and no clock.
 */

import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';

/** Everything the queue needs to know about a Runner. */
export interface QueueRunner {
  id: string;
  latitude: number | null;
  longitude: number | null;
  rightToWorkVerified: boolean;
  criminalRecordCheckVerified: boolean;
  available: boolean;
  /** Null for a Runner who has never completed a job — they have waited longest of all. */
  lastJobCompletedAt: Date | null;
}

export interface JobLocation {
  latitude: number | null;
  longitude: number | null;
}

export interface QueueOptions {
  /**
   * Runners further away than this are not offered the job at all. Not a fairness rule, a
   * practicality: a Runner twenty miles away cannot deliver chilled food.
   */
  serviceRadiusMiles?: number;
  /**
   * How coarsely distance is compared, in miles.
   *
   * Distance is bucketed before Runners are ordered, so that being fifty yards closer does
   * not beat having waited two hours longer. Inside a bucket, the longest wait always wins.
   * This is what makes the queue a rotation rather than a race won by whoever happens to be
   * standing outside the shop.
   */
  distanceBucketMiles?: number;
}

export interface RankedRunner {
  runnerId: string;
  distanceMiles: number | null;
  /** Milliseconds since this Runner last completed a job. Infinity if they never have. */
  waitedMs: number;
  queuePosition: number;
}

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great circle distance in miles. Null if either point is unknown. */
export function distanceMiles(a: JobLocation, b: JobLocation): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) {
    return null;
  }
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** A Runner may only be offered work once both checks have been verified. */
export function isEligible(runner: QueueRunner): boolean {
  return runner.available && runner.rightToWorkVerified && runner.criminalRecordCheckVerified;
}

/**
 * Order the available Runners for one job.
 *
 * Nearest first, in buckets, and longest waiting first inside each bucket. A Runner who has
 * never completed a job counts as having waited forever, so new Runners get their first job
 * rather than starving behind established ones.
 */
export function buildOfferQueue(
  job: JobLocation,
  runners: readonly QueueRunner[],
  now: Date,
  options: QueueOptions = {},
): RankedRunner[] {
  const bucketMiles = options.distanceBucketMiles ?? 0.5;
  const radiusMiles = options.serviceRadiusMiles ?? 10;

  const scored = runners
    .filter(isEligible)
    .map((runner) => {
      const distance = distanceMiles(job, runner);
      const waitedMs =
        runner.lastJobCompletedAt === null
          ? Number.POSITIVE_INFINITY
          : now.getTime() - runner.lastJobCompletedAt.getTime();
      return { runner, distance, waitedMs };
    })
    .filter((entry) => entry.distance === null || entry.distance <= radiusMiles);

  scored.sort((a, b) => {
    // A Runner whose position is unknown sorts after everyone whose position is known.
    const bucketA = a.distance === null ? Number.POSITIVE_INFINITY : Math.floor(a.distance / bucketMiles);
    const bucketB = b.distance === null ? Number.POSITIVE_INFINITY : Math.floor(b.distance / bucketMiles);
    if (bucketA !== bucketB) return bucketA - bucketB;

    // Inside a bucket, longest wait wins. This is the rotation.
    if (a.waitedMs !== b.waitedMs) return b.waitedMs - a.waitedMs;

    // A stable, arbitrary tie break so the order is deterministic.
    return a.runner.id.localeCompare(b.runner.id);
  });

  return scored.map((entry, index) => ({
    runnerId: entry.runner.id,
    distanceMiles: entry.distance,
    waitedMs: entry.waitedMs,
    queuePosition: index,
  }));
}

/** Who is next, given who has already been offered this job and declined or timed out. */
export function nextRunnerToOffer(
  queue: readonly RankedRunner[],
  alreadyOfferedRunnerIds: readonly string[],
): RankedRunner | null {
  const seen = new Set(alreadyOfferedRunnerIds);
  return queue.find((entry) => !seen.has(entry.runnerId)) ?? null;
}

/** An offer has expired when the hold has elapsed and nobody has answered. */
export function isOfferExpired(offer: { expiresAt: Date; respondedAt: Date | null }, now: Date): boolean {
  return offer.respondedAt === null && now.getTime() >= offer.expiresAt.getTime();
}

/** When a sixty second hold, or whatever the configuration says, runs out. */
export function offerExpiryAt(now: Date, holdSeconds: number): Date {
  return new Date(now.getTime() + holdSeconds * 1000);
}

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

export interface PoolableOrder {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

export interface OrderPool {
  orderIds: string[];
  /** Five pounds per order in the pool, always. Never divided between them (Rule Two). */
  runnerPaymentPence: number;
}

/**
 * Group orders that are close enough to be carried in one trip.
 *
 * The grouping is simple and deliberately conservative: an order joins an existing pool
 * only if it is within the radius of every order already in that pool, so a pool can never
 * stretch into a chain of far apart stops.
 *
 * A pooled order pays the Runner the full five pounds. Pooling is a saving in the Runner's
 * time, not a discount on their earnings. Three pooled orders pay fifteen pounds.
 */
export function poolOrders(orders: readonly PoolableOrder[], radiusMiles: number): OrderPool[] {
  const pools: Array<{ orderIds: string[]; members: PoolableOrder[] }> = [];

  for (const order of orders) {
    const home = pools.find((pool) =>
      pool.members.every((member) => {
        const distance = distanceMiles(member, order);
        return distance !== null && distance <= radiusMiles;
      }),
    );

    if (home) {
      home.orderIds.push(order.id);
      home.members.push(order);
    } else {
      pools.push({ orderIds: [order.id], members: [order] });
    }
  }

  return pools.map((pool) => ({
    orderIds: pool.orderIds,
    runnerPaymentPence: pool.orderIds.length * RUNNER_PAYMENT_PENCE,
  }));
}

/** What the Runner is owed for a trip: five pounds for each order in it, without exception. */
export function runnerPaymentForTrip(orderCount: number): number {
  if (!Number.isInteger(orderCount) || orderCount < 0) {
    throw new TypeError(`An order count must be a whole number, received ${orderCount}.`);
  }
  return orderCount * RUNNER_PAYMENT_PENCE;
}
