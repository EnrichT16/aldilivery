/**
 * Referrals and Ozi Ambassadors (Anthony, 30 October 2026). The sums, in one place, for the
 * server and the web app alike. Every figure comes from `referrals` and `ambassadors` in
 * config/store.json (Rule Nine).
 *
 * Referral levels: everybody (Shoppers, Runners, shop partners and organisations) has their own
 * link. A level is reached at so many ACTIVE referrals (people who joined through the link and
 * are really using the service), and only counts when at least `minimumActiveShare` of everyone
 * who joined through the link is active: 20 active out of 28 joined is 71%, which qualifies.
 * Each level is its own reward, given by hand by staff. These replaced the Runner reward of
 * £150 at 100 referrals.
 *
 * Ambassadors: anybody who chooses to become one, and agrees to the Ambassador terms, can
 * introduce businesses, with no limit on how many. They earn a share of Ozi's profit on each
 * order (the item charges on a shop's orders; on a restaurant's, only its agreed discount for Ozi,
 * restaurants paying no commission since 30 October 2026; never the delivery fee, the restaurant
 * fee, or a restaurant's item charges), 2% unless set, for so many months from when that business was
 * approved. Each branch is its own venture: the branch they introduced earns the full share,
 * another branch of the same business that joined through the same Ambassador's link a quarter
 * of it (ruled 30 October 2026; it was half), and a branch that joined without their link
 * nothing. They also earn a one-off share (5%) of the business's first Partner Plus payment. A
 * month's earnings above `reviewAbovePence` are checked by the owner before paying.
 *
 * Tamper-proof money (ruled 30 October 2026): every earning comes from a real recorded order and
 * follows its final state, so a cancelled or refunded order earns nothing and a part refund earns
 * less (`ambassadorEarningAfterRefunds`). An earning is PENDING until `holdDays` after the order
 * was delivered (`ambassadorAvailableAt`), then AVAILABLE; only what is available can be paid.
 */

import { formatPence } from './money.js';

/**
 * The version of the Ozi Ambassador terms at /ambassador/terms, kept with each agreement.
 * Changed in substance on 30 October 2026 (Anthony: the base on a restaurant's orders is its
 * discount alone), so an Ambassador who agreed to an earlier version agrees again before a
 * withdrawal; their link keeps working. Changed again the same day (Anthony, Ambassador
 * applications): an Ambassador is approved only after their documents are checked and a short chat
 * with the founder, and we may decline or suspend. Changed again on 31 October 2026 (Anthony,
 * protections against misuse): never ask for or take money, never promise anything not in the
 * agreement, never collect bank or card details; breaking any of them is removal for fraud.
 * Changed on 2 November 2026 (Anthony, ruling 91): the Top Ambassador of the month prize, paid
 * only in a month whose net income from Ambassador-brought businesses reaches the bar, and the
 * one-off first-business bonus.
 */
export const AMBASSADOR_TERMS_VERSION = '2026-11-02';

/** One reward level: so many active referrals, the reward, and what it is called. */
export interface ReferralLevel {
  readonly activeReferrals: number;
  readonly rewardPence: number;
  /** "£10 voucher": said in "the £10 voucher level" and "for your £10 voucher". */
  readonly label: string;
}

export interface ReferralSettings {
  /** Smallest first. */
  readonly levels: readonly ReferralLevel[];
  /** 0.7: at least 70% of the people who joined through the link must be active. */
  readonly minimumActiveShare: number;
  /** What the reward is bought as, by hand, for staff: "Amazon voucher". */
  readonly givenAs: string;
  /**
   * Sending the voucher (Anthony, 30 October 2026): how long the gift card lasts, said in the
   * message (Amazon UK gift cards last 10 years, so there is no expiry here); the days after it
   * is sent that Ozi rings to remind them while it is unopened (the day, 7 and 14); and how long
   * Ozi rings in the app before a text instead.
   */
  readonly voucherLastsYears: number;
  readonly voucherReminderDays: readonly number[];
  readonly voucherRingSeconds: number;
}

/** "Your £10 Amazon shopping voucher from <product name>": the voucher message's title. */
export function voucherTitle(
  rewardPence: number,
  givenAs: string,
  productName: string,
  symbol = '£',
): string {
  const brand = givenAs.replace(/\s*voucher$/i, '').trim();
  return `Your ${rewardWords(rewardPence, symbol)} ${brand} shopping voucher from ${productName}`;
}

/**
 * What Ozi says when it rings about an unopened voucher: "Hello, this is <assistant> from <product name>.
 * You've been sent a £10 shopping voucher as a thank you. Open your Ozi inbox to see it."
 */
export function voucherReminderWords(
  rewardPence: number,
  assistantName: string,
  productName: string,
  symbol = '£',
): string {
  return `Hello, this is ${assistantName} from ${productName}. You've been sent a ${rewardWords(rewardPence, symbol)} shopping voucher as a thank you. Open your ${assistantName} inbox to see it.`;
}

/** "Code ••••AB12": a voucher code with all but its last four characters hidden. */
export function maskedVoucherCode(code: string): string {
  if (code === '') return '';
  const last = code.slice(-4);
  return `${'•'.repeat(Math.max(4, code.length - 4))}${last}`;
}

/**
 * What an Ambassador earns on each order (Anthony's final ruling, 30 October 2026), each a share
 * from 0 to 1. On a restaurant's order: of the mark-up Ozi keeps, and of the discount Ozi keeps,
 * never the item charges or the restaurant fee. On a grocery shop partner's order: of the item
 * charges on its things, and of any mark-up and discount Ozi keeps.
 */
export interface AmbassadorShares {
  /** 0.02: 2% of the mark-up Ozi keeps on a restaurant's dishes. */
  readonly restaurantMarkupShare: number;
  /** 0.02: 2% of the discount Ozi keeps on a restaurant's dishes. */
  readonly restaurantDiscountShare: number;
  /** 0.01: 1% of the item charges on a grocery shop partner's things. */
  readonly groceryItemChargeShare: number;
  /** 0.01: 1% of the mark-up Ozi keeps on a grocery shop partner's things. */
  readonly groceryMarkupShare: number;
  /** 0.01: 1% of the discount Ozi keeps on a grocery shop partner's things. */
  readonly groceryDiscountShare: number;
}

export interface AmbassadorSettings extends AmbassadorShares {
  /** For this many months from when the business was approved. */
  readonly months: number;
  /** A one-off share of the business's first Partner Plus payment: 0.05 is 5%. */
  readonly planShare: number;
  /** Another branch of a business they introduced, through their link: 0.25 is a quarter. */
  readonly branchShareFactor: number;
  /** Days after delivery an earning waits, pending, for refunds and complaints: 30. */
  readonly holdDays: number;
  /** Paid, or withdrawn, once at least this much is available. */
  readonly payoutMinimumPence: number;
  /** A month's earnings above this are checked by the owner before paying. No limit otherwise. */
  readonly reviewAbovePence: number;
  /**
   * Applying (Anthony, 30 October 2026): a proof of address must be dated within this many months
   * (3), and the ID and address documents are kept for this many months after somebody stops
   * being an Ambassador, or is declined (12), then removed.
   */
  readonly addressWithinMonths: number;
  readonly documentsKeptMonths: number;
  /**
   * Declined, suspended and removed (Anthony, 31 October 2026): a declined applicant may apply
   * again this many months after the decline (6); their ID, proof of address and face photo are
   * removed this many days after it (30); a short note (name, date of birth if held, date,
   * reason) is kept this many months (12), then removed too, except the note that bars somebody
   * removed for fraud, which stays.
   */
  readonly reapplyAfterMonths: number;
  readonly declinedDocumentsDeleteAfterDays: number;
  readonly declinedNoteKeptMonths: number;
  /**
   * Top Ambassador of the month (Anthony, 2 November 2026, ruling 91): the prize (£25) for the
   * Ambassador who brought in the most confirmed, ordering businesses in a calendar month (UK
   * time), at least `monthlyPrizeMinimumBusinesses` (2) of them; paid only when Ozi's net income
   * that month from the businesses Ambassadors brought in is at least `monthlyPrizeBarPence`
   * (£125, five times the prize); from `monthlyPrizeFromMonth` ("2026-11") to
   * `monthlyPrizeUntilMonth` ("2027-11"), both counted, when the owner reviews it.
   */
  readonly monthlyPrizePence: number;
  readonly monthlyPrizeMinimumBusinesses: number;
  readonly monthlyPrizeBarPence: number;
  readonly monthlyPrizeFromMonth: string;
  readonly monthlyPrizeUntilMonth: string;
  /**
   * The first-business bonus (ruling 91): once in an Ambassador's life, £10, when their first
   * confirmed business has completed `firstBusinessBonusAfterOrders` (4) paid, non-refunded
   * orders.
   */
  readonly firstBusinessBonusPence: number;
  readonly firstBusinessBonusAfterOrders: number;
  /**
   * An individual rate (Anthony, 3 November 2026, ruling 94): the owner alone may grant one
   * Ambassador a higher rate than the standard one, said as a percentage in place of the
   * restaurant mark-up share ("3% where others earn 2%") and applied as the same multiplier to
   * every percentage share. Never above this many percent (5).
   */
  readonly maxIndividualRatePercent: number;
  /**
   * Texting an Ambassador's link to a business from the admin panel or by the owner's voice
   * (ruling 94): at most this many texts a UK day for each member of staff (20).
   */
  readonly linkTextsPerDay: number;
}

/** "2%", "2.5%" or "0.25%": a share as people read it, to two places at most. */
export function shareWords(share: number): string {
  const percent = Math.round(share * 10000) / 100;
  return `${percent}%`;
}

/** "£10", or "£10.50" when it is not whole pounds. */
export function rewardWords(pence: number, symbol = '£'): string {
  const full = formatPence(pence, symbol);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

/** The share of people who joined that are active: 0 when nobody has joined. */
export function activeShare(active: number, joined: number): number {
  if (joined <= 0) return 0;
  return active / joined;
}

/** "71%": the share as a whole percentage, rounded down so 69.9% never reads as 70%. */
export function percentWords(active: number, joined: number): string {
  return `${Math.floor(activeShare(active, joined) * 100 + 1e-9)}%`;
}

/** Whether enough of the people who joined are active for a level to count (the 70% rule). */
export function meetsActiveShare(
  active: number,
  joined: number,
  settings: Pick<ReferralSettings, 'minimumActiveShare'>,
): boolean {
  if (joined <= 0 || active <= 0) return false;
  // Compared as whole numbers, so 7 out of 10 is exactly 70% and qualifies.
  return active * 1000 >= Math.round(settings.minimumActiveShare * 1000) * joined;
}

/** Every level reached now: enough active referrals, and the 70% rule met. Smallest first. */
export function levelsReached(
  active: number,
  joined: number,
  settings: Pick<ReferralSettings, 'levels' | 'minimumActiveShare'>,
): ReferralLevel[] {
  if (!meetsActiveShare(active, joined, settings)) return [];
  return settings.levels.filter((level) => active >= level.activeReferrals);
}

/** The highest level reached now, or null. */
export function highestLevel(
  active: number,
  joined: number,
  settings: Pick<ReferralSettings, 'levels' | 'minimumActiveShare'>,
): ReferralLevel | null {
  return levelsReached(active, joined, settings).at(-1) ?? null;
}

/**
 * The next level to work towards: the smallest not yet earned. `earned` is the active-referral
 * counts of levels already recorded, so a level once reached stays reached.
 */
export function nextLevel(
  settings: Pick<ReferralSettings, 'levels'>,
  earned: readonly number[] = [],
): ReferralLevel | null {
  return settings.levels.find((level) => !earned.includes(level.activeReferrals)) ?? null;
}

/**
 * What a person sees of their own progress: "7 of 20 active referrals for your £10 voucher".
 * When they have enough active referrals but too few of everyone who joined are active, it says
 * so plainly.
 */
export function progressWords(
  active: number,
  joined: number,
  settings: Pick<ReferralSettings, 'levels' | 'minimumActiveShare'>,
  earned: readonly number[] = [],
): string {
  const next = nextLevel(settings, earned);
  if (!next) return 'You have reached every reward level. Thank you.';
  const words = `${Math.min(active, next.activeReferrals)} of ${next.activeReferrals} active referrals for your ${next.label}.`;
  if (active >= next.activeReferrals && !meetsActiveShare(active, joined, settings)) {
    const needed = Math.round(settings.minimumActiveShare * 100);
    return `${words} At least ${needed}% of the people who joined need to be active, and ${active} of ${joined} is ${percentWords(active, joined)}.`;
  }
  return words;
}

/** What the person is told when they reach a level: on their dashboard, and by Ozi once. */
export function earnedWords(level: ReferralLevel, symbol = '£'): string {
  return `You've earned a ${rewardWords(level.rewardPence, symbol)} shopping voucher. We'll be in touch.`;
}

/** What the owner is told: "Ada has reached the £10 voucher level with 20 active referrals." */
export function ownerLevelWords(name: string, level: ReferralLevel, active: number): string {
  return `${name} has reached the ${level.label} level with ${active} active referrals.`;
}

/** What Ozi kept on one business's things in one order, the amounts an Ambassador's share is of. */
export interface AmbassadorBase {
  /** A restaurant, café or takeaway, or a grocery shop partner. */
  readonly kind: 'restaurant' | 'grocery';
  /** The mark-up Ozi kept: what the Shopper paid less the shop price. */
  readonly markupPence: number;
  /** The discount Ozi kept: the shop price less what the Runner paid at the counter. */
  readonly discountPence: number;
  /** The item charges on its things (counted for a grocery shop partner only). */
  readonly itemChargesPence: number;
}

/**
 * The Ambassador's share on one business's things in one order, to the nearest penny (Anthony's
 * final ruling, 30 October 2026). A restaurant: 2% of the mark-up kept plus 2% of the discount
 * kept (a £10 dish at 50% mark-up and 20% discount: 2% of £5 and 2% of £2, 14p). A grocery shop
 * partner: 1% of the item charges, of the mark-up and of the discount. A quarter of it for
 * another branch that joined through their link.
 */
export function ambassadorOrderSharePence(
  base: AmbassadorBase,
  settings: AmbassadorShares & Pick<AmbassadorSettings, 'branchShareFactor'>,
  branch: 'introduced' | 'other_branch' = 'introduced',
  /** An individual rate (ruling 94): 1.5 makes every 2% a 3% and every 1% a 1.5%. */
  multiplier = 1,
): number {
  const factor = (branch === 'other_branch' ? settings.branchShareFactor : 1) * multiplier;
  // Worked in millionths, so 2% of £10 is exactly 20p however the share is written.
  const part = (pence: number, share: number): number =>
    Math.max(0, pence) * Math.round(share * factor * 1_000_000);
  const millionths =
    base.kind === 'restaurant'
      ? part(base.markupPence, settings.restaurantMarkupShare) +
        part(base.discountPence, settings.restaurantDiscountShare)
      : part(base.itemChargesPence, settings.groceryItemChargeShare) +
        part(base.markupPence, settings.groceryMarkupShare) +
        part(base.discountPence, settings.groceryDiscountShare);
  return Math.round(millionths / 1_000_000);
}

/** The one-off share of the business's first Partner Plus payment: 5% of £14.99 is 75p. */
export function ambassadorPlanSharePence(
  firstPaymentPence: number,
  settings: Pick<AmbassadorSettings, 'planShare'>,
): number {
  if (firstPaymentPence <= 0) return 0;
  return Math.round((firstPaymentPence * Math.round(settings.planShare * 1_000_000)) / 1_000_000);
}

/** Whether a month's earnings are high enough for the owner to check them before paying. */
export function ambassadorNeedsReview(
  monthPence: number,
  settings: Pick<AmbassadorSettings, 'reviewAbovePence'>,
): boolean {
  return monthPence > settings.reviewAbovePence;
}

/** The moment the share stops: `months` calendar months after the business was approved. */
export function ambassadorShareEnds(
  approvedAt: Date,
  settings: Pick<AmbassadorSettings, 'months'>,
): Date {
  const end = new Date(approvedAt);
  end.setUTCMonth(end.getUTCMonth() + settings.months);
  return end;
}

/** Whether an order at this moment still earns the Ambassador a share. */
export function withinAmbassadorMonths(
  approvedAt: Date | null,
  at: Date,
  settings: Pick<AmbassadorSettings, 'months'>,
): boolean {
  if (!approvedAt) return false;
  return (
    at.getTime() >= approvedAt.getTime() &&
    at.getTime() < ambassadorShareEnds(approvedAt, settings).getTime()
  );
}

/** Whether what is owed is enough to pay this month. */
export function ambassadorPayable(
  owedPence: number,
  settings: Pick<AmbassadorSettings, 'payoutMinimumPence'>,
): boolean {
  return owedPence > 0 && owedPence >= settings.payoutMinimumPence;
}

/**
 * What a share is worth once refunds are taken into account: a whole refund (or a cancelled
 * order) leaves nothing, and a part refund takes off the same part of the share. Worked from what
 * the Shopper finally paid and what was given back, never from estimates. Rounded down, so a
 * refund never leaves the Ambassador a penny more than their part.
 */
export function ambassadorEarningAfterRefunds(
  sharePence: number,
  paidPence: number,
  refundedPence: number,
): number {
  if (sharePence <= 0 || paidPence <= 0) return 0;
  const kept = Math.max(0, paidPence - Math.max(0, refundedPence));
  if (kept >= paidPence) return sharePence;
  return Math.floor((sharePence * kept) / paidPence);
}

/** When an earning stops being pending and can be paid: `holdDays` after the order was delivered. */
export function ambassadorAvailableAt(
  deliveredAt: Date,
  settings: Pick<AmbassadorSettings, 'holdDays'>,
): Date {
  return new Date(deliveredAt.getTime() + settings.holdDays * 24 * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ an individual rate (ruling 94) */

/** The standard rate as people say it: the restaurant mark-up share, 2, as a percentage. */
export function standardRatePercent(settings: Pick<AmbassadorShares, 'restaurantMarkupShare'>) {
  return Math.round(settings.restaurantMarkupShare * 10000) / 100;
}

/**
 * The multiplier behind a chosen rate: 3% where the standard is 2% is 1.5, applied to every
 * percentage share. A rate equal to the standard one is the plain multiplier of 1.
 */
export function individualRateMultiplier(
  percent: number,
  settings: Pick<AmbassadorShares, 'restaurantMarkupShare'>,
): number {
  const standard = standardRatePercent(settings);
  if (standard <= 0) return 1;
  return Math.round((percent / standard) * 10000) / 10000;
}

/** The rate a multiplier gives, as a percentage: 1.5 on a standard 2% is 3. */
export function individualRatePercent(
  multiplier: number,
  settings: Pick<AmbassadorShares, 'restaurantMarkupShare'>,
): number {
  return Math.round(standardRatePercent(settings) * multiplier * 100) / 100;
}

/**
 * Why a rate the owner asked for cannot be set, in plain words, or null when it can: more than
 * nothing, never below the standard rate (the rate is a favour, never a cut), and never above
 * `maxIndividualRatePercent`.
 */
export function individualRateProblem(
  percent: number,
  settings: Pick<AmbassadorShares, 'restaurantMarkupShare'> &
    Pick<AmbassadorSettings, 'maxIndividualRatePercent'>,
): string | null {
  const standard = standardRatePercent(settings);
  if (!Number.isFinite(percent) || percent <= 0) {
    return 'Please give the rate as a percentage, such as 3.';
  }
  if (Math.round(percent * 100) / 100 !== percent) {
    return 'Please give the rate to two decimal places at most.';
  }
  if (percent < standard) {
    return `An individual rate is never below the standard rate of ${standard}%.`;
  }
  if (percent > settings.maxIndividualRatePercent) {
    return `An individual rate can be at most ${settings.maxIndividualRatePercent}%.`;
  }
  return null;
}

/** "3%, where the standard rate is 2%", or "the standard rate of 2%". */
export function individualRateWords(
  multiplier: number,
  settings: Pick<AmbassadorShares, 'restaurantMarkupShare'>,
): string {
  const standard = standardRatePercent(settings);
  const percent = individualRatePercent(multiplier, settings);
  if (multiplier === 1) return `the standard rate of ${standard}%`;
  return `${percent}%, where the standard rate is ${standard}%`;
}

/* ------------------------------------------------------------------ a link read aloud (ruling 94) */

const SPOKEN_CHARACTERS: Record<string, string> = {
  '/': 'slash',
  '.': 'dot',
  '?': 'question mark',
  '=': 'equals',
  '&': 'and sign',
  '-': 'dash',
  _: 'underscore',
  ':': 'colon',
  '%': 'percent',
  '+': 'plus',
  '#': 'hash',
  '~': 'tilde',
  '@': 'at',
};

/**
 * A web link said slowly, for somebody writing it down from Ozi (ruling 94): "https colon slash
 * slash" is left off, every slash, dot, question mark and equals sign is said, a plain word is
 * said as a word, and a code is spelt out, upper-case letters as "capital", in groups of at most
 * four with a pause between. "ozi.example/business/join?ambassador=runner-AB12" becomes "ozi,
 * dot, example, slash, business, slash, join, question mark, ambassador, equals, runner, dash,
 * capital A, capital B, 1, 2".
 */
export function linkAloud(link: string): string {
  const bare = link.replace(/^https?:\/\//i, '');
  const pieces: string[] = [];
  for (const part of bare.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/g) ?? []) {
    if (/^[A-Za-z0-9]+$/.test(part)) {
      pieces.push(wordAloud(part));
    } else {
      pieces.push(SPOKEN_CHARACTERS[part] ?? `the character ${part}`);
    }
  }
  return pieces.join(', ');
}

/** A plain lower-case word is said as it is; anything with digits or capitals is spelt out. */
function wordAloud(word: string): string {
  if (/^[a-z]+$/.test(word) && word.length <= 12) return word;
  const letters = word.split('').map((character) => {
    if (/[0-9]/.test(character)) return character;
    return /[A-Z]/.test(character) ? `capital ${character}` : character;
  });
  const groups: string[] = [];
  for (let at = 0; at < letters.length; at += 4) {
    groups.push(letters.slice(at, at + 4).join(' '));
  }
  return groups.join(', ');
}
