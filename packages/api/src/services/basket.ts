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
 *
 * Restaurants (Anthony, 30 October 2026): a basket of dishes from one restaurant, café or
 * takeaway is a restaurant order, priced apart from groceries: dishes at shop prices with the
 * normal item charge, and the flat restaurant fee in place of delivery, with a smallest order
 * (the one minimum there is, ruled by Anthony as an exception to Rule Four for restaurants
 * only). Dishes cannot share a basket with other shopping, nor with another restaurant's dishes:
 * the code has linked orders only for a basket too big for one Runner, not for one from two
 * places, so each restaurant order goes on its own, and the Shopper is told so plainly.
 */

import {
  BasketOverMaximumError,
  counterPricePence,
  displayPricePence,
  formatPence,
  isRestaurantKind,
  itemChargePence,
  priceBasket,
  priceBasketInParts,
  priceRestaurantBasket,
  RESTAURANT_MIXED_WORDS,
  RestaurantBelowMinimumError,
  restaurantMinimumWords,
  type RestaurantSettings,
  type BasketPartFees,
  productAllowed,
  type BasketPricing,
  type DeliveryFees,
  type DeliveryPlan,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { BasketLine, CatalogueItem } from '../domain.js';
import {
  AgeRestrictedItemError,
  ApiError,
  BadRequestError,
  BasketTooLargeError,
  NotFoundError,
  ProductTooDearError,
  RestaurantMinimumError,
  RestaurantMixedError,
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
  /**
   * A Shop Partner's thing (Anthony, 30 October 2026): its own shop price for one, before any
   * agreed mark-up (`unitPricePence` is the price with it, what the Shopper pays), and what the
   * Runner pays for one at the counter, less any agreed discount. Absent for everything else.
   */
  shopPricePence?: number;
  counterPricePence?: number;
}

export interface PricedBasket extends BasketPricing {
  lines: PricedLine[];
}

/** The restaurant a dish in the catalogue is from, and the discount it has agreed for Ozi. */
export interface RestaurantRef {
  shopId: string;
  name: string;
  discountPercent: number;
  /** The mark-up agreed on its prices (Anthony, 30 October 2026), 0 for none. */
  markupPercent: number;
}

/** A Shop Partner's terms on one of its things in the catalogue (Anthony, 30 October 2026). */
export interface PartnerLineTerms {
  shopPricePence: number;
  counterPricePence: number;
}

/** A restaurant order's own figures: which restaurant, its discount, and the counter price. */
export interface RestaurantPricing extends RestaurantRef {
  /** What the Runner pays the restaurant at the counter: the shop prices less the discount. */
  counterPence: number;
}

/** Why a regular order (a Set) cannot carry a restaurant's dishes (Anthony, 30 October 2026). */
export const RESTAURANT_SET_WORDS =
  'Restaurant dishes cannot go in a regular order. Please order them on their own when you would like them.';

/** What pricing reads to tell a restaurant order from groceries. */
export interface RestaurantLookup {
  /** Catalogue item id to the restaurant it is from, for the dishes in the basket only. */
  of: ReadonlyMap<string, RestaurantRef>;
  /** Catalogue item id to its partner's shop price and counter price, for every partner thing. */
  terms?: ReadonlyMap<string, PartnerLineTerms>;
  settings: Pick<
    RestaurantSettings,
    'feePence' | 'largeOrderFeePence' | 'largeOrderFromPence' | 'minimumOrderPence'
  >;
  currencySymbol: string;
}

/**
 * Which of these catalogue rows are a restaurant's dishes: a Shop Partner's product is in the
 * catalogue as "partner:<product id>", and its partner's kind says whether it is food.
 */
export async function restaurantsOf(
  ctx: Pick<AppContext, 'repository' | 'config'>,
  items: readonly CatalogueItem[],
): Promise<RestaurantLookup> {
  const of = new Map<string, RestaurantRef>();
  const terms = new Map<string, PartnerLineTerms>();
  for (const item of items) {
    if (!item.externalRef?.startsWith('partner:')) continue;
    const product = await ctx.repository.partnerProducts.findById(
      item.externalRef.slice('partner:'.length),
    );
    if (!product) continue;
    const shop = await ctx.repository.partnerShops.findById(product.partnerShopId);
    if (!shop || shop.kind === 'service') continue;
    const discountPercent = shop.agreedDiscountPercent ?? 0;
    terms.set(item.id, {
      shopPricePence: product.pricePence,
      counterPricePence: counterPricePence(product.pricePence, discountPercent),
    });
    if (!isRestaurantKind(shop.kind)) continue;
    of.set(item.id, {
      shopId: shop.id,
      name: shop.name,
      discountPercent,
      markupPercent: shop.agreedMarkupPercent ?? 0,
    });
  }
  return {
    of,
    terms,
    settings: ctx.config.restaurants,
    currencySymbol: ctx.config.store.currencySymbol,
  };
}

/**
 * The one restaurant this basket is from, or null for groceries. Refuses dishes mixed with other
 * shopping, and dishes from two restaurants.
 */
function restaurantOfBasket(
  lines: readonly PricedLine[],
  restaurants: RestaurantLookup | undefined,
): RestaurantRef | null {
  if (!restaurants || restaurants.of.size === 0) return null;
  const refs = lines.map((line) => restaurants.of.get(line.catalogueItemId) ?? null);
  if (refs.every((ref) => ref === null)) return null;
  const first = refs[0];
  if (!first || refs.some((ref) => ref === null || ref.shopId !== first.shopId)) {
    throw new RestaurantMixedError(RESTAURANT_MIXED_WORDS);
  }
  return first;
}

/** A restaurant basket priced: the flat fee, the smallest order, and the counter price. */
function priceRestaurantLines(
  pricedLines: PricedLine[],
  restaurant: RestaurantRef,
  restaurants: RestaurantLookup,
  options: PriceBasketOptions,
  plan: DeliveryPlan,
): PricedBasket & { restaurant: RestaurantPricing } {
  try {
    const pricing = priceRestaurantBasket(
      pricedLines.map((line) => ({ shopPricePence: line.unitPricePence, quantity: line.quantity })),
      plan,
      options,
      restaurants.settings,
    );
    // What the Runner pays at the counter: each dish's counter price, from its shop price less
    // the discount, never from the marked-up price the Shopper pays (30 October 2026).
    const counterPence = pricedLines.every((line) => line.counterPricePence !== undefined)
      ? pricedLines.reduce((sum, line) => sum + (line.counterPricePence ?? 0) * line.quantity, 0)
      : counterPricePence(pricing.goodsPence, restaurant.discountPercent);
    return {
      ...pricing,
      lines: pricedLines,
      restaurant: { ...restaurant, counterPence },
    };
  } catch (failure) {
    if (failure instanceof RestaurantBelowMinimumError) {
      throw new RestaurantMinimumError(
        restaurantMinimumWords(restaurants.settings, (pence) =>
          formatPence(pence, restaurants.currencySymbol),
        ),
        failure.goodsPence,
        failure.minimumPence,
      );
    }
    if (failure instanceof BasketOverMaximumError) {
      // A restaurant order is one Runner's: never linked orders.
      const money = (pence: number): string => formatPence(pence, restaurants.currencySymbol);
      throw new ApiError(
        422,
        'basket_too_large',
        `This comes to ${money(failure.goodsPence)} of dishes, and one restaurant order carries up to ${money(failure.maximumPence)}. Please take something out.`,
        { goodsPence: failure.goodsPence, maximumPence: failure.maximumPence },
      );
    }
    throw failure;
  }
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
  allowanceExtraPence = 0,
  restaurants?: RestaurantLookup,
): PricedBasket & { restaurant: RestaurantPricing | null } {
  const pricedLines = withPartnerTerms(checkedLines(lines, catalogueItems, options), restaurants);
  const restaurant = restaurantOfBasket(pricedLines, restaurants);
  if (restaurant && restaurants) {
    return priceRestaurantLines(pricedLines, restaurant, restaurants, options, plan);
  }
  const goodsPence = pricedLines.reduce((sum, line) => sum + line.linePence, 0);

  if (goodsPence > options.maximumOrderGoodsPence) {
    throw new BasketTooLargeError(goodsPence, options.maximumOrderGoodsPence);
  }

  const pricing = priceBasket(
    pricedLines.map((line) => ({ shopPricePence: line.unitPricePence, quantity: line.quantity })),
    plan,
    options,
    allowanceExtraPence,
  );
  return { ...pricing, lines: pricedLines, restaurant: null };
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
  /** A restaurant order's own figures, or null for groceries (Anthony, 30 October 2026). */
  restaurant: RestaurantPricing | null;
}

/**
 * Price a basket that may be over one order (ruling 61): the same checks as `priceLines`, then
 * linked orders of up to £150 of shopping each, the first at the Shopper's plan price and each
 * after it at `extraRunnerDeliveryPence`. Refuses a basket over `maximumBasketGoodsPence`. Any
 * extra delivery charge for the monthly allowance (ruling 73) is on the first order only.
 */
export function priceLinesInParts(
  lines: readonly BasketLine[],
  catalogueItems: readonly CatalogueItem[],
  options: BasketPartFees,
  plan: DeliveryPlan = 'payg',
  allowanceExtraPence = 0,
  restaurants?: RestaurantLookup,
): PricedBasketInParts {
  const pricedLines = withPartnerTerms(checkedLines(lines, catalogueItems, options), restaurants);
  const restaurant = restaurantOfBasket(pricedLines, restaurants);
  if (restaurant && restaurants) {
    // One restaurant, one order, one Runner: never linked orders.
    const priced = priceRestaurantLines(pricedLines, restaurant, restaurants, options, plan);
    const { lines: pricedRestaurantLines, restaurant: figures, ...pricing } = priced;
    return {
      ...pricing,
      lines: pricedRestaurantLines,
      parts: [{ ...pricing, part: 1, extra: false, lines: pricedRestaurantLines }],
      extraDeliveryPence: 0,
      restaurant: figures,
    };
  }
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
    allowanceExtraPence,
  );
  const byId = new Map(pricedLines.map((line) => [line.catalogueItemId, line]));
  const parts = inParts.parts.map((part) => ({
    part: part.part,
    extra: part.extra,
    goodsPence: part.goodsPence,
    itemChargesPence: part.itemChargesPence,
    feePence: part.feePence,
    allowanceExtraPence: part.allowanceExtraPence,
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
    allowanceExtraPence: inParts.allowanceExtraPence,
    totalPence: inParts.totalPence,
    plan: inParts.plan,
    extraDeliveryPence: inParts.extraDeliveryPence,
    lines: pricedLines,
    parts,
    restaurant: null,
  };
}

/** Each partner thing's shop price and counter price, kept on its line for the order. */
function withPartnerTerms(
  lines: PricedLine[],
  restaurants: RestaurantLookup | undefined,
): PricedLine[] {
  const terms = restaurants?.terms;
  if (!terms || terms.size === 0) return lines;
  return lines.map((line) => {
    const found = terms.get(line.catalogueItemId);
    return found ? { ...line, ...found } : line;
  });
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
