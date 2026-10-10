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

import { formatPence, itemChargePence } from '@aldilivery/core';

import { requireSession } from '../app.js';
import type { Order } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { recordOrder } from '../lib/analytics.js';
import { textPdf } from '../lib/pdf.js';
import { staffActor } from '../lib/staff.js';
import { basketGroup, carryWithFirstRunner, listTinyExtras } from '../services/basket-orders.js';
import { offerOrder } from '../services/dispatch.js';
import { orderReference } from './runner-account.js';
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
    // A basket kept whole (ruling 61) is one transfer for every linked order.
    const group = await basketGroup(app.ctx, order);
    return {
      orderId: order.id,
      reference: order.bankReference,
      amountPence: group.reduce((sum, linked) => sum + linked.totalEstimatePence, 0),
      orders: group.length,
      shopperName: shopper?.displayName ?? 'A Shopper',
      placedAt: order.spokenConfirmationAt ?? order.createdAt,
      receivedAt: order.bankReceivedAt,
      status: order.status,
    };
  }

  app.get('/staff/payments', async (request) => {
    await staffActor(request, 'payments');
    const waiting = (await repository.orders.listByStatus('confirmed')).filter(
      (order) => order.paidBy === 'bank' && (order.basketPart ?? 1) === 1,
    );
    const received: Order[] = [];
    for (const status of PAID) {
      for (const order of await repository.orders.listByStatus(status)) {
        if (order.paidBy === 'bank' && (order.basketPart ?? 1) === 1) received.push(order);
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
    // Every linked order of a basket kept whole came in the one transfer (ruling 61).
    const group = (await basketGroup(app.ctx, order)).filter((row) => row.status === 'confirmed');
    let paid = order;
    let amountPence = 0;
    for (const linked of group) {
      const updated = await repository.orders.update(linked.id, { status: 'paid', bankReceivedAt: at });
      if (linked.id === order.id) paid = updated;
      amountPence += updated.totalEstimatePence;
      if (app.ctx.autoOffer) await offerOrder(app.ctx, updated.id).catch(() => undefined);
      await recordOrder(app.ctx, updated, 'order_paid', request.log);
    }
    await repository.income.record({
      at,
      gateway: 'Bank transfer',
      kind: 'order',
      amountPence,
      reference: paid.bankReference ?? paid.id,
    });
    void tellShopper(app.ctx, paid, 'paid', request.log);
    request.log.info(
      { orderId: paid.id, by: actor.name },
      'A bank transfer was marked as received.',
    );
    return {
      message: `Marked as received: ${money(amountPence)}, reference ${paid.bankReference}. The order is going to a Runner.`,
    };
  });

  app.post('/staff/payments/:orderId/cancel', async (request) => {
    await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(orderId);
    if (!order || order.paidBy !== 'bank') throw new NotFoundError('bank transfer order');
    if (order.status !== 'confirmed')
      throw new ConflictError('That order is not waiting for a transfer.');
    for (const linked of await basketGroup(app.ctx, order)) {
      if (linked.status !== 'confirmed') continue;
      await repository.orders.update(linked.id, {
        status: 'cancelled',
        cancelledAt: now(),
        cancelReason: 'The bank transfer never came; cancelled by staff.',
        ...(linked.extraDeliveryStatus ? { extraDeliveryStatus: 'waived' as const } : {}),
      });
    }
    return { message: `Cancelled: reference ${order.bankReference}. Nothing was taken.` };
  });

  /**
   * Tiny extras (ruling 61): a linked order after the first with under £5 of shopping, so a
   * person can ask the first Runner to carry it instead of sending another for £13.50.
   */
  app.get('/staff/tiny-extras', async (request) => {
    await staffActor(request, 'payments');
    const rows = await listTinyExtras(app.ctx);
    return {
      tinyExtras: await Promise.all(
        rows.map(async ({ order, first }) => {
          const firstRunner = first?.runnerId ? await repository.runners.findById(first.runnerId) : null;
          return {
            orderId: order.id,
            reference: orderReference(order.id),
            firstOrderId: first?.id ?? null,
            firstReference: first ? orderReference(first.id) : null,
            part: order.basketPart,
            of: order.basketOf,
            goodsPence: order.goodsEstimatePence,
            extraDeliveryPence: order.feePence,
            items: order.items.map((item) => `${item.quantity} × ${item.name}`),
            // Who to ask: the first order's Runner, once there is one.
            firstRunner: firstRunner ? { name: firstRunner.name, phone: firstRunner.phone } : null,
            firstStatus: first?.status ?? null,
          };
        }),
      ),
    };
  });

  app.post('/staff/tiny-extras/:orderId/carry-with-first', async (request) => {
    const actor = await staffActor(request, 'payments');
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const { first, extra } = await carryWithFirstRunner(app.ctx, orderId, request.log);
    request.log.info({ orderId, by: actor.name }, 'A tiny extra was carried with the first Runner.');
    return {
      first,
      extra,
      message: `Done: the ${money(extra.goodsEstimatePence)} of shopping goes with the first Runner, order ${orderReference(first.id)}, and the extra ${money(extra.feePence)} delivery is not taken.`,
    };
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
      // Each price with its item charge in it, as it was shown (ruling 58), and the parts.
      ...order.items.map((item) => {
        const shop = (item.actualPricePence ?? item.estimatedPricePence) * item.quantity;
        const charge = itemChargePence(item.estimatedPricePence, config.fees) * item.quantity;
        return `${item.quantity} x ${item.name}  ${money(shop + charge)} (${money(shop)} in the shop, ${money(charge)} item charge${item.quantity === 1 ? '' : 's'})`;
      }),
      '',
      `Shop total: ${money(order.receiptTotalPence ?? order.goodsEstimatePence)}`,
      `Item charges: ${money(order.itemChargesPence)}`,
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
