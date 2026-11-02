/**
 * Top Ambassador of the month, and the first-business bonus (Anthony, 2 November 2026, ruling
 * 91). The pure sums and the words, for the server and the web app alike; every figure comes from
 * `ambassador` in config/store.json (Rule Nine). Both are paid only from money the Ambassadors'
 * businesses have already brought in: neither is ever paid before Ozi has been paid.
 *
 * The month's prize goes to the Ambassador who brought in the most confirmed, ordering businesses
 * in a calendar month (UK time): a business counts when it confirmed that Ambassador's claim in
 * that month (its `ambassadorConfirmedAt`) and had at least one paid, non-refunded order in it.
 * At least `monthlyPrizeMinimumBusinesses` (2) are needed; a tie goes to whoever reached that
 * count first, by the confirmation time of their last counted business. The prize is paid only
 * when Ozi's net income that month from every business brought in by Ambassadors reaches
 * `monthlyPrizeBarPence` (£125): `oziNetOnOrderPence` is that income on one order.
 *
 * The first-business bonus is once in an Ambassador's life: when their first confirmed business
 * has completed `firstBusinessBonusAfterOrders` (4) paid, non-refunded orders.
 */

import type { AmbassadorSettings } from './referrals.js';
import { rewardWords } from './referrals.js';

/** "2026-11": the calendar month a moment falls in, in UK time (Europe/London). */
export function ukMonthKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

/** "2026-10" from "2026-11": the calendar month before. */
export function monthBefore(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

/** "2026-12" from "2026-11": the calendar month after. */
export function monthAfter(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/** "November 2026" from "2026-11". */
export function monthWords(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}

/** Whether the monthly prize runs in this month: from the first month to the last, both counted. */
export function prizeMonthRuns(
  month: string,
  settings: Pick<AmbassadorSettings, 'monthlyPrizeFromMonth' | 'monthlyPrizeUntilMonth'>,
): boolean {
  return month >= settings.monthlyPrizeFromMonth && month <= settings.monthlyPrizeUntilMonth;
}

/** Whether the month's net income from Ambassador-brought businesses reaches the bar. */
export function prizeBarMet(
  netPence: number,
  settings: Pick<AmbassadorSettings, 'monthlyPrizeBarPence'>,
): boolean {
  return netPence >= settings.monthlyPrizeBarPence;
}

/** One Ambassador's standing in a month: how many businesses counted, and when each confirmed. */
export interface PrizeStanding {
  readonly ambassadorKind: string;
  readonly ambassadorId: string;
  /** The confirmation time of each confirmed, ordering business that month. */
  readonly confirmedAt: readonly Date[];
}

export interface PrizeDecision {
  /** The winner, or null when nobody had enough businesses. */
  readonly winner: PrizeStanding | null;
  readonly qualifyingBusinesses: number;
}

/**
 * Who wins the month: the most confirmed, ordering businesses, at least the minimum; a tie goes
 * to whoever reached that count first (the earlier confirmation of their last counted business).
 * Nobody wins with fewer than the minimum.
 */
export function decideMonthlyPrize(
  standings: readonly PrizeStanding[],
  settings: Pick<AmbassadorSettings, 'monthlyPrizeMinimumBusinesses'>,
): PrizeDecision {
  let winner: PrizeStanding | null = null;
  let reachedAt = Number.POSITIVE_INFINITY;
  for (const standing of standings) {
    const count = standing.confirmedAt.length;
    if (count < settings.monthlyPrizeMinimumBusinesses) continue;
    const times = standing.confirmedAt.map((at) => at.getTime()).sort((a, b) => a - b);
    const last = times[count - 1] ?? Number.POSITIVE_INFINITY;
    const best = winner?.confirmedAt.length ?? 0;
    if (count > best || (count === best && last < reachedAt)) {
      winner = standing;
      reachedAt = last;
    }
  }
  return { winner, qualifyingBusinesses: winner?.confirmedAt.length ?? 0 };
}

/** The money on one paid, non-refunded order from an Ambassador-brought business. */
export interface OrderTake {
  /** The delivery fee, or the flat restaurant fee, the Shopper paid. */
  readonly feePence: number;
  /** The Runner's pay on it (Rule Two). */
  readonly runnerPaymentPence: number;
  /** The extra delivery charge past a plan's allowance (ruling 73), or 0. */
  readonly allowanceExtraPence: number;
  /** The item charges on the business's things. */
  readonly itemChargesPence: number;
  /** The mark-up kept on the business's things: what the Shopper paid less the shop price. */
  readonly markupPence: number;
  /** The discount kept on the business's things: the shop price less the counter price. */
  readonly discountPence: number;
  /** What the payment processor took on the order's total. */
  readonly processorCostPence: number;
  /** Every Ambassador share recorded on the order. */
  readonly ambassadorSharesPence: number;
  /** What has been given back to the Shopper since: part refunds and goodwill. */
  readonly refundedPence: number;
}

/**
 * Ozi's net income on one order from an Ambassador-brought business (ruling 91): Ozi's share of
 * the delivery or restaurant fee (the fee less the Runner's pay) and any allowance extra, plus the
 * item charges, the mark-up and the discount kept on the business's things, less the payment
 * processor's cost, the Ambassador shares on the order and anything refunded. Never below nothing.
 */
export function oziNetOnOrderPence(take: OrderTake): number {
  const income =
    Math.max(0, take.feePence - take.runnerPaymentPence) +
    Math.max(0, take.allowanceExtraPence) +
    Math.max(0, take.itemChargesPence) +
    Math.max(0, take.markupPence) +
    Math.max(0, take.discountPence);
  const costs =
    Math.max(0, take.processorCostPence) +
    Math.max(0, take.ambassadorSharesPence) +
    Math.max(0, take.refundedPence);
  return Math.max(0, income - costs);
}

/** Whether the first-business bonus is due: the business has completed enough orders. */
export function firstBusinessBonusDue(
  paidOrders: number,
  settings: Pick<AmbassadorSettings, 'firstBusinessBonusAfterOrders'>,
): boolean {
  return paidOrders >= settings.firstBusinessBonusAfterOrders;
}

/* ------------------------------------------------------------------ the words */

/** "You have 1 confirmed, ordering business this month." */
export function prizeStandingWords(count: number): string {
  return count === 1
    ? 'You have 1 confirmed, ordering business this month.'
    : `You have ${count} confirmed, ordering businesses this month.`;
}

/** Whether the month's bar is met so far, in words, never the figure. */
export function prizeBarWords(
  met: boolean,
  settings: Pick<AmbassadorSettings, 'monthlyPrizePence'>,
  symbol = '£',
): string {
  const prize = rewardWords(settings.monthlyPrizePence, symbol);
  return met
    ? `The ${prize} prize is on this month.`
    : 'Not enough orders yet this month for the prize.';
}

/** Last month's winner by first name, or why there was no prize. */
export function lastMonthPrizeWords(
  decision: { winnerFirstName: string | null; barMet: boolean } | null,
  settings: Pick<AmbassadorSettings, 'monthlyPrizePence'>,
  symbol = '£',
): string {
  if (!decision) return "Last month's prize is being decided.";
  if (!decision.barMet) return 'No prize last month, as not enough orders came in.';
  if (!decision.winnerFirstName) {
    return 'No prize last month, as nobody brought in enough businesses.';
  }
  return `Last month's Top Ambassador: ${decision.winnerFirstName}, who won ${rewardWords(settings.monthlyPrizePence, symbol)}.`;
}

/** "Your first business has completed 2 of 4 orders. At 4, you earn a £10 one-off bonus." */
export function firstBusinessBonusWords(
  state: { hasBusiness: boolean; paidOrders: number; credited: boolean },
  settings: Pick<AmbassadorSettings, 'firstBusinessBonusPence' | 'firstBusinessBonusAfterOrders'>,
  symbol = '£',
): string {
  const bonus = rewardWords(settings.firstBusinessBonusPence, symbol);
  const needed = settings.firstBusinessBonusAfterOrders;
  if (state.credited) {
    return `You earned your ${bonus} one-off bonus when your first business completed ${needed} orders.`;
  }
  if (!state.hasBusiness) {
    return `When your first confirmed business completes ${needed} orders, you earn a ${bonus} one-off bonus.`;
  }
  return `Your first business has completed ${Math.min(state.paidOrders, needed)} of ${needed} orders. At ${needed}, you earn a ${bonus} one-off bonus.`;
}

/** The clause of the Ambassador terms on the prize and the bonus, from the figures. */
export function prizeTermsWords(
  settings: Pick<
    AmbassadorSettings,
    | 'monthlyPrizePence'
    | 'monthlyPrizeMinimumBusinesses'
    | 'monthlyPrizeBarPence'
    | 'monthlyPrizeFromMonth'
    | 'monthlyPrizeUntilMonth'
    | 'firstBusinessBonusPence'
    | 'firstBusinessBonusAfterOrders'
  >,
  symbol = '£',
): { prize: string; bonus: string } {
  const prize = rewardWords(settings.monthlyPrizePence, symbol);
  const bar = rewardWords(settings.monthlyPrizeBarPence, symbol);
  return {
    prize: `From ${monthWords(settings.monthlyPrizeFromMonth)} to ${monthWords(settings.monthlyPrizeUntilMonth)}, the Ambassador who brings in the most confirmed, ordering businesses in a calendar month wins ${prize}, with at least ${settings.monthlyPrizeMinimumBusinesses} such businesses; a tie goes to whoever got there first. The prize is paid only in a month when our net income from the businesses Ambassadors have brought in is at least ${bar}. A month below that pays no prize. The winner is announced by first name on every Ambassador's dashboard on the 1st of the next month, and the prize is held and paid as earnings are.`,
    bonus: `Once, when the first business you introduced and that confirmed you has completed ${settings.firstBusinessBonusAfterOrders} paid orders that were not refunded, you earn a one-off ${rewardWords(settings.firstBusinessBonusPence, symbol)}, held and paid as earnings are.`,
  };
}
