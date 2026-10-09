/**
 * The fee engine.
 *
 * Every figure in this file is an integer number of pence. Money is never a float in this
 * codebase: floats lose halfpennies, and a lost halfpenny in the wrong direction is a broken
 * promise to a Runner.
 *
 * Pricing as ruled on 9 October 2026 (docs/BUILD_PROMPT.md, ruling 58), every figure from
 * config/store.json:
 *
 * - An item charge on every unit: 50p, and 50p more for every whole £6 of the product's shop
 *   price (under £6 is 50p, £6 to £11.99 is £1, £12 to £17.99 is £1.50, and so on). The same on
 *   every plan, never removed. Prices shown to a Shopper always include it.
 * - Delivery by plan: pay as you go is £7.99 for shopping of £15 or less and £13.50 above it;
 *   Ozi Membership (and an organisation's clients) £7.99 always; Ozi Plus and Ozi Family and
 *   Carer £5.99. The Runner's five pounds comes out of every one of them (Rule Two).
 * - No single product over £60, and one order carries at most the whole-order goods cap.
 *
 * The Runner's five pounds is a constant in rules.ts, because it is untouched.
 *
 * The functions here are pure: same inputs, same outputs, no clock, no random, no I/O.
 */

import { RUNNER_PAYMENT_PENCE } from './rules.js';

/**
 * Which delivery price applies. Decided by the server from the Shopper's account (their plan,
 * or an organisation that looks after them), never by the time, the place or the demand.
 */
export type DeliveryPlan = 'payg' | 'membership' | 'plus';

export const DELIVERY_PLANS: readonly DeliveryPlan[] = ['payg', 'membership', 'plus'];

/** Delivery, by plan, as configured. */
export interface DeliveryPrices {
  /** Pay as you go, shopping of `payAsYouGoSmallOrderUpToPence` or less. */
  readonly payAsYouGoSmallOrderPence: number;
  /** The largest shop total that still has the smaller pay-as-you-go price. */
  readonly payAsYouGoSmallOrderUpToPence: number;
  /** Pay as you go, shopping over that. */
  readonly payAsYouGoPence: number;
  /** Ozi Membership, and an organisation's clients: the same whatever the size. */
  readonly membershipPence: number;
  /** Ozi Plus and Ozi Family and Carer. */
  readonly plusPence: number;
}

/** The charge added to every unit: base, plus a step for every whole `everyPence` of price. */
export interface ItemChargeRule {
  readonly basePence: number;
  readonly stepPence: number;
  readonly everyPence: number;
}

/** Everything the fee engine reads from config/store.json. */
export interface DeliveryFees {
  readonly delivery: DeliveryPrices;
  readonly itemCharge: ItemChargeRule;
  /** No single product may cost more than this in the shop. */
  readonly maximumProductPence: number;
  /**
   * The most shopping (at shop prices) one order carries. Above it, the Shopper is told so
   * and offered two deliveries.
   */
  readonly maximumOrderGoodsPence: number;
}

/**
 * How the payment processor charges: a percentage of the whole transaction plus a fixed
 * amount, in basis points so the arithmetic stays whole — 150 basis points is 1.5 percent.
 * Used for reporting what the platform keeps, never to set a price.
 */
export interface ProcessorModel {
  readonly percentageBasisPoints: number;
  readonly fixedPence: number;
}

/** One line of a basket as the fee engine sees it: a shop price and how many. */
export interface PricedUnitLine {
  readonly shopPricePence: number;
  readonly quantity: number;
}

/** What the Shopper is told, before they confirm anything. */
export interface BasketPricing {
  /** The shopping at shop prices: what the till is expected to say. */
  readonly goodsPence: number;
  /** The item charges, every unit counted. */
  readonly itemChargesPence: number;
  /** Delivery, for this plan and this size of shop. */
  readonly feePence: number;
  readonly totalPence: number;
  readonly plan: DeliveryPlan;
}

/** The internal view of the same order: who gets what. */
export interface OrderEconomics extends BasketPricing {
  readonly runnerPaymentPence: number;
  readonly processorCostPence: number;
  /** Delivery less the Runner's five pounds, plus the item charges, less the card fee. */
  readonly platformNetPence: number;
}

/** A basket over the most one order carries. The Shopper is offered two deliveries. */
export class BasketOverMaximumError extends Error {
  constructor(
    readonly goodsPence: number,
    readonly maximumPence: number,
  ) {
    super(
      `A goods total of ${goodsPence}p is over the ${maximumPence}p most that one delivery carries. ` +
        `It can be split into two deliveries.`,
    );
    this.name = 'BasketOverMaximumError';
  }
}

/** A single product over the most any one product may cost. It is not sold. */
export class ProductOverMaximumError extends Error {
  constructor(
    readonly shopPricePence: number,
    readonly maximumPence: number,
  ) {
    super(
      `A product at ${shopPricePence}p is over the ${maximumPence}p most that any one product may cost.`,
    );
    this.name = 'ProductOverMaximumError';
  }
}

function assertWholePence(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a whole, non-negative number of pence, received ${value}.`);
  }
}

/**
 * The item charge on one unit of a product, from its shop price: 50p, and 50p more for every
 * whole £6 (with the configured figures). Never removed by any plan.
 */
export function itemChargePence(shopPricePence: number, fees: Pick<DeliveryFees, 'itemCharge'>): number {
  assertWholePence(shopPricePence, 'Shop price');
  const { basePence, stepPence, everyPence } = fees.itemCharge;
  return basePence + stepPence * Math.floor(shopPricePence / everyPence);
}

/**
 * The price a Shopper is shown or told for one unit: the shop price with its item charge
 * already in it. UK pricing law does not allow a compulsory charge to be added later.
 */
export function displayPricePence(shopPricePence: number, fees: Pick<DeliveryFees, 'itemCharge'>): number {
  return shopPricePence + itemChargePence(shopPricePence, fees);
}

/** Whether one product may be sold at all: no single product over the configured most. */
export function productAllowed(
  shopPricePence: number,
  fees: Pick<DeliveryFees, 'maximumProductPence'>,
): boolean {
  return shopPricePence <= fees.maximumProductPence;
}

/** Throws when a product is over the most any one product may cost. */
export function assertProductAllowed(
  shopPricePence: number,
  fees: Pick<DeliveryFees, 'maximumProductPence'>,
): void {
  assertWholePence(shopPricePence, 'Shop price');
  if (!productAllowed(shopPricePence, fees)) {
    throw new ProductOverMaximumError(shopPricePence, fees.maximumProductPence);
  }
}

/** The item charges on a whole basket: each unit counted on its own. */
export function itemChargesForLines(
  lines: readonly PricedUnitLine[],
  fees: Pick<DeliveryFees, 'itemCharge'>,
): number {
  return lines.reduce((sum, line) => {
    assertWholePence(line.quantity, 'Quantity');
    return sum + itemChargePence(line.shopPricePence, fees) * line.quantity;
  }, 0);
}

/**
 * The delivery fee, in pence, for this much shopping (at shop prices) on this plan.
 *
 * Rule Four lives in this signature. The only inputs are the goods total, the plan the Shopper
 * chose and the configured fees. There is no time of day, no distance, no weather, no demand
 * and no order history, so there is nothing a future edit could multiply the fee by. A smaller
 * shop is cheaper to deliver on pay as you go, never dearer: there is no small order fee and
 * no minimum. A basket of one penny is priced and accepted.
 */
export function deliveryFeePence(goodsPence: number, plan: DeliveryPlan, fees: DeliveryFees): number {
  assertWholePence(goodsPence, 'Goods total');
  if (goodsPence > fees.maximumOrderGoodsPence) {
    throw new BasketOverMaximumError(goodsPence, fees.maximumOrderGoodsPence);
  }
  const prices = fees.delivery;
  switch (plan) {
    case 'plus':
      return prices.plusPence;
    case 'membership':
      return prices.membershipPence;
    case 'payg':
      return goodsPence <= prices.payAsYouGoSmallOrderUpToPence
        ? prices.payAsYouGoSmallOrderPence
        : prices.payAsYouGoPence;
    default: {
      const unknown: never = plan;
      throw new TypeError(`Unknown delivery plan: ${String(unknown)}.`);
    }
  }
}

/**
 * Goods, item charges, delivery and total together, so the API and the web never do this
 * arithmetic twice. Every product is checked against the most one product may cost.
 */
export function priceBasket(
  lines: readonly PricedUnitLine[],
  plan: DeliveryPlan,
  fees: DeliveryFees,
): BasketPricing {
  for (const line of lines) assertProductAllowed(line.shopPricePence, fees);
  const goodsPence = lines.reduce((sum, line) => sum + line.shopPricePence * line.quantity, 0);
  const itemChargesPence = itemChargesForLines(lines, fees);
  const feePence = deliveryFeePence(goodsPence, plan, fees);
  return {
    goodsPence,
    itemChargesPence,
    feePence,
    totalPence: goodsPence + itemChargesPence + feePence,
    plan,
  };
}

/**
 * What the payment processor takes from a transaction, in pence: a percentage of the whole
 * charge, plus a fixed amount. Rounded up, so any report of what the platform keeps errs on
 * the low side.
 */
export function processorCostPence(totalTransactionPence: number, processor: ProcessorModel): number {
  assertWholePence(totalTransactionPence, 'Transaction total');
  const percentagePart = Math.ceil((totalTransactionPence * processor.percentageBasisPoints) / 10_000);
  return percentagePart + processor.fixedPence;
}

/** The full economics of an order, for internal reporting. */
export function orderEconomics(pricing: BasketPricing, processor: ProcessorModel): OrderEconomics {
  const cost = processorCostPence(pricing.totalPence, processor);
  return {
    ...pricing,
    runnerPaymentPence: RUNNER_PAYMENT_PENCE,
    processorCostPence: cost,
    platformNetPence: pricing.feePence - RUNNER_PAYMENT_PENCE + pricing.itemChargesPence - cost,
  };
}

/** How organisations are charged for the people they look after. */
export interface OrganisationPricing {
  /** For each client, a month. */
  readonly clientMonthlyPence: number;
  /** Every this-many-th client (51st, 102nd, ...) is charged the discounted price instead. */
  readonly discountEveryNthClient: number;
  readonly discountedClientMonthlyPence: number;
}

/**
 * An organisation's monthly charge for this many clients: the sum over clients numbered 1 to N
 * of the discounted price for every Nth one and the full price for everyone else.
 */
export function organisationMonthlyPence(clients: number, pricing: OrganisationPricing): number {
  assertWholePence(clients, 'Number of clients');
  const discounted = Math.floor(clients / pricing.discountEveryNthClient);
  return (
    (clients - discounted) * pricing.clientMonthlyPence +
    discounted * pricing.discountedClientMonthlyPence
  );
}
