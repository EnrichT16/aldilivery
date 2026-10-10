/**
 * Pricing a basket.
 *
 * Three rules meet here.
 *
 * Rule Six: an age restricted item is refused at basket time. Not hidden from search and
 * then quietly dropped at checkout — refused, by name, so the Shopper knows why.
 *
 * Rule Four: there is no minimum. A basket of one tin is priced and accepted like any
 * other. There is a maximum, which one order carries (`fees.maximumOrderGoodsPence`). Above it
 * the Shopper is told so in plain words before paying and chooses (ruling 61): take something
 * out, or keep everything as linked orders, each with its own Runner (`priceLinesInParts`).
 *
 * Rule Three as amended on 9 October 2026 (ruling 58): every unit carries an item charge, and
 * the price shown for it always includes that charge; no single product may cost more than
 * £60 in the shop; delivery depends on the plan and the size of the shop.
 */

import {
  displayPricePence,
  itemChargePence,
  priceBasket,
  priceBasketInParts,
  type BasketPartFees,
  productAllowed,
  type BasketPricing,
  type DeliveryFees,
  type DeliveryPlan,
} from '@aldilivery/core';

import type { BasketLine, CatalogueItem } from '../domain.js';
import {
  AgeRestrictedItemError,
  BadRequestError,
  BasketTooLargeError,
  NotFoundError,
  ProductTooDearError,
} from '../errors.js';

export interface PricedLine {
  catalogueItemId: string;
  name: string;
  quantity: number;
  /** The estimated shop price for one of them: what the till is expected to say. */
  unitPricePence: number;
  /** The item charge on one of them. */
  unitChargePence: number;
  /** The price shown and spoken for one of them: shop price and item charge together. */
  unitDisplayPence: number;
  /** Shop price times quantity. */
  linePence: number;
  /** Shown price times quantity. */
  lineDisplayPence: number;
}

export interface PricedBasket extends BasketPricing {
  lines: PricedLine[];
}

export type PriceBasketOptions = DeliveryFees;

/**
 * Turn basket lines and the catalogue rows they point at into a price, for the Shopper's plan.
 *
 * The catalogue rows are passed in rather than looked up here, so this function stays pure
 * and the age restriction check can be proved without a database.
 */
export function priceLines(
  lines: readonly BasketLine[],
  catalogueItems: readonly CatalogueItem[],
  options: PriceBasketOptions,
  plan: DeliveryPlan = 'payg',
): PricedBasket {
  const pricedLines = checkedLines(lines, catalogueItems, options);
  const goodsPence = pricedLines.reduce((sum, line) => sum + line.linePence, 0);

  if (goodsPence > options.maximumOrderGoodsPence) {
    throw new BasketTooLargeError(goodsPence, options.maximumOrderGoodsPence);
  }

  const pricing = priceBasket(
    pricedLines.map((line) => ({ shopPricePence: line.unitPricePence, quantity: line.quantity })),
    plan,
    options,
  );
  return { ...pricing, lines: pricedLines };
}

/** One linked order of a basket kept whole (ruling 61), with its own priced lines. */
export interface PricedBasketPart extends BasketPricing {
  part: number;
  extra: boolean;
  lines: PricedLine[];
}

/** A basket priced as linked orders (ruling 61): one part when it is within one order. */
export interface PricedBasketInParts extends BasketPricing {
  lines: PricedLine[];
  parts: PricedBasketPart[];
  /** The extra Runners' deliveries, taken only when each of them collects. */
  extraDeliveryPence: number;
}

/**
 * Price a basket that may be over one order (ruling 61): the same checks as `priceLines`, then
 * linked orders of up to £150 of shopping each, the first at the Shopper's plan price and each
 * after it at `extraRunnerDeliveryPence`. Refuses a basket over `maximumBasketGoodsPence`.
 */
export function priceLinesInParts(
  lines: readonly BasketLine[],
  catalogueItems: readonly CatalogueItem[],
  options: BasketPartFees,
  plan: DeliveryPlan = 'payg',
): PricedBasketInParts {
  const pricedLines = checkedLines(lines, catalogueItems, options);
  const goodsPence = pricedLines.reduce((sum, line) => sum + line.linePence, 0);
  if (goodsPence > options.maximumBasketGoodsPence) {
    throw new BasketTooLargeError(goodsPence, options.maximumBasketGoodsPence, true);
  }
  const inParts = priceBasketInParts(
    pricedLines.map((line) => ({
      key: line.catalogueItemId,
      unitPricePence: line.unitPricePence,
      quantity: line.quantity,
    })),
    plan,
    options,
  );
  const byId = new Map(pricedLines.map((line) => [line.catalogueItemId, line]));
  const parts = inParts.parts.map((part) => ({
    part: part.part,
    extra: part.extra,
    goodsPence: part.goodsPence,
    itemChargesPence: part.itemChargesPence,
    feePence: part.feePence,
    totalPence: part.totalPence,
    plan: part.plan,
    lines: part.lines.map((line) => {
      const whole = byId.get(line.key) as PricedLine;
      return {
        ...whole,
        quantity: line.quantity,
        linePence: whole.unitPricePence * line.quantity,
        lineDisplayPence: whole.unitDisplayPence * line.quantity,
      };
    }),
  }));
  return {
    goodsPence: inParts.goodsPence,
    itemChargesPence: inParts.itemChargesPence,
    feePence: inParts.feePence,
    totalPence: inParts.totalPence,
    plan: inParts.plan,
    extraDeliveryPence: inParts.extraDeliveryPence,
    lines: pricedLines,
    parts,
  };
}

/** The checks every basket goes through, and its lines priced one by one. */
function checkedLines(
  lines: readonly BasketLine[],
  catalogueItems: readonly CatalogueItem[],
  options: PriceBasketOptions,
): PricedLine[] {
  if (lines.length === 0) {
    throw new BadRequestError('There is nothing in the basket yet.');
  }

  // Something taken off sale is treated as gone.
  const byId = new Map(
    catalogueItems.filter((item) => !item.retired).map((item) => [item.id, item]),
  );

  const missing = lines.filter((line) => !byId.has(line.catalogueItemId));
  if (missing.length > 0) {
    throw new NotFoundError('item in your basket');
  }

  // Rule Six, before anything is priced.
  const items = lines.map((line) => byId.get(line.catalogueItemId) as CatalogueItem);
  const restricted = items.filter((item) => item.ageRestricted);
  if (restricted.length > 0) {
    throw new AgeRestrictedItemError(restricted.map((item) => item.name));
  }

  // No single product over the most one product may cost (ruling 58).
  const tooDear = items.filter((item) => !productAllowed(item.estimatedPricePence, options));
  if (tooDear.length > 0) {
    throw new ProductTooDearError(
      tooDear.map((item) => item.name),
      options.maximumProductPence,
    );
  }

  const pricedLines: PricedLine[] = lines.map((line) => {
    const item = byId.get(line.catalogueItemId) as CatalogueItem;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new BadRequestError(
        `How many ${item.name} would you like? Please give a whole number.`,
      );
    }
    const unitDisplayPence = displayPricePence(item.estimatedPricePence, options);
    return {
      catalogueItemId: item.id,
      name: item.name,
      quantity: line.quantity,
      unitPricePence: item.estimatedPricePence,
      unitChargePence: itemChargePence(item.estimatedPricePence, options),
      unitDisplayPence,
      linePence: item.estimatedPricePence * line.quantity,
      lineDisplayPence: unitDisplayPence * line.quantity,
    };
  });

  return pricedLines;
}
