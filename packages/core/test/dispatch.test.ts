/**
 * The fair queue sharpened (ruling 64, Anthony, 16 October 2026).
 *
 * The question is not "does the queue work" but "is it fair, the way Anthony said": the lowest
 * earner today first, then the longest wait; nobody jumping the queue while far ahead; the near
 * band asked first and the offer widening after a minute; a Runner at the door chaining to the
 * job next door; and one plain sentence about a Runner's place in line.
 */

import { describe, expect, it } from 'vitest';

import {
  bandOf,
  chainHoldSeconds,
  compareFairShare,
  FAIR_SHARE_DEFAULTS,
  fairQueue,
  firstBandOnly,
  lowestEarnedToday,
  mayChain,
  queuePositionWords,
  tooFarAhead,
  type FairRunner,
} from '../src/index.js';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

function runner(overrides: Partial<FairRunner> & { id: string }): FairRunner {
  return { earnedTodayPence: 0, lastJobCompletedAt: null, distanceMiles: 0.5, ...overrides };
}

const ids = (places: ReturnType<typeof fairQueue>) => places.map((place) => place.runnerId);

describe('rule 1: earned-today balance', () => {
  it.each([
    {
      name: 'the lowest earner today goes first, whoever waited longer',
      runners: [
        runner({ id: 'rich', earnedTodayPence: 2000, lastJobCompletedAt: minutesAgo(300) }),
        runner({ id: 'poor', earnedTodayPence: 500, lastJobCompletedAt: minutesAgo(5) }),
      ],
      expected: ['poor', 'rich'],
    },
    {
      name: 'with the same earnings, the longest wait since the last job goes first',
      runners: [
        runner({ id: 'recent', earnedTodayPence: 500, lastJobCompletedAt: minutesAgo(5) }),
        runner({ id: 'waited', earnedTodayPence: 500, lastJobCompletedAt: minutesAgo(90) }),
      ],
      expected: ['waited', 'recent'],
    },
    {
      name: 'a Runner who has never had a job has waited longest of all',
      runners: [
        runner({ id: 'old-hand', earnedTodayPence: 0, lastJobCompletedAt: minutesAgo(600) }),
        runner({ id: 'new', earnedTodayPence: 0, lastJobCompletedAt: null }),
      ],
      expected: ['new', 'old-hand'],
    },
    {
      name: 'identical Runners come out in a fixed order',
      runners: [runner({ id: 'b' }), runner({ id: 'a' })],
      expected: ['a', 'b'],
    },
  ])('$name', ({ runners, expected }) => {
    expect(ids(fairQueue(runners, NOW, FAIR_SHARE_DEFAULTS))).toEqual(expected);
    expect([...runners].sort((a, b) => compareFairShare(a, b, NOW)).map((r) => r.id)).toEqual(
      expected,
    );
  });

  it.each([
    { earned: 1500, lowest: 0, lead: 1500, ahead: false, name: 'exactly the lead is not too far' },
    { earned: 1501, lowest: 0, lead: 1500, ahead: true, name: 'a penny over the lead is' },
    {
      earned: 2500,
      lowest: 1200,
      lead: 1500,
      ahead: false,
      name: 'measured from the lowest earner, not from nothing',
    },
    {
      earned: 2800,
      lowest: 1200,
      lead: 1500,
      ahead: true,
      name: 'and over it from the lowest earner',
    },
  ])('$name', ({ earned, lowest, lead, ahead }) => {
    expect(tooFarAhead(earned, lowest, lead)).toBe(ahead);
  });

  it('knows the lowest earner on shift, and nothing when nobody is', () => {
    expect(lowestEarnedToday([{ earnedTodayPence: 900 }, { earnedTodayPence: 300 }])).toBe(300);
    expect(lowestEarnedToday([])).toBe(0);
  });

  it('keeps the regular Runner first only while they are not more than the lead ahead', () => {
    const regularWithin = [
      runner({ id: 'other', earnedTodayPence: 0 }),
      runner({ id: 'regular', earnedTodayPence: 1500 }),
    ];
    expect(ids(fairQueue(regularWithin, NOW, FAIR_SHARE_DEFAULTS, 'regular'))).toEqual([
      'regular',
      'other',
    ]);

    const regularTooFar = [
      runner({ id: 'other', earnedTodayPence: 0 }),
      runner({ id: 'regular', earnedTodayPence: 1501 }),
    ];
    expect(ids(fairQueue(regularTooFar, NOW, FAIR_SHARE_DEFAULTS, 'regular'))).toEqual([
      'other',
      'regular',
    ]);
    // A regular Runner who is not in the queue at all changes nothing.
    expect(ids(fairQueue(regularTooFar, NOW, FAIR_SHARE_DEFAULTS, 'nobody'))).toEqual([
      'other',
      'regular',
    ]);
  });

  it('the regular Runner goes to the front from the far band too, while within the lead', () => {
    const runners = [
      runner({ id: 'near', earnedTodayPence: 0, distanceMiles: 0.2 }),
      runner({ id: 'regular', earnedTodayPence: 500, distanceMiles: 4 }),
    ];
    expect(ids(fairQueue(runners, NOW, FAIR_SHARE_DEFAULTS, 'regular'))).toEqual([
      'regular',
      'near',
    ]);
  });
});

describe('rule 3: distance band first', () => {
  it.each([
    { miles: 0, band: 'near' },
    { miles: 1.5, band: 'near' },
    { miles: 1.51, band: 'far' },
    { miles: 9, band: 'far' },
    { miles: null, band: 'far' },
  ])('$miles miles from the pickup is the $band band', ({ miles, band }) => {
    expect(bandOf(miles, FAIR_SHARE_DEFAULTS.nearBandMiles)).toBe(band);
  });

  it('asks the near band first, in fairness order, then the far band in fairness order', () => {
    const runners = [
      runner({ id: 'far-poor', earnedTodayPence: 0, distanceMiles: 3 }),
      runner({ id: 'near-rich', earnedTodayPence: 2000, distanceMiles: 1 }),
      runner({ id: 'near-poor', earnedTodayPence: 500, distanceMiles: 1.4 }),
      runner({ id: 'far-rich', earnedTodayPence: 1000, distanceMiles: 6 }),
    ];
    const queue = fairQueue(runners, NOW, FAIR_SHARE_DEFAULTS);
    expect(ids(queue)).toEqual(['near-poor', 'near-rich', 'far-poor', 'far-rich']);
    expect(queue.map((place) => place.band)).toEqual(['near', 'near', 'far', 'far']);
    expect(queue.map((place) => place.position)).toEqual([0, 1, 2, 3]);
  });

  it('is the first band alone until bandSeconds have passed, then widens', () => {
    const asked = NOW;
    const seconds = (n: number) => new Date(asked.getTime() + n * 1000);
    expect(firstBandOnly(asked, seconds(0), 60)).toBe(true);
    expect(firstBandOnly(asked, seconds(59), 60)).toBe(true);
    expect(firstBandOnly(asked, seconds(60), 60)).toBe(false);
    expect(firstBandOnly(asked, seconds(61), 60)).toBe(false);
  });
});

describe('rule 2: chaining from the door', () => {
  it.each([
    {
      miles: 1.0,
      earned: 0,
      lowest: 0,
      may: true,
      name: 'a job next door, for a Runner not ahead',
    },
    {
      miles: 1.5,
      earned: 1500,
      lowest: 0,
      may: true,
      name: 'exactly the radius and exactly the lead',
    },
    { miles: 1.6, earned: 0, lowest: 0, may: false, name: 'a job beyond the radius' },
    { miles: null, earned: 0, lowest: 0, may: false, name: 'a job nobody can place' },
    {
      miles: 0.3,
      earned: 1600,
      lowest: 0,
      may: false,
      name: 'a Runner too far ahead of the lowest earner',
    },
    {
      miles: 0.3,
      earned: 1600,
      lowest: 500,
      may: true,
      name: 'ahead, but within the lead of the lowest earner',
    },
  ])('$name', ({ miles, earned, lowest, may }) => {
    expect(mayChain({ earnedTodayPence: earned }, miles, lowest, FAIR_SHARE_DEFAULTS)).toBe(may);
  });

  it('holds a chained offer for the minutes before they are done', () => {
    expect(chainHoldSeconds(FAIR_SHARE_DEFAULTS)).toBe(120);
    expect(chainHoldSeconds({ chainMinutesBeforeDone: 3 })).toBe(180);
  });
});

describe('rule 4: one sentence about their place in line', () => {
  it.each([
    { position: 0, words: 'You are first in line for the next job.' },
    { position: 1, words: 'You are second in line for the next job.' },
    { position: 2, words: 'You are third in line for the next job.' },
    { position: 9, words: 'You are tenth in line for the next job.' },
    { position: 10, words: 'You are number 11 in line for the next job.' },
  ])('position $position: "$words"', ({ position, words }) => {
    expect(queuePositionWords(position)).toBe(words);
  });

  it('says plainly why there is no place, without any money in it', () => {
    expect(queuePositionWords(null, 'off_shift')).toBe(
      'You are off shift, so you are not in line for jobs. Go on shift to join the line.',
    );
    expect(queuePositionWords(null)).toMatch(/off shift/);
    expect(queuePositionWords(null, 'job_in_hand')).toBe(
      'You have a job in hand. You are back in line as soon as it is delivered.',
    );
    expect(queuePositionWords(null, 'checks_not_done')).toBe(
      'Your checks are not finished yet, so you are not in line for jobs.',
    );
    expect(queuePositionWords(null, 'not_allowed')).toBe(
      'You are not in line for jobs just now. Your Runner page says what is needed first.',
    );
    for (const reason of ['off_shift', 'job_in_hand', 'checks_not_done', 'not_allowed'] as const) {
      expect(queuePositionWords(null, reason)).not.toMatch(/£|\d/);
    }
  });
});
