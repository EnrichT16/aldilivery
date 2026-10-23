/**
 * The monthly plans and the first free month (ruling 58, Anthony, 9 October 2026; delivery and
 * the monthly allowance as ruled on 20 October 2026, ruling 73).
 *
 * - Ozi Membership (£10 a month): delivery £7.99 up to £60 and £9.99 over, 5 orders a month,
 *   Recipes included, one free Ozi Finds It a month, favourites remembered.
 * - Ozi Plus (£15 a month): all of Membership, delivery £6.99 up to £60 and £8.99 over, 8 orders
 *   a month, two free Ozi Finds It a month, my regular Runner where possible, priority at busy
 *   times, no adverts, a friendly check-in after a while without an order.
 * - Ozi Family and Carer (£20 a month): all of Plus for up to four people in different homes,
 *   5 orders a month for each of them; the payer sees every order and is told at each stage,
 *   approves orders above a limit they set, pays with one card, and has a weekly summary.
 *
 * Past a plan's allowance, the next order has an extra delivery charge (£5.99), then two orders
 * without it, then the extra again (`allowanceExtraPence` in core). The Shopper is told before
 * the one yes. Pay as you go has no allowance.
 *
 * Every new Shopper has their first month of membership free, from sign-up, and pays the
 * pay-as-you-go delivery during it unless they choose to join. About three days before it ends
 * they are reminded that £10 a month starts only if they choose to join. Nothing is ever taken
 * without the Shopper choosing to join (UK subscription rules: clear consent, reminders, and
 * cancelling as easily as joining). Nobody is refused service for not joining.
 *
 * Billing is the same saved-card charge the old 30-day Plus used, now repeated monthly on the
 * same date only for a Shopper who said yes to that when joining; cancelling stops it at once
 * and the plan runs to the end of the month already paid for.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  allowanceExtraPence,
  allowancePlanWords,
  allowanceWords,
  deliveryStepsWords,
  formatPence,
  orderAllowanceFor,
  type AllowancePlan,
  type DeliveryPlan,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, Shopper, ShopperPlan } from '../domain.js';
import { tellShopperById } from './order-updates.js';

type PlanContext = Pick<AppContext, 'repository' | 'config' | 'now'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The same day next month (or the last day of a shorter month): "the same date each month". */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** What a new account's free month runs until, or null when the free month is switched off. */
export function freeMonthEnd(config: AppContext['config'], at: Date): Date | null {
  return config.extras.freeFirstMonth ? addMonths(at, 1) : null;
}

/** The plan's name as people hear it, with the assistant's name from configuration. */
export function planName(plan: ShopperPlan, assistantName: string): string {
  return {
    membership: `${assistantName} Membership`,
    plus: `${assistantName} Plus`,
    family: `${assistantName} Family and Carer`,
  }[plan];
}

/** What the plan costs a month. */
export function planPricePence(plan: ShopperPlan, config: AppContext['config']): number {
  return {
    membership: config.extras.membershipPence,
    plus: config.extras.plusPence,
    family: config.extras.familyPence,
  }[plan];
}

/** The plan the Shopper has paid up for right now, or null. */
export function activePlan(shopper: Shopper, at: Date): ShopperPlan | null {
  if (shopper.plan === null || shopper.planUntil === null) return null;
  return shopper.planUntil.getTime() > at.getTime() ? shopper.plan : null;
}

/** Still inside the first free month. */
export function inFreeMonth(shopper: Shopper, at: Date): boolean {
  return shopper.freeMonthUntil !== null && shopper.freeMonthUntil.getTime() > at.getTime();
}

/**
 * Membership's extras (Recipes, a free Finds It a month, favourites): on any plan, and during
 * the free month. Delivery is a separate question: see `deliveryPlanFor`.
 */
export function hasMembershipExtras(shopper: Shopper, at: Date): boolean {
  return activePlan(shopper, at) !== null || inFreeMonth(shopper, at);
}

/** Plus's extras (regular Runner, priority, no adverts, check-ins): Plus and Family. */
export function hasPlusExtras(shopper: Shopper, at: Date): boolean {
  const plan = activePlan(shopper, at);
  return plan === 'plus' || plan === 'family';
}

/**
 * Which delivery price applies to this Shopper now. A paid-up plan decides; a person an
 * organisation looks after has Membership delivery; everybody else, the free month included,
 * pays as they go. Never the time, the place or the demand (Rule Four).
 */
export async function deliveryPlanFor(
  ctx: Pick<PlanContext, 'repository'>,
  shopper: Shopper,
  at: Date,
): Promise<DeliveryPlan> {
  const plan = activePlan(shopper, at);
  if (plan === 'plus' || plan === 'family') return 'plus';
  if (plan === 'membership') return 'membership';
  if (shopper.organisationId) {
    const organisation = await ctx.repository.organisations.findById(shopper.organisationId);
    if (organisation?.active) return 'membership';
  }
  return 'payg';
}

/**
 * Which monthly allowance applies to this Shopper now (ruling 73): like `deliveryPlanFor`, with
 * Family and Carer told apart from Plus because it is counted for each person. A person an
 * organisation looks after has Membership's; the free month and pay as you go have none.
 */
export async function allowancePlanFor(
  ctx: Pick<PlanContext, 'repository'>,
  shopper: Shopper,
  at: Date,
): Promise<AllowancePlan> {
  const plan = activePlan(shopper, at);
  if (plan) return plan;
  return (await deliveryPlanFor(ctx, shopper, at)) === 'membership' ? 'membership' : 'payg';
}

/** The calendar month in the United Kingdom, as "2026-10", for counting orders. */
export function ukMonth(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${year}-${month}`;
}

/**
 * Whether an order counts towards the monthly allowance (ruling 73): one of the Shopper's own
 * whole orders that was placed (paid) and not cancelled or refunded. A part of a split job is
 * not an order of its own, and a basket kept whole as linked orders counts once, by its first.
 */
export function countsTowardsAllowance(order: Order): boolean {
  if (order.splitParentId !== null) return false;
  if (order.basketPart !== null && order.basketPart > 1) return false;
  return PAID.has(order.status);
}

/**
 * The calendar month an order counts in: the month it was placed, or for an order booked for a
 * later day (ruling 78), the month of its delivery, "2026-11".
 */
export function allowanceMonth(order: Pick<Order, 'createdAt' | 'deliveryDay'>): string {
  return order.deliveryDay ? order.deliveryDay.slice(0, 7) : ukMonth(order.createdAt);
}

/**
 * The number the next order would be in this calendar month (UK time): the Shopper's own
 * orders that count, this month, plus one for the order being placed. For an order booked for a
 * later day (ruling 78), `at` is a moment on its delivery day, so it counts in that month.
 */
export async function orderNumberThisMonth(
  ctx: Pick<PlanContext, 'repository'>,
  shopper: Shopper,
  at: Date,
): Promise<number> {
  const month = ukMonth(at);
  const orders = await ctx.repository.orders.listForShopper(shopper.id);
  return (
    orders.filter((order) => countsTowardsAllowance(order) && allowanceMonth(order) === month)
      .length + 1
  );
}

/** Where the Shopper stands with their monthly allowance, for the next order. */
export interface AllowanceStanding {
  plan: AllowancePlan;
  /** The number the next order would be this month, from 1. */
  orderNumber: number;
  /** Orders the plan includes a month (for each person on Family), or null on pay as you go. */
  included: number | null;
  /** The extra delivery charge the next order carries, or 0. */
  extraPence: number;
  /** What the Shopper is told before the yes, or null when there is nothing to say. */
  words: string | null;
}

/** The monthly allowance for this Shopper's next order (ruling 73), with the words to say. */
export async function allowanceFor(
  ctx: Pick<PlanContext, 'repository' | 'config'>,
  shopper: Shopper,
  at: Date,
  /** For an order booked for a later day (ruling 78): a moment on its delivery day. */
  countIn: Date = at,
): Promise<AllowanceStanding> {
  const { config } = ctx;
  const allowance = config.fees.delivery.allowance;
  const plan = await allowancePlanFor(ctx, shopper, at);
  const orderNumber = await orderNumberThisMonth(ctx, shopper, countIn);
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  return {
    plan,
    orderNumber,
    included: orderAllowanceFor(plan, allowance),
    extraPence: allowanceExtraPence(plan, orderNumber, allowance),
    words: allowanceWords(plan, orderNumber, allowance, money),
  };
}

/** Free Ozi Finds It searches a month for this Shopper (ruling 73: two on Plus and Family). */
export function freeFindItsFor(shopper: Shopper, at: Date, config: AppContext['config']): number {
  if (!hasMembershipExtras(shopper, at)) return 0;
  return hasPlusExtras(shopper, at)
    ? config.extras.plusFreeFindItsPerMonth
    : config.extras.freeFindItsPerMonth;
}

/** What the account page and the plan page say about the Shopper's plan. */
export async function planView(ctx: PlanContext, shopper: Shopper) {
  const { config, repository, now } = ctx;
  const at = now();
  const plan = activePlan(shopper, at);
  const payer =
    shopper.familyOwnerId !== null
      ? await repository.shoppers.findById(shopper.familyOwnerId)
      : null;
  const members =
    shopper.plan === 'family' && shopper.familyOwnerId === null
      ? await repository.shoppers.listFamily(shopper.id)
      : [];
  return {
    plan,
    planName: plan ? planName(plan, config.assistantName) : null,
    planUntil: plan ? shopper.planUntil : null,
    renews: plan !== null && shopper.planRenews && shopper.familyOwnerId === null,
    cancelled: shopper.planCancelledAt !== null && !shopper.planRenews,
    monthlyPence: plan ? planPricePence(plan, config) : null,
    freeMonthUntil: inFreeMonth(shopper, at) ? shopper.freeMonthUntil : null,
    deliveryPlan: await deliveryPlanFor(ctx, shopper, at),
    familyCode: plan === 'family' && shopper.familyOwnerId === null ? shopper.familyCode : null,
    members: members.map((member) => ({ id: member.id, name: member.displayName })),
    joinedFamilyOf: payer?.displayName ?? null,
    approvalLimitPence: shopper.familyOwnerId === null ? shopper.approvalLimitPence : null,
    familyMaximum: config.extras.familyMaximum,
    creditPence: shopper.creditPence,
    // The monthly allowance (ruling 73): which applies, and how many orders so far this month.
    allowancePlan: await allowancePlanFor(ctx, shopper, at),
    ordersThisMonth: (await orderNumberThisMonth(ctx, shopper, at)) - 1,
  };
}

function longDate(when: Date): string {
  return when.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}

/* ------------------------------------------------------------------ the monthly sweeps */

type SweepContext = Pick<
  AppContext,
  'repository' | 'config' | 'now' | 'payments' | 'sendPush' | 'sendText'
>;

/**
 * Takes the next month for every plan the Shopper chose to renew and has not cancelled, on the
 * same date as before. A card that cannot be charged ends the plan, with a plain message: the
 * Shopper goes back to pay as you go, and can join again whenever they like.
 */
export async function renewPlans(ctx: SweepContext, log: FastifyBaseLogger): Promise<number> {
  const { repository, config, payments, now } = ctx;
  const at = now();
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  let renewed = 0;
  for (const shopper of await repository.shoppers.listPlansDue(at)) {
    if (!shopper.plan || !shopper.planUntil) continue;
    const plan = shopper.plan;
    const name = planName(plan, config.assistantName);
    const price = planPricePence(plan, config);
    const cards = await repository.paymentMethods.listForShopper(shopper.id);
    const card = cards.find((method) => method.isDefault) ?? cards[0];
    let until = shopper.planUntil;
    // One month at a time, from the date it was due, so the date stays the same each month.
    const next = addMonths(until, 1);
    try {
      if (!card) throw new Error('No saved card.');
      await payments.chargeSavedCard({
        amountPence: price,
        currency: config.store.currency,
        paymentMethodId: card.stripePaymentMethodId,
        customerId: shopper.stripeCustomerId,
        description: `${config.productName} ${name}, one month`,
        reference: `plan:${shopper.id}:${until.toISOString()}`,
        agreedAt: (shopper.planStartedAt ?? at).toISOString(),
      });
      until = next;
    } catch (failure) {
      log.warn({ err: failure, shopperId: shopper.id }, 'A monthly plan could not be renewed.');
      await repository.shoppers.update(shopper.id, { planRenews: false });
      await tellShopperById(
        ctx as AppContext,
        shopper.id,
        `We couldn't take ${money(price)} for ${name}, so it has stopped and nothing was taken. You pay as you go from now on. You can join again at any time in Settings.`,
        { url: '/plus', tag: 'plan-renewal' },
        log,
      );
      continue;
    }
    await repository.shoppers.update(shopper.id, { planUntil: until });
    if (plan === 'family') {
      for (const member of await repository.shoppers.listFamily(shopper.id)) {
        await repository.shoppers.update(member.id, { plan: 'family', planUntil: until });
      }
    }
    renewed += 1;
    await tellShopperById(
      ctx as AppContext,
      shopper.id,
      `${money(price)} was taken for another month of ${name}, until ${longDate(until)}${card ? `, from your card ending ${card.lastFour}` : ''}. You can cancel at any time in Settings, or by saying "cancel my membership".`,
      { url: '/plus', tag: 'plan-renewal' },
      log,
    );
  }
  return renewed;
}

/**
 * About three days before the free month ends, the Shopper is reminded that membership costs
 * £10 a month only if they choose to join, and that nothing changes if they do not.
 */
export async function remindFreeMonthEnding(
  ctx: SweepContext,
  log: FastifyBaseLogger,
): Promise<number> {
  const { repository, config, now } = ctx;
  const at = now();
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const until = new Date(at.getTime() + config.extras.freeMonthReminderDaysBefore * DAY_MS);
  let reminded = 0;
  for (const shopper of await repository.shoppers.listFreeMonthEnding(at, until)) {
    // Someone who already joined a plan has nothing to decide.
    if (activePlan(shopper, at) || !shopper.freeMonthUntil) {
      await repository.shoppers.update(shopper.id, { freeMonthReminderSentAt: at });
      continue;
    }
    const name = planName('membership', config.assistantName);
    await tellShopperById(
      ctx as AppContext,
      shopper.id,
      `Your free month of ${name} ends on ${longDate(shopper.freeMonthUntil)}. Nothing will be taken. If you'd like to carry on, you can choose to join for ${money(config.extras.membershipPence)} a month, with delivery at ${deliveryStepsWords('membership', config.fees, money)}, and ${allowancePlanWords('membership', config.fees.delivery.allowance, money) ?? ''}. If you don't, you simply pay as you go, as now, with delivery at ${deliveryStepsWords('payg', config.fees, money)}.`,
      { url: '/plus', tag: 'free-month' },
      log,
    );
    await repository.shoppers.update(shopper.id, { freeMonthReminderSentAt: at });
    reminded += 1;
  }
  return reminded;
}

/**
 * Ozi Plus: a friendly check-in for someone on Plus or Family who has not ordered for a while.
 * Once per quiet spell; never about money.
 */
export async function sendCheckIns(ctx: SweepContext, log: FastifyBaseLogger): Promise<number> {
  const { repository, config, now } = ctx;
  const at = now();
  const quietMs = config.extras.checkInAfterDays * DAY_MS;
  let sent = 0;
  for (const shopper of await repository.shoppers.listOnPlan(at)) {
    if (!hasPlusExtras(shopper, at)) continue;
    const orders = await repository.orders.listForShopper(shopper.id);
    const last = orders.reduce<Date>(
      (latest, order) => (order.createdAt > latest ? order.createdAt : latest),
      shopper.planStartedAt ?? shopper.createdAt,
    );
    if (at.getTime() - last.getTime() < quietMs) continue;
    if (shopper.checkInSentAt && shopper.checkInSentAt.getTime() > last.getTime()) continue;
    await tellShopperById(
      ctx as AppContext,
      shopper.id,
      `Hello ${shopper.displayName.split(/\s+/)[0] ?? ''}, it's ${config.assistantName}. Just checking you're all right and have what you need. If you'd like some shopping, I'm here.`,
      { url: '/', tag: 'check-in' },
      log,
    );
    await repository.shoppers.update(shopper.id, { checkInSentAt: at });
    sent += 1;
  }
  return sent;
}

const PAID: ReadonlySet<Order['status']> = new Set([
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
]);

/** Family and Carer: a weekly summary for the payer of everyone's orders. */
export async function sendWeeklySummaries(
  ctx: SweepContext,
  log: FastifyBaseLogger,
): Promise<number> {
  const { repository, config, now } = ctx;
  const at = now();
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS);
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  let sent = 0;
  for (const payer of await repository.shoppers.listOnPlan(at)) {
    if (payer.plan !== 'family' || payer.familyOwnerId !== null) continue;
    if (payer.weeklySummarySentAt && payer.weeklySummarySentAt.getTime() > weekAgo.getTime()) {
      continue;
    }
    const people = [payer, ...(await repository.shoppers.listFamily(payer.id))];
    const parts: string[] = [];
    for (const person of people) {
      const week = (await repository.orders.listForShopper(person.id)).filter(
        (order) => PAID.has(order.status) && order.createdAt >= weekAgo,
      );
      if (week.length === 0) continue;
      const spent = week.reduce(
        (sum, order) => sum + (order.finalTotalPence ?? order.totalEstimatePence),
        0,
      );
      parts.push(
        `${person.id === payer.id ? 'You' : person.displayName}: ${week.length} order${week.length === 1 ? '' : 's'}, ${money(spent)}`,
      );
    }
    const words =
      parts.length === 0
        ? 'No orders this week on your family plan.'
        : `This week on your family plan: ${parts.join('; ')}.`;
    await tellShopperById(
      ctx as AppContext,
      payer.id,
      `${words} ${config.assistantName} can read it to you in Family.`,
      { url: '/plus', tag: 'weekly-summary' },
      log,
    );
    await repository.shoppers.update(payer.id, { weeklySummarySentAt: at });
    sent += 1;
  }
  return sent;
}

/** All the plan sweeps, run hourly by the server. */
export async function sweepPlans(ctx: SweepContext, log: FastifyBaseLogger) {
  return {
    renewed: await renewPlans(ctx, log),
    reminded: await remindFreeMonthEnding(ctx, log),
    checkIns: await sendCheckIns(ctx, log),
    summaries: await sendWeeklySummaries(ctx, log),
  };
}

/**
 * Family and Carer: the payer is told at each stage of a member's order (ordered, on its way,
 * delivered). Never breaks what caused it.
 */
export async function tellFamilyPayer(
  ctx: AppContext,
  order: Order,
  words: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const shopper = await ctx.repository.shoppers.findById(order.shopperId);
    if (!shopper?.familyOwnerId || activePlan(shopper, ctx.now()) !== 'family') return;
    await tellShopperById(
      ctx,
      shopper.familyOwnerId,
      `${shopper.displayName}'s order: ${words}`,
      { url: '/plus', tag: `family-${order.id}` },
      log,
    );
  } catch (failure) {
    log.warn({ err: failure, orderId: order.id }, 'The family payer could not be told.');
  }
}

/** "Cancel my membership", "cancel my plan", "stop my subscription", said or typed. */
export const CANCEL_PLAN =
  /\b(cancel|stop|end|leave)\b.{0,12}\b(membership|plan|subscription|plus|family and carer)\b/i;

/**
 * Cancelling a plan, the same from the button, from Ozi and from the telephone: nothing more
 * is taken, and the plan runs to the end of the month already paid for. A family member is
 * told who pays for theirs.
 */
export async function cancelPlanFor(
  ctx: PlanContext,
  shopper: Shopper,
): Promise<{ cancelled: boolean; message: string; shopper: Shopper }> {
  const { repository, config, now } = ctx;
  const at = now();
  if (shopper.familyOwnerId !== null) {
    return {
      cancelled: false,
      shopper,
      message:
        'Your plan is paid by the person who looks after your family plan, so nothing is taken from you. To come off it, choose Leave the family plan.',
    };
  }
  const plan = activePlan(shopper, at);
  if (!plan || !shopper.planRenews) {
    return {
      cancelled: false,
      shopper,
      message: plan
        ? `${planName(plan, config.assistantName)} is already cancelled. Nothing more will be taken.`
        : 'You are not on a plan, so there is nothing to cancel. Nothing will be taken.',
    };
  }
  const updated = await repository.shoppers.update(shopper.id, {
    planRenews: false,
    planCancelledAt: at,
  });
  return {
    cancelled: true,
    shopper: updated,
    message: `${planName(plan, config.assistantName)} is cancelled. Nothing more will be taken. You keep it until ${longDate(shopper.planUntil ?? at)}, then you pay as you go.`,
  };
}
