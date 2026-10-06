/**
 * Paid extras (6 October 2026). Ozi Recipes: the full recipes, read out by Ozi and added to the
 * basket in one go, for a small price for a number of days, taken from the saved card.
 *
 * Rule One: the price is said and agreed before anything is taken, and the agreement travels
 * with the request. Nothing renews by itself: when the days run out, it is simply locked again.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError, NotFoundError, UnavailableError } from '../errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function registerExtrasRoutes(app: FastifyInstance): Promise<void> {
  const { repository, payments, config, now } = app.ctx;

  app.post('/extras/recipe-pass', async (request) => {
    const session = requireSession(request, 'shopper');
    const { recipePassPence, recipePassDays } = config.extras;
    const price = formatPence(recipePassPence, config.store.currencySymbol);
    z.object({
      priceAccepted: z.literal(true, {
        errorMap: () => ({ message: `Please agree to the price first: ${price}.` }),
      }),
    }).parse(request.body ?? {});

    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    const cards = await repository.paymentMethods.listForShopper(shopper.id);
    const card = cards.find((method) => method.isDefault) ?? cards[0];
    if (!card) throw new ConflictError('Please save a card first. Nothing has been charged.');

    const at = now();
    const from =
      shopper.recipePassUntil && shopper.recipePassUntil.getTime() > at.getTime()
        ? shopper.recipePassUntil
        : at;
    const until = new Date(from.getTime() + recipePassDays * DAY_MS);

    let reference: string;
    try {
      reference = (
        await payments.chargeSavedCard({
          amountPence: recipePassPence,
          currency: config.store.currency,
          paymentMethodId: card.stripePaymentMethodId,
          customerId: shopper.stripeCustomerId,
          description: `${config.productName} Recipes, ${recipePassDays} days`,
          reference: `recipe-pass:${shopper.id}:${at.toISOString()}`,
          agreedAt: at.toISOString(),
        })
      ).id;
    } catch (failure) {
      request.log.warn({ err: failure }, 'A recipe pass could not be charged');
      throw new UnavailableError(
        `The card could not be charged just now, so Recipes is not unlocked and nothing was taken. Please try again, or use another card.`,
      );
    }
    if (!reference) throw new BadRequestError('The payment could not be confirmed.');

    await repository.shoppers.update(shopper.id, { recipePassUntil: until });
    const words = until.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/London',
    });
    return {
      recipePassUntil: until,
      message: `Recipes is unlocked until ${words}. ${price} was taken from your card ending ${card.lastFour}. It does not renew by itself.`,
    };
  });
}
