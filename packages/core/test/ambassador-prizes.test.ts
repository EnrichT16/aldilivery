/**
 * Top Ambassador of the month and the first-business bonus (Anthony, 2 November 2026, ruling
 * 91): the pure sums and the words, and the figures in config/store.json.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  decideMonthlyPrize,
  firstBusinessBonusDue,
  firstBusinessBonusWords,
  lastMonthPrizeWords,
  monthAfter,
  monthBefore,
  monthWords,
  oziNetOnOrderPence,
  prizeBarMet,
  prizeBarWords,
  prizeMonthRuns,
  prizeStandingWords,
  prizeTermsWords,
  ukMonthKey,
} from '../src/ambassador-prizes.js';
import { parseStoreConfig } from '../src/config.js';
import { loadStoreConfig, storeConfigPath } from '../src/node.js';
import { AMBASSADOR_TERMS_VERSION } from '../src/referrals.js';

const settings = loadStoreConfig().ambassador;

describe('the months', () => {
  it('counts a month in UK time: 11pm on 31 October UTC is November in summer time, October in winter', () => {
    // British Summer Time ended on 25 October 2026, so 31 October 23:30Z is still October.
    expect(ukMonthKey(new Date('2026-10-31T23:30:00.000Z'))).toBe('2026-10');
    // On 30 June 23:30Z, UK time is 00:30 on 1 July.
    expect(ukMonthKey(new Date('2027-06-30T23:30:00.000Z'))).toBe('2027-07');
    expect(ukMonthKey(new Date('2026-11-02T10:00:00.000Z'))).toBe('2026-11');
  });

  it('moves a month back and forward, across the year end', () => {
    expect(monthBefore('2026-11')).toBe('2026-10');
    expect(monthBefore('2027-01')).toBe('2026-12');
    expect(monthAfter('2026-12')).toBe('2027-01');
    expect(monthAfter('2026-11')).toBe('2026-12');
    expect(monthWords('2026-11')).toBe('November 2026');
  });

  it('runs from November 2026 to November 2027, both counted, as the figures say', () => {
    expect(prizeMonthRuns('2026-10', settings)).toBe(false);
    expect(prizeMonthRuns('2026-11', settings)).toBe(true);
    expect(prizeMonthRuns('2027-11', settings)).toBe(true);
    expect(prizeMonthRuns('2027-12', settings)).toBe(false);
  });

  it('refuses a bar below the prize, a month not written YYYY-MM, or an end before the start', () => {
    const file = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
    const ambassador = file['ambassador'] as Record<string, unknown>;
    expect(() =>
      parseStoreConfig({
        ...file,
        ambassador: { ...ambassador, monthlyPrizeBarPence: 2000, monthlyPrizePence: 2500 },
      }),
    ).toThrow(/monthlyPrizeBarPence must be at least/);
    expect(() =>
      parseStoreConfig({ ...file, ambassador: { ...ambassador, monthlyPrizeFromMonth: 'Nov 26' } }),
    ).toThrow(/YYYY-MM/);
    expect(() =>
      parseStoreConfig({
        ...file,
        ambassador: { ...ambassador, monthlyPrizeUntilMonth: '2026-10' },
      }),
    ).toThrow(/monthlyPrizeUntilMonth/);
  });
});

describe('the month decision', () => {
  const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 10, day, hour));

  it('goes to the most confirmed, ordering businesses, at least two', () => {
    const decision = decideMonthlyPrize(
      [
        { ambassadorKind: 'shopper', ambassadorId: 'ada', confirmedAt: [at(3), at(9), at(20)] },
        { ambassadorKind: 'runner', ambassadorId: 'bola', confirmedAt: [at(1), at(2)] },
        { ambassadorKind: 'shopper', ambassadorId: 'chidi', confirmedAt: [at(1)] },
      ],
      settings,
    );
    expect(decision.winner?.ambassadorId).toBe('ada');
    expect(decision.qualifyingBusinesses).toBe(3);
  });

  it('gives nobody the prize with one business each, or none', () => {
    expect(
      decideMonthlyPrize(
        [{ ambassadorKind: 'shopper', ambassadorId: 'chidi', confirmedAt: [at(1)] }],
        settings,
      ),
    ).toEqual({ winner: null, qualifyingBusinesses: 0 });
    expect(decideMonthlyPrize([], settings)).toEqual({ winner: null, qualifyingBusinesses: 0 });
  });

  it('breaks a tie by who got there first: the earlier confirmation of the last counted business', () => {
    const decision = decideMonthlyPrize(
      [
        // Ada's second business confirmed on the 20th; Bola's on the 9th. Bola got there first,
        // even though Ada's first business came before Bola's.
        { ambassadorKind: 'shopper', ambassadorId: 'ada', confirmedAt: [at(1), at(20)] },
        { ambassadorKind: 'runner', ambassadorId: 'bola', confirmedAt: [at(9), at(2)] },
      ],
      settings,
    );
    expect(decision.winner?.ambassadorId).toBe('bola');
    expect(decision.qualifyingBusinesses).toBe(2);
  });

  it('pays only when the month reaches the bar, £125', () => {
    expect(prizeBarMet(12499, settings)).toBe(false);
    expect(prizeBarMet(12500, settings)).toBe(true);
  });
});

describe('net income from Ambassador-brought businesses', () => {
  it('is the fee less the Runner, the extra, the item charges, the mark-up and the discount, less the processor, the shares and refunds', () => {
    expect(
      oziNetOnOrderPence({
        feePence: 1099,
        runnerPaymentPence: 500,
        allowanceExtraPence: 599,
        itemChargesPence: 150,
        markupPence: 300,
        discountPence: 200,
        processorCostPence: 56,
        ambassadorSharesPence: 7,
        refundedPence: 100,
      }),
    ).toBe(1099 - 500 + 599 + 150 + 300 + 200 - 56 - 7 - 100);
  });

  it('is never below nothing, and a fee below the Runner adds nothing', () => {
    expect(
      oziNetOnOrderPence({
        feePence: 399,
        runnerPaymentPence: 500,
        allowanceExtraPence: 0,
        itemChargesPence: 50,
        markupPence: 0,
        discountPence: 0,
        processorCostPence: 80,
        ambassadorSharesPence: 1,
        refundedPence: 0,
      }),
    ).toBe(0);
  });
});

describe('the first-business bonus', () => {
  it('is due at the 4th paid order, not the 3rd', () => {
    expect(firstBusinessBonusDue(3, settings)).toBe(false);
    expect(firstBusinessBonusDue(4, settings)).toBe(true);
    expect(firstBusinessBonusDue(5, settings)).toBe(true);
  });
});

describe('the words', () => {
  it('say the standing, met or not met, and never a figure beyond that', () => {
    expect(prizeStandingWords(1)).toBe('You have 1 confirmed, ordering business this month.');
    expect(prizeStandingWords(0)).toBe('You have 0 confirmed, ordering businesses this month.');
    expect(prizeBarWords(true, settings)).toBe('The £25 prize is on this month.');
    expect(prizeBarWords(false, settings)).toBe('Not enough orders yet this month for the prize.');
  });

  it("say last month's winner by first name, or why there was no prize", () => {
    expect(lastMonthPrizeWords({ winnerFirstName: 'Ada', barMet: true }, settings)).toBe(
      "Last month's Top Ambassador: Ada, who won £25.",
    );
    expect(lastMonthPrizeWords({ winnerFirstName: 'Ada', barMet: false }, settings)).toBe(
      'No prize last month, as not enough orders came in.',
    );
    expect(lastMonthPrizeWords({ winnerFirstName: null, barMet: true }, settings)).toBe(
      'No prize last month, as nobody brought in enough businesses.',
    );
    expect(lastMonthPrizeWords(null, settings)).toBe("Last month's prize is being decided.");
  });

  it('say how far the first business has got', () => {
    expect(
      firstBusinessBonusWords({ hasBusiness: true, paidOrders: 2, credited: false }, settings),
    ).toBe('Your first business has completed 2 of 4 orders. At 4, you earn a £10 one-off bonus.');
    expect(
      firstBusinessBonusWords({ hasBusiness: false, paidOrders: 0, credited: false }, settings),
    ).toBe('When your first confirmed business completes 4 orders, you earn a £10 one-off bonus.');
    expect(
      firstBusinessBonusWords({ hasBusiness: true, paidOrders: 9, credited: true }, settings),
    ).toBe('You earned your £10 one-off bonus when your first business completed 4 orders.');
  });

  it('give the terms the prize, the bar as pounds, the two-business minimum and the dates', () => {
    const words = prizeTermsWords(settings);
    expect(words.prize).toContain('From November 2026 to November 2027');
    expect(words.prize).toContain('wins £25, with at least 2 such businesses');
    expect(words.prize).toContain('is at least £125');
    expect(words.prize).toContain('A month below that pays no prize.');
    expect(words.bonus).toContain('completed 4 paid orders');
    expect(words.bonus).toContain('one-off £10');
  });

  it('bumps the terms version, so every Ambassador agrees again', () => {
    expect(AMBASSADOR_TERMS_VERSION).toBe('2026-11-02');
  });
});
