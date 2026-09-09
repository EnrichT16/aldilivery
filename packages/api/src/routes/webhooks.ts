/**
 * Stripe webhooks.
 *
 * An unverified webhook is not an event, it is somebody typing at our server. The signature
 * is checked before anything is read, and a failure is a 400 with no detail.
 *
 * Note what this handler does not do: it never creates or advances a payment. It records
 * what Stripe says happened to a payment that Rule One already allowed. A webhook cannot be
 * used to charge a Shopper who never confirmed.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { BadRequestError } from '../errors.js';

interface PaymentIntentLike {
  id?: string;
  metadata?: { orderId?: string };
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const { repository, payments, now } = app.ctx;

  app.post('/webhooks/stripe', async (request: FastifyRequest, reply) => {
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      throw new BadRequestError('That request was not signed.');
    }

    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestError('That request had no body.');
    }

    let event;
    try {
      event = payments.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new BadRequestError('That signature did not check out.');
    }

    const object = (event.data as { object?: PaymentIntentLike } | undefined)?.object ?? {};
    const orderId = object.metadata?.orderId;

    switch (event.type) {
      case 'payment_intent.succeeded': {
        if (orderId) {
          const order = await repository.orders.findById(orderId);
          // Only ever confirms a payment for an order that was already confirmed and sent.
          if (order && order.status === 'confirmed') {
            await repository.orders.update(order.id, { status: 'paid' });
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        if (orderId) {
          const order = await repository.orders.findById(orderId);
          if (order && (order.status === 'confirmed' || order.status === 'paid')) {
            await repository.orders.update(order.id, {
              status: 'cancelled',
              cancelledAt: now(),
            });
          }
        }
        break;
      }

      case 'charge.refunded': {
        if (orderId) {
          const order = await repository.orders.findById(orderId);
          if (order) {
            await repository.orders.update(order.id, { status: 'refunded' });
          }
        }
        break;
      }

      default:
        // Everything else is acknowledged and ignored. Stripe sends a great deal we do not
        // need, and answering 200 stops it retrying forever.
        break;
    }

    void reply.status(200);
    return { received: true, type: event.type };
  });
}
