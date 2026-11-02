/**
 * Top Ambassador of the month, and the first-business bonus (Anthony, 2 November 2026, ruling
 * 91). Both are paid only from money the Ambassadors' businesses have already brought in, and
 * neither is ever paid before Ozi has been paid. Every figure is in `ambassador` in
 * config/store.json; the sums and the words are in packages/core/src/ambassador-prizes.ts.
 *
 * The prize. Each calendar month (UK time), the Ambassador who brought in the most confirmed,
 * ordering businesses wins `monthlyPrizePence` (£25). A business counts for an Ambassador in a
 * month when it confirmed that Ambassador's claim in that month (`ambassadorConfirmedAt`, set
 * when the business typed its code or signed itself up through the link, services/
 * ambassador-protection.ts) and had at least one paid, non-refunded order delivered in it. At
 * least `monthlyPrizeMinimumBusinesses` (2) are needed; a tie goes to whoever reached the count
 * first. The prize is paid only when Ozi's net income that month from the businesses Ambassadors
 * brought in is at least `monthlyPrizeBarPence` (£125): see `monthTakings` for exactly what that
 * is. The decision is made once, by the hourly sweep, on or after the 1st of the next month
 * (`AmbassadorPrize`, one row a month), and the prize is credited to the winner's Ambassador
 * balance as an entry of kind `prize`, under the normal 30-day hold and withdrawal rules.
 *
 * The first-business bonus. Once in an Ambassador's life, `firstBusinessBonusPence` (£10) when
 * their first confirmed business has completed `firstBusinessBonusAfterOrders` (4) paid,
 * non-refunded orders; a refund that takes the count back below that before it is credited
 * simply postpones it. Credited as an entry of kind `first-business-bonus`, held from the
 * delivery of the order that made it due.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  ambassadorApproved,
  ambassadorAvailableAt,
  decideMonthlyPrize,
  firstBusinessBonusDue,
  firstBusinessBonusWords,
  firstNameOf,
  formatPence,
  lastMonthPrizeWords,
  monthBefore,
  monthAfter,
  monthWords,
  oziNetOnOrderPence,
  prizeBarMet,
  prizeBarWords,
  prizeMonthRuns,
  prizeStandingWords,
  processorCostPence,
  rewardWords,
  ukMonthKey,
  type PrizeStanding,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  AmbassadorEntry,
  AmbassadorPrize,
  Order,
  PartnerShop,
  ReferralKind,
} from '../domain.js';
import { ambassadorMayEarn } from './ambassador-protection.js';
import { EARNS, paidAndRefunded, profitByShop } from './ambassadors.js';
import { findAccount } from './referrals.js';

type Ctx = Pick<AppContext, 'repository' | 'config' | 'now'>;

/* ------------------------------------------------------------------ the orders that count */

/** A paid order that was not refunded whole: delivered or completed, and not all given back. */
async function paidNotRefunded(ctx: Ctx, order: Order): Promise<boolean> {
  if (!EARNS.has(order.status) || !order.deliveredAt) return false;
  const { paidPence, refundedPence } = await paidAndRefunded(ctx, order);
  return refundedPence < paidPence;
}

/** Every paid, non-refunded order, oldest delivery first; in one month (UK time) when given. */
async function paidOrders(ctx: Ctx, month?: string): Promise<Order[]> {
  const orders = [
    ...(await ctx.repository.orders.listByStatus('delivered')),
    ...(await ctx.repository.orders.listByStatus('completed')),
  ];
  const kept: Order[] = [];
  for (const order of orders) {
    if (!order.deliveredAt) continue;
    if (month && ukMonthKey(order.deliveredAt) !== month) continue;
    if (await paidNotRefunded(ctx, order)) kept.push(order);
  }
  return kept.sort((a, b) => a.deliveredAt!.getTime() - b.deliveredAt!.getTime());
}

/**
 * The businesses Ambassadors brought in: tied to an Ambassador, and confirmed by the business
 * itself (the business's own code, or its own sign-up through the link). A business from before
 * confirmation began, or one still waiting for its code, is not among them.
 */
async function broughtInShops(ctx: Ctx): Promise<Map<string, PartnerShop>> {
  const shops = new Map<string, PartnerShop>();
  for (const shop of await ctx.repository.partnerShops.list()) {
    if (!shop.ambassadorKind || !shop.ambassadorId) continue;
    if (!shop.ambassadorConfirmedAt || !ambassadorMayEarn(shop)) continue;
    shops.set(shop.id, shop);
  }
  return shops;
}

export interface MonthTakings {
  month: string;
  /** Ozi's net income that month from the businesses Ambassadors brought in. */
  netPence: number;
  /** The confirmed, ordering businesses that month, by Ambassador. */
  standings: PrizeStanding[];
}

/**
 * One month's takings from the businesses Ambassadors brought in (ruling 91), worked from the
 * orders as they finally stand. "Net income from Ambassador-brought businesses" is, over every
 * paid, non-refunded order delivered that month (UK time) with anything in it from such a
 * business:
 *
 * - Ozi's share of the delivery fee, or of the flat restaurant fee: the fee the Shopper paid less
 *   the Runner's pay (Rule Two), and any extra delivery charge past a plan's allowance;
 * - plus the item charges, the mark-up and the discount Ozi kept on that business's things, the
 *   same figures an Ambassador's share is worked from (`profitByShop`);
 * - less the payment processor's cost on the order's total (`processorCostPence`, from
 *   `fees.processor`), the Ambassador shares recorded on the order, and anything given back to
 *   the Shopper since (part refunds and goodwill).
 *
 * Never below nothing on any order. A business is "ordering" that month when at least one such
 * order had its things in it, and counts for its Ambassador when it confirmed them that month.
 */
export async function monthTakings(ctx: Ctx, month: string): Promise<MonthTakings> {
  const brought = await broughtInShops(ctx);
  const ordering = new Set<string>();
  let netPence = 0;
  for (const order of await paidOrders(ctx, month)) {
    const profits = await profitByShop(ctx, order);
    const inIt = [...profits.values()].filter(({ shop }) => brought.has(shop.id));
    if (inIt.length === 0) continue;
    for (const { shop } of inIt) ordering.add(shop.id);
    const shares = (await ctx.repository.ambassadors.listForOrder(order.id))
      .filter((entry) => entry.kind === 'share')
      .reduce((sum, entry) => sum + entry.amountPence, 0);
    const { refundedPence } = await paidAndRefunded(ctx, order);
    netPence += oziNetOnOrderPence({
      feePence: order.feePence,
      runnerPaymentPence: order.runnerPaymentPence,
      allowanceExtraPence: order.allowanceExtraPence,
      itemChargesPence: inIt.reduce((sum, { base }) => sum + base.itemChargesPence, 0),
      markupPence: inIt.reduce((sum, { base }) => sum + base.markupPence, 0),
      discountPence: inIt.reduce((sum, { base }) => sum + base.discountPence, 0),
      processorCostPence: processorCostPence(
        Math.max(0, order.finalTotalPence ?? order.totalEstimatePence),
        ctx.config.fees.processor,
      ),
      ambassadorSharesPence: shares,
      refundedPence,
    });
  }
  const byAmbassador = new Map<string, { kind: ReferralKind; id: string; confirmedAt: Date[] }>();
  for (const shop of brought.values()) {
    if (!ordering.has(shop.id)) continue;
    if (ukMonthKey(shop.ambassadorConfirmedAt!) !== month) continue;
    const key = `${shop.ambassadorKind}:${shop.ambassadorId}`;
    const standing = byAmbassador.get(key) ?? {
      kind: shop.ambassadorKind!,
      id: shop.ambassadorId!,
      confirmedAt: [],
    };
    standing.confirmedAt.push(shop.ambassadorConfirmedAt!);
    byAmbassador.set(key, standing);
  }
  return {
    month,
    netPence,
    standings: [...byAmbassador.values()].map((standing) => ({
      ambassadorKind: standing.kind,
      ambassadorId: standing.id,
      confirmedAt: standing.confirmedAt,
    })),
  };
}

/* ------------------------------------------------------------------ the month's decision */

/** Only an approved Ambassador can win: never one suspended, declined or removed. */
async function approvedStandings(ctx: Ctx, standings: PrizeStanding[]): Promise<PrizeStanding[]> {
  const kept: PrizeStanding[] = [];
  for (const standing of standings) {
    const agreement = await ctx.repository.ambassadors.findAgreement(
      standing.ambassadorKind as ReferralKind,
      standing.ambassadorId,
    );
    if (agreement && ambassadorApproved(agreement.status)) kept.push(standing);
  }
  return kept;
}

/**
 * Decides one month, once: who won, whether the bar was met, and the net; and credits the prize
 * to the winner, under the hold, only when the bar was met. A month already decided, or outside
 * the months the prize runs, changes nothing. Gives the decision kept.
 */
export async function decideMonth(
  ctx: Ctx,
  month: string,
  log?: FastifyBaseLogger,
): Promise<AmbassadorPrize | null> {
  const settings = ctx.config.ambassador;
  if (!prizeMonthRuns(month, settings)) return null;
  const already = await ctx.repository.ambassadorPrizes.findByMonth(month);
  if (already) return already;
  const takings = await monthTakings(ctx, month);
  const decision = decideMonthlyPrize(await approvedStandings(ctx, takings.standings), settings);
  const barMet = prizeBarMet(takings.netPence, settings);
  const at = ctx.now();
  const kept = await ctx.repository.ambassadorPrizes.decide({
    month,
    winnerKind: (decision.winner?.ambassadorKind as ReferralKind | undefined) ?? null,
    winnerId: decision.winner?.ambassadorId ?? null,
    qualifyingBusinesses: decision.qualifyingBusinesses,
    barMet,
    netPence: takings.netPence,
    decidedAt: at,
  });
  // Decided meanwhile by another run: that decision stands.
  if (!kept) return ctx.repository.ambassadorPrizes.findByMonth(month);
  if (kept.barMet && kept.winnerKind && kept.winnerId) {
    const entry = await ctx.repository.ambassadors.add({
      ambassadorKind: kept.winnerKind,
      ambassadorId: kept.winnerId,
      kind: 'prize',
      partnerShopId: null,
      orderId: null,
      profitPence: kept.netPence,
      amountPence: settings.monthlyPrizePence,
      availableAt: ambassadorAvailableAt(at, settings),
      reference: `prize:${month}`,
      recordedBy: null,
      at,
    });
    if (entry) {
      log?.info(
        { month, winner: `${kept.winnerKind}:${kept.winnerId}`, amountPence: entry.amountPence },
        'Top Ambassador of the month',
      );
    }
  }
  return kept;
}

/**
 * Every hour: every month the prize ran that is over and not yet decided is decided, oldest
 * first, and every Ambassador's first-business bonus is credited if it is due. Running it again
 * changes nothing. Never throws.
 */
export async function sweepAmbassadorPrizes(
  ctx: Ctx,
  log?: FastifyBaseLogger,
): Promise<{ decided: number; bonuses: number }> {
  const report = { decided: 0, bonuses: 0 };
  try {
    const settings = ctx.config.ambassador;
    const current = ukMonthKey(ctx.now());
    for (
      let month = settings.monthlyPrizeFromMonth;
      month < current && month <= settings.monthlyPrizeUntilMonth;
      month = monthAfter(month)
    ) {
      if (await ctx.repository.ambassadorPrizes.findByMonth(month)) continue;
      if (await decideMonth(ctx, month, log)) report.decided += 1;
    }
    for (const agreement of await ctx.repository.ambassadors.listAgreements()) {
      if (await settleFirstBusinessBonus(ctx, agreement.accountKind, agreement.accountId, log)) {
        report.bonuses += 1;
      }
    }
  } catch (failure) {
    log?.warn({ err: failure }, 'The Ambassador prize sweep could not finish');
  }
  return report;
}

/* ------------------------------------------------------------------ the first-business bonus */

export interface FirstBusinessState {
  /** Their first confirmed business, or null. */
  shop: PartnerShop | null;
  /** Its paid, non-refunded orders so far. */
  paidOrders: number;
  /** The order that made the bonus due, when it is. */
  dueAt: Date | null;
  /** Already credited. */
  credited: AmbassadorEntry | null;
}

function bonusReference(kind: ReferralKind, id: string): string {
  return `first-business-bonus:${kind}:${id}`;
}

/** Their first confirmed business and how many paid orders it has completed. */
export async function firstBusinessState(
  ctx: Ctx,
  kind: ReferralKind,
  id: string,
): Promise<FirstBusinessState> {
  const credited = await ctx.repository.ambassadors.findByReference(bonusReference(kind, id));
  const shop =
    [...(await broughtInShops(ctx)).values()]
      .filter((one) => one.ambassadorKind === kind && one.ambassadorId === id)
      .sort((a, b) => a.ambassadorConfirmedAt!.getTime() - b.ambassadorConfirmedAt!.getTime())[0] ??
    null;
  if (!shop) return { shop: null, paidOrders: 0, dueAt: null, credited };
  const needed = ctx.config.ambassador.firstBusinessBonusAfterOrders;
  let paid = 0;
  let dueAt: Date | null = null;
  for (const order of await paidOrders(ctx)) {
    if (!(await profitByShop(ctx, order)).has(shop.id)) continue;
    paid += 1;
    if (paid === needed) dueAt = order.deliveredAt;
  }
  return { shop, paidOrders: paid, dueAt, credited };
}

/**
 * Credits the one-off first-business bonus once their first confirmed business has completed
 * its orders: once in their life, held from the delivery that made it due. Nothing for somebody
 * removed. Gives the entry made, or null.
 */
export async function settleFirstBusinessBonus(
  ctx: Ctx,
  kind: ReferralKind,
  id: string,
  log?: FastifyBaseLogger,
): Promise<AmbassadorEntry | null> {
  try {
    const settings = ctx.config.ambassador;
    if (settings.firstBusinessBonusPence <= 0) return null;
    const agreement = await ctx.repository.ambassadors.findAgreement(kind, id);
    if (!agreement || agreement.status === 'removed') return null;
    const state = await firstBusinessState(ctx, kind, id);
    if (state.credited || !state.shop || !state.dueAt) return null;
    if (!firstBusinessBonusDue(state.paidOrders, settings)) return null;
    return await ctx.repository.ambassadors.add({
      ambassadorKind: kind,
      ambassadorId: id,
      kind: 'first-business-bonus',
      partnerShopId: state.shop.id,
      orderId: null,
      profitPence: 0,
      amountPence: settings.firstBusinessBonusPence,
      availableAt: ambassadorAvailableAt(state.dueAt, settings),
      reference: bonusReference(kind, id),
      recordedBy: null,
      at: state.dueAt,
    });
  } catch (failure) {
    log?.warn({ err: failure, kind, id }, 'A first-business bonus could not be checked');
    return null;
  }
}

/* ------------------------------------------------------------------ what each Ambassador sees */

export interface PrizePanel {
  /** Whether the prize runs this month. */
  runs: boolean;
  /** "You have 1 confirmed, ordering business this month." */
  standingWords: string;
  /** "The £25 prize is on this month." or "Not enough orders yet this month for the prize." */
  barWords: string;
  /** Last month's winner by first name, or why there was no prize. */
  lastMonthWords: string;
  /** "Your first business has completed 2 of 4 orders. At 4, you earn a £10 one-off bonus." */
  firstBusinessWords: string;
}

/**
 * The "Top Ambassador" panel: this Ambassador's own standing this month, whether the bar is met
 * so far, last month's winner by first name, and their first-business bonus. Never another
 * Ambassador's count, and never a company figure beyond met or not met.
 */
export async function prizePanel(ctx: Ctx, kind: ReferralKind, id: string): Promise<PrizePanel> {
  const settings = ctx.config.ambassador;
  const symbol = ctx.config.store.currencySymbol;
  const month = ukMonthKey(ctx.now());
  const runs = prizeMonthRuns(month, settings);
  let standingWords = `The Top Ambassador prize runs from ${monthWords(settings.monthlyPrizeFromMonth)} to ${monthWords(settings.monthlyPrizeUntilMonth)}.`;
  let barWords = '';
  if (runs) {
    const takings = await monthTakings(ctx, month);
    const mine = takings.standings.find(
      (standing) => standing.ambassadorKind === kind && standing.ambassadorId === id,
    );
    standingWords = prizeStandingWords(mine?.confirmedAt.length ?? 0);
    barWords = prizeBarWords(prizeBarMet(takings.netPence, settings), settings, symbol);
  }
  const last = monthBefore(month);
  let lastMonthWords = `The Top Ambassador prize began in ${monthWords(settings.monthlyPrizeFromMonth)}.`;
  if (prizeMonthRuns(last, settings)) {
    const decision = await ctx.repository.ambassadorPrizes.findByMonth(last);
    const winner =
      decision?.winnerKind && decision.winnerId
        ? await findAccount(ctx, decision.winnerKind, decision.winnerId)
        : null;
    lastMonthWords = lastMonthPrizeWords(
      decision
        ? { winnerFirstName: winner ? firstNameOf(winner.name) : null, barMet: decision.barMet }
        : null,
      settings,
      symbol,
    );
  }
  const first = await firstBusinessState(ctx, kind, id);
  return {
    runs,
    standingWords,
    barWords,
    lastMonthWords,
    firstBusinessWords: firstBusinessBonusWords(
      {
        hasBusiness: first.shop !== null,
        paidOrders: first.paidOrders,
        credited: first.credited !== null,
      },
      settings,
      symbol,
    ),
  };
}

/* ------------------------------------------------------------------ what the owner sees */

export interface PrizeLogRow {
  month: string;
  monthWords: string;
  winnerName: string | null;
  qualifyingBusinesses: number;
  barMet: boolean;
  netPence: number;
  netWords: string;
  prizePence: number;
  decidedAt: Date;
}

export interface FirstBusinessBonusRow {
  ambassadorName: string;
  business: string;
  amountPence: number;
  amountWords: string;
  at: Date;
}

/** Every month's decision, newest first, with the winner's name, for the owner. */
export async function prizeLog(ctx: Ctx): Promise<PrizeLogRow[]> {
  const symbol = ctx.config.store.currencySymbol;
  const rows: PrizeLogRow[] = [];
  for (const prize of await ctx.repository.ambassadorPrizes.list()) {
    const winner =
      prize.winnerKind && prize.winnerId
        ? await findAccount(ctx, prize.winnerKind, prize.winnerId)
        : null;
    rows.push({
      month: prize.month,
      monthWords: monthWords(prize.month),
      winnerName: winner?.name ?? null,
      qualifyingBusinesses: prize.qualifyingBusinesses,
      barMet: prize.barMet,
      netPence: prize.netPence,
      netWords: formatPence(prize.netPence, symbol),
      prizePence: prize.barMet && winner ? ctx.config.ambassador.monthlyPrizePence : 0,
      decidedAt: prize.decidedAt,
    });
  }
  return rows;
}

/** Every first-business bonus credited, newest first, for the owner. */
export async function firstBusinessBonusLog(ctx: Ctx): Promise<FirstBusinessBonusRow[]> {
  const symbol = ctx.config.store.currencySymbol;
  const rows: FirstBusinessBonusRow[] = [];
  for (const entry of await ctx.repository.ambassadors.list()) {
    if (entry.kind !== 'first-business-bonus') continue;
    const account = await findAccount(ctx, entry.ambassadorKind, entry.ambassadorId);
    const shop = entry.partnerShopId
      ? await ctx.repository.partnerShops.findById(entry.partnerShopId)
      : null;
    rows.push({
      ambassadorName: account?.name ?? 'An Ambassador',
      business: shop?.name ?? 'a business',
      amountPence: entry.amountPence,
      amountWords: formatPence(entry.amountPence, symbol),
      at: entry.at,
    });
  }
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * The owner's Ozi tool `ambassador_prizes` (read-only): every month's decision in spoken terms,
 * and the first-business bonuses credited. "Who won the Ambassador prize last month?"
 */
export async function ambassadorPrizesForVoice(ctx: Ctx) {
  const settings = ctx.config.ambassador;
  const symbol = ctx.config.store.currencySymbol;
  const prizes = (await prizeLog(ctx)).map((row) => ({
    month: row.monthWords,
    winner: row.winnerName,
    qualifyingBusinesses: row.qualifyingBusinesses,
    barMet: row.barMet,
    netIncome: row.netWords,
    prizePaid: row.prizePence > 0 ? rewardWords(row.prizePence, symbol) : 'nothing',
    outcome: !row.barMet
      ? 'No prize: the month was below the bar, so not enough came in from Ambassadors’ businesses.'
      : row.winnerName
        ? `${row.winnerName} won ${rewardWords(settings.monthlyPrizePence, symbol)}.`
        : 'No prize: nobody brought in enough confirmed, ordering businesses.',
  }));
  const bonuses = (await firstBusinessBonusLog(ctx)).map((row) => ({
    ambassador: row.ambassadorName,
    business: row.business,
    amount: row.amountWords,
    when: row.at.toLocaleDateString('en-GB', {
      timeZone: 'Europe/London',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  }));
  return {
    rules: `The Top Ambassador of the month wins ${rewardWords(settings.monthlyPrizePence, symbol)} for the most confirmed, ordering businesses in the month, at least ${settings.monthlyPrizeMinimumBusinesses}, paid only when the month's net income from Ambassador-brought businesses is at least ${rewardWords(settings.monthlyPrizeBarPence, symbol)}; it runs from ${monthWords(settings.monthlyPrizeFromMonth)} to ${monthWords(settings.monthlyPrizeUntilMonth)}. The first-business bonus is ${rewardWords(settings.firstBusinessBonusPence, symbol)} once, after an Ambassador's first confirmed business completes ${settings.firstBusinessBonusAfterOrders} paid orders.`,
    lastMonth: monthWords(monthBefore(ukMonthKey(ctx.now()))),
    prizes,
    firstBusinessBonuses: bonuses,
    ...(prizes.length === 0 ? { note: 'No month has been decided yet.' } : {}),
  };
}
