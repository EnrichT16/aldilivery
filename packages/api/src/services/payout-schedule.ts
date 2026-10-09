/**
 * When a Runner's money reaches their bank (ruling 16): weekly by default, daily if they choose,
 * or an instant payout whenever they want one, at Stripe's fee, which they pay and see first.
 *
 * What this controls, and what it does not. A Runner's £5 for each delivery, and paying them
 * back for the shopping (ruling 55), still go to the Runner's own Stripe account straight away,
 * by Stripe Connect transfer, exactly as before (Rule Ten: the service never holds it). The
 * schedule is Stripe's own setting on that account, for how often Stripe then sends what is
 * there on to the Runner's bank. Weekly goes out on a Friday. An instant payout sends what Stripe
 * says can go instantly, less Stripe's fee, to their debit card in minutes.
 *
 * The fee shown is `runners.instantPayoutFeeBasisPoints` and `instantPayoutFeeMinimumPence` in
 * config/store.json, which must match what Stripe charges and what the platform passes on to
 * connected accounts in the Stripe dashboard. The payout is made for the amount less that fee,
 * so what Stripe takes for the fee comes from the same money and never from anyone else's.
 */

import { formatPence, type StoreConfig } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PayoutSchedule, Runner } from '../domain.js';
import { BadRequestError, ConflictError } from '../errors.js';

type MoneyContext = Pick<AppContext, 'repository' | 'config' | 'payments' | 'now'>;

/** Stripe's fee for an instant payout of this much, rounded up to the penny. */
export function instantFeePence(amountPence: number, config: StoreConfig): number {
  const { instantPayoutFeeBasisPoints, instantPayoutFeeMinimumPence } = config.runners;
  return Math.max(
    instantPayoutFeeMinimumPence,
    Math.ceil((amountPence * instantPayoutFeeBasisPoints) / 10_000),
  );
}

/** What the schedule means, in the words the Money tab uses. */
export function scheduleWords(schedule: PayoutSchedule): string {
  return schedule === 'daily'
    ? 'Stripe sends what is in your Stripe account to your bank every day.'
    : 'Stripe sends what is in your Stripe account to your bank once a week, on a Friday.';
}

/** What the schedule controls, said once, plainly. */
export const WHAT_THE_SCHEDULE_CONTROLS =
  'Your pay for each delivery, and the money for the shopping you paid for, reach your own Stripe account straight away, as before. This choice is only how often Stripe then sends it on to your bank.';

export interface InstantQuote {
  availablePence: number;
  feePence: number;
  youGetPence: number;
  possible: boolean;
  words: string;
}

export async function instantQuote(ctx: MoneyContext, runner: Runner): Promise<InstantQuote> {
  const symbol = ctx.config.store.currencySymbol;
  if (!runner.stripeConnectedAccountId) {
    return {
      availablePence: 0,
      feePence: 0,
      youGetPence: 0,
      possible: false,
      words:
        'Set up how you get paid first. Then you can take your money instantly if you need it.',
    };
  }
  let availablePence = 0;
  try {
    availablePence = await ctx.payments.instantPayoutAvailable({
      accountId: runner.stripeConnectedAccountId,
      currency: ctx.config.fees.currency,
    });
  } catch {
    // Stripe could not say: nothing is offered rather than a guess.
    availablePence = 0;
  }
  const feePence = instantFeePence(availablePence, ctx.config);
  const youGetPence = Math.max(0, availablePence - feePence);
  if (youGetPence <= 0) {
    return {
      availablePence,
      feePence,
      youGetPence: 0,
      possible: false,
      words:
        availablePence === 0
          ? 'Nothing can be sent instantly just now. Stripe needs a debit card on your account for instant payouts, and money that has arrived.'
          : `${formatPence(availablePence, symbol)} could go instantly, but Stripe's fee of ${formatPence(feePence, symbol)} would take all of it. It goes with your usual payout instead, for free.`,
    };
  }
  return {
    availablePence,
    feePence,
    youGetPence,
    possible: true,
    words: `${formatPence(availablePence, symbol)} can go to your debit card now. Stripe's fee for that is ${formatPence(feePence, symbol)}, paid by you, so you would get ${formatPence(youGetPence, symbol)}.`,
  };
}

/** Choose weekly or daily. Written to Stripe first, so the two never disagree. */
export async function chooseSchedule(
  ctx: MoneyContext,
  runner: Runner,
  schedule: PayoutSchedule,
): Promise<Runner> {
  if (runner.stripeConnectedAccountId) {
    try {
      await ctx.payments.setPayoutSchedule({
        accountId: runner.stripeConnectedAccountId,
        interval: schedule,
      });
    } catch {
      throw new ConflictError(
        'Stripe did not take that change just now. Nothing has changed. Please try again later.',
      );
    }
  }
  return ctx.repository.runners.update(runner.id, { payoutSchedule: schedule });
}

/**
 * An instant payout, asked for after seeing the fee. `expectedYouGetPence` is the figure they
 * were shown: if it has changed since, nothing is sent and the new figure is shown instead.
 */
export async function takeInstantPayout(
  ctx: MoneyContext,
  runner: Runner,
  expectedYouGetPence: number,
): Promise<{ payoutId: string; quote: InstantQuote; message: string }> {
  const quote = await instantQuote(ctx, runner);
  if (!quote.possible || !runner.stripeConnectedAccountId) {
    throw new BadRequestError(quote.words);
  }
  if (quote.youGetPence !== expectedYouGetPence) {
    throw new ConflictError(`That has changed since you looked. ${quote.words}`, { quote });
  }
  const at = ctx.now();
  const payout = await ctx.payments
    .createInstantPayout({
      accountId: runner.stripeConnectedAccountId,
      amountPence: quote.youGetPence,
      currency: ctx.config.fees.currency,
      // One a minute at most, however often the button is pressed.
      reference: `instant:${runner.id}:${at.toISOString().slice(0, 16)}`,
    })
    .catch(() => {
      throw new ConflictError(
        'Stripe could not send that instantly. Nothing has been taken. Your usual payout still goes as normal.',
      );
    });
  const symbol = ctx.config.store.currencySymbol;
  return {
    payoutId: payout.id,
    quote,
    message: `${formatPence(quote.youGetPence, symbol)} is on its way to your debit card. Stripe's fee was ${formatPence(quote.feePence, symbol)}.`,
  };
}
