/**
 * Paying Runners back for the shopping, for staff (ruling 55).
 *
 * Most pay-backs go by themselves the moment the till total is in. The ones that need a person
 * (the till far over the estimate, a bank transfer order, a refund or a charge that failed, or
 * more than one delivery carries) wait in the admin panel's Payments tab, for the founder or
 * the finance officer to approve. Approving sends it straight to the Runner's own account and
 * tells them. Never more than the till total, and never more than one delivery carries.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import type { Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import { reimbursementReference, sendReimbursement } from '../services/reimburse.js';
import { orderReference } from './runner-account.js';

const approveSchema = z.object({
  /** A smaller amount, if the person decides only part of the till total should be paid back. */
  amountPence: z.number().int().min(1).optional(),
  by: z.string().trim().min(1).max(80).default('Staff'),
});

export async function registerReimbursementRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  async function row(order: Order) {
    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    return {
      orderId: order.id,
      reference: orderReference(order.id),
      transferReference: reimbursementReference(order.id),
      runnerName: runner?.name ?? 'A Runner',
      goodsEstimatePence: order.goodsEstimatePence,
      receiptTotalPence: order.receiptTotalPence,
      amountPence: order.reimbursementPence ?? 0,
      status: order.reimbursementStatus,
      reason: order.reimbursementReason,
      approvedBy: order.reimbursementApprovedBy,
      paidAt: order.reimbursedAt,
    };
  }

  app.get('/staff/reimbursements', async (request) => {
    await staffActor(request, 'payments');
    const paid = (await repository.orders.listByReimbursementStatus('paid')).sort(
      (a, b) => (b.reimbursedAt?.getTime() ?? 0) - (a.reimbursedAt?.getTime() ?? 0),
    );
    return {
      waiting: await Promise.all(
        (await repository.orders.listByReimbursementStatus('waiting')).map(row),
      ),
      owed: await Promise.all((await repository.orders.listByReimbursementStatus('owed')).map(row)),
      paid: await Promise.all(paid.slice(0, 50).map(row)),
    };
  });

  app.post('/staff/reimbursements/:orderId/approve', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = approveSchema.parse(request.body ?? {});
    const order = await repository.orders.findById(orderId);
    if (!order) throw new NotFoundError('order');
    if (order.reimbursementStatus !== 'waiting' || order.receiptTotalPence === null) {
      throw new ConflictError('That pay-back is not waiting for anybody to approve it.');
    }

    // Never more than the till said, and never more than one delivery carries.
    const most = Math.min(order.receiptTotalPence, config.fees.maximumGoodsPence);
    const pence = Math.min(body.amountPence ?? order.reimbursementPence ?? most, most);
    await repository.orders.update(order.id, { reimbursementPence: pence });

    const by = decidedBy(actor, body.by);
    const outcome = await sendReimbursement(app.ctx, order.id, by, request.log);
    request.log.info({ orderId: order.id, by, pence }, 'A Runner pay-back was approved.');

    // The Runner is not watching the screen for this one, so they are told by text.
    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    if (runner && app.ctx.sendText) {
      await app.ctx
        .sendText(runner.phone, `${config.productName}: ${outcome.message}`)
        .catch((failure: unknown) =>
          request.log.warn({ err: failure }, 'The Runner could not be told.'),
        );
    }

    return {
      outcome,
      message:
        outcome.kind === 'paid'
          ? `Approved: ${money(pence)} paid back to ${runner?.name ?? 'the Runner'}.`
          : `Approved: ${money(pence)} is owed to ${runner?.name ?? 'the Runner'}, and goes as soon as their payout account is ready.`,
    };
  });
}
