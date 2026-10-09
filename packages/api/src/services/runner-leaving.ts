/**
 * A Runner leaving: closing their Runner account themselves, or removed by staff, and the cool
 * bag deposit paid back (docs/LEGAL_REVIEW.md, point 3).
 *
 * The Runner agreement promises that whatever is held towards the cool bag deposit is paid back
 * when a Runner stops early, unless they owe money after a person's written decision (a
 * recovery, see services/pay-runner.ts). Until 18 October 2026 staff had to do it by hand. Now:
 *
 * - nothing owed: the whole deposit held goes straight to the Runner's own Stripe account, by
 *   Stripe Connect transfer, once only (the reference is `coolbag:<runner id>`);
 * - their payout account not ready: it is owed, shown, and the minute sweep sends it as soon as
 *   it is, the same way as their pay;
 * - something still owed after a written decision: it waits for a person, who either pays it
 *   all back or keeps part of it against what is owed and writes down why. Nothing is ever kept
 *   without that.
 *
 * Rule Ten: while the deposit is held, the service is holding Runner money. Paying it back
 * straight away on leaving shortens that time but does not end it; that is still for Anthony to
 * rule on (docs/changes/runner.md).
 */

import { formatPence } from '@aldilivery/core';

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Runner } from '../domain.js';
import { BadRequestError, ConflictError } from '../errors.js';

type LeavingContext = Pick<
  AppContext,
  'repository' | 'config' | 'payments' | 'now' | 'env' | 'sendText'
>;

const ACTIVE = ['accepted', 'shopping', 'receipt_submitted', 'delivering'] as const;

export type DepositOutcome =
  | { kind: 'none' }
  | { kind: 'paid'; pence: number; transferId: string }
  | { kind: 'owed'; pence: number }
  | { kind: 'waiting'; pence: number; owedPence: number };

/** What is held, and not yet paid back. */
export function depositHeld(runner: Runner): number {
  return runner.coolBagRefundedAt ? 0 : runner.coolBagWithheldPence;
}

export function depositWords(outcome: DepositOutcome, symbol: string): string {
  switch (outcome.kind) {
    case 'none':
      return 'We were not holding a cool bag deposit for you.';
    case 'paid':
      return `Your cool bag deposit of ${formatPence(outcome.pence, symbol)} has been paid back to your account.`;
    case 'owed':
      return `We owe you your cool bag deposit of ${formatPence(outcome.pence, symbol)}. It is sent as soon as your bank details are set up with Stripe.`;
    case 'waiting':
      return `We hold ${formatPence(outcome.pence, symbol)} of cool bag deposit, and ${formatPence(outcome.owedPence, symbol)} is still owed after a decision about a refund. A person will write to you within 14 days to say what is paid back.`;
  }
}

/** Mark a Runner as gone: off shift, offered nothing more. Then settle the deposit. */
export async function leave(
  ctx: LeavingContext,
  runner: Runner,
  input: { reason: string; by: string },
  log?: FastifyBaseLogger,
): Promise<{ runner: Runner; deposit: DepositOutcome }> {
  if (runner.leftAt) throw new ConflictError('That Runner account is already closed.');
  for (const status of ACTIVE) {
    const busy = (await ctx.repository.orders.listByStatus(status)).some(
      (order) => order.runnerId === runner.id,
    );
    if (busy) {
      throw new ConflictError(
        'There is a job in hand. Please finish it, or tell us, before the Runner account is closed.',
      );
    }
  }
  const left = await ctx.repository.runners.update(runner.id, {
    leftAt: ctx.now(),
    leftReason: input.reason,
    leftBy: input.by,
    available: false,
  });
  // Any offer they were holding goes on to somebody else at the next sweep.
  for (const offer of await ctx.repository.offers.listByOutcome('pending')) {
    if (offer.runnerId === runner.id) {
      await ctx.repository.offers.update(offer.id, { outcome: 'declined', respondedAt: ctx.now() });
    }
  }
  const deposit = await settleDeposit(ctx, left, log);
  return { runner: (await ctx.repository.runners.findById(runner.id)) ?? left, deposit };
}

/**
 * Pay back the cool bag deposit of a Runner who has left, if nothing stops it. Safe to call
 * again and again: the transfer has a reference that makes it happen once only.
 */
export async function settleDeposit(
  ctx: LeavingContext,
  runner: Runner,
  log?: FastifyBaseLogger,
): Promise<DepositOutcome> {
  const held = depositHeld(runner);
  if (!runner.leftAt || held <= 0) return { kind: 'none' };

  const owed = await ctx.repository.recoveries.listOutstanding(runner.id);
  const owedPence = owed.reduce((sum, row) => sum + row.amountPence - row.recoveredPence, 0);
  if (owedPence > 0) {
    // A written decision applies: a person decides what is paid back, never this code.
    if (!runner.coolBagRefundNote) {
      await ctx.repository.runners.update(runner.id, {
        coolBagRefundNote: 'Waiting for a person: money is still owed after a decision.',
      });
      if (ctx.env.ownerAlertPhone && ctx.sendText) {
        await ctx
          .sendText(
            ctx.env.ownerAlertPhone,
            `${ctx.config.productName}: Runner ${runner.name} (${runner.referralCode}) has left with ${formatPence(held, ctx.config.store.currencySymbol)} cool bag deposit held and money owed. Please decide in the admin panel, Money owed, within 14 days.`,
          )
          .catch((failure: unknown) => log?.warn({ err: failure }, 'The owner could not be told.'));
      }
    }
    return { kind: 'waiting', pence: held, owedPence };
  }
  return payDeposit(ctx, runner, held, null);
}

async function payDeposit(
  ctx: LeavingContext,
  runner: Runner,
  pence: number,
  note: string | null,
): Promise<DepositOutcome> {
  const ready =
    runner.stripeConnectedAccountId !== null &&
    (await ctx.payments
      .getConnectedAccount(runner.stripeConnectedAccountId)
      .then((status) => status.transfersActive)
      .catch(() => false));
  if (!ready || !runner.stripeConnectedAccountId) {
    await ctx.repository.runners.update(runner.id, {
      coolBagRefundNote: note ?? 'Owed: waiting for their payout account.',
    });
    return { kind: 'owed', pence };
  }
  const transfer = await ctx.payments.createTransfer({
    amountPence: pence,
    currency: ctx.config.fees.currency,
    destinationAccountId: runner.stripeConnectedAccountId,
    orderId: `coolbag-${runner.id}`,
    description: `${ctx.config.productName} cool bag deposit paid back`,
    idempotencyKey: `coolbag:${runner.id}`,
  });
  await ctx.repository.runners.update(runner.id, {
    coolBagRefundedPence: pence,
    coolBagRefundedAt: ctx.now(),
    coolBagRefundTransferId: transfer.id,
    coolBagRefundNote: note,
    coolBagWithheldPence: 0,
    coolBagDepositStatus: 'released',
  });
  return { kind: 'paid', pence, transferId: transfer.id };
}

/**
 * A person's written decision about a deposit that waited: keep part of it against what is
 * owed (never more than is owed), and pay the rest back. What is kept repays the oldest debt
 * first, and the reason is kept on the Runner's account.
 */
export async function decideDeposit(
  ctx: LeavingContext,
  runner: Runner,
  input: { keepPence: number; note: string; by: string },
): Promise<{ kept: number; outcome: DepositOutcome }> {
  const held = depositHeld(runner);
  if (!runner.leftAt) throw new BadRequestError('That Runner has not left.');
  if (held <= 0) throw new ConflictError('There is no deposit left to decide about.');
  const owed = await ctx.repository.recoveries.listOutstanding(runner.id);
  const owedPence = owed.reduce((sum, row) => sum + row.amountPence - row.recoveredPence, 0);
  const keep = Math.min(input.keepPence, held, owedPence);
  if (input.keepPence > keep) {
    throw new BadRequestError(
      `No more than ${formatPence(Math.min(held, owedPence), ctx.config.store.currencySymbol)} can be kept: what is held, and never more than is owed.`,
    );
  }
  let left = keep;
  for (const row of owed) {
    if (left <= 0) break;
    const take = Math.min(left, row.amountPence - row.recoveredPence);
    await ctx.repository.recoveries.update(row.id, { recoveredPence: row.recoveredPence + take });
    left -= take;
  }
  const note = `${input.by}: ${input.note}${keep > 0 ? ` (kept ${formatPence(keep, ctx.config.store.currencySymbol)})` : ''}`;
  const rest = held - keep;
  if (rest <= 0) {
    await ctx.repository.runners.update(runner.id, {
      coolBagRefundedPence: 0,
      coolBagRefundedAt: ctx.now(),
      coolBagRefundNote: note,
      coolBagWithheldPence: 0,
      coolBagDepositStatus: 'released',
    });
    return { kept: keep, outcome: { kind: 'none' } };
  }
  await ctx.repository.runners.update(runner.id, { coolBagWithheldPence: rest });
  const outcome = await payDeposit(ctx, { ...runner, coolBagWithheldPence: rest }, rest, note);
  return { kept: keep, outcome };
}

/** The minute sweep: deposits owed to Runners who have left, sent once their account is ready. */
export async function sweepDeposits(
  ctx: LeavingContext,
  onError: (runnerId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  let paid = 0;
  for (const runner of await ctx.repository.runners.listAll()) {
    if (!runner.leftAt || depositHeld(runner) <= 0) continue;
    try {
      if ((await settleDeposit(ctx, runner)).kind === 'paid') paid += 1;
    } catch (failure) {
      onError(runner.id, failure);
    }
  }
  return paid;
}
