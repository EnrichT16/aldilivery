/**
 * What an in-app call costs, and taking it (docs/BUILD_PROMPT.md, Sections B and F; rulings of
 * 2 October 2026).
 *
 * - 5p a minute for each person on the call (`calls.pencePerMinute`).
 * - The Shopper pays: their own minutes, and the minutes of everyone they added. A Runner never
 *   pays (Rule Two), so a Runner's minutes are never counted.
 * - Each person's time is rounded up to a whole minute. A Shopper who never answered pays
 *   nothing.
 * - The charge is taken from the Shopper's card when the call ends. If the card cannot be
 *   charged, it waits as outstanding and is taken the next time a charge succeeds. Above
 *   `calls.maxOutstandingPence` waiting, nobody more can be added to a call until it is paid.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Call, CallLeg } from '../domain.js';

export function priceStatement(pencePerMinute: number): string {
  return `In-app calls cost ${pencePerMinute}p a minute, paid from your card when the call ends.`;
}

export function guestPriceStatement(name: string, pencePerMinute: number): string {
  return `Adding ${name} costs ${pencePerMinute}p a minute for them, paid from your card.`;
}

/** The minutes the Shopper pays for: theirs, and each guest's, each rounded up. */
export function billableMinutes(legs: CallLeg[]): number {
  return legs
    .filter((leg) => leg.role !== 'runner')
    .reduce((total, leg) => total + Math.ceil(leg.secondsConnected / 60), 0);
}

export async function outstandingPence(ctx: AppContext, shopperId: string): Promise<number> {
  const due = await ctx.repository.calls.listChargesDue(shopperId);
  return due
    .filter((call) => call.chargeStatus === 'outstanding')
    .reduce((total, call) => total + call.chargePence, 0);
}

/** Close any leg still connected at `at`, adding its time. */
export async function closeLegs(ctx: AppContext, callId: string, at: Date): Promise<CallLeg[]> {
  const legs = await ctx.repository.callLegs.listForCall(callId);
  return Promise.all(
    legs.map(async (leg) => {
      if (!leg.connectedSince) return leg;
      const seconds = Math.max(0, Math.round((at.getTime() - leg.connectedSince.getTime()) / 1000));
      return ctx.repository.callLegs.update(leg.id, {
        connectedSince: null,
        secondsConnected: leg.secondsConnected + seconds,
      });
    }),
  );
}

/** End the call, work out what it cost, and try to take it. Safe to call twice. */
export async function finishCall(
  ctx: AppContext,
  call: Call,
  at: Date,
  log: FastifyBaseLogger,
): Promise<Call> {
  if (call.status === 'ended') return call;
  const legs = await closeLegs(ctx, call.id, at);
  const minutes = billableMinutes(legs);
  const chargePence = minutes * call.pencePerMinute;
  const ended = await ctx.repository.calls.update(call.id, {
    status: 'ended',
    endedAt: at,
    billedMinutes: minutes,
    chargePence,
    chargeStatus: chargePence === 0 ? 'not_due' : 'pending',
  });
  if (chargePence === 0) return ended;
  return chargeCalls(ctx, ended.shopperId, log).then(
    async () => (await ctx.repository.calls.findById(ended.id)) ?? ended,
  );
}

/**
 * Take every call charge this Shopper owes: anything pending, then anything outstanding,
 * oldest first. Stops at the first refusal, leaving the rest outstanding. Called when a call
 * ends and after any of their payments succeeds.
 */
export async function chargeCalls(
  ctx: AppContext,
  shopperId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const { repository, payments, config, now } = ctx;
  const shopper = await repository.shoppers.findById(shopperId);
  if (!shopper) return;
  const cards = await repository.paymentMethods.listForShopper(shopperId);
  const card = cards.find((method) => method.isDefault) ?? cards[0];

  const pending = await repository.calls.listChargesDue(shopperId);
  for (const call of pending) {
    if (!card) {
      await repository.calls.update(call.id, { chargeStatus: 'outstanding' });
      continue;
    }
    try {
      const charged = await payments.chargeSavedCard({
        amountPence: call.chargePence,
        currency: config.store.currency,
        paymentMethodId: card.stripePaymentMethodId,
        // Cards are not yet saved to a Stripe customer (BUILD_LOG, Step 37): until they are,
        // a live charge waits as outstanding rather than failing a second time.
        customerId: null,
        description: `${config.productName} call, ${call.billedMinutes} minutes`,
        reference: `call:${call.id}`,
        agreedAt: (call.priceAcceptedAt ?? call.createdAt).toISOString(),
      });
      await repository.calls.update(call.id, {
        chargeStatus: 'paid',
        paymentReference: charged.id,
        chargedAt: now(),
      });
    } catch (failure) {
      log.warn({ err: failure, callId: call.id }, 'A call charge could not be taken; it waits.');
      await repository.calls.update(call.id, { chargeStatus: 'outstanding' });
      // Mark the rest outstanding too, and try again next time.
      for (const rest of pending.slice(pending.indexOf(call) + 1)) {
        await repository.calls.update(rest.id, { chargeStatus: 'outstanding' });
      }
      return;
    }
  }
}
