/**
 * Pricing a basket.
 *
 * Two rules meet here.
 *
 * Rule Six: an age restricted item is refused at basket time. Not hidden from search and
 * then quietly dropped at checkout — refused, by name, so the Shopper knows why.
 *
 * Rule Four: there is no minimum. A basket of one tin is priced and accepted like any
 * other. There is also no maximum in the sense of a rule; the only ceiling is the top of
 * the fee bands, above which Aldilivery cannot price the order without breaking Rule
 * Three, and that is explained rather than silently applied.
 */

import { priceBasket, type BasketPricing, type FeeBand } from '@aldilivery/core';

import type { BasketLine, CatalogueItem } from '../domain.js';
import { AgeRestrictedItemError, BadRequestError, BasketTooLargeError, NotFoundError } from '../errors.js';

export interface PricedLine {
  catalogueItemId: string;
  name: string;
  quantity: number;
  /** The estimated price for one of them. */
  unitPricePence: number;
  /** Unit price times quantity. */
  linePence: number;
}

export interface PricedBasket extends BasketPricing {
  lines: PricedLine[];
}

export interface PriceBasketOptions {
  bands: readonly FeeBand[];
  maximumGoodsPence: number;
}

/**
 * Turn basket lines and the catalogue rows they point at into a price.
 *
 * The catalogue rows are passed in rather than looked up here, so this function stays pure
 * and the age restriction check can be proved without a database.
 */
export function priceLines(
  lines: readonly BasketLine[],
  catalogueItems: readonly CatalogueItem[],
  options: PriceBasketOptions,
): PricedBasket {
  if (lines.length === 0) {
    throw new BadRequestError('There is nothing in the basket yet.');
  }

  const byId = new Map(catalogueItems.map((item) => [item.id, item]));

  const missing = lines.filter((line) => !byId.has(line.catalogueItemId));
  if (missing.length > 0) {
    throw new NotFoundError('item in your basket');
  }

  // Rule Six, before anything is priced.
  const restricted = lines
    .map((line) => byId.get(line.catalogueItemId) as CatalogueItem)
    .filter((item) => item.ageRestricted);
  if (restricted.length > 0) {
    throw new AgeRestrictedItemError(restricted.map((item) => item.name));
  }

  const pricedLines: PricedLine[] = lines.map((line) => {
    const item = byId.get(line.catalogueItemId) as CatalogueItem;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new BadRequestError(`How many ${item.name} would you like? Please give a whole number.`);
    }
    return {
      catalogueItemId: item.id,
      name: item.name,
      quantity: line.quantity,
      unitPricePence: item.estimatedPricePence,
      linePence: item.estimatedPricePence * line.quantity,
    };
  });

  const goodsPence = pricedLines.reduce((sum, line) => sum + line.linePence, 0);

  if (goodsPence > options.maximumGoodsPence) {
    throw new BasketTooLargeError(goodsPence, options.maximumGoodsPence);
  }

  const pricing = priceBasket(goodsPence, options.bands);
  return { ...pricing, lines: pricedLines };
}
