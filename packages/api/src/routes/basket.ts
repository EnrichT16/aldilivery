/**
 * Pricing a basket before anybody commits to anything.
 *
 * This route exists so that the fee is on the screen, in words, before the confirmation
 * button. A Shopper should never find out what the fee was after agreeing to it.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, needsCarRunner } from '@aldilivery/core';
import { z } from 'zod';

import { priceLines } from '../services/basket.js';
import { deliveryPlanFor } from '../services/plans.js';

const basketSchema = z.object({
  lines: z
    .array(
      z.object({
        catalogueItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1, 'There is nothing in the basket yet.'),
});

export async function registerBasketRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;

  app.post('/basket/price', async (request) => {
    const { lines } = basketSchema.parse(request.body);

    const items = await repository.catalogue.findManyByIds(
      lines.map((line) => line.catalogueItemId),
    );

    // The delivery price follows the signed-in Shopper's plan; anybody else pays as they go.
    const shopper =
      request.session?.role === 'shopper'
        ? await repository.shoppers.findById(request.session.accountId)
        : null;
    const plan = shopper ? await deliveryPlanFor(app.ctx, shopper, now()) : 'payg';

    // Throws on an age restricted item (Rule Six), on a product over the most one product may
    // cost, and on a basket over the most one order carries.
    const priced = priceLines(lines, items, config.fees, plan);

    const symbol = config.store.currencySymbol;
    const shopping = priced.goodsPence + priced.itemChargesPence;
    // Ruling 59: a large shop goes to a Runner with a car, which may take a little longer.
    const carNeeded = needsCarRunner(priced.goodsPence, config.dispatch.carOnlyAbovePence);

    return {
      goodsEstimatePence: priced.goodsPence,
      itemChargesPence: priced.itemChargesPence,
      feePence: priced.feePence,
      totalPence: priced.totalPence,
      deliveryPlan: priced.plan,
      carNeeded,
      lines: priced.lines,
      // Said in words as well as pence, so a screen reader, a large text setting or a
      // future voice reply all have something plain to read out.
      inWords: {
        goods: formatPence(priced.goodsPence, symbol),
        itemCharges: formatPence(priced.itemChargesPence, symbol),
        shopping: formatPence(shopping, symbol),
        fee: formatPence(priced.feePence, symbol),
        total: formatPence(priced.totalPence, symbol),
      },
      explanation: [
        `The shopping is about ${formatPence(shopping, symbol)}, with the item charges included: ${formatPence(priced.goodsPence, symbol)} at the shop's prices and ${formatPence(priced.itemChargesPence, symbol)} of item charges.`,
        `Delivery is ${formatPence(priced.feePence, symbol)}.`,
        `So about ${formatPence(priced.totalPence, symbol)} altogether.`,
        'You pay what the till says for the shopping, so the total may change a little.',
        ...(carNeeded ? ['Large orders go to a Runner with a car.'] : []),
      ],
    };
  });
}
