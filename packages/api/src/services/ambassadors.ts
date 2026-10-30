/**
 * Ozi Ambassadors (Anthony, 30 October 2026; rules changed the same day). Anybody, a Shopper, a
 * Runner, a shop partner or an organisation, can choose to become an Ozi Ambassador: they press
 * "Become an Ozi Ambassador" and agree to the Ambassador terms at /ambassador/terms, and the
 * moment and the version are kept (`becomeAmbassador`). Only then do they have an Ambassador
 * link. It lands on `/business/join` and ties the new shop partner to them (`ambassadorKind` and
 * `ambassadorId` on the shop). A shop owner cannot be the Ambassador of their own shop: the tie
 * is refused when the shop's phone or email is the Ambassador's. There is no limit on how many
 * businesses an Ambassador introduces.
 *
 * What an Ambassador earns, every figure in `ambassador` in config/store.json:
 *
 * - 2% (`profitShare`, ruled at 2%) of Ozi's profit on every order from that business, for 12
 *   months from when it was approved. Ozi's profit is the item charges on a shop's order (the
 *   item charges on that shop's things in it), or the commission on a café's or restaurant's
 *   (10% of the goods, the commission routes/business.ts shows the café, matched by its
 *   partnerShopId). Never the delivery fee. Only approved businesses with real orders earn.
 * - Each branch (each listing) is its own venture. The branch the Ambassador introduced earns the
 *   full share; another branch of the same business that joined through the same Ambassador's
 *   link earns `branchShareFactor` (a quarter, ruled 30 October 2026; it was half) of it; a
 *   branch that joined without their link earns them nothing. Staff mark a listing "a branch of"
 *   another in the admin panel (`branchOfShopId`).
 * - A one-off 5% (`planShare`) of the business's first Partner Plus payment, once that payment is
 *   confirmed (the free month is not a payment).
 *
 * Tamper-proof money (ruled 30 October 2026):
 *
 * - Every share comes from a real recorded order, read again from the database when it is
 *   delivered (`creditAmbassadorShares`), and is worked out from the order's final state: what
 *   the Runner really bought at the till, less anything cancelled or refunded
 *   (`shareWorth`). Never from an estimate the browser sent.
 * - A share is PENDING until `holdDays` (30) after the order was delivered, and follows the order
 *   while it waits: a refund or cancel makes it smaller or nothing. Then it is AVAILABLE.
 * - A refund that comes after a share became available (a late complaint, a card chargeback) is
 *   a DEDUCTION line, taken off what is available next, never below zero.
 * - Only what is available can be paid, by staff's "Mark paid" or by a withdrawal.
 *
 * Withdrawals (ruled 30 October 2026): an Ambassador with at least £10 available asks for it to
 * go to their bank. They set up their bank details on Stripe's own form, through a Stripe account
 * of their own made as the Runners' are (routes/payouts.ts), so the details never pass through
 * the service; a Runner who is an Ambassador uses the payout account they already have. The money
 * goes by a Stripe transfer to that account, and Stripe pays it into their bank. A withdrawal that
 * would take this calendar month's withdrawals over `reviewAbovePence` (£500), or from somebody
 * staff have flagged, waits for staff to approve it.
 *
 * When an Ambassador's earnings in a calendar month pass `reviewAbovePence` (£500), the owner is
 * told once that month on Ozi's desk, to check before paying. The Ambassador sees their
 * businesses (name, and whether approved), what is pending, available and paid, and any
 * deductions, never a shop's orders.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  AMBASSADOR_TERMS_VERSION,
  ambassadorAvailableAt,
  ambassadorEarningAfterRefunds,
  ambassadorNeedsReview,
  ambassadorPayable,
  ambassadorPlanSharePence,
  ambassadorShareEnds,
  ambassadorSharePence,
  commissionPence,
  formatPence,
  itemChargePence,
  rewardWords,
  withinAmbassadorMonths,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  AmbassadorAgreement,
  AmbassadorEntry,
  AmbassadorWithdrawal,
  Order,
  PartnerShop,
  ReferralKind,
} from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { askOwner } from './owner-desk.js';
import {
  findAccount,
  KIND_WORDS,
  resolveVia,
  samePerson,
  shopAsAccount,
  type ReferralAccount,
  type ReferralContext,
} from './referrals.js';

type MoneyContext = Pick<AppContext, 'repository' | 'config' | 'now'>;

/** The kind:code in an Ambassador's link, the same codes as their referral link. */
export function ambassadorLink(origin: string, account: Pick<ReferralAccount, 'kind' | 'code'>) {
  return `${origin}/business/join?ambassador=${account.kind}-${encodeURIComponent(account.code)}`;
}

/**
 * Whether this would-be Ambassador is the shop's own owner: the same shop, phone number or email.
 */
export function ownBusiness(
  ambassador: Pick<ReferralAccount, 'kind' | 'id' | 'phones' | 'emails'>,
  shop: PartnerShop,
): boolean {
  return samePerson(ambassador, shopAsAccount(shop));
}

/** Whether this person has chosen to become an Ambassador, and when they agreed. */
export async function ambassadorAgreement(
  ctx: Pick<AppContext, 'repository'>,
  kind: ReferralKind,
  id: string,
): Promise<AmbassadorAgreement | null> {
  return ctx.repository.ambassadors.findAgreement(kind, id);
}

/**
 * They choose to become an Ozi Ambassador, agreeing to the Ambassador terms of this version:
 * the moment and the version are kept. Agreeing again changes nothing.
 */
export async function becomeAmbassador(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  kind: ReferralKind,
  id: string,
  version: string,
): Promise<AmbassadorAgreement> {
  if (version !== AMBASSADOR_TERMS_VERSION) {
    throw new BadRequestError(
      'The Ambassador terms have changed. Please read them again, then agree.',
    );
  }
  return ctx.repository.ambassadors.agree({
    accountKind: kind,
    accountId: id,
    agreedAt: ctx.now(),
    termsVersion: version,
  });
}

/**
 * Ties a new shop partner to the Ambassador whose link it came by, if they have agreed to the
 * Ambassador terms. Refused, and nothing tied, for the shop's own owner. Says what happened, for
 * the welcome message.
 */
export async function tieAmbassador(
  ctx: ReferralContext,
  shop: PartnerShop,
  via: string | null | undefined,
): Promise<{ tied: boolean; words: string }> {
  if (!via) return { tied: false, words: '' };
  const ambassador = await resolveVia(ctx, via);
  if (!ambassador || ambassador.closed) return { tied: false, words: '' };
  if (!(await ambassadorAgreement(ctx, ambassador.kind, ambassador.id))) {
    return { tied: false, words: '' };
  }
  if (ownBusiness(ambassador, shop)) {
    return {
      tied: false,
      words:
        ' The Ambassador introduction was not recorded: a business owner cannot be the Ambassador of their own business.',
    };
  }
  await ctx.repository.partnerShops.update(shop.id, {
    ambassadorKind: ambassador.kind,
    ambassadorId: ambassador.id,
  });
  return { tied: true, words: ` You were introduced by ${ambassador.name}, an Ozi Ambassador.` };
}

/* ------------------------------------------------------------------ earning */

/**
 * Ozi's profit on one order from each Shop Partner in it, from the order's final state: the item
 * charges on that shop's things as the Shopper was charged them, or a café's or restaurant's
 * commission on what the Runner really paid for them at the till (`actualPricePence`, the
 * estimate only where no till price was given). Never the delivery fee. Things the Runner could
 * not get are left out.
 */
export async function profitByShop(
  ctx: Pick<AppContext, 'repository' | 'config'>,
  order: Order,
): Promise<Map<string, { shop: PartnerShop; profitPence: number }>> {
  const { repository, config } = ctx;
  const items = order.items.filter((item) => item.substitutionOutcome !== 'unavailable');
  const catalogue = await repository.catalogue.findManyByIds(
    items.map((item) => item.catalogueItemId ?? '').filter(Boolean),
  );
  const shopOf = new Map<string, string>();
  for (const entry of catalogue) {
    if (!entry.externalRef?.startsWith('partner:')) continue;
    const product = await repository.partnerProducts.findById(entry.externalRef.slice(8));
    if (product) shopOf.set(entry.id, product.partnerShopId);
  }
  const lines = new Map<string, { goods: number; charges: number }>();
  for (const item of items) {
    const shopId = shopOf.get(item.catalogueItemId ?? '');
    if (!shopId) continue;
    // As the receipt has it: the shop price paid, and the item charge on the price shown.
    const line = lines.get(shopId) ?? { goods: 0, charges: 0 };
    line.goods += (item.actualPricePence ?? item.estimatedPricePence) * item.quantity;
    line.charges += itemChargePence(item.estimatedPricePence, config.fees) * item.quantity;
    lines.set(shopId, line);
  }
  const result = new Map<string, { shop: PartnerShop; profitPence: number }>();
  for (const [shopId, line] of lines) {
    const shop = await repository.partnerShops.findById(shopId);
    if (!shop) continue;
    const profitPence =
      shop.kind === 'food'
        ? commissionPence(line.goods, config.extras.partners.foodCommissionBasisPoints)
        : line.charges;
    result.set(shopId, { shop, profitPence });
  }
  return result;
}

const EARNS = new Set(['delivered', 'completed']);

/**
 * What the Shopper finally paid for the order, and what has been given back since: complaint
 * refunds and goodwill refunds. A cancelled or refunded order is given back whole.
 */
async function paidAndRefunded(
  ctx: Pick<AppContext, 'repository'>,
  order: Order,
): Promise<{ paidPence: number; refundedPence: number }> {
  const paidPence = order.finalTotalPence ?? order.totalEstimatePence;
  if (!EARNS.has(order.status)) return { paidPence, refundedPence: paidPence };
  const problems = await ctx.repository.problems.listForOrder(order.id);
  const refundedPence =
    order.goodwillRefundedPence + problems.reduce((sum, report) => sum + report.refundPence, 0);
  return { paidPence, refundedPence };
}

/**
 * What one shop's share on one order is worth now, from the order as it finally stands: nothing
 * once it is cancelled, refunded or disputed, less for a part refund.
 */
async function shareWorth(
  ctx: MoneyContext,
  order: Order,
  shop: PartnerShop,
  profitPence: number,
  disputed: boolean,
): Promise<number> {
  if (disputed) return 0;
  const share = ambassadorSharePence(
    profitPence,
    ctx.config.ambassador,
    await branchRate(ctx, shop),
  );
  const { paidPence, refundedPence } = await paidAndRefunded(ctx, order);
  return ambassadorEarningAfterRefunds(share, paidPence, refundedPence);
}

/** "2026-10": the calendar month an entry counts in. */
function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/**
 * Whether this shop earns its Ambassador the full share, or a quarter as another branch of a
 * business they introduced: a listing marked a branch of another listing tied to the same
 * Ambassador.
 */
export async function branchRate(
  ctx: Pick<AppContext, 'repository'>,
  shop: PartnerShop,
): Promise<'introduced' | 'other_branch'> {
  if (!shop.branchOfShopId || shop.branchOfShopId === shop.id) return 'introduced';
  const main = await ctx.repository.partnerShops.findById(shop.branchOfShopId);
  return main &&
    main.ambassadorKind === shop.ambassadorKind &&
    main.ambassadorId === shop.ambassadorId
    ? 'other_branch'
    : 'introduced';
}

/**
 * An Ambassador's earnings this calendar month passed the review figure: the owner is told once
 * that month, to check before paying.
 */
async function reviewIfHigh(
  ctx: MoneyContext,
  kind: ReferralKind,
  id: string,
  at: Date,
  log?: FastifyBaseLogger,
): Promise<void> {
  const month = monthKey(at);
  const monthPence = (await ctx.repository.ambassadors.listFor(kind, id))
    .filter((entry) => earning(entry) && monthKey(entry.at) === month)
    .reduce((sum, entry) => sum + entry.amountPence, 0);
  if (!ambassadorNeedsReview(monthPence, ctx.config.ambassador)) return;
  const account = await findAccount(ctx, kind, id);
  const figure = rewardWords(
    ctx.config.ambassador.reviewAbovePence,
    ctx.config.store.currencySymbol,
  );
  await askOwner(
    ctx,
    {
      kind: 'ambassador_review',
      subjectId: `${kind}:${id}:${month}`,
      summary: `${account?.name ?? 'An Ambassador'}'s Ambassador earnings are over ${figure} this month. Please check before paying.`,
      options: 'acknowledge',
    },
    log,
  );
}

function earning(entry: AmbassadorEntry): boolean {
  return entry.kind === 'share' || entry.kind === 'bonus';
}

/**
 * An order delivered: each Ambassador of an approved shop in it earns their share of Ozi's profit,
 * if the order is within 12 months of that shop's approval: the full share for the branch they
 * introduced, a quarter for another branch of it. The order is read again from the database, so
 * only a real, delivered order earns. Pending for `holdDays`. Once per order and shop. Never
 * throws.
 */
export async function creditAmbassadorShares(
  ctx: MoneyContext,
  delivered: Pick<Order, 'id'>,
  log?: FastifyBaseLogger,
): Promise<AmbassadorEntry[]> {
  const made: AmbassadorEntry[] = [];
  try {
    const order = await ctx.repository.orders.findById(delivered.id);
    if (!order || !EARNS.has(order.status) || !order.deliveredAt) return made;
    const at = order.deliveredAt;
    for (const { shop, profitPence } of (await profitByShop(ctx, order)).values()) {
      if (!shop.ambassadorKind || !shop.ambassadorId) continue;
      if (shop.status !== 'approved') continue;
      if (!withinAmbassadorMonths(shop.approvedAt, at, ctx.config.ambassador)) continue;
      const amountPence = await shareWorth(ctx, order, shop, profitPence, false);
      if (amountPence <= 0) continue;
      const entry = await ctx.repository.ambassadors.add({
        ambassadorKind: shop.ambassadorKind,
        ambassadorId: shop.ambassadorId,
        kind: 'share',
        partnerShopId: shop.id,
        orderId: order.id,
        profitPence,
        amountPence,
        availableAt: ambassadorAvailableAt(at, ctx.config.ambassador),
        reference: `share:${order.id}:${shop.id}`,
        recordedBy: null,
        at,
      });
      if (!entry) continue;
      made.push(entry);
      await reviewIfHigh(ctx, entry.ambassadorKind, entry.ambassadorId, at, log);
    }
  } catch (failure) {
    log?.warn({ orderId: delivered.id, err: failure }, 'An Ambassador share could not be recorded');
  }
  return made;
}

/**
 * Brings every share on one order up to date with the order's final state. A pending share
 * simply follows it. An available share keeps its worth, and anything given back since is a
 * deduction line, made once and only ever made larger, taken off what is available next.
 */
export async function reconcileOrder(ctx: MoneyContext, orderId: string): Promise<void> {
  const entries = await ctx.repository.ambassadors.listForOrder(orderId);
  const shares = entries.filter((entry) => entry.kind === 'share');
  if (shares.length === 0) return;
  const order = await ctx.repository.orders.findById(orderId);
  const now = ctx.now().getTime();
  const profits = order ? await profitByShop(ctx, order) : new Map();
  for (const share of shares) {
    const found = share.partnerShopId ? profits.get(share.partnerShopId) : undefined;
    const worth =
      order && found
        ? await shareWorth(ctx, order, found.shop, share.profitPence, share.disputedAt !== null)
        : 0;
    const pending = share.availableAt !== null && share.availableAt.getTime() > now;
    if (pending) {
      if (worth < share.amountPence) {
        await ctx.repository.ambassadors.updateEntry(share.id, { amountPence: worth });
      }
      continue;
    }
    const owed = Math.max(0, share.amountPence - worth);
    if (owed === 0) continue;
    const reference = `deduction:${share.id}`;
    const earlier = entries.find((entry) => entry.reference === reference);
    if (!earlier) {
      await ctx.repository.ambassadors.add({
        ambassadorKind: share.ambassadorKind,
        ambassadorId: share.ambassadorId,
        kind: 'deduction',
        partnerShopId: share.partnerShopId,
        orderId,
        profitPence: 0,
        amountPence: owed,
        reference,
        recordedBy: null,
        at: ctx.now(),
      });
    } else if (owed > earlier.amountPence) {
      await ctx.repository.ambassadors.updateEntry(earlier.id, { amountPence: owed });
    }
  }
}

/** Every order an Ambassador has a share on, brought up to date. */
export async function reconcileAmbassador(
  ctx: MoneyContext,
  kind: ReferralKind,
  id: string,
): Promise<void> {
  const orders = new Set(
    (await ctx.repository.ambassadors.listFor(kind, id))
      .filter((entry) => entry.kind === 'share' && entry.orderId)
      .map((entry) => entry.orderId!),
  );
  for (const orderId of orders) await reconcileOrder(ctx, orderId);
}

/**
 * A card chargeback (Stripe's `charge.dispute.created`) on a Shopper's payment: every share on the
 * orders it paid for is worth nothing, and a share already available becomes a deduction. Gives
 * how many shares it touched.
 */
export async function ambassadorChargeback(
  ctx: MoneyContext,
  paymentIntentId: string,
): Promise<number> {
  let touched = 0;
  const orders = new Map<string, Order | null>();
  for (const entry of await ctx.repository.ambassadors.list()) {
    if (entry.kind !== 'share' || !entry.orderId || entry.disputedAt) continue;
    if (!orders.has(entry.orderId)) {
      orders.set(entry.orderId, await ctx.repository.orders.findById(entry.orderId));
    }
    if (orders.get(entry.orderId)?.stripePaymentIntentId !== paymentIntentId) continue;
    await ctx.repository.ambassadors.updateEntry(entry.id, { disputedAt: ctx.now() });
    touched += 1;
  }
  for (const [orderId, order] of orders) {
    if (order?.stripePaymentIntentId === paymentIntentId) await reconcileOrder(ctx, orderId);
  }
  return touched;
}

/**
 * The one-off share of each introduced business's first Partner Plus payment, once that payment
 * is confirmed (a Partner Plus payment of more than nothing: the free month does not count).
 * Pending for `holdDays` from the payment, as a share is from a delivery.
 */
export async function settlePlusBonuses(
  ctx: MoneyContext,
  shops: readonly PartnerShop[],
  log?: FastifyBaseLogger,
): Promise<void> {
  for (const shop of shops) {
    if (!shop.ambassadorKind || !shop.ambassadorId) continue;
    const first = (await ctx.repository.partnerPayments.listForShop(shop.id))
      .filter((payment) => payment.kind === 'plan' && payment.amountPence > 0)
      .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())[0];
    if (!first) continue;
    const amountPence = ambassadorPlanSharePence(first.amountPence, ctx.config.ambassador);
    if (amountPence <= 0) continue;
    const entry = await ctx.repository.ambassadors.add({
      ambassadorKind: shop.ambassadorKind,
      ambassadorId: shop.ambassadorId,
      kind: 'bonus',
      partnerShopId: shop.id,
      orderId: null,
      profitPence: first.amountPence,
      amountPence,
      availableAt: ambassadorAvailableAt(first.paidAt, ctx.config.ambassador),
      reference: `bonus:${shop.id}`,
      recordedBy: null,
      at: first.paidAt,
    });
    if (entry) await reviewIfHigh(ctx, entry.ambassadorKind, entry.ambassadorId, entry.at, log);
  }
}

/* ------------------------------------------------------------------ what is owed */

export interface DeductionLine {
  at: Date;
  amountPence: number;
  /** "A refund on an order from Corner Shop, taken off." */
  words: string;
}

export interface AmbassadorSummary {
  businesses: Array<{
    id: string;
    name: string;
    approved: boolean;
    /** Another branch of a business they introduced: a quarter of the share. */
    branch: boolean;
    /** When the 12 months of shares end, once approved. */
    shareEnds: Date | null;
    earnedPence: number;
  }>;
  /** Every share and bonus, pending or not, after refunds. */
  earnedPence: number;
  earnedThisMonthPence: number;
  /** Waiting for the refund window to pass. */
  pendingPence: number;
  /** Can be paid now: available earnings, less deductions, payments and withdrawals waiting. */
  availablePence: number;
  paidPence: number;
  deductionsPence: number;
  deductions: DeductionLine[];
  /** Asked for, waiting for staff to approve. */
  withdrawingPence: number;
  /**
   * Deductions not yet covered by later earnings: taken off what becomes available next. Zero
   * almost always.
   */
  shortfallPence: number;
  /** At least the minimum is available: it can be paid or withdrawn. */
  payable: boolean;
}

/**
 * What one Ambassador has earned, has pending, has available, has been paid and has had taken
 * off, with their businesses. Brought up to date with every order first.
 */
export async function ambassadorSummary(
  ctx: MoneyContext,
  kind: ReferralKind,
  id: string,
): Promise<AmbassadorSummary> {
  const shops = (await ctx.repository.partnerShops.list()).filter(
    (shop) => shop.ambassadorKind === kind && shop.ambassadorId === id,
  );
  await settlePlusBonuses(ctx, shops);
  await reconcileAmbassador(ctx, kind, id);
  const branches = new Set<string>();
  for (const shop of shops) {
    if ((await branchRate(ctx, shop)) === 'other_branch') branches.add(shop.id);
  }
  const names = new Map(
    (await ctx.repository.partnerShops.list()).map((shop) => [shop.id, shop.name]),
  );
  const entries = await ctx.repository.ambassadors.listFor(kind, id);
  const at = ctx.now();
  const sum = (rows: AmbassadorEntry[]) => rows.reduce((total, row) => total + row.amountPence, 0);
  const earnings = entries.filter(earning);
  const isPending = (entry: AmbassadorEntry) =>
    entry.availableAt !== null && entry.availableAt.getTime() > at.getTime();
  const deductions = entries.filter((entry) => entry.kind === 'deduction');
  const paidPence = sum(entries.filter((entry) => entry.kind === 'payment'));
  const withdrawingPence = (await ctx.repository.ambassadors.listWithdrawalsFor(kind, id))
    .filter((withdrawal) => withdrawal.status === 'waiting_approval')
    .reduce((total, withdrawal) => total + withdrawal.amountPence, 0);
  // Never below zero: a deduction bigger than what is available waits for the next earnings.
  const netPence =
    sum(earnings.filter((entry) => !isPending(entry))) -
    sum(deductions) -
    paidPence -
    withdrawingPence;
  const availablePence = Math.max(0, netPence);
  const month = monthKey(at);
  const symbol = ctx.config.store.currencySymbol;
  return {
    businesses: shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      approved: shop.status === 'approved',
      branch: branches.has(shop.id),
      shareEnds: shop.approvedAt
        ? ambassadorShareEnds(shop.approvedAt, ctx.config.ambassador)
        : null,
      earnedPence: sum(earnings.filter((entry) => entry.partnerShopId === shop.id)),
    })),
    earnedPence: sum(earnings),
    earnedThisMonthPence: sum(earnings.filter((entry) => monthKey(entry.at) === month)),
    pendingPence: sum(earnings.filter(isPending)),
    availablePence,
    paidPence,
    deductionsPence: sum(deductions),
    deductions: deductions.map((entry) => ({
      at: entry.at,
      amountPence: entry.amountPence,
      words: `A refund on an order from ${names.get(entry.partnerShopId ?? '') ?? 'a business'} came after your share was available: ${formatPence(entry.amountPence, symbol)} taken off.`,
    })),
    withdrawingPence,
    shortfallPence: Math.max(0, -netPence),
    payable: ambassadorPayable(availablePence, ctx.config.ambassador),
  };
}

/** Every Ambassador, for staff: whoever has introduced a business, the most available first. */
export async function ambassadorLog(ctx: ReferralContext, search = '') {
  const keys = new Map<string, { kind: ReferralKind; id: string }>();
  for (const shop of await ctx.repository.partnerShops.list()) {
    if (shop.ambassadorKind && shop.ambassadorId) {
      keys.set(`${shop.ambassadorKind}:${shop.ambassadorId}`, {
        kind: shop.ambassadorKind,
        id: shop.ambassadorId,
      });
    }
  }
  const wanted = search.trim().toLowerCase();
  const rows = [];
  for (const { kind, id } of keys.values()) {
    const account = await findAccount(ctx, kind, id);
    if (!account) continue;
    if (
      wanted !== '' &&
      ![account.name, KIND_WORDS[kind], account.area].some((text) =>
        text.toLowerCase().includes(wanted),
      )
    ) {
      continue;
    }
    const agreement = await ambassadorAgreement(ctx, kind, id);
    const withdrawals = await ctx.repository.ambassadors.listWithdrawalsFor(kind, id);
    rows.push({
      kind,
      id,
      name: account.name,
      kindWords: KIND_WORDS[kind],
      area: account.area,
      flagged: Boolean(agreement?.flaggedAt),
      flagReason: agreement?.flagReason ?? null,
      waitingWithdrawals: withdrawals
        .filter((withdrawal) => withdrawal.status === 'waiting_approval')
        .map((withdrawal) => ({
          id: withdrawal.id,
          amountPence: withdrawal.amountPence,
          requestedAt: withdrawal.requestedAt,
          waitingReason: withdrawal.waitingReason,
        })),
      ...(await ambassadorSummary(ctx, kind, id)),
    });
  }
  return rows.sort(
    (a, b) =>
      b.availablePence - a.availablePence ||
      b.pendingPence - a.pendingPence ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Staff paid an Ambassador by hand what is AVAILABLE to them, never what is pending: recorded
 * with who marked it, once at least the minimum is available.
 */
export async function markAmbassadorPaid(
  ctx: ReferralContext,
  kind: ReferralKind,
  id: string,
  by: string,
): Promise<{ message: string; amountPence: number }> {
  const account = await findAccount(ctx, kind, id);
  if (!account) throw new NotFoundError('Ambassador');
  const summary = await ambassadorSummary(ctx, kind, id);
  if (!summary.payable) {
    throw new ConflictError(
      `Nothing can be paid yet: they are paid once at least ${rewardWords(ctx.config.ambassador.payoutMinimumPence, ctx.config.store.currencySymbol)} is available. Earnings stay pending for ${ctx.config.ambassador.holdDays} days after each delivery.`,
    );
  }
  const at = ctx.now();
  await ctx.repository.ambassadors.add({
    ambassadorKind: kind,
    ambassadorId: id,
    kind: 'payment',
    partnerShopId: null,
    orderId: null,
    profitPence: 0,
    amountPence: summary.availablePence,
    reference: `payment:${kind}:${id}:${at.getTime()}`,
    recordedBy: by,
    at,
  });
  return {
    message: `${account.name} is marked paid ${formatPence(summary.availablePence, ctx.config.store.currencySymbol)}, by ${by}.`,
    amountPence: summary.availablePence,
  };
}

/* ------------------------------------------------------------------ withdrawals */

type PayContext = Pick<AppContext, 'repository' | 'config' | 'now' | 'payments'> &
  Partial<Pick<AppContext, 'env'>>;

async function agreed(
  ctx: Pick<AppContext, 'repository'>,
  kind: ReferralKind,
  id: string,
): Promise<AmbassadorAgreement> {
  const agreement = await ambassadorAgreement(ctx, kind, id);
  if (!agreement) {
    throw new ConflictError('Please become an Ozi Ambassador first, agreeing to the terms.');
  }
  return agreement;
}

/** Their own Stripe account for withdrawals: a Runner's payout account, or one made for this. */
async function payoutAccountOf(
  ctx: Pick<AppContext, 'repository'>,
  agreement: AmbassadorAgreement,
): Promise<string | null> {
  if (agreement.stripeConnectedAccountId) return agreement.stripeConnectedAccountId;
  if (agreement.accountKind === 'runner') {
    const runner = await ctx.repository.runners.findById(agreement.accountId);
    return runner?.stripeConnectedAccountId ?? null;
  }
  return null;
}

/** Where each kind of account comes back to after Stripe's form. */
const DASHBOARD: Record<ReferralKind, string> = {
  shopper: '/settings',
  runner: '/runner/home',
  partner: '/partner',
  organisation: '/organisation',
};

/**
 * Setting up, or carrying on setting up, where withdrawals go: a one-time link to Stripe's own
 * form, where the bank details go straight to Stripe, as the Runners' do (routes/payouts.ts).
 */
export async function ambassadorBankSetup(
  ctx: PayContext,
  kind: ReferralKind,
  id: string,
  webOrigin: string,
): Promise<{ url: string }> {
  const agreement = await agreed(ctx, kind, id);
  let accountId = await payoutAccountOf(ctx, agreement);
  if (!accountId) {
    accountId = (await ctx.payments.createConnectedAccount({ ambassador: `${kind}:${id}` })).id;
    await ctx.repository.ambassadors.updateAgreement(agreement.id, {
      stripeConnectedAccountId: accountId,
    });
  }
  const back = `${webOrigin}${DASHBOARD[kind]}`;
  return ctx.payments.createOnboardingLink({
    accountId,
    returnUrl: `${back}?bank=back`,
    refreshUrl: `${back}?bank=again`,
  });
}

/** Whether their Stripe account is ready to be paid into. Never throws. */
export async function ambassadorBankReady(
  ctx: Pick<AppContext, 'repository' | 'payments'>,
  kind: ReferralKind,
  id: string,
): Promise<boolean> {
  const agreement = await ambassadorAgreement(ctx, kind, id);
  if (!agreement) return false;
  const accountId = await payoutAccountOf(ctx, agreement);
  if (!accountId) return false;
  try {
    return (await ctx.payments.getConnectedAccount(accountId)).transfersActive;
  } catch {
    return false;
  }
}

/** What has gone to their bank this calendar month already, by withdrawal. */
async function withdrawnThisMonth(ctx: MoneyContext, kind: ReferralKind, id: string) {
  const month = monthKey(ctx.now());
  return (await ctx.repository.ambassadors.listWithdrawalsFor(kind, id))
    .filter((row) => row.status === 'sent' && monthKey(row.decidedAt ?? row.requestedAt) === month)
    .reduce((total, row) => total + row.amountPence, 0);
}

/** Sends a withdrawal by Stripe, and records the payment once it has gone. */
async function sendWithdrawal(
  ctx: PayContext,
  withdrawal: AmbassadorWithdrawal,
  accountId: string,
  by: string,
  log?: FastifyBaseLogger,
): Promise<AmbassadorWithdrawal> {
  const at = ctx.now();
  try {
    const transfer = await ctx.payments.createTransfer({
      amountPence: withdrawal.amountPence,
      currency: ctx.config.fees.currency,
      destinationAccountId: accountId,
      orderId: `ambassador-withdrawal:${withdrawal.id}`,
      description: `${ctx.config.productName} Ambassador earnings`,
      idempotencyKey: `ambassador-withdrawal:${withdrawal.id}`,
    });
    // The payment line first, while the withdrawal still holds the money back: never twice.
    await ctx.repository.ambassadors.add({
      ambassadorKind: withdrawal.ambassadorKind,
      ambassadorId: withdrawal.ambassadorId,
      kind: 'payment',
      partnerShopId: null,
      orderId: null,
      profitPence: 0,
      amountPence: withdrawal.amountPence,
      reference: `withdrawal:${withdrawal.id}`,
      recordedBy: by,
      at,
    });
    return ctx.repository.ambassadors.updateWithdrawal(withdrawal.id, {
      status: 'sent',
      decidedAt: at,
      decidedBy: by,
      stripeTransferId: transfer.id,
    });
  } catch (failure) {
    log?.warn({ err: failure, withdrawalId: withdrawal.id }, 'An Ambassador withdrawal failed');
    return ctx.repository.ambassadors.updateWithdrawal(withdrawal.id, {
      status: 'failed',
      decidedAt: at,
      decidedBy: by,
      failure: failure instanceof Error ? failure.message : 'Stripe did not take it.',
    });
  }
}

/**
 * An Ambassador asks for everything AVAILABLE to go to their bank, once it is at least the
 * minimum. Sent at once, unless it takes this month's withdrawals over the review figure or they
 * are flagged: then it waits for staff, and the money is held back for it meanwhile.
 */
export async function requestWithdrawal(
  ctx: PayContext,
  kind: ReferralKind,
  id: string,
  log?: FastifyBaseLogger,
): Promise<{ withdrawal: AmbassadorWithdrawal; message: string }> {
  const agreement = await agreed(ctx, kind, id);
  const symbol = ctx.config.store.currencySymbol;
  const rates = ctx.config.ambassador;
  const summary = await ambassadorSummary(ctx, kind, id);
  if (!summary.payable) {
    throw new ConflictError(
      `You can withdraw once at least ${rewardWords(rates.payoutMinimumPence, symbol)} is available. You have ${formatPence(summary.availablePence, symbol)} available now.`,
    );
  }
  const accountId = await payoutAccountOf(ctx, agreement);
  if (!accountId || !(await ambassadorBankReady(ctx, kind, id))) {
    throw new ConflictError('Please set up your bank details with Stripe first.');
  }
  const amountPence = summary.availablePence;
  let waitingReason: string | null = null;
  if (agreement.flaggedAt) {
    waitingReason = 'A person checks your withdrawals before they are sent.';
  } else if ((await withdrawnThisMonth(ctx, kind, id)) + amountPence > rates.reviewAbovePence) {
    waitingReason = `Withdrawals over ${rewardWords(rates.reviewAbovePence, symbol)} in a month are checked by a person first.`;
  }
  const withdrawal = await ctx.repository.ambassadors.createWithdrawal({
    ambassadorKind: kind,
    ambassadorId: id,
    amountPence,
    status: 'waiting_approval',
    waitingReason,
    requestedAt: ctx.now(),
  });
  const money = formatPence(amountPence, symbol);
  if (waitingReason) {
    const account = await findAccount(ctx, kind, id);
    await askOwner(
      ctx,
      {
        kind: 'ambassador_review',
        subjectId: `withdrawal:${withdrawal.id}`,
        summary: `${account?.name ?? 'An Ambassador'} asked to withdraw ${money} of Ambassador earnings. Please check it on the Referrals page before it is sent.`,
        options: 'acknowledge',
      },
      log,
    );
    return {
      withdrawal,
      message: `Your withdrawal of ${money} is waiting for a person to approve it. ${waitingReason}`,
    };
  }
  const sent = await sendWithdrawal(ctx, withdrawal, accountId, 'Ambassador withdrawal', log);
  if (sent.status !== 'sent') {
    return {
      withdrawal: sent,
      message:
        'Your withdrawal could not be sent just now. Nothing was taken off. Please try again later.',
    };
  }
  return {
    withdrawal: sent,
    message: `${money} is on its way to your bank. Stripe usually pays it in within a few working days.`,
  };
}

/** Staff approve a withdrawal that was waiting: it is sent now. */
export async function approveWithdrawal(
  ctx: PayContext,
  withdrawalId: string,
  by: string,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const withdrawal = await ctx.repository.ambassadors.findWithdrawal(withdrawalId);
  if (!withdrawal) throw new NotFoundError('withdrawal');
  if (withdrawal.status !== 'waiting_approval') {
    throw new ConflictError('That withdrawal is not waiting for approval.');
  }
  const agreement = await agreed(ctx, withdrawal.ambassadorKind, withdrawal.ambassadorId);
  // A deduction since it was asked for can leave less to send than was held back for it.
  const summary = await ambassadorSummary(ctx, withdrawal.ambassadorKind, withdrawal.ambassadorId);
  if (summary.shortfallPence > 0) {
    throw new ConflictError(
      'A refund since it was asked for leaves less available than this withdrawal. Please refuse it; they can ask again for what is available.',
    );
  }
  const accountId = await payoutAccountOf(ctx, agreement);
  if (!accountId) throw new ConflictError('They have not set up their bank details with Stripe.');
  const sent = await sendWithdrawal(ctx, withdrawal, accountId, by, log);
  const money = formatPence(withdrawal.amountPence, ctx.config.store.currencySymbol);
  return {
    message:
      sent.status === 'sent'
        ? `The withdrawal of ${money} is approved and sent, by ${by}.`
        : `Stripe did not take the withdrawal of ${money}: ${sent.failure ?? 'no reason given'}. Nothing was paid.`,
  };
}

/** Staff refuse a withdrawal that was waiting: the money stays available to them. */
export async function refuseWithdrawal(
  ctx: MoneyContext,
  withdrawalId: string,
  by: string,
): Promise<{ message: string }> {
  const withdrawal = await ctx.repository.ambassadors.findWithdrawal(withdrawalId);
  if (!withdrawal) throw new NotFoundError('withdrawal');
  if (withdrawal.status !== 'waiting_approval') {
    throw new ConflictError('That withdrawal is not waiting for approval.');
  }
  await ctx.repository.ambassadors.updateWithdrawal(withdrawal.id, {
    status: 'refused',
    decidedAt: ctx.now(),
    decidedBy: by,
  });
  return {
    message: `The withdrawal of ${formatPence(withdrawal.amountPence, ctx.config.store.currencySymbol)} is refused, by ${by}. Nothing was paid.`,
  };
}

/** Staff flag an Ambassador, so every withdrawal waits for a person, or take the flag off. */
export async function flagAmbassador(
  ctx: MoneyContext,
  kind: ReferralKind,
  id: string,
  flagged: boolean,
  reason: string,
): Promise<{ message: string }> {
  const agreement = await agreed(ctx, kind, id);
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    flaggedAt: flagged ? ctx.now() : null,
    flagReason: flagged ? reason : null,
  });
  const account = await findAccount(ctx, kind, id);
  return {
    message: flagged
      ? `${account?.name ?? 'They'} is flagged: every withdrawal waits for a person.`
      : `The flag on ${account?.name ?? 'them'} is taken off.`,
  };
}

/** Words for a withdrawal, as the Ambassador sees it. */
export function withdrawalWords(withdrawal: AmbassadorWithdrawal, symbol: string): string {
  const money = formatPence(withdrawal.amountPence, symbol);
  switch (withdrawal.status) {
    case 'waiting_approval':
      return `${money}: waiting for a person to approve it.`;
    case 'sent':
      return `${money}: sent to your bank.`;
    case 'refused':
      return `${money}: not sent. Please contact us.`;
    case 'failed':
      return `${money}: could not be sent. Nothing was taken off.`;
  }
}
