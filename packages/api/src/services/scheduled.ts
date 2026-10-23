/**
 * Ordering now for a later day (ruling 78, Anthony, 23 October 2026).
 *
 * A booked order is written as soon as the Shopper says yes, with its delivery day, its window
 * and how the money is taken, and is offered to Runners only at its offer time: the start of
 * its window less `scheduled.offerLeadMinutes` (dispatch.ts never offers it earlier). One sweep,
 * run every minute by the server, does everything that happens later:
 *
 * - A payment the Shopper asked to be taken on a chosen day and time is taken then, from the
 *   saved card, off session. Refused, it is tried again every `retryEveryMinutes` up to
 *   `maxChargeTries` tries; after the first refusal the Shopper is told in words that name no
 *   amount, and it goes on Ozi's desk. If the bank asks the Shopper to check it is them, no
 *   more tries are made and a secure link to pay is sent instead.
 * - An order still unpaid at its offer time is not sent to a Runner; the Shopper and the owner
 *   are told, and it waits, cancellable by the Shopper.
 * - The Shopper is reminded the day before and on the morning of delivery.
 * - Each morning the owner has one matter on Ozi's desk with the day's booked orders.
 *
 * The final amount is still what the till says on the day (services/till.ts), as agreed. Nothing
 * here takes any money the Shopper did not say yes to (Rule One).
 */

import { createHash } from 'node:crypto';

import {
  addDays,
  checkSchedule,
  chargeMomentWords,
  dayWords,
  formatPence,
  nextChargeTry,
  ukClock,
  ukDay,
  ukMoment,
  windowWords,
  type ChargePlan,
  type DeliveryWindow,
} from '@aldilivery/core';
import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { BadRequestError, ConflictError } from '../errors.js';
import { recordOrder } from '../lib/analytics.js';
import { recordOrderIncome } from '../lib/ledger.js';
import { orderReference } from '../routes/runner-account.js';
import { chargedNowPence } from './basket-orders.js';
import { applyCredit } from './credit.js';
import { offerOrder } from './dispatch.js';
import { tellShopperById } from './order-updates.js';
import { askOwner } from './owner-desk.js';

/** What the Shopper asked for at checkout: the day, the window, and when the money is taken. */
export interface ScheduleRequest {
  deliveryDay: string;
  window: DeliveryWindow;
  pay: ChargePlan;
  chargeDay?: string | undefined;
  chargeTime?: string | undefined;
}

/** The fields a booked order is written with, once its booking has been checked. */
export function scheduleFields(
  ctx: Pick<AppContext, 'config' | 'now'>,
  request: ScheduleRequest,
): Pick<
  Order,
  | 'deliveryDay'
  | 'deliveryWindow'
  | 'offerAt'
  | 'chargePlan'
  | 'chargeAt'
  | 'chargeNextTryAt'
  | 'chargeStatus'
> {
  const settings = ctx.config.scheduled;
  const check = checkSchedule(
    {
      deliveryDay: request.deliveryDay,
      window: request.window,
      chargePlan: request.pay,
      chargeDay: request.chargeDay,
      chargeTime: request.chargeTime ?? settings.defaultChargeTime,
    },
    ctx.now(),
    settings,
  );
  if (!check.ok) throw new BadRequestError(`${check.message} Nothing has been charged.`);
  return {
    deliveryDay: request.deliveryDay,
    deliveryWindow: request.window,
    offerAt: check.offerAt,
    chargePlan: request.pay,
    chargeAt: check.chargeAt,
    chargeNextTryAt: check.chargeAt,
    chargeStatus: request.pay === 'scheduled' ? 'waiting' : null,
  };
}

/** "Saturday 31 October, in the morning, 8:00 to 12:00". */
export function bookedWords(
  ctx: Pick<AppContext, 'config'>,
  order: Pick<Order, 'deliveryDay' | 'deliveryWindow'>,
): string {
  if (!order.deliveryDay) return 'as soon as possible';
  return `${dayWords(order.deliveryDay)}${order.deliveryWindow ? `, in ${windowWords(order.deliveryWindow, ctx.config.scheduled)}` : ''}`;
}

/** When the money is taken, in words: "on Sunday 1 November at 00:05". */
export function chargeWords(order: Pick<Order, 'chargeAt' | 'chargePlan' | 'deliveryDay'>): string {
  if (order.chargePlan === 'scheduled' && order.chargeAt) {
    return chargeMomentWords(ukDay(order.chargeAt), ukClock(order.chargeAt));
  }
  if (order.chargePlan === 'bank' && order.deliveryDay) {
    return `by bank transfer by ${dayWords(addDays(order.deliveryDay, -1))}`;
  }
  return 'now';
}

/** A booked order is offered no sooner than its offer time. */
export function notYetDue(order: Pick<Order, 'offerAt'>, at: Date): boolean {
  return order.offerAt !== null && order.offerAt.getTime() > at.getTime();
}

/** The words a Shopper gets when their payment could not be taken: never an amount. */
export const PAYMENT_FAILED_WORDS =
  'a payment for your order could not be taken; please check your card or pay by bank transfer.';

/* ------------------------------------------------------------------ taking the money */

export type ScheduledChargeOutcome = 'paid' | 'retrying' | 'failed' | 'needs_authentication';

/**
 * Take a booked order's payment, on the day and time the Shopper chose. Each try has its own
 * reference, so a try asked for twice is taken once.
 */
export async function takeScheduledPayment(
  ctx: AppContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<ScheduledChargeOutcome> {
  const { repository, payments, config } = ctx;
  const at = ctx.now();
  const tries = order.chargeTries + 1;
  const payer = await repository.shoppers.findById(order.payerShopperId ?? order.shopperId);
  const card = order.paymentMethodId
    ? await repository.paymentMethods.findById(order.paymentMethodId)
    : null;
  const amountPence = chargedNowPence(order);

  let result: Awaited<ReturnType<typeof payments.chargeOffSession>>;
  if (!payer || !card) {
    result = { outcome: 'declined', reason: 'no_saved_card' };
  } else {
    try {
      result = await payments.chargeOffSession({
        amountPence,
        currency: config.fees.currency,
        paymentMethodId: card.stripePaymentMethodId,
        customerId: payer.stripeCustomerId,
        description: `${config.productName} order ${order.id}, booked for ${order.deliveryDay ?? ''}`,
        reference: `scheduled:${order.id}`,
        agreedAt: (order.spokenConfirmationAt ?? order.createdAt).toISOString(),
        idempotencyKey: `scheduled:${order.id}:${tries}`,
      });
    } catch (failure) {
      // Stripe could not be reached: counted as a try, and tried again in its time.
      log.warn({ err: failure, orderId: order.id }, 'A booked order payment could not be tried.');
      result = { outcome: 'declined', reason: 'gateway_unreachable' };
    }
  }

  const booked = bookedWords(ctx, order);
  const where = { url: '/orders', tag: `booked-${order.id}` };

  if (result.outcome === 'succeeded') {
    const paid = await repository.orders.update(order.id, {
      status: 'paid',
      stripePaymentIntentId: result.id,
      chargeStatus: 'paid',
      chargeTries: tries,
      chargeNextTryAt: null,
    });
    await recordOrder(ctx, paid, 'order_paid', log);
    await recordOrderIncome(repository, payments, paid, at, amountPence);
    await applyCredit(ctx, paid.id, log).catch(() => 0);
    await tellShopperById(
      ctx,
      order.shopperId,
      `The payment for your order booked for ${booked} has been taken. Thank you.`,
      where,
      log,
    );
    // Its offer time has come already (it was held, waiting): straight to a Runner.
    if (ctx.autoOffer && !notYetDue(paid, at)) {
      await offerOrder(ctx, paid.id).catch(() => undefined);
    }
    return 'paid';
  }

  if (result.outcome === 'authentication_required') {
    // Only the Shopper can do what their bank asks, so no more tries: a secure link instead.
    let url: string | null = null;
    try {
      const origin = ctx.env.primaryOrigin ?? '';
      ({ url } = await payments.createPaymentLink({
        orderId: order.id,
        amountPence,
        currency: config.fees.currency,
        description: `${config.productName}: your booked shopping and delivery`,
        customerId: payer?.stripeCustomerId ?? null,
        successUrl: `${origin}/orders`,
        cancelUrl: `${origin}/orders`,
        expiresAt: Math.floor(at.getTime() / 1000) + 23 * 3600,
      }));
    } catch (failure) {
      log.error({ err: failure, orderId: order.id }, 'A payment link could not be made.');
    }
    await repository.orders.update(order.id, {
      chargeStatus: 'needs_authentication',
      chargeTries: tries,
      chargeNextTryAt: null,
      ...(url ? { chargeLinkSentAt: at } : {}),
    });
    await tellShopperById(
      ctx,
      order.shopperId,
      url
        ? `your bank wants to check it is you before the payment for your order booked for ${booked} can be taken. Please pay with this secure link: ${url} . Or pay by bank transfer, or open the app.`
        : `your bank wants to check it is you before the payment for your order booked for ${booked} can be taken. Please open the app to pay, or pay by bank transfer.`,
      { ...where, url: url ?? where.url },
      log,
    );
    await askOwner(
      ctx,
      {
        kind: 'scheduled_payment',
        subjectId: order.id,
        summary: `The payment for booked order ${orderReference(order.id)}, for ${booked}, needs the Shopper to check it with their bank. They have been sent a link to pay.`,
        options: 'acknowledge',
      },
      log,
    );
    return 'needs_authentication';
  }

  // Refused: tried again in its time, up to the most tries.
  const next = nextChargeTry(tries, at, config.scheduled);
  await repository.orders.update(order.id, {
    chargeStatus: next ? 'retrying' : 'failed',
    chargeTries: tries,
    chargeNextTryAt: next,
  });
  log.info(
    { orderId: order.id, tries, reason: result.reason },
    'A booked order payment was refused.',
  );
  if (tries === 1 || !next) {
    await tellShopperById(
      ctx,
      order.shopperId,
      next ? PAYMENT_FAILED_WORDS : `${PAYMENT_FAILED_WORDS} We have stopped trying your card.`,
      where,
      log,
    );
    await askOwner(
      ctx,
      {
        kind: 'scheduled_payment',
        subjectId: order.id,
        summary: next
          ? `The payment for booked order ${orderReference(order.id)}, for ${booked}, was refused. It will be tried again every ${config.scheduled.retryEveryMinutes} minutes, up to ${config.scheduled.maxChargeTries} tries.`
          : `The payment for booked order ${orderReference(order.id)}, for ${booked}, was refused ${tries} times, so no more tries will be made. The Shopper has been told.`,
        options: 'acknowledge',
      },
      log,
    );
  }
  return next ? 'retrying' : 'failed';
}

/* ------------------------------------------------------------------ the sweep */

export interface ScheduledSweepReport {
  charged: number;
  held: number;
  reminded: number;
  summary: boolean;
}

/** Everything that happens to booked orders later. Run every minute by the server. */
export async function sweepScheduled(
  ctx: AppContext,
  log: FastifyBaseLogger,
): Promise<ScheduledSweepReport> {
  const { repository, config } = ctx;
  const settings = config.scheduled;
  const at = ctx.now();
  const today = ukDay(at);
  const clock = ukClock(at);
  const report: ScheduledSweepReport = { charged: 0, held: 0, reminded: 0, summary: false };

  for (const listed of await repository.orders.listScheduled()) {
    if (listed.isDemo) continue;
    try {
      let order = listed;
      // The money, at the moment the Shopper chose, and again after a refusal.
      if (
        order.status === 'confirmed' &&
        order.chargePlan === 'scheduled' &&
        order.approvalStatus !== 'waiting' &&
        (order.chargeStatus === 'waiting' || order.chargeStatus === 'retrying') &&
        order.chargeNextTryAt !== null &&
        order.chargeNextTryAt.getTime() <= at.getTime()
      ) {
        const outcome = await takeScheduledPayment(ctx, order, log);
        if (outcome === 'paid') report.charged += 1;
        order = (await repository.orders.findById(order.id)) ?? order;
      }

      // Its offer time, and still not paid: not sent to a Runner, and everybody told once.
      if (order.status === 'confirmed' && !notYetDue(order, at) && !order.scheduledHeldAt) {
        await repository.orders.update(order.id, { scheduledHeldAt: at });
        report.held += 1;
        await tellShopperById(
          ctx,
          order.shopperId,
          `your order booked for ${bookedWords(ctx, order)} has not been paid for yet, so no Runner has been sent. It is waiting: pay by bank transfer, or open the app to pay or cancel it.`,
          { url: '/orders', tag: `booked-${order.id}` },
          log,
        );
        await askOwner(
          ctx,
          {
            kind: 'scheduled_payment',
            subjectId: order.id,
            summary: `Booked order ${orderReference(order.id)}, for ${bookedWords(ctx, order)}, was not paid by its time, so no Runner has been sent. It is waiting, and the Shopper has been told.`,
            options: 'acknowledge',
            again: true,
          },
          log,
        );
        if (ctx.env.ownerAlertPhone && ctx.sendText) {
          await ctx
            .sendText(
              ctx.env.ownerAlertPhone,
              `${config.productName}: booked order ${orderReference(order.id)} was not paid by its time, so no Runner has been sent. It is on Ozi's desk.`,
            )
            .catch((failure: unknown) =>
              log.warn({ err: failure }, 'The owner could not be told.'),
            );
        }
      }

      // The Shopper's reminders: the day before, and the morning of delivery. Never an amount.
      const day = order.deliveryDay ?? '';
      if (
        !order.reminderDayBeforeAt &&
        today === addDays(day, -1) &&
        clock >= settings.reminders.dayBeforeAt
      ) {
        await repository.orders.update(order.id, { reminderDayBeforeAt: at });
        // Booked today for tomorrow: the confirmation has only just said it.
        if (ukDay(order.createdAt) !== today) {
          report.reminded += 1;
          await tellShopperById(
            ctx,
            order.shopperId,
            `a reminder: your shopping comes tomorrow, ${bookedWords(ctx, order)}. You can change or cancel it under Your orders.`,
            { url: '/orders', tag: `booked-${order.id}-eve` },
            log,
          );
        }
      }
      if (!order.reminderMorningAt && today === day && clock >= settings.reminders.morningOfAt) {
        await repository.orders.update(order.id, { reminderMorningAt: at });
        if (order.status !== 'confirmed') {
          report.reminded += 1;
          await tellShopperById(
            ctx,
            order.shopperId,
            `your shopping comes today, in ${order.deliveryWindow ? windowWords(order.deliveryWindow, settings) : 'the day'}. We will tell you when a Runner has it.`,
            { url: '/my-order', tag: `booked-${order.id}-day` },
            log,
          );
        }
      }
    } catch (failure) {
      log.error({ err: failure, orderId: listed.id }, 'A booked order could not be swept.');
    }
  }

  // The owner's one summary of the day's booked orders, on Ozi's desk, once each morning.
  if (clock >= settings.reminders.ownerSummaryAt) {
    report.summary = await ownerSummary(ctx, today, log);
  }
  return report;
}

/** The day's booked orders, in a sentence or two for Ozi's desk: one matter, not one each. */
async function ownerSummary(
  ctx: AppContext,
  today: string,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const subjectId = `scheduled-${today}`;
  const already = await ctx.repository.ownerDesk.findMattersFor('scheduled_today', subjectId);
  if (already.length > 0) return false;
  const todays = (await ctx.repository.orders.listScheduled()).filter(
    (order) => order.deliveryDay === today && !order.isDemo,
  );
  if (todays.length === 0) return false;
  const count = (window: DeliveryWindow): number =>
    todays.filter((order) => order.deliveryWindow === window).length;
  const unpaid = todays.filter((order) => order.status === 'confirmed').length;
  const parts = (['morning', 'afternoon', 'evening'] as const)
    .filter((window) => count(window) > 0)
    .map((window) => `${count(window)} in the ${window}`);
  const listed =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
      : (parts[0] ?? '');
  const made = await askOwner(
    ctx,
    {
      kind: 'scheduled_today',
      subjectId,
      summary: `Today there ${todays.length === 1 ? 'is 1 booked order' : `are ${todays.length} booked orders`}: ${listed}.${unpaid > 0 ? ` ${unpaid === 1 ? '1 is' : `${unpaid} are`} not paid for yet.` : ''} They go to Runners as each window comes.`,
      options: 'acknowledge',
    },
    log,
  );
  return made !== null;
}

/* ------------------------------------------------------------------ the Shopper's own */

/** Booked orders the Shopper can still change or cancel: not yet with a Runner. */
export function changeable(order: Order, at: Date): boolean {
  if (!order.deliveryDay || order.runnerId) return false;
  if (order.status === 'confirmed') return true;
  return order.status === 'paid' && notYetDue(order, at);
}

/** What the Your orders page shows of one booked order. */
export function bookedView(ctx: Pick<AppContext, 'config' | 'now'>, order: Order) {
  const at = ctx.now();
  return {
    id: order.id,
    reference: orderReference(order.id),
    status: order.status,
    deliveryDay: order.deliveryDay,
    deliveryWindow: order.deliveryWindow,
    deliveryWords: bookedWords(ctx, order),
    chargePlan: order.chargePlan,
    chargeAt: order.chargeAt,
    chargeWords: chargeWords(order),
    chargeStatus: order.chargeStatus,
    paid: order.status !== 'confirmed',
    held: order.scheduledHeldAt !== null,
    bankReference: order.bankReference,
    totalPence: order.totalEstimatePence,
    items: order.items.map((item) => ({ name: item.name, quantity: item.quantity })),
    canChange: changeable(order, at),
    canChangePayment:
      order.status === 'confirmed' && order.chargePlan === 'scheduled' && !order.runnerId,
    canCancel: changeable(order, at) || (order.status === 'offered' && !order.runnerId),
  };
}

/**
 * Change a booked order's day, window, or the moment the money is taken, before a Runner has it.
 * The money's moment only before it has been taken.
 */
export async function changeBooking(
  ctx: AppContext,
  order: Order,
  change: {
    deliveryDay?: string | undefined;
    window?: DeliveryWindow | undefined;
    chargeDay?: string | undefined;
    chargeTime?: string | undefined;
  },
  log: FastifyBaseLogger,
): Promise<Order> {
  const at = ctx.now();
  if (!changeable(order, at)) {
    throw new ConflictError(
      'This order can no longer be changed here, because a Runner is on it or its day has come. Please phone us.',
    );
  }
  const changingMoney = change.chargeDay !== undefined || change.chargeTime !== undefined;
  if (changingMoney && !(order.status === 'confirmed' && order.chargePlan === 'scheduled')) {
    throw new ConflictError(
      'The payment for this order has already been taken, or it is paid another way, so only the day can be changed.',
    );
  }
  const deliveryDay = change.deliveryDay ?? order.deliveryDay ?? '';
  const window = change.window ?? order.deliveryWindow ?? 'morning';
  const pay = (order.chargePlan ?? 'now') as ChargePlan;
  const fields = scheduleFields(ctx, {
    deliveryDay,
    window,
    // A paid order is checked as paid now: its money's moment is past.
    pay: order.status === 'confirmed' ? pay : 'now',
    chargeDay: change.chargeDay ?? (order.chargeAt ? ukDay(order.chargeAt) : undefined),
    chargeTime: change.chargeTime ?? (order.chargeAt ? ukClock(order.chargeAt) : undefined),
  });
  const updated = await ctx.repository.orders.update(order.id, {
    deliveryDay: fields.deliveryDay,
    deliveryWindow: fields.deliveryWindow,
    offerAt: fields.offerAt,
    ...(order.status === 'confirmed' && pay === 'scheduled'
      ? {
          chargeAt: fields.chargeAt,
          chargeNextTryAt: fields.chargeAt,
          chargeStatus: 'waiting' as const,
          chargeTries: 0,
        }
      : {}),
    scheduledHeldAt: null,
    reminderDayBeforeAt: null,
    reminderMorningAt: null,
  });
  await tellShopperById(
    ctx,
    order.shopperId,
    `your booked order is changed: it now comes ${bookedWords(ctx, updated)}.${updated.chargePlan === 'scheduled' && updated.status === 'confirmed' ? ` The payment is taken ${chargeWords(updated)}.` : ''}`,
    { url: '/orders', tag: `booked-${order.id}` },
    log,
  );
  return updated;
}

/**
 * Cancel a booked order before a Runner has it. Paid by card, every penny taken comes back to
 * the card; paid by bank transfer, a person sends it back, and the owner is told. Unpaid, it is
 * simply cancelled: nothing was taken.
 */
export async function cancelBooking(
  ctx: AppContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<{ order: Order; refundedPence: number; message: string }> {
  const { repository, payments, config } = ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const at = ctx.now();
  const offeredUntaken = order.status === 'offered' && !order.runnerId;
  if (!order.deliveryDay || !(changeable(order, at) || offeredUntaken)) {
    throw new ConflictError(
      'This order can no longer be cancelled here, because a Runner is on it. Please phone us.',
    );
  }
  // Anyone still being asked to take it is asked no more.
  for (const offer of await repository.offers.listForOrder(order.id)) {
    if (offer.outcome === 'pending') {
      await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
    }
  }
  if (order.status === 'confirmed') {
    const cancelled = await repository.orders.update(order.id, {
      status: 'cancelled',
      cancelledAt: at,
      cancelReason: 'The Shopper cancelled a booked order before it was paid.',
      chargeNextTryAt: null,
    });
    return {
      order: cancelled,
      refundedPence: 0,
      message: 'Your booked order is cancelled. Nothing was taken.',
    };
  }
  const takenPence = Math.max(0, chargedNowPence(order) - order.creditAppliedPence);
  if (order.paidBy === 'bank') {
    const cancelled = await repository.orders.update(order.id, {
      status: 'cancelled',
      cancelledAt: at,
      cancelReason:
        'The Shopper cancelled a booked order paid by bank transfer: to be refunded in full by staff.',
    });
    await askOwner(
      ctx,
      {
        kind: 'scheduled_payment',
        subjectId: order.id,
        summary: `Booked order ${orderReference(order.id)}, paid by bank transfer, was cancelled by the Shopper. Please send back ${money(takenPence)} in full by bank transfer.`,
        options: 'acknowledge',
        again: true,
      },
      log,
    );
    return {
      order: cancelled,
      refundedPence: 0,
      message: `Your booked order is cancelled. We will send the ${money(takenPence)} you paid back to you by bank transfer.`,
    };
  }
  if (!order.stripePaymentIntentId) {
    throw new ConflictError('We could not find the payment to give back. Please phone us.');
  }
  await payments.refundPayment({
    paymentIntentId: order.stripePaymentIntentId,
    amountPence: takenPence,
    reference: `cancel-booked:${order.id}`,
  });
  const refunded = await repository.orders.update(order.id, {
    status: 'refunded',
    cancelledAt: at,
    cancelReason: 'The Shopper cancelled a booked order: refunded in full.',
  });
  return {
    order: refunded,
    refundedPence: takenPence,
    message: `Your booked order is cancelled, and the ${money(takenPence)} we took is going back to your card in full.`,
  };
}

/* ------------------------------------------------------------------ Runners and bank */

/** What a Runner sees of tomorrow's booked orders: how many, by window, and nothing else. */
export async function bookedForTomorrow(
  ctx: Pick<AppContext, 'repository' | 'now'>,
): Promise<{ day: string; total: number; morning: number; afternoon: number; evening: number }> {
  const tomorrow = addDays(ukDay(ctx.now()), 1);
  const orders = (await ctx.repository.orders.listScheduled()).filter(
    (order) => order.deliveryDay === tomorrow && !order.isDemo,
  );
  const count = (window: DeliveryWindow): number =>
    orders.filter((order) => order.deliveryWindow === window).length;
  return {
    day: tomorrow,
    total: orders.length,
    morning: count('morning'),
    afternoon: count('afternoon'),
    evening: count('evening'),
  };
}

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * The reference an account puts on a transfer or standing order to us: the same every time,
 * short enough to type, with no easily confused letters. S for a Shopper, P for a Shop Partner,
 * G for an organisation.
 */
export function personalReference(
  prefix: string,
  kind: 'shopper' | 'partner' | 'organisation',
  id: string,
): string {
  const digest = createHash('sha256').update(`${kind}:${id}`).digest();
  let code = '';
  for (let i = 0; i < 6; i += 1) code += LETTERS[digest[i]! % LETTERS.length];
  const letter = kind === 'shopper' ? 'S' : kind === 'partner' ? 'P' : 'G';
  return `${prefix}-${letter}${code}`;
}

/** A moment, for a booking's day: midday on it, UK time, for counting it in its month. */
export function middayOf(day: string): Date {
  return ukMoment(day, '12:00');
}
