/**
 * Referral levels and the Ozi Ambassador share (Anthony, 30 October 2026): the pure sums, and
 * the figures in config/store.json.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseStoreConfig } from '../src/config.js';
import { loadStoreConfig, storeConfigPath } from '../src/node.js';
import {
  maskedVoucherCode,
  voucherReminderWords,
  voucherTitle,
  ambassadorAvailableAt,
  ambassadorEarningAfterRefunds,
  ambassadorNeedsReview,
  ambassadorPayable,
  ambassadorPlanSharePence,
  ambassadorShareEnds,
  ambassadorOrderSharePence,
  earnedWords,
  individualRateMultiplier,
  individualRatePercent,
  individualRateProblem,
  individualRateWords,
  linkAloud,
  standardRatePercent,
  highestLevel,
  levelsReached,
  meetsActiveShare,
  nextLevel,
  ownerLevelWords,
  percentWords,
  progressWords,
  rewardWords,
  shareWords,
  withinAmbassadorMonths,
} from '../src/referrals.js';

const config = loadStoreConfig();
const referrals = config.referrals;
const ambassadors = config.ambassador;

describe('the referral figures in config/store.json', () => {
  it('are the levels Anthony set, replacing £150 at 100 referrals', () => {
    expect(referrals.levels).toEqual([
      { activeReferrals: 20, rewardPence: 1000, label: '£10 voucher' },
      { activeReferrals: 30, rewardPence: 1500, label: '£15 voucher' },
      { activeReferrals: 40, rewardPence: 2000, label: '£20 voucher' },
    ]);
    expect(referrals.minimumActiveShare).toBe(0.7);
    expect(referrals.givenAs).toBe('Amazon voucher');
    expect(config.runners).not.toHaveProperty('referralRewardPence');
    expect(config.runners).not.toHaveProperty('referralsForReward');
  });

  it('are the Ambassador terms Anthony set', () => {
    expect(ambassadors).toEqual({
      restaurantMarkupShare: 0.02,
      restaurantDiscountShare: 0.02,
      groceryItemChargeShare: 0.01,
      groceryMarkupShare: 0.01,
      groceryDiscountShare: 0.01,
      months: 12,
      planShare: 0.05,
      branchShareFactor: 0.25,
      holdDays: 30,
      payoutMinimumPence: 1000,
      reviewAbovePence: 50000,
      // Applying (Anthony, 30 October 2026): proof of address within 3 months, and documents
      // kept for 12 months after somebody stops.
      addressWithinMonths: 3,
      documentsKeptMonths: 12,
      // Declined, suspended and removed (Anthony, 31 October 2026).
      reapplyAfterMonths: 6,
      declinedDocumentsDeleteAfterDays: 30,
      declinedNoteKeptMonths: 12,
      // Top Ambassador of the month and the first-business bonus (Anthony, 2 November 2026,
      // ruling 91): £25 for at least 2 confirmed, ordering businesses, paid only in a month whose
      // net income from Ambassador-brought businesses is at least £125 (five times the prize),
      // from November 2026 to November 2027; £10 once, after the first business's 4th paid order.
      monthlyPrizePence: 2500,
      monthlyPrizeMinimumBusinesses: 2,
      monthlyPrizeBarPence: 12500,
      monthlyPrizeFromMonth: '2026-11',
      monthlyPrizeUntilMonth: '2027-11',
      firstBusinessBonusPence: 1000,
      firstBusinessBonusAfterOrders: 4,
      // An individual rate the owner may grant (Anthony, 3 November 2026, ruling 94): at most
      // 5%; and at most 20 link texts a day for each member of staff.
      maxIndividualRatePercent: 5,
      linkTextsPerDay: 20,
    });
    expect(ambassadors.monthlyPrizeBarPence).toBe(5 * ambassadors.monthlyPrizePence);
    expect(shareWords(ambassadors.restaurantMarkupShare)).toBe('2%');
    expect(shareWords(ambassadors.groceryItemChargeShare)).toBe('1%');
    expect(shareWords(0.025)).toBe('2.5%');
    expect(shareWords(0.0025)).toBe('0.25%');
  });

  it('refuses levels that make no sense', () => {
    // The real file, so every other section is valid.
    const file = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
    expect(() =>
      parseStoreConfig({ ...file, referrals: { levels: [], minimumActiveShare: 0.7 } }),
    ).toThrow(/referrals.levels/);
    expect(() => parseStoreConfig({ ...file, referrals: { minimumActiveShare: 1.5 } })).toThrow(
      /minimumActiveShare/,
    );
  });
});

describe('the 70% rule', () => {
  it('counts 20 active out of 28 joined (71%), and not 20 out of 29 (68%)', () => {
    expect(meetsActiveShare(20, 28, referrals)).toBe(true);
    expect(percentWords(20, 28)).toBe('71%');
    expect(meetsActiveShare(20, 29, referrals)).toBe(false);
    expect(percentWords(20, 29)).toBe('68%');
  });

  it('counts exactly 70%, and never nobody', () => {
    expect(meetsActiveShare(7, 10, referrals)).toBe(true);
    expect(meetsActiveShare(0, 0, referrals)).toBe(false);
    expect(percentWords(0, 0)).toBe('0%');
  });
});

describe('levels reached', () => {
  it('reaches a level at its number of active referrals, with the 70% rule met', () => {
    expect(levelsReached(19, 20, referrals)).toEqual([]);
    expect(levelsReached(20, 20, referrals).map((level) => level.label)).toEqual(['£10 voucher']);
    expect(highestLevel(35, 40, referrals)?.label).toBe('£15 voucher');
    expect(levelsReached(45, 50, referrals)).toHaveLength(3);
  });

  it('reaches nothing when too few of the people who joined are active', () => {
    expect(levelsReached(30, 50, referrals)).toEqual([]);
    expect(highestLevel(30, 50, referrals)).toBeNull();
  });

  it('works towards the smallest level not yet earned', () => {
    expect(nextLevel(referrals)?.activeReferrals).toBe(20);
    expect(nextLevel(referrals, [20])?.activeReferrals).toBe(30);
    expect(nextLevel(referrals, [20, 30, 40])).toBeNull();
  });
});

describe('the words', () => {
  it('says progress plainly', () => {
    expect(progressWords(7, 9, referrals)).toBe('7 of 20 active referrals for your £10 voucher.');
    expect(progressWords(22, 25, referrals, [20])).toBe(
      '22 of 30 active referrals for your £15 voucher.',
    );
    expect(progressWords(20, 30, referrals)).toBe(
      '20 of 20 active referrals for your £10 voucher. At least 70% of the people who joined need to be active, and 20 of 30 is 66%.',
    );
    expect(progressWords(50, 50, referrals, [20, 30, 40])).toBe(
      'You have reached every reward level. Thank you.',
    );
  });

  it('tells the person and the owner what was reached', () => {
    const first = referrals.levels[0]!;
    expect(earnedWords(first)).toBe("You've earned a £10 shopping voucher. We'll be in touch.");
    expect(ownerLevelWords('Ada Obi', first, 20)).toBe(
      'Ada Obi has reached the £10 voucher level with 20 active referrals.',
    );
    expect(rewardWords(1050)).toBe('£10.50');
  });
});

describe('the Ambassador share', () => {
  const restaurant = (markupPence: number, discountPence: number, itemChargesPence = 0) =>
    ({ kind: 'restaurant', markupPence, discountPence, itemChargesPence }) as const;
  const grocery = (itemChargesPence: number, markupPence = 0, discountPence = 0) =>
    ({ kind: 'grocery', markupPence, discountPence, itemChargesPence }) as const;

  it('is 2% of the mark-up and 2% of the discount on a restaurant, never its item charges', () => {
    // The founder's example: a £10 dish, 50% mark-up (£5) and 20% discount (£2): 10p + 4p.
    expect(ambassadorOrderSharePence(restaurant(500, 200), ambassadors)).toBe(14);
    // The item charges are never in it, on a restaurant.
    expect(ambassadorOrderSharePence(restaurant(500, 200, 10_000), ambassadors)).toBe(14);
    // No mark-up and no discount: nothing.
    expect(ambassadorOrderSharePence(restaurant(0, 0, 300), ambassadors)).toBe(0);
    expect(ambassadorOrderSharePence(restaurant(-100, 0), ambassadors)).toBe(0);
    // 3% if the founder switches it.
    expect(
      ambassadorOrderSharePence(restaurant(1000, 0), {
        ...ambassadors,
        restaurantMarkupShare: 0.03,
      }),
    ).toBe(30);
  });

  it('is 1% of the item charges, the mark-up and the discount on a grocery shop partner', () => {
    // £15 of item charges: 15p.
    expect(ambassadorOrderSharePence(grocery(1500), ambassadors)).toBe(15);
    // £15 of item charges, £10 of mark-up and £5 of discount: 15p + 10p + 5p.
    expect(ambassadorOrderSharePence(grocery(1500, 1000, 500), ambassadors)).toBe(30);
    // To the nearest penny: 1% of £3.33 is 3p.
    expect(ambassadorOrderSharePence(grocery(333), ambassadors)).toBe(3);
  });

  it('is a quarter of that on another branch of the business, through the same link', () => {
    expect(ambassadorOrderSharePence(restaurant(1000, 0), ambassadors, 'other_branch')).toBe(5);
    expect(ambassadorOrderSharePence(restaurant(1000, 0), ambassadors, 'introduced')).toBe(20);
    expect(ambassadorOrderSharePence(grocery(2000), ambassadors, 'other_branch')).toBe(5);
  });

  it('is multiplied by an individual rate (ruling 94): 3% where others earn 2% is 1.5 on every share', () => {
    // The founder's example at 3%: 3% of £5 and 3% of £2, 21p.
    expect(ambassadorOrderSharePence(restaurant(500, 200), ambassadors, 'introduced', 1.5)).toBe(
      21,
    );
    // A grocery shop's 1% becomes 1.5%: £15 of item charges, £10 of mark-up and £5 of discount.
    expect(
      ambassadorOrderSharePence(grocery(1500, 1000, 500), ambassadors, 'introduced', 1.5),
    ).toBe(45);
    // Another branch's quarter is a quarter of the individual rate.
    expect(ambassadorOrderSharePence(restaurant(1000, 0), ambassadors, 'other_branch', 1.5)).toBe(
      8,
    );
    // The plain multiplier changes nothing.
    expect(ambassadorOrderSharePence(restaurant(500, 200), ambassadors, 'introduced', 1)).toBe(14);
  });

  it('turns a rate the owner says into the multiplier and back, within the cap (ruling 94)', () => {
    expect(standardRatePercent(ambassadors)).toBe(2);
    expect(individualRateMultiplier(3, ambassadors)).toBe(1.5);
    expect(individualRateMultiplier(2, ambassadors)).toBe(1);
    expect(individualRateMultiplier(5, ambassadors)).toBe(2.5);
    expect(individualRatePercent(1.5, ambassadors)).toBe(3);
    expect(individualRatePercent(1, ambassadors)).toBe(2);
    expect(individualRateWords(1, ambassadors)).toBe('the standard rate of 2%');
    expect(individualRateWords(1.5, ambassadors)).toBe('3%, where the standard rate is 2%');
    expect(ambassadors.maxIndividualRatePercent).toBe(5);
    expect(individualRateProblem(3, ambassadors)).toBeNull();
    expect(individualRateProblem(5, ambassadors)).toBeNull();
    expect(individualRateProblem(2, ambassadors)).toBeNull();
    expect(individualRateProblem(5.5, ambassadors)).toBe('An individual rate can be at most 5%.');
    expect(individualRateProblem(1, ambassadors)).toBe(
      'An individual rate is never below the standard rate of 2%.',
    );
    expect(individualRateProblem(0, ambassadors)).toMatch(/as a percentage/);
    expect(individualRateProblem(Number.NaN, ambassadors)).toMatch(/as a percentage/);
    expect(individualRateProblem(2.123, ambassadors)).toMatch(/two decimal places/);
  });

  it('refuses a cap below the standard rate in the settings', () => {
    const file = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
    expect(() =>
      parseStoreConfig({
        ...file,
        ambassador: { ...(file['ambassador'] as object), maxIndividualRatePercent: 1 },
      }),
    ).toThrow(/at least the standard rate/);
  });

  it('says a link slowly, for writing down (ruling 94)', () => {
    expect(linkAloud('https://ozi.example/business/join?ambassador=runner-AB12')).toBe(
      'ozi, dot, example, slash, business, slash, join, question mark, ambassador, equals, runner, dash, capital A capital B 1 2',
    );
    // A long code is spelt in groups of four, with a pause between.
    expect(linkAloud('https://ozi.example/ambassador/check/RMQ3H9F2')).toBe(
      'ozi, dot, example, slash, ambassador, slash, check, slash, capital R capital M capital Q 3, capital H 9 capital F 2',
    );
    // Anything with digits or capitals in it is spelt out, four characters at a time.
    expect(linkAloud('https://ozi.example/x?next=%2Fshops')).toBe(
      'ozi, dot, example, slash, x, question mark, next, equals, percent, 2 capital F s h, o p s',
    );
  });

  it('refuses the old single profit share in the settings', () => {
    const file = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
    expect(() =>
      parseStoreConfig({
        ...file,
        ambassador: { ...(file['ambassador'] as object), profitShare: 0.02 },
      }),
    ).toThrow(/replaced/);
  });

  it('takes a one-off 5% of the first Partner Plus payment: 75p of £14.99', () => {
    expect(ambassadorPlanSharePence(1499, ambassadors)).toBe(75);
    expect(ambassadorPlanSharePence(0, ambassadors)).toBe(0);
  });

  it('asks the owner to check a month over £500, and has no other limit', () => {
    expect(ambassadorNeedsReview(50000, ambassadors)).toBe(false);
    expect(ambassadorNeedsReview(50001, ambassadors)).toBe(true);
  });

  it('runs for 12 months from approval, and stops then', () => {
    const approved = new Date('2026-11-15T10:00:00.000Z');
    expect(ambassadorShareEnds(approved, ambassadors).toISOString()).toBe(
      '2027-11-15T10:00:00.000Z',
    );
    expect(
      withinAmbassadorMonths(approved, new Date('2027-11-15T09:59:00.000Z'), ambassadors),
    ).toBe(true);
    expect(
      withinAmbassadorMonths(approved, new Date('2027-11-15T10:00:00.000Z'), ambassadors),
    ).toBe(false);
    expect(
      withinAmbassadorMonths(approved, new Date('2026-11-14T10:00:00.000Z'), ambassadors),
    ).toBe(false);
    expect(withinAmbassadorMonths(null, approved, ambassadors)).toBe(false);
  });

  it('is paid once £10 is owed', () => {
    expect(ambassadorPayable(999, ambassadors)).toBe(false);
    expect(ambassadorPayable(1000, ambassadors)).toBe(true);
    expect(ambassadorPayable(0, { payoutMinimumPence: 0 })).toBe(false);
  });
});

describe('tamper-proof Ambassador money (ruled 30 October 2026)', () => {
  it('follows refunds: a whole refund leaves nothing, a part refund takes off its part', () => {
    expect(ambassadorEarningAfterRefunds(30, 2000, 0)).toBe(30);
    expect(ambassadorEarningAfterRefunds(30, 2000, 2000)).toBe(0);
    expect(ambassadorEarningAfterRefunds(30, 2000, 5000)).toBe(0);
    expect(ambassadorEarningAfterRefunds(30, 2000, 1000)).toBe(15);
    // Rounded down: never a penny more than their part.
    expect(ambassadorEarningAfterRefunds(31, 2000, 1000)).toBe(15);
    expect(ambassadorEarningAfterRefunds(30, 0, 0)).toBe(0);
  });

  it('holds an earning for 30 days after delivery before it can be paid', () => {
    expect(
      ambassadorAvailableAt(new Date('2026-11-01T10:00:00.000Z'), ambassadors).toISOString(),
    ).toBe('2026-12-01T10:00:00.000Z');
  });
});

describe('sending the voucher (30 October 2026)', () => {
  it('has the title, the words Ozi says, and the code masked to its last four', () => {
    const product = config.productName;
    const assistant = config.assistantName;
    expect(voucherTitle(1000, config.referrals.givenAs, product)).toBe(
      `Your £10 Amazon shopping voucher from ${product}`,
    );
    expect(voucherReminderWords(1000, assistant, product)).toBe(
      `Hello, this is ${assistant} from ${product}. You've been sent a £10 shopping voucher as a thank you. Open your ${assistant} inbox to see it.`,
    );
    expect(maskedVoucherCode('GIFT-ABCD-9876')).toBe('••••••••••9876');
    expect(maskedVoucherCode('AB12')).toBe('••••AB12');
    expect(maskedVoucherCode('')).toBe('');
  });

  it('reminds on the day, 7 and 14 days later, lasts 10 years, and refuses more than three', () => {
    expect(config.referrals.voucherReminderDays).toEqual([0, 7, 14]);
    expect(config.referrals.voucherLastsYears).toBe(10);
    const file = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
    const referrals = file['referrals'] as Record<string, unknown>;
    expect(() =>
      parseStoreConfig({
        ...file,
        referrals: { ...referrals, voucherReminderDays: [0, 7, 14, 21] },
      }),
    ).toThrow(/voucherReminderDays/);
    expect(() =>
      parseStoreConfig({ ...file, referrals: { ...referrals, voucherReminderDays: [7, 0] } }),
    ).toThrow(/voucherReminderDays/);
  });
});
