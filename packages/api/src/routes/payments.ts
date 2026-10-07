/**
 * Bank transfers to the business account (ruling 50), and receipts.
 *
 * The Payments tab of the admin panel lists every order waiting for a transfer, with its
 * reference and amount, so a person can match it against the business bank account and mark it
 * as received. Only then is the order paid and offered to a Runner. Every paid order, however
 * it was paid, has a receipt the Shopper can download.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import { requireSession } from '../app.js';
import type { Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { recordOrder } from '../lib/analytics.js';
import { textPdf } from '../lib/pdf.js';
import { staffActor } from '../lib/staff.js';
import { offerOrder } from '../services/dispatch.js';
import { tellShopper } from '../services/order-updates.js';

const PAID: Order['status'][] = [
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
];

export async function registerPaymentRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  async function row(order: Order) {
    const shopper = await repository.shoppers.findById(order.shopperId);
    return {
      orderId: order.id,
      reference: order.bankReference,
      amountPence: order.totalEstimatePence,
      shopperName: shopper?.displayName ?? 'A Shopper',
      placedAt: order.spokenConfirmationAt ?? order.createdAt,
      receivedAt: order.bankReceivedAt,
      status: order.status,
    };
  }

  app.get('/staff/payments', async (request) => {
    await staffActor(request, 'payments');
    const waiting = (await repository.orders.listByStatus('confirmed')).filter(
      (order) => order.paidBy === 'bank',
    );
    const received: Order[] = [];
    for (const status of PAID) {
      for (const order of await repository.orders.listByStatus(status)) {
        if (order.paidBy === 'bank') received.push(order);
      }
    }
    received.sort(
      (a, b) => (b.bankReceivedAt?.getTime() ?? 0) - (a.bankReceivedAt?.getTime() ?? 0),
    );
    return {
      waiting: await Promise.all(waiting.map(row)),
      received: await Promise.all(received.slice(0, 50).map(row)),
    };
  });

  app.post('/staff/payments/:orderId/received', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(orderId);
    if (!order || order.paidBy !== 'bank') throw new NotFoundError('bank transfer order');
    if (order.status !== 'confirmed')
      throw new ConflictError('That order is not waiting for a transfer.');
    const at = now();
    const paid = await repository.orders.update(order.id, { status: 'paid', bankReceivedAt: at });
    await repository.income.record({
      at,
      gateway: 'Bank transfer',
      kind: 'order',
      amountPence: paid.totalEstimatePence,
      reference: paid.bankReference ?? paid.id,
    });
    if (app.ctx.autoOffer) await offerOrder(app.ctx, paid.id).catch(() => undefined);
    await recordOrder(app.ctx, paid, 'order_paid', request.log);
    void tellShopper(app.ctx, paid, 'paid', request.log);
    request.log.info(
      { orderId: paid.id, by: actor.name },
      'A bank transfer was marked as received.',
    );
    return {
      message: `Marked as received: ${money(paid.totalEstimatePence)}, reference ${paid.bankReference}. The order is going to a Runner.`,
    };
  });

  app.post('/staff/payments/:orderId/cancel', async (request) => {
    await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(orderId);
    if (!order || order.paidBy !== 'bank') throw new NotFoundError('bank transfer order');
    if (order.status !== 'confirmed')
      throw new ConflictError('That order is not waiting for a transfer.');
    await repository.orders.update(order.id, { status: 'cancelled', cancelledAt: now() });
    return { message: `Cancelled: reference ${order.bankReference}. Nothing was taken.` };
  });

  /** A receipt for a paid order, as a PDF, for the Shopper who placed it. */
  app.get('/orders/:id/receipt.pdf', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(id);
    if (!order || order.shopperId !== session.accountId) throw new NotFoundError('order');
    if (!PAID.includes(order.status))
      throw new ConflictError('There is no receipt until it is paid.');
    const shopper = await repository.shoppers.findById(order.shopperId);
    const total = order.finalTotalPence ?? order.totalEstimatePence;
    const lines = [
      `Receipt for ${shopper?.displayName ?? 'you'}`,
      `Order ${order.id}`,
      `Paid ${order.paidBy === 'bank' ? `by bank transfer, reference ${order.bankReference}` : 'by card'}`,
      `Delivered to ${order.deliveryAddress}`,
      '',
      ...order.items.map(
        (item) =>
          `${item.quantity} x ${item.name}  ${money((item.actualPricePence ?? item.estimatedPricePence) * item.quantity)}`,
      ),
      '',
      `Shopping: ${money(order.receiptTotalPence ?? order.goodsEstimatePence)}`,
      `Delivery: ${money(order.receiptFeePence ?? order.feePence)}`,
      `Total: ${money(total)}`,
      order.receiptTotalPence === null
        ? 'The shopping is an estimate until your Runner reaches the till.'
        : '',
      '',
      `${config.productName}. ${config.motto}`,
    ];
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="receipt-${order.id}.pdf"`);
    return reply.send(textPdf(`${config.productName} receipt`, lines));
  });
}
