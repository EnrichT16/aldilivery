/**
 * Photos of till receipts (docs/STILL_TO_DO.md item 2).
 *
 * A Runner sends the photo with the till total, or afterwards here. Staff who approve pay-backs
 * or settle till totals (the founder and the finance officer) can look at it. Nobody else can:
 * not the Shopper, whose order it is (they have their own receipt to download), and not other
 * Runners.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { staffActor } from '../lib/staff.js';
import { keepReceiptPhoto, receiptPhotoSchema } from '../services/receipt-photo.js';
import { receiptPhotoArrived } from '../services/reimburse.js';

export async function registerReceiptPhotoRoutes(app: FastifyInstance): Promise<void> {
  const { repository } = app.ctx;

  /** The Runner adds the photo after the till total. A pay-back waiting only for it goes now. */
  app.post('/orders/:id/receipt-photo', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const session = requireSession(request, 'runner');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const photo = receiptPhotoSchema.parse(request.body);
    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (order.runnerId !== session.accountId) {
      throw new ForbiddenError('That order is not yours.');
    }
    if (['delivered', 'completed', 'cancelled', 'refunded'].includes(order.status)) {
      throw new ConflictError('That order is finished. If the receipt matters, please tell us.');
    }
    await keepReceiptPhoto(app.ctx, order.id, photo);
    const paidBack = await receiptPhotoArrived(app.ctx, order.id, request.log);
    void reply.status(201);
    return {
      saved: true,
      reimbursement: paidBack,
      message: paidBack
        ? `Thank you, the photo of the receipt is in. ${paidBack.message}`
        : 'Thank you, the photo of the receipt is in.',
    };
  });

  /** The photo, for the people approving pay-backs and settling till totals. */
  app.get('/staff/orders/:id/receipt-photo', async (request, reply) => {
    await staffActor(request, 'payments');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const photo = await repository.receiptPhotos.findByOrderId(id);
    if (!photo) throw new NotFoundError('receipt photo');
    void reply.header('content-type', photo.contentType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(photo.data));
  });
}
