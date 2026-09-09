/**
 * Pricing a basket before anybody commits to anything.
 *
 * This route exists so that the fee is on the screen, in words, before the confirmation
 * button. A Shopper should never find out what the fee was after agreeing to it.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence } from '@aldilivery/core';
import { z } from 'zod';

import { priceLines } from '../services/basket.js';

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
  const { repository, config } = app.ctx;

  app.post('/basket/price', async (request) => {
    const { lines } = basketSchema.parse(request.body);

    const items = await repository.catalogue.findManyByIds(lines.map((line) => line.catalogueItemId));

    // Throws on an age restricted item (Rule Six) and on a basket above the top fee band.
    const priced = priceLines(lines, items, {
      bands: config.fees.bands,
      maximumGoodsPence: config.fees.maximumGoodsPence,
    });

    const symbol = config.store.currencySymbol;

    return {
      goodsEstimatePence: priced.goodsPence,
      feePence: priced.feePence,
      totalPence: priced.totalPence,
      lines: priced.lines,
      // Said in words as well as pence, so a screen reader, a large text setting or a
      // future voice reply all have something plain to read out.
      inWords: {
        goods: formatPence(priced.goodsPence, symbol),
        fee: formatPence(priced.feePence, symbol),
        total: formatPence(priced.totalPence, symbol),
      },
      explanation: [
        `The shopping is about ${formatPence(priced.goodsPence, symbol)}.`,
        `Our fee is ${formatPence(priced.feePence, symbol)}. That is the only fee.`,
        `So about ${formatPence(priced.totalPence, symbol)} altogether.`,
        'You pay what the till says for the shopping, so the total may change a little.',
      ],
    };
  });
}
