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
import { chargeCalls } from '../services/calls.js';
import { applyCredit } from '../services/credit.js';
import { recordOrder } from '../lib/analytics.js';
import { cardRegionFor } from '../lib/card-region.js';
import { recordOrderIncome } from '../lib/ledger.js';
import { STRIPE_API_VERSION } from '../lib/payments.js';
import { offerOrder } from '../services/dispatch.js';
import {
  answerAuthorizationRequest,
  recordAuthorization,
  recordTransaction,
  releaseCard,
} from '../services/runner-card.js';
import { tellShopper } from '../services/order-updates.js';

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

    // A Runner is at a till with their spending card, and Stripe is waiting about two seconds
    // for a yes or no. The answer is the response itself, in the form Stripe asks for, with the
    // API version we speak. Anything we cannot tie to an order in hand is declined.
    if (event.type === 'issuing_authorization.request') {
      let approved = false;
      try {
        approved = (await answerAuthorizationRequest(app.ctx, object as never)).approved;
      } catch (failure) {
        request.log.error({ err: failure }, 'A card authorization could not be decided: declined.');
      }
      void reply.status(200).header('Stripe-Version', STRIPE_API_VERSION);
      return { approved };
    }
    const orderId = object.metadata?.orderId;

    switch (event.type) {
      case 'payment_intent.succeeded': {
        if (orderId) {
          const order = await repository.orders.findById(orderId);
          // Only ever confirms a payment for an order that was already confirmed and sent.
          if (order && order.status === 'confirmed') {
            await repository.orders.update(order.id, { status: 'paid' });
            // The bank has approved it: now it can go to a Runner. The sweep catches it if
            // nobody is free right now.
            if (app.ctx.autoOffer) {
              await offerOrder(app.ctx, order.id).catch(() => undefined);
            }
            // Their card has just been charged successfully: anything waiting for calls is
            // taken now too (ruling, 2 October 2026).
            await chargeCalls(app.ctx, order.shopperId, request.log).catch(() => undefined);
            await applyCredit(app.ctx, order.id, request.log).catch(() => 0);
            const paid = await repository.orders.findById(order.id);
            if (paid) {
              await recordOrder(app.ctx, paid, 'order_paid', request.log);
              await recordOrderIncome(repository, app.ctx.payments, paid, now());
              void tellShopper(app.ctx, paid, 'paid', request.log);
            }
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
              cancelReason: 'The card payment failed at the bank.',
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
            // Refunded while a Runner had it: their spending card is frozen at once.
            if (order.payMethodUsed === 'card') {
              await releaseCard(app.ctx, order.runnerId, order.id, request.log);
            }
          }
        }
        break;
      }

      // A telephone order paid on the link Ozi texted (ruling 48): the card is kept for next
      // time, the address given on Stripe's page is where the shopping goes, and only now is a
      // Runner sent.
      case 'checkout.session.completed': {
        const sessionId = (object as { id?: string }).id;
        const order = orderId ? await repository.orders.findById(orderId) : null;
        if (!order || order.status !== 'confirmed' || !sessionId) break;
        const paid = await payments.paidByLink(sessionId);
        if (!paid) break;
        const shopper = await repository.shoppers.findById(order.shopperId);
        if (!shopper) break;
        if (paid.customerId && !shopper.stripeCustomerId) {
          await repository.shoppers.update(shopper.id, { stripeCustomerId: paid.customerId });
        }
        if (shopper.deliveryAddress.trim() === '' && paid.address) {
          await repository.shoppers.update(shopper.id, { deliveryAddress: paid.address });
        }
        const cards = await repository.paymentMethods.listForShopper(shopper.id);
        const card =
          cards.find((existing) => existing.stripePaymentMethodId === paid.paymentMethodId) ??
          (await repository.paymentMethods.create({
            shopperId: shopper.id,
            stripePaymentMethodId: paid.paymentMethodId,
            lastFour: paid.lastFour,
            brand: paid.brand,
            region: paid.country ? cardRegionFor(paid.country) : null,
            isDefault: cards.length === 0,
          }));
        const updated = await repository.orders.update(order.id, {
          status: 'paid',
          stripePaymentIntentId: paid.paymentIntentId,
          paymentMethodId: card.id,
          deliveryAddress: paid.address || shopper.deliveryAddress,
        });
        if (app.ctx.autoOffer) await offerOrder(app.ctx, updated.id).catch(() => undefined);
        await recordOrder(app.ctx, updated, 'order_paid', request.log);
        await recordOrderIncome(repository, payments, updated, now());
        void tellShopper(app.ctx, updated, 'paid', request.log);
        break;
      }

      // The link ran out unpaid: the order is closed, and nothing was taken.
      case 'checkout.session.expired': {
        const order = orderId ? await repository.orders.findById(orderId) : null;
        if (order && order.status === 'confirmed') {
          await repository.orders.update(order.id, {
            status: 'cancelled',
            cancelledAt: now(),
            cancelReason: 'The payment link ran out unpaid.',
          });
        }
        break;
      }

      // The spending card (services/runner-card.ts): what each authorization came to, and the
      // money that actually moved, recorded on the order.
      case 'issuing_authorization.created':
      case 'issuing_authorization.updated': {
        await recordAuthorization(app.ctx, object as never, request.log);
        break;
      }
      case 'issuing_transaction.created': {
        await recordTransaction(app.ctx, object as never, request.log);
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
