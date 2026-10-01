/**
 * Paying the Runner.
 *
 * Rule Two: five pounds on every completed order, without exception. The amount is read
 * from the constant in `@aldilivery/core`, never calculated from the fee, never scaled by
 * distance, never reduced because an order was small or pooled or late.
 *
 * Rule Ten: The service never holds Runner money. The five pounds moves by Stripe Connect
 * transfer to the Runner's own account. The only money that pauses is the cool bag deposit,
 * which is withheld a little at a time and paid over in full after the twentieth delivery.
 */

import type { FastifyInstance } from 'fastify';
import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession, requireStaff } from '../app.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { payOutOrder } from '../services/pay-runner.js';

export async function registerPayoutRoutes(app: FastifyInstance): Promise<void> {
  const { repository, payments, env } = app.ctx;

  /** Paying out one order by hand. For the server and staff only; it normally happens by itself. */
  app.post('/orders/:id/payout', async (request) => {
    requireStaff(request, app.ctx.env.staffKey);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return payOutOrder(app.ctx, id);
  });

  /**
   * A Runner's own record of what they have earned, and whether their pay can reach them.
   *
   * Until 27 Sep 2026 this was `/runners/:id/payouts` and answered anybody who knew a Runner's
   * id, signed in or not. It is now only ever the signed-in Runner's own.
   */
  app.get('/runners/me/payouts', async (request) => {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');

    const payouts = await repository.payouts.listForRunner(runner.id);
    const status = runner.stripeConnectedAccountId
      ? await payments.getConnectedAccount(runner.stripeConnectedAccountId)
      : null;

    // Delivered and not yet paid: owed, and paid by the sweep once their account is ready.
    const delivered = (await repository.orders.listByStatus('delivered')).filter(
      (order) => order.runnerId === runner.id,
    );
    const owed = [];
    for (const order of delivered) {
      if (!(await repository.payouts.findByOrderId(order.id))) owed.push(order);
    }

    return {
      setup: !status ? 'not_started' : status.transfersActive ? 'ready' : 'incomplete',
      payouts,
      totalEarnedPence: payouts.reduce((sum, payout) => sum + payout.earnedPence, 0),
      totalTransferredPence: payouts.reduce((sum, payout) => sum + payout.transferredPence, 0),
      owedPence: owed.length * RUNNER_PAYMENT_PENCE,
      owedDeliveries: owed.length,
      coolBagHeldPence: runner.coolBagWithheldPence,
      coolBagDepositStatus: runner.coolBagDepositStatus,
      completedDeliveryCount: runner.completedDeliveryCount,
      perOrderPence: RUNNER_PAYMENT_PENCE,
    };
  });

  /**
   * Start, or carry on with, setting up where a Runner's pay goes. Makes their Stripe account the
   * first time, and always hands back a fresh one-time link to Stripe's own form, where their
   * bank details go straight to Stripe and never through the service.
   */
  app.post('/runners/me/payouts/setup', async (request) => {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');

    // Back to the web app when Stripe is done: the one origin this API serves, or the one the
    // request came from if that is an allowed one.
    const origin = request.headers.origin;
    const allowed = env.allowedOrigins.filter((o) => o !== '*');
    const webOrigin =
      typeof origin === 'string' && (env.allowedOrigins.includes('*') || allowed.includes(origin))
        ? origin
        : allowed[0];
    if (!webOrigin) {
      throw new BadRequestError('We do not know where to send you back to. Please tell us.');
    }

    let accountId = runner.stripeConnectedAccountId;
    if (!accountId) {
      accountId = (await payments.createConnectedAccount({ runnerId: runner.id })).id;
      await repository.runners.update(runner.id, { stripeConnectedAccountId: accountId });
    }

    const link = await payments.createOnboardingLink({
      accountId,
      returnUrl: `${webOrigin}/runner/home?pay=back`,
      refreshUrl: `${webOrigin}/runner/home?pay=again`,
    });
    return { url: link.url };
  });
}
