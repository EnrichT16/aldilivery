/**
 * Paying the Runner.
 *
 * Rule Two: five pounds on every completed order, without exception. The amount is read
 * from the constant in `@aldilivery/core`, never calculated from the fee, never scaled by
 * distance, never reduced because an order was small or pooled or late.
 *
 * Rule Ten: Aldilivery never holds Runner money. The five pounds moves by Stripe Connect
 * transfer to the Runner's own account. The only money that pauses is the cool bag deposit,
 * which is withheld a little at a time and paid over in full after the twentieth delivery.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, RUNNER_PAYMENT_PENCE } from '@aldilivery/core';
import { z } from 'zod';

import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { planPayout } from '../services/payouts.js';

export async function registerPayoutRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments, now } = app.ctx;
  const symbol = config.store.currencySymbol;

  app.post('/orders/:id/payout', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (!order.runnerId) throw new BadRequestError('That order has no Runner yet.');

    if (order.status !== 'delivered' && order.status !== 'completed') {
      throw new ConflictError('A Runner is paid once the order is delivered.');
    }

    const alreadyPaid = await repository.payouts.findByOrderId(order.id);
    if (alreadyPaid) {
      throw new ConflictError('That order has already been paid out.', {
        payoutId: alreadyPaid.id,
      });
    }

    const runner = await repository.runners.findById(order.runnerId);
    if (!runner) throw new NotFoundError('Runner');

    const plan = planPayout(
      {
        coolBagDepositStatus: runner.coolBagDepositStatus,
        coolBagWithheldPence: runner.coolBagWithheldPence,
        completedDeliveryCount: runner.completedDeliveryCount,
      },
      config.fees.coolBag,
    );

    // Rule Two, checked rather than assumed.
    if (plan.earnedPence !== RUNNER_PAYMENT_PENCE) {
      throw new Error('Rule Two: a Runner earns five pounds on every completed order.');
    }

    let transferId: string | null = null;
    if (plan.transferredPence > 0) {
      if (!runner.stripeConnectedAccountId) {
        throw new BadRequestError(
          'We cannot pay you until your bank details are set up. Nothing is lost; the money is owed to you.',
        );
      }
      const transfer = await payments.createTransfer({
        amountPence: plan.transferredPence,
        currency: config.fees.currency,
        destinationAccountId: runner.stripeConnectedAccountId,
        orderId: order.id,
        description: `${config.productName} delivery ${order.id}`,
      });
      transferId = transfer.id;
    }

    const payout = await repository.payouts.create({
      orderId: order.id,
      runnerId: runner.id,
      earnedPence: plan.earnedPence,
      coolBagWithheldPence: plan.coolBagWithheldPence,
      transferredPence: plan.transferredPence,
      stripeTransferId: transferId,
    });

    await repository.runners.update(runner.id, {
      coolBagDepositStatus: plan.coolBagDepositStatusAfter,
      coolBagWithheldPence: plan.coolBagWithheldTotalAfter,
      completedDeliveryCount: plan.completedDeliveryCountAfter,
      lastJobCompletedAt: now(),
    });

    const updatedOrder = await repository.orders.update(order.id, {
      status: 'completed',
      completedAt: order.completedAt ?? now(),
      runnerTransferId: transferId,
    });

    const notes = [`You earned ${formatPence(plan.earnedPence, symbol)} for this delivery.`];
    if (plan.coolBagWithheldPence > 0) {
      notes.push(
        `${formatPence(plan.coolBagWithheldPence, symbol)} is held towards your cool bag deposit. You get it back after ${config.fees.coolBag.releaseAfterCompletedDeliveries} deliveries.`,
      );
    }
    if (plan.coolBagReleasedPence > 0) {
      notes.push(
        `Your cool bag deposit of ${formatPence(plan.coolBagReleasedPence, symbol)} has been paid back to you.`,
      );
    }
    notes.push(`${formatPence(plan.transferredPence, symbol)} is on its way to your account.`);

    return { payout, plan, order: updatedOrder, notes };
  });

  /** A Runner's own record of what they have earned. */
  app.get('/runners/:id/payouts', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const runner = await repository.runners.findById(id);
    if (!runner) throw new NotFoundError('Runner');

    const payouts = await repository.payouts.listForRunner(id);
    return {
      payouts,
      totalEarnedPence: payouts.reduce((sum, payout) => sum + payout.earnedPence, 0),
      totalTransferredPence: payouts.reduce((sum, payout) => sum + payout.transferredPence, 0),
      coolBagHeldPence: runner.coolBagWithheldPence,
      coolBagDepositStatus: runner.coolBagDepositStatus,
      completedDeliveryCount: runner.completedDeliveryCount,
      perOrderPence: RUNNER_PAYMENT_PENCE,
    };
  });
}
