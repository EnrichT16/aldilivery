/**
 * The Runner spending card (Anthony, 9 October 2026: "no Runner should need their own money to
 * do a job").
 *
 * A Runner pays at the till with a virtual card from Stripe Issuing, kept in their phone's
 * wallet, front and centre; or, as the second choice, with their own card, paid back straight
 * away (ruling 55, services/reimburse.ts), which stays as the fallback.
 *
 * - The card is frozen (inactive) whenever it is not loaded for an order.
 * - When a Runner who chose the card accepts an order, it is loaded with the shopping estimate
 *   plus the larger of £5 or a fifth of it (`tillLimitPence`, the same margin the Shopper's card
 *   is settled within), never more than one order carries (`fees.maximumOrderGoodsPence`, ruling 58), grocery shops
 *   only, and switched on.
 * - Every payment at a till is asked of us by Stripe in real time
 *   (`issuing_authorization.request`): approved only for a card tied to an order in hand for
 *   that Runner, still being shopped, in pounds, at a grocery shop, and within what is loaded
 *   for the order, counting what it has already spent. Anything else is declined, with the
 *   reason kept.
 * - When the till total goes in, or the order ends, the card is frozen and its limit put back to
 *   nothing. The till total of a card order is what the card actually paid; the receipt the
 *   Runner types must match it within a few pence, or a person looks.
 * - No pay-back for a card order: the business paid the shop. The Runner's £5 is untouched
 *   (Rule Two).
 *
 * Rule Ten: the card number never passes through this service. Stripe shows it to the Runner in
 * its own frame (Issuing Elements) with a short-lived key, and money is never held for a
 * Runner: the card spends the business's own Issuing balance.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { CardAuthorization, Order, Runner, RunnerPayMethod } from '../domain.js';
import { ConflictError } from '../errors.js';
import { GROCERY_CATEGORIES } from '../lib/payments.js';
import { tillLimitPence } from './till.js';
import { mostOneOrderCarries } from './basket-orders.js';

type CardContext = Pick<AppContext, 'repository' | 'config' | 'payments' | 'now' | 'env'> &
  Partial<Pick<AppContext, 'sendText'>>;

/** How far the receipt the Runner types may be from what the card paid: a few pence. */
export const CARD_MATCH_TOLERANCE_PENCE = 5;

/** The statuses in which a loaded card may be used at a till. */
const SHOPPING: ReadonlyArray<Order['status']> = ['accepted', 'shopping'];

/** Whether the spending card is switched on for this server (STRIPE_ISSUING_ENABLED). */
export function cardSwitchedOn(ctx: Pick<AppContext, 'env'>): boolean {
  return ctx.env.stripeIssuingEnabled;
}

/** What the card is loaded with for an order: estimate plus the margin, never over the whole-order goods cap (shop prices only: item charges go to the business). */
export function cardLimitFor(goodsEstimatePence: number, maximumGoodsPence: number): number {
  return Math.min(goodsEstimatePence + tillLimitPence(goodsEstimatePence), maximumGoodsPence);
}

/** How this Runner pays at the till today, given whether the card is switched on at all. */
export function payMethodNow(ctx: Pick<AppContext, 'env'>, runner: Runner): RunnerPayMethod {
  return cardSwitchedOn(ctx) && runner.payMethod === 'card' && runner.issuingCardId
    ? 'card'
    : 'own';
}

function cardName(ctx: Pick<AppContext, 'config'>): string {
  return `${ctx.config.assistantName} card`;
}

/** What the Runner page shows about paying at the till. Never more than the last four digits. */
export function cardView(ctx: Pick<AppContext, 'env' | 'config'>, runner: Runner) {
  return {
    enabled: cardSwitchedOn(ctx),
    cardName: cardName(ctx),
    payMethod: payMethodNow(ctx, runner),
    chosen: runner.payMethod,
    termsAccepted: runner.issuingTermsAcceptedAt !== null,
    card:
      runner.issuingCardId && runner.cardLast4
        ? {
            id: runner.issuingCardId,
            last4: runner.cardLast4,
            status: runner.cardStatus ?? 'inactive',
          }
        : null,
  };
}

export interface CardSetupInput {
  address: { line1: string; line2?: string; city: string; postcode: string };
  email?: string;
  ip: string;
  userAgent?: string;
}

/**
 * Accepting the cardholder terms and making the card. The terms are recorded with the date and
 * internet address, as Stripe requires; the address is given to Stripe for the card and not kept
 * here. Asking again returns the card already made.
 */
export async function setUpCard(
  ctx: CardContext,
  runner: Runner,
  input: CardSetupInput,
): Promise<Runner> {
  if (!cardSwitchedOn(ctx)) {
    throw new ConflictError(`The ${cardName(ctx)} is coming soon.`);
  }
  if (runner.leftAt) throw new ConflictError('Your Runner account is closed.');
  if (runner.issuingCardId) return runner;

  const acceptedAt = ctx.now();
  let current = await ctx.repository.runners.update(runner.id, {
    issuingTermsAcceptedAt: acceptedAt,
    issuingTermsAcceptedIp: input.ip,
  });

  const cardholderId =
    current.issuingCardholderId ??
    (
      await ctx.payments.createCardholder({
        runnerId: runner.id,
        name: runner.name,
        phone: runner.phone || null,
        email: input.email ?? null,
        billing: {
          line1: input.address.line1,
          ...(input.address.line2 ? { line2: input.address.line2 } : {}),
          city: input.address.city,
          postalCode: input.address.postcode,
          country: 'GB',
        },
        termsAcceptedAt: acceptedAt,
        termsAcceptedIp: input.ip,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      })
    ).id;
  // Kept at once, so a card that fails to be made next is made for the same cardholder.
  current = await ctx.repository.runners.update(runner.id, { issuingCardholderId: cardholderId });

  const card = await ctx.payments.createVirtualCard({ cardholderId, runnerId: runner.id });
  return ctx.repository.runners.update(current.id, {
    issuingCardId: card.id,
    cardLast4: card.last4,
    cardStatus: 'inactive',
    payMethod: 'card',
  });
}

/** Choosing how to pay at the till. The card only once it is made and switched on. */
export async function choosePayMethod(
  ctx: CardContext,
  runner: Runner,
  method: RunnerPayMethod,
): Promise<{ runner: Runner; message: string }> {
  if (method === 'card') {
    if (!cardSwitchedOn(ctx)) throw new ConflictError(`The ${cardName(ctx)} is coming soon.`);
    if (!runner.issuingCardId) {
      throw new ConflictError(`Please set up your ${cardName(ctx)} first.`);
    }
  }
  const updated = await ctx.repository.runners.update(runner.id, { payMethod: method });
  return {
    runner: updated,
    message:
      method === 'card'
        ? `Done. You pay at the till with your ${cardName(ctx)}, loaded for each order. None of your own money is needed.`
        : 'Done. You pay at the till with your own card, and we pay you back straight away when the till total is in.',
  };
}

/** A short-lived key for Stripe Issuing Elements to show this Runner their own card. */
export async function cardKey(
  ctx: CardContext,
  runner: Runner,
  nonce: string,
): Promise<{ cardId: string; secret: string }> {
  if (!cardSwitchedOn(ctx)) throw new ConflictError(`The ${cardName(ctx)} is coming soon.`);
  if (!runner.issuingCardId) throw new ConflictError(`Please set up your ${cardName(ctx)} first.`);
  const { secret } = await ctx.payments.createCardKey({ cardId: runner.issuingCardId, nonce });
  return { cardId: runner.issuingCardId, secret };
}

/** The order this Runner's card may be used for now, if any: in hand, still being shopped. */
export async function cardOrderInHand(
  ctx: Pick<AppContext, 'repository'>,
  runnerId: string,
  exceptOrderId?: string,
): Promise<Order | null> {
  for (const status of SHOPPING) {
    const found = (await ctx.repository.orders.listByStatus(status)).find(
      (order) =>
        order.runnerId === runnerId && order.payMethodUsed === 'card' && order.id !== exceptOrderId,
    );
    if (found) return found;
  }
  return null;
}

export interface CardLoadOutcome {
  payMethodUsed: RunnerPayMethod;
  cardLimitPence: number | null;
  message: string;
}

/**
 * Straight after a Runner accepts an order: load their card for it, or note that they pay with
 * their own card. If the card cannot be loaded, they are told to use their own card and are paid
 * back, so the order never waits.
 */
export async function loadCardForOrder(
  ctx: CardContext,
  order: Order,
  runner: Runner,
  log?: FastifyBaseLogger,
): Promise<CardLoadOutcome> {
  const symbol = ctx.config.store.currencySymbol;
  const own: CardLoadOutcome = {
    payMethodUsed: 'own',
    cardLimitPence: null,
    message:
      'Pay at the till with your own card. We pay you back straight away when the till total is in.',
  };
  if (payMethodNow(ctx, runner) !== 'card' || !runner.issuingCardId) {
    await ctx.repository.orders.update(order.id, { payMethodUsed: 'own' });
    return own;
  }
  const limit = cardLimitFor(order.goodsEstimatePence, mostOneOrderCarries(ctx.config, order));
  try {
    await ctx.payments.loadCard({
      cardId: runner.issuingCardId,
      limitPence: limit,
      orderId: order.id,
    });
  } catch (failure) {
    log?.error({ err: failure, orderId: order.id }, 'The spending card could not be loaded.');
    await ctx.repository.orders.update(order.id, { payMethodUsed: 'own' });
    return {
      ...own,
      message: `We could not load your ${cardName(ctx)} just now, so please pay with your own card this time. We pay you back straight away when the till total is in.`,
    };
  }
  await ctx.repository.runners.update(runner.id, { cardStatus: 'active' });
  await ctx.repository.orders.update(order.id, {
    payMethodUsed: 'card',
    cardLimitPence: limit,
    cardSpentPence: null,
    cardMerchant: null,
  });
  return {
    payMethodUsed: 'card',
    cardLimitPence: limit,
    message: `Your ${cardName(ctx)} is loaded with up to ${formatPence(limit, symbol)} for this order. Tap your phone at the till.`,
  };
}

/**
 * Freeze the card and put its limit back to nothing, unless it is loaded for another order in
 * hand. Called when the till total goes in and when an order ends; never throws, because the
 * real-time check declines a card with no order in hand anyway.
 */
export async function releaseCard(
  ctx: CardContext,
  runnerId: string | null,
  exceptOrderId: string | undefined,
  log?: FastifyBaseLogger,
): Promise<void> {
  if (!runnerId) return;
  try {
    const runner = await ctx.repository.runners.findById(runnerId);
    if (!runner?.issuingCardId) return;
    if (await cardOrderInHand(ctx, runnerId, exceptOrderId)) return;
    await ctx.payments.setCardStatus({ cardId: runner.issuingCardId, status: 'inactive' });
    await ctx.repository.runners.update(runner.id, { cardStatus: 'inactive' });
    await ctx.payments
      .clearCardLimit({ cardId: runner.issuingCardId })
      .catch((failure: unknown) => {
        log?.warn({ err: failure, runnerId }, 'The card is frozen, but its limit was not cleared.');
      });
  } catch (failure) {
    log?.error({ err: failure, runnerId }, 'The spending card could not be frozen.');
  }
}

/** Every card left switched on with no order in hand is frozen. Run on the minute sweep. */
export async function sweepCards(
  ctx: CardContext,
  onError: (runnerId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  let frozen = 0;
  for (const runner of await ctx.repository.runners.listWithCards()) {
    if (runner.cardStatus !== 'active') continue;
    try {
      if (await cardOrderInHand(ctx, runner.id)) continue;
      await releaseCard(ctx, runner.id, undefined);
      frozen += 1;
    } catch (failure) {
      onError(runner.id, failure);
    }
  }
  return frozen;
}

export interface AuthorizationDecision {
  approved: boolean;
  reason: string;
}

/**
 * Whether to approve a payment at a till. Pure, so every reason to decline is proved without a
 * server or a card.
 */
export function decideAuthorization(input: {
  enabled: boolean;
  runner: Pick<Runner, 'id' | 'leftAt'> | null;
  order: Pick<Order, 'runnerId' | 'status' | 'payMethodUsed' | 'cardLimitPence'> | null;
  amountPence: number;
  currency: string;
  category: string;
  /** What the card has already been approved for on this order. */
  approvedSoFarPence: number;
}): AuthorizationDecision {
  if (!input.enabled) return { approved: false, reason: 'The card is switched off.' };
  if (!input.runner) return { approved: false, reason: 'This card is not a Runner’s card.' };
  if (input.runner.leftAt) return { approved: false, reason: 'The Runner has left.' };
  const order = input.order;
  if (
    !order ||
    order.runnerId !== input.runner.id ||
    order.payMethodUsed !== 'card' ||
    !SHOPPING.includes(order.status) ||
    !order.cardLimitPence
  ) {
    return { approved: false, reason: 'No order being shopped is loaded on this card.' };
  }
  if (input.currency.toLowerCase() !== 'gbp') {
    return { approved: false, reason: `Not in pounds (${input.currency}).` };
  }
  if (!(GROCERY_CATEGORIES as readonly string[]).includes(input.category)) {
    return { approved: false, reason: `Not a grocery shop (${input.category || 'unknown'}).` };
  }
  if (input.amountPence <= 0) return { approved: false, reason: 'No amount.' };
  if (input.approvedSoFarPence + input.amountPence > order.cardLimitPence) {
    return { approved: false, reason: 'Over what is loaded for this order.' };
  }
  return { approved: true, reason: 'Within what is loaded for this order.' };
}

/** What Stripe sends about an authorization, as much as we read of it. */
interface AuthorizationObject {
  id?: string;
  amount?: number;
  currency?: string;
  approved?: boolean;
  status?: string;
  created?: number;
  card?: string | { id?: string };
  merchant_data?: { name?: string | null; category?: string | null };
  pending_request?: { amount?: number; currency?: string } | null;
  request_history?: Array<{ approved?: boolean; reason?: string }>;
}

interface TransactionObject {
  id?: string;
  amount?: number;
  type?: string;
  created?: number;
  card?: string | { id?: string };
  authorization?: string | { id?: string } | null;
  merchant_data?: { name?: string | null };
}

function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : (value.id ?? null);
}

/** Stripe's reasons for a decline it made itself, in plain words. */
const STRIPE_REASONS: Record<string, string> = {
  card_inactive: 'The card was frozen.',
  spending_controls: 'Over the card’s limit, or not a grocery shop.',
  webhook_declined: 'Declined by our check.',
  webhook_timeout: 'Our check did not answer in time.',
  insufficient_funds: 'Not enough in the business’s card balance.',
  verification_failed: 'The card details did not check out.',
  suspected_fraud: 'Stripe suspected fraud.',
};

async function approvedSoFar(ctx: Pick<AppContext, 'repository'>, orderId: string, except: string) {
  return (await ctx.repository.cardAuthorizations.listForOrder(orderId))
    .filter(
      (row) =>
        row.kind === 'authorization' &&
        row.approved &&
        row.status !== 'reversed' &&
        row.stripeId !== except,
    )
    .reduce((sum, row) => sum + row.amountPence, 0);
}

/**
 * The real-time question from Stripe: a Runner is at a till. Decided, recorded, and answered
 * straight away; Stripe waits about two seconds before falling back to its own setting.
 */
export async function answerAuthorizationRequest(
  ctx: CardContext,
  object: AuthorizationObject,
): Promise<AuthorizationDecision> {
  const stripeId = object.id ?? '';
  const cardId = idOf(object.card);
  const runner = cardId ? await ctx.repository.runners.findByIssuingCardId(cardId) : null;
  const order = runner ? await cardOrderInHand(ctx, runner.id) : null;
  const amountPence = object.pending_request?.amount ?? object.amount ?? 0;
  const currency = object.pending_request?.currency ?? object.currency ?? '';
  const decision = decideAuthorization({
    enabled: cardSwitchedOn(ctx),
    runner,
    order,
    amountPence,
    currency,
    category: object.merchant_data?.category ?? '',
    approvedSoFarPence: order && stripeId ? await approvedSoFar(ctx, order.id, stripeId) : 0,
  });
  if (stripeId) {
    await ctx.repository.cardAuthorizations.upsert({
      stripeId,
      kind: 'authorization',
      orderId: order?.id ?? null,
      runnerId: runner?.id ?? null,
      amountPence,
      approved: decision.approved,
      reason: decision.reason,
      status: 'pending',
      merchant: object.merchant_data?.name ?? '',
      at: object.created ? new Date(object.created * 1000) : ctx.now(),
    });
    // Shown on the order at once, so a till total typed straight after the tap finds it.
    if (decision.approved && order) await recomputeSpend(ctx, order.id);
  }
  return decision;
}

/** An authorization was made or changed (approved, declined by Stripe, reversed or closed). */
export async function recordAuthorization(
  ctx: CardContext,
  object: AuthorizationObject,
  log?: FastifyBaseLogger,
): Promise<CardAuthorization | null> {
  if (!object.id) return null;
  const existing = await ctx.repository.cardAuthorizations.findByStripeId(object.id);
  const cardId = idOf(object.card);
  const runner = cardId ? await ctx.repository.runners.findByIssuingCardId(cardId) : null;
  const orderId =
    existing?.orderId ?? (runner ? ((await cardOrderInHand(ctx, runner.id))?.id ?? null) : null);
  const stripeReason = object.request_history?.at(-1)?.reason ?? '';
  const stripeWords = STRIPE_REASONS[stripeReason] ?? stripeReason;
  // Our own reason stands, unless Stripe declined one we had approved (its balance, say).
  const reason =
    object.approved === false && existing?.approved
      ? stripeWords || 'Declined by Stripe.'
      : existing?.reason || stripeWords || (object.approved ? 'Approved.' : 'Declined.');
  const row = await ctx.repository.cardAuthorizations.upsert({
    stripeId: object.id,
    kind: 'authorization',
    orderId,
    runnerId: existing?.runnerId ?? runner?.id ?? null,
    amountPence: object.amount ?? existing?.amountPence ?? 0,
    approved: object.approved ?? existing?.approved ?? false,
    reason,
    status: object.status ?? existing?.status ?? '',
    merchant: object.merchant_data?.name ?? existing?.merchant ?? '',
    at: existing?.at ?? (object.created ? new Date(object.created * 1000) : ctx.now()),
  });
  if (orderId) await recomputeSpend(ctx, orderId, log);
  return row;
}

/** Money actually moved on the card: a capture (spent) or a refund. */
export async function recordTransaction(
  ctx: CardContext,
  object: TransactionObject,
  log?: FastifyBaseLogger,
): Promise<CardAuthorization | null> {
  if (!object.id) return null;
  const authorizationId = idOf(object.authorization);
  const authorization = authorizationId
    ? await ctx.repository.cardAuthorizations.findByStripeId(authorizationId)
    : null;
  const cardId = idOf(object.card);
  const runner = cardId ? await ctx.repository.runners.findByIssuingCardId(cardId) : null;
  const orderId =
    authorization?.orderId ??
    (runner ? ((await cardOrderInHand(ctx, runner.id))?.id ?? null) : null);
  // Stripe gives a purchase as a negative amount from the business's balance; we keep what was
  // spent as positive, and a refund as negative.
  const row = await ctx.repository.cardAuthorizations.upsert({
    stripeId: object.id,
    kind: 'transaction',
    orderId,
    runnerId: authorization?.runnerId ?? runner?.id ?? null,
    amountPence: -(object.amount ?? 0),
    approved: true,
    reason: object.type === 'refund' ? 'Refunded by the shop.' : 'Paid to the shop.',
    status: object.type ?? '',
    merchant: object.merchant_data?.name ?? authorization?.merchant ?? '',
    at: object.created ? new Date(object.created * 1000) : ctx.now(),
  });
  if (orderId) await recomputeSpend(ctx, orderId, log);
  return row;
}

/**
 * What the card spent on an order: the transactions once there are any, and until then what
 * was approved and not reversed. A till total already in that no longer matches goes to a person.
 */
export async function recomputeSpend(
  ctx: CardContext,
  orderId: string,
  log?: FastifyBaseLogger,
): Promise<Order | null> {
  const rows = await ctx.repository.cardAuthorizations.listForOrder(orderId);
  const transactions = rows.filter((row) => row.kind === 'transaction');
  const spent =
    transactions.length > 0
      ? transactions.reduce((sum, row) => sum + row.amountPence, 0)
      : rows
          .filter((row) => row.approved && row.status !== 'reversed')
          .reduce((sum, row) => sum + row.amountPence, 0);
  const merchant = [...rows].reverse().find((row) => row.approved && row.merchant)?.merchant;
  const order = await ctx.repository.orders.update(orderId, {
    cardSpentPence: spent,
    cardMerchant: merchant ?? null,
  });
  if (
    order.payMethodUsed === 'card' &&
    order.receiptTotalPence !== null &&
    order.tillStatus === null &&
    Math.abs(order.receiptTotalPence - spent) > CARD_MATCH_TOLERANCE_PENCE
  ) {
    await flagCardTill(
      ctx,
      order,
      `the card paid ${formatPence(spent, ctx.config.store.currencySymbol)}, not the ${formatPence(order.receiptTotalPence, ctx.config.store.currencySymbol)} put in`,
      log,
    );
  }
  return order;
}

/**
 * The till total of a card order: what the card paid, when the receipt the Runner typed matches
 * it within a few pence. Otherwise the reason a person must look.
 */
export function cardTill(
  order: Pick<Order, 'cardSpentPence'>,
  typedPence: number,
  symbol: string,
): { tillPence: number; mismatch: string | null } {
  const spent = order.cardSpentPence;
  if (spent === null || spent <= 0) {
    return { tillPence: typedPence, mismatch: 'no card payment was found for this order yet' };
  }
  if (Math.abs(typedPence - spent) > CARD_MATCH_TOLERANCE_PENCE) {
    return {
      tillPence: spent,
      mismatch: `the receipt says ${formatPence(typedPence, symbol)} but the card paid ${formatPence(spent, symbol)}`,
    };
  }
  return { tillPence: spent, mismatch: null };
}

/** A card order's till that does not match: on the owner's till screen, and the owner texted. */
export async function flagCardTill(
  ctx: CardContext,
  order: Order,
  why: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  await ctx.repository.orders.update(order.id, {
    tillStatus: 'needs_person',
    tillReason: `card: ${why}`,
  });
  if (ctx.env.ownerAlertPhone && ctx.sendText) {
    await ctx
      .sendText(
        ctx.env.ownerAlertPhone,
        `${ctx.config.productName} card: order ${order.id}, ${why}. Please check it on the till screen.`,
      )
      .catch((failure: unknown) => log?.warn({ err: failure }, 'The owner could not be told.'));
  }
}
