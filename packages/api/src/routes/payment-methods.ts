/**
 * Saved cards.
 *
 * Rule Ten. Look at what this route accepts: a Stripe payment method identifier and the
 * last four digits. That is the whole of it. There is no field for a card number, and the
 * schema below would reject one. The card details went from the Shopper's browser to
 * Stripe and never came here.
 */

import type { FastifyInstance } from 'fastify';

import { refuseIfDemo } from '../services/demo.js';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { cardAccepted, cardRegionFor } from '../lib/card-region.js';

const saveSchema = z.object({
  /** From Stripe, in the browser. Looks like `pm_1234...`. */
  stripePaymentMethodId: z.string().trim().min(3).max(120),
  lastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'We only keep the last four digits.'),
  brand: z.string().trim().max(30).optional(),
  /** The issuing country as Stripe gives it (`GB`), or a region name (`UK`). */
  region: z.string().trim().max(10).optional(),
  isDefault: z.boolean().optional(),
});

export async function registerPaymentMethodRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments } = app.ctx;

  app.post('/payment-methods', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const input = saveSchema.parse(request.body);
    const region = input.region ? cardRegionFor(input.region) : undefined;

    if (!cardAccepted(config.payments.supportedCardRegions, region ?? null)) {
      throw new BadRequestError(
        `We can only take cards from ${config.payments.supportedCardRegions.join(' and ')} at the moment.`,
      );
    }

    // Attach the card to the Shopper's Stripe customer, so it can be charged again: for the
    // next order, and for a call that ends with nobody at the screen. A card that is not
    // attached is spent after one payment.
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    // The demo account (ruling 60) keeps its demo card: no real card is ever saved on it.
    refuseIfDemo(shopper);
    let customerId: string;
    try {
      ({ customerId } = await payments.saveCardForReuse({
        shopperId: shopper.id,
        customerId: shopper.stripeCustomerId,
        paymentMethodId: input.stripePaymentMethodId,
      }));
    } catch (failure) {
      request.log.warn({ err: failure }, 'Stripe would not keep a card.');
      throw new BadRequestError(
        'We could not save that card. Please check the details, or try a different card. Nothing has been charged.',
      );
    }
    if (customerId !== shopper.stripeCustomerId) {
      await repository.shoppers.update(shopper.id, { stripeCustomerId: customerId });
    }

    const method = await repository.paymentMethods.create({
      shopperId: session.accountId,
      stripePaymentMethodId: input.stripePaymentMethodId,
      lastFour: input.lastFour,
      brand: input.brand ?? null,
      region: region ?? null,
      isDefault: input.isDefault ?? true,
    });

    void reply.status(201);
    return { paymentMethod: method, message: `Saved. The card ending ${method.lastFour}.` };
  });

  app.get('/payment-methods', async (request) => {
    const session = requireSession(request, 'shopper');
    const methods = await repository.paymentMethods.listForShopper(session.accountId);
    return { paymentMethods: methods };
  });
}
