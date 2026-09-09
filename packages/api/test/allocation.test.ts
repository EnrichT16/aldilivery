/**
 * The rotating fair queue, the sixty second hold, and pooling.
 *
 * The question these tests answer is not "does allocation work" but "is it fair". A Runner
 * who has waited longest gets the next job. A Runner who misses one is not punished. A pooled
 * trip pays five pounds for every order in it.
 */

import { describe, expect, it } from 'vitest';

import {
  buildOfferQueue,
  distanceMiles,
  isEligible,
  isOfferExpired,
  nextRunnerToOffer,
  offerExpiryAt,
  poolOrders,
  runnerPaymentForTrip,
  type QueueRunner,
} from '../src/services/allocation.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');

function runner(overrides: Partial<QueueRunner> & { id: string }): QueueRunner {
  return {
    latitude: 52.4862,
    longitude: -1.8904,
    rightToWorkVerified: true,
    criminalRecordCheckVerified: true,
    available: true,
    lastJobCompletedAt: null,
    ...overrides,
  };
}

const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const JOB = { latitude: 52.4862, longitude: -1.8904 };

describe('who may be offered a job at all', () => {
  it('needs a Runner who is on shift', () => {
    expect(isEligible(runner({ id: 'a', available: false }))).toBe(false);
  });

  it('needs a verified right to work', () => {
    expect(isEligible(runner({ id: 'a', rightToWorkVerified: false }))).toBe(false);
  });

  it('needs a verified criminal record check', () => {
    expect(isEligible(runner({ id: 'a', criminalRecordCheckVerified: false }))).toBe(false);
  });

  it('leaves unverified Runners out of the queue entirely', () => {
    const queue = buildOfferQueue(
      JOB,
      [runner({ id: 'verified' }), runner({ id: 'unchecked', criminalRecordCheckVerified: false })],
      NOW,
    );
    expect(queue.map((entry) => entry.runnerId)).toEqual(['verified']);
  });
});

describe('the rotation', () => {
  it('offers to whoever has waited longest since their last job', () => {
    const queue = buildOfferQueue(
      JOB,
      [
        runner({ id: 'just-finished', lastJobCompletedAt: minutesAgo(2) }),
        runner({ id: 'waiting-an-hour', lastJobCompletedAt: minutesAgo(60) }),
        runner({ id: 'waiting-ten', lastJobCompletedAt: minutesAgo(10) }),
      ],
      NOW,
    );

    expect(queue.map((entry) => entry.runnerId)).toEqual([
      'waiting-an-hour',
      'waiting-ten',
      'just-finished',
    ]);
  });

  it('treats a Runner who has never had a job as having waited longest of all', () => {
    const queue = buildOfferQueue(
      JOB,
      [
        runner({ id: 'established', lastJobCompletedAt: minutesAgo(120) }),
        runner({ id: 'brand-new', lastJobCompletedAt: null }),
      ],
      NOW,
    );
    expect(queue[0]?.runnerId).toBe('brand-new');
  });

  it('puts a clearly nearer Runner first, because chilled food does not travel', () => {
    const queue = buildOfferQueue(
      JOB,
      [
        // Roughly four miles away, waiting a long time.
        runner({
          id: 'far-and-waiting',
          latitude: 52.5442,
          longitude: -1.8904,
          lastJobCompletedAt: minutesAgo(240),
        }),
        // On the doorstep, just finished.
        runner({ id: 'near-and-busy', lastJobCompletedAt: minutesAgo(1) }),
      ],
      NOW,
    );
    expect(queue[0]?.runnerId).toBe('near-and-busy');
  });

  it('does not let fifty yards beat two hours of waiting', () => {
    const queue = buildOfferQueue(
      JOB,
      [
        // A few dozen yards nearer, but only just finished a job.
        runner({ id: 'a-touch-nearer', latitude: 52.48621, lastJobCompletedAt: minutesAgo(1) }),
        runner({ id: 'waiting-two-hours', latitude: 52.4863, lastJobCompletedAt: minutesAgo(120) }),
      ],
      NOW,
      { distanceBucketMiles: 0.5 },
    );
    expect(queue[0]?.runnerId).toBe('waiting-two-hours');
  });

  it('leaves out Runners beyond the service radius', () => {
    const queue = buildOfferQueue(
      JOB,
      [runner({ id: 'nearby' }), runner({ id: 'another-city', latitude: 51.5074, longitude: -0.1278 })],
      NOW,
      { serviceRadiusMiles: 10 },
    );
    expect(queue.map((entry) => entry.runnerId)).toEqual(['nearby']);
  });

  it('is deterministic when two Runners are identical', () => {
    const runners = [
      runner({ id: 'bbb', lastJobCompletedAt: minutesAgo(30) }),
      runner({ id: 'aaa', lastJobCompletedAt: minutesAgo(30) }),
    ];
    expect(buildOfferQueue(JOB, runners, NOW).map((e) => e.runnerId)).toEqual(
      buildOfferQueue(JOB, [...runners].reverse(), NOW).map((e) => e.runnerId),
    );
  });

  it('passes to the next Runner once one has been offered the job', () => {
    const queue = buildOfferQueue(
      JOB,
      [
        runner({ id: 'first', lastJobCompletedAt: minutesAgo(90) }),
        runner({ id: 'second', lastJobCompletedAt: minutesAgo(60) }),
        runner({ id: 'third', lastJobCompletedAt: minutesAgo(30) }),
      ],
      NOW,
    );

    expect(nextRunnerToOffer(queue, [])?.runnerId).toBe('first');
    expect(nextRunnerToOffer(queue, ['first'])?.runnerId).toBe('second');
    expect(nextRunnerToOffer(queue, ['first', 'second'])?.runnerId).toBe('third');
    expect(nextRunnerToOffer(queue, ['first', 'second', 'third'])).toBeNull();
  });
});

describe('the sixty second hold', () => {
  it('holds the offer for exactly the configured time', () => {
    const expiresAt = offerExpiryAt(NOW, 60);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(60_000);
  });

  it('is still live one second before it runs out', () => {
    const offer = { expiresAt: offerExpiryAt(NOW, 60), respondedAt: null };
    expect(isOfferExpired(offer, new Date(NOW.getTime() + 59_000))).toBe(false);
  });

  it('has run out at the sixtieth second', () => {
    const offer = { expiresAt: offerExpiryAt(NOW, 60), respondedAt: null };
    expect(isOfferExpired(offer, new Date(NOW.getTime() + 60_000))).toBe(true);
  });

  it('never expires once it has been answered', () => {
    const offer = { expiresAt: offerExpiryAt(NOW, 60), respondedAt: new Date(NOW.getTime() + 5_000) };
    expect(isOfferExpired(offer, new Date(NOW.getTime() + 600_000))).toBe(false);
  });
});

describe('pooling', () => {
  const here = { latitude: 52.4862, longitude: -1.8904 };
  const aStreetAway = { latitude: 52.4875, longitude: -1.8912 };
  const threeMilesOff = { latitude: 52.5300, longitude: -1.8904 };

  it('groups orders that are within the radius of each other', () => {
    const pools = poolOrders(
      [
        { id: 'a', ...here },
        { id: 'b', ...aStreetAway },
      ],
      1,
    );
    expect(pools).toHaveLength(1);
    expect(pools[0]?.orderIds).toEqual(['a', 'b']);
  });

  it('leaves a distant order in its own pool', () => {
    const pools = poolOrders(
      [
        { id: 'a', ...here },
        { id: 'b', ...threeMilesOff },
      ],
      1,
    );
    expect(pools).toHaveLength(2);
  });

  it('pays the Runner five pounds for every order in the pool (Rule Two)', () => {
    const pools = poolOrders(
      [
        { id: 'a', ...here },
        { id: 'b', ...aStreetAway },
        { id: 'c', ...here },
      ],
      1,
    );
    expect(pools).toHaveLength(1);
    expect(pools[0]?.runnerPaymentPence).toBe(1500);
  });

  it('never divides the five pounds between pooled orders', () => {
    for (let orders = 1; orders <= 10; orders += 1) {
      expect(runnerPaymentForTrip(orders)).toBe(orders * 500);
    }
  });

  it('will not chain a pool across a long line of stops', () => {
    // Each is within a mile of the last, but the ends are more than a mile apart.
    const pools = poolOrders(
      [
        { id: 'a', latitude: 52.4862, longitude: -1.8904 },
        { id: 'b', latitude: 52.4962, longitude: -1.8904 },
        { id: 'c', latitude: 52.5062, longitude: -1.8904 },
      ],
      1,
    );
    expect(pools.length).toBeGreaterThan(1);
  });
});

describe('distance', () => {
  it('is zero for the same point', () => {
    expect(distanceMiles(JOB, JOB)).toBeCloseTo(0, 6);
  });

  it('is unknown when either point is unknown', () => {
    expect(distanceMiles(JOB, { latitude: null, longitude: null })).toBeNull();
  });

  it('is about a hundred miles from Birmingham to London', () => {
    const miles = distanceMiles(
      { latitude: 52.4862, longitude: -1.8904 },
      { latitude: 51.5074, longitude: -0.1278 },
    );
    expect(miles).toBeGreaterThan(90);
    expect(miles).toBeLessThan(110);
  });
});
