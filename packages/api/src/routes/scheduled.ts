/**
 * Booked orders (ruling 78): the Shopper's own list, changing and cancelling them, what a Runner
 * sees of tomorrow, and the "Pay us by bank" page.
 *
 * Runners see only how many orders are booked for tomorrow, by window: never who, where or what.
 * The bank page is for those who pay us, Shoppers, Shop Partners and organisations, and never
 * for Runners, who do not. The account number and sort code are shown on the page and never
 * written to any log.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { ForbiddenError, NotFoundError, UnauthorisedError } from '../errors.js';
import { bankSettings } from '../lib/bank.js';
import { businessActor } from '../lib/business.js';
import {
  bookedForTomorrow,
  bookedView,
  cancelBooking,
  changeBooking,
  personalReference,
} from '../services/scheduled.js';

const changeSchema = z
  .object({
    deliveryDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    window: z.enum(['morning', 'afternoon', 'evening']).optional(),
    chargeDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    chargeTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Please give the time as HH:MM, such as 00:05.')
      .optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Please say what to change: the day, the time of day, or when the money is taken.',
  });

export async function registerScheduledRoutes(app: FastifyInstance): Promise<void> {
  const { repository } = app.ctx;

  async function myBooked(request: Parameters<typeof requireSession>[0]) {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(id);
    if (!order || order.shopperId !== session.accountId || !order.deliveryDay) {
      throw new NotFoundError('booked order');
    }
    return order;
  }

  /** The Shopper's booked orders that have not come yet, soonest first. */
  app.get('/orders/booked', async (request) => {
    const session = requireSession(request, 'shopper');
    const orders = (await repository.orders.listForShopper(session.accountId))
      .filter(
        (order) =>
          order.deliveryDay !== null &&
          ['confirmed', 'paid', 'offered', 'accepted'].includes(order.status),
      )
      .sort((a, b) => (a.offerAt?.getTime() ?? 0) - (b.offerAt?.getTime() ?? 0));
    return { orders: orders.map((order) => bookedView(app.ctx, order)) };
  });

  app.post('/orders/:id/booking', async (request) => {
    const order = await myBooked(request);
    const change = changeSchema.parse(request.body);
    const updated = await changeBooking(app.ctx, order, change, request.log);
    const view = bookedView(app.ctx, updated);
    return {
      order: view,
      message: `Changed. Your order now comes ${view.deliveryWords}.${updated.chargePlan === 'scheduled' && updated.status === 'confirmed' ? ` The payment is taken ${view.chargeWords}.` : ''}`,
    };
  });

  app.post('/orders/:id/booking/cancel', async (request) => {
    const order = await myBooked(request);
    const outcome = await cancelBooking(app.ctx, order, request.log);
    return {
      order: bookedView(app.ctx, outcome.order),
      refundedPence: outcome.refundedPence,
      message: outcome.message,
    };
  });

  /** A Runner's home page: how many are booked for tomorrow, by window, and nothing more. */
  app.get('/runner/booked', async (request) => {
    requireSession(request, 'runner');
    return bookedForTomorrow(app.ctx);
  });

  function bankDetails(reference: string) {
    const bank = bankSettings(app.ctx.env.storeConfigPath);
    if (!bank.enabled) {
      return {
        enabled: false as const,
        message: 'Paying by bank transfer is not switched on yet.',
      };
    }
    return {
      enabled: true as const,
      accountName: bank.accountName,
      sortCode: bank.sortCode,
      accountNumber: bank.accountNumber,
      reference,
    };
  }

  /**
   * "Pay us by bank", for a Shopper: the business account and a reference of their own, for a
   * transfer or a standing order set up in their own banking app. Not for Runners.
   */
  app.get('/pay-by-bank', async (request) => {
    if (!request.session) throw new UnauthorisedError();
    if (request.session.role === 'runner') {
      throw new ForbiddenError('Runners do not pay us, so there is nothing to pay here.');
    }
    const bank = bankSettings(app.ctx.env.storeConfigPath);
    return bankDetails(
      personalReference(bank.referencePrefix, 'shopper', request.session.accountId),
    );
  });

  /** The same for a Shop Partner or an organisation, paying their monthly fees. */
  app.get('/business/pay-by-bank', async (request) => {
    const user = await businessActor(request);
    const bank = bankSettings(app.ctx.env.storeConfigPath);
    const kind = user.kind === 'partner' ? 'partner' : 'organisation';
    const accountId = (kind === 'partner' ? user.partnerShopId : user.organisationId) ?? user.id;
    return bankDetails(personalReference(bank.referencePrefix, kind, accountId));
  });
}
