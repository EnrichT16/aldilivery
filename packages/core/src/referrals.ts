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
 * with the founder, and we may decline or suspend.
 */
export const AMBASSADOR_TERMS_VERSION = '2026-10-30c';

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
): number {
  const factor = branch === 'other_branch' ? settings.branchShareFactor : 1;
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
