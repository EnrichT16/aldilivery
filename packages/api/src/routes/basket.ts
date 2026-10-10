/**
 * Pricing a basket before anybody commits to anything.
 *
 * This route exists so that the fee is on the screen, in words, before the confirmation
 * button. A Shopper should never find out what the fee was after agreeing to it.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, needsVehicle, overOneRunnerWords } from '@aldilivery/core';
import { z } from 'zod';

import { priceLinesInParts, type PricedBasketInParts } from '../services/basket.js';
import { largeOrderShopperWords } from '../services/dispatch.js';
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
    // cost, and on a basket over the most one basket holds (ruling 61: £450). Over one order
    // (£150), it is priced both ways the Shopper may choose (basketChoice).
    const priced = priceLinesInParts(lines, items, config.fees, plan);

    const symbol = config.store.currencySymbol;
    if (priced.parts.length > 1) return basketChoice(priced);
    const shopping = priced.goodsPence + priced.itemChargesPence;
    // Rulings 59 and 60: a large shop goes to a Runner with a vehicle who can carry it, or
    // comes in parts if none takes it, which may take a little longer.
    const carNeeded = needsVehicle(priced.goodsPence, config.dispatch.maxGoodsPenceByMode);

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
        ...(carNeeded ? [largeOrderShopperWords(config, priced.goodsPence)] : []),
      ],
    };
  });

  /**
   * A basket over £150 (ruling 61): the Shopper is told plainly, before paying, that it is more
   * than one Runner can carry, and given both choices: take something out or swap it, or keep
   * everything as linked orders. Nothing hidden: every order, its Runner and its delivery.
   */
  function basketChoice(priced: PricedBasketInParts) {
    const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
    const shopping = priced.goodsPence + priced.itemChargesPence;
    const choice = overOneRunnerWords(config.fees, money);
    const parts = priced.parts.map((part) => ({
      part: part.part,
      runner: `Runner ${part.part}`,
      goodsPence: part.goodsPence,
      itemChargesPence: part.itemChargesPence,
      feePence: part.feePence,
      totalPence: part.totalPence,
      extra: part.extra,
      tinyExtra: part.extra && part.goodsPence < config.dispatch.tinyExtraBelowPence,
      carNeeded: needsVehicle(part.goodsPence, config.dispatch.maxGoodsPenceByMode),
      lines: part.lines,
      words: `Runner ${part.part}: ${money(part.goodsPence)} of shopping at the shop's prices and ${money(part.itemChargesPence)} of item charges, delivery ${money(part.feePence)}${part.extra ? ', taken only when this Runner collects it' : ''}.`,
    }));
    return {
      overOneRunner: true,
      choice,
      maximumOrderGoodsPence: config.fees.maximumOrderGoodsPence,
      maximumBasketGoodsPence: config.fees.maximumBasketGoodsPence,
      goodsEstimatePence: priced.goodsPence,
      itemChargesPence: priced.itemChargesPence,
      // Keeping everything: every order's delivery added up.
      feePence: priced.feePence,
      totalPence: priced.totalPence,
      extraDeliveryPence: priced.extraDeliveryPence,
      deliveryPlan: priced.plan,
      carNeeded: true,
      lines: priced.lines,
      parts,
      inWords: {
        goods: money(priced.goodsPence),
        itemCharges: money(priced.itemChargesPence),
        shopping: money(shopping),
        fee: money(priced.feePence),
        total: money(priced.totalPence),
      },
      explanation: [
        choice,
        `If you keep everything, it comes as ${priced.parts.length} orders, each with its own Runner:`,
        ...parts.map((part) => part.words),
        `So about ${money(priced.totalPence)} altogether, delivery ${money(priced.feePence)} of it.`,
        'You pay what the till says for the shopping, so the total may change a little.',
      ],
    };
  }
}
