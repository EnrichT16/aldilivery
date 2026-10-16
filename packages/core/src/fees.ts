/**
 * The fee engine.
 *
 * Every figure in this file is an integer number of pence. Money is never a float in this
 * codebase: floats lose halfpennies, and a lost halfpenny in the wrong direction is a broken
 * promise to a Runner.
 *
 * Pricing as ruled on 9 October 2026 (docs/BUILD_PROMPT.md, ruling 58) and re-banded on
 * 16 October 2026 (ruling 63), every figure from config/store.json:
 *
 * - An item charge on every unit: 50p, and 50p more for every whole £6 of the product's shop
 *   price (under £6 is 50p, £6 to £11.99 is £1, £12 to £17.99 is £1.50, and so on). The same on
 *   every plan, never removed. Prices shown to a Shopper always include it.
 * - Delivery by plan and by the value of the shopping, in bands (`fees.delivery.bands`): pay as
 *   you go £7.99 up to £30, £9.99 over £30 up to £60, £13.50 over £60; Ozi Membership (and an
 *   organisation's clients) £5.99 up to £60 and £9.99 over; Ozi Plus and Ozi Family and Carer
 *   £3.99 up to £60 and £7.99 over. The Runner's five pounds comes out of every one of them
 *   (Rule Two). The bands are read here, never written.
 * - No single product over £60, and one order carries at most the whole-order goods cap.
 *
 * The Runner's five pounds is a constant in rules.ts, because it is untouched.
 *
 * The functions here are pure: same inputs, same outputs, no clock, no random, no I/O.
 */

import { packFirstFit, type SplitLine } from './dispatch.js';
import { RUNNER_PAYMENT_PENCE } from './rules.js';

/**
 * Which delivery price applies. Decided by the server from the Shopper's account (their plan,
 * or an organisation that looks after them), never by the time, the place or the demand.
 */
export type DeliveryPlan = 'payg' | 'membership' | 'plus';

export const DELIVERY_PLANS: readonly DeliveryPlan[] = ['payg', 'membership', 'plus'];

/**
 * One band of delivery prices (ruling 63): what each plan pays when the shopping at shop
 * prices is over the band before it and up to `upToPence`. The last band has `upToPence` null
 * and covers everything above the band before it.
 */
export interface DeliveryBand {
  /** The largest shop total this band covers, or null for the last band. */
  readonly upToPence: number | null;
  /** Pay as you go (no plan, and the free first month). */
  readonly payAsYouGoPence: number;
  /** Ozi Membership, and an organisation's clients. */
  readonly membershipPence: number;
  /** Ozi Plus and Ozi Family and Carer. */
  readonly plusPence: number;
}

/** Delivery, by plan and by the value of the shopping, as configured. */
export interface DeliveryPrices {
  /** In rising order of `upToPence`, the last one null. Never empty. */
  readonly bands: readonly DeliveryBand[];
}

/** One step of a plan's delivery prices: this much for shopping up to `upToPence` (null: above). */
export interface DeliveryStep {
  readonly upToPence: number | null;
  readonly pence: number;
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
    throw new TypeError(
      `${label} must be a whole, non-negative number of pence, received ${value}.`,
    );
  }
}

/**
 * The item charge on one unit of a product, from its shop price: 50p, and 50p more for every
 * whole £6 (with the configured figures). Never removed by any plan.
 */
export function itemChargePence(
  shopPricePence: number,
  fees: Pick<DeliveryFees, 'itemCharge'>,
): number {
  assertWholePence(shopPricePence, 'Shop price');
  const { basePence, stepPence, everyPence } = fees.itemCharge;
  return basePence + stepPence * Math.floor(shopPricePence / everyPence);
}

/**
 * The price a Shopper is shown or told for one unit: the shop price with its item charge
 * already in it. UK pricing law does not allow a compulsory charge to be added later.
 */
export function displayPricePence(
  shopPricePence: number,
  fees: Pick<DeliveryFees, 'itemCharge'>,
): number {
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
export function deliveryFeePence(
  goodsPence: number,
  plan: DeliveryPlan,
  fees: DeliveryFees,
): number {
  assertWholePence(goodsPence, 'Goods total');
  if (goodsPence > fees.maximumOrderGoodsPence) {
    throw new BasketOverMaximumError(goodsPence, fees.maximumOrderGoodsPence);
  }
  return bandPrice(deliveryBandFor(goodsPence, fees), plan);
}

/** The band this much shopping (at shop prices) falls in: the first whose `upToPence` it is within. */
export function deliveryBandFor(
  goodsPence: number,
  fees: Pick<DeliveryFees, 'delivery'>,
): DeliveryBand {
  assertWholePence(goodsPence, 'Goods total');
  const band = fees.delivery.bands.find(
    (candidate) => candidate.upToPence === null || goodsPence <= candidate.upToPence,
  );
  if (!band) {
    // The configuration parser requires a last band with no upper limit, so a parsed
    // configuration never gets here; a hand-made one is told plainly.
    throw new TypeError(`No delivery band covers a goods total of ${goodsPence}p.`);
  }
  return band;
}

/** What one plan pays in one band. */
export function bandPrice(band: DeliveryBand, plan: DeliveryPlan): number {
  switch (plan) {
    case 'plus':
      return band.plusPence;
    case 'membership':
      return band.membershipPence;
    case 'payg':
      return band.payAsYouGoPence;
    default: {
      const unknown: never = plan;
      throw new TypeError(`Unknown delivery plan: ${String(unknown)}.`);
    }
  }
}

/**
 * A plan's delivery prices as steps, with neighbouring bands that cost the same joined: on
 * Membership, £5.99 up to £30 and £5.99 up to £60 become one step, £5.99 up to £60, then £9.99
 * above. This is what the screens, Ozi and the documents say; the bands stay as configured.
 */
export function deliverySteps(
  plan: DeliveryPlan,
  fees: Pick<DeliveryFees, 'delivery'>,
): DeliveryStep[] {
  const steps: DeliveryStep[] = [];
  for (const band of fees.delivery.bands) {
    const pence = bandPrice(band, plan);
    const last = steps[steps.length - 1];
    if (last && last.pence === pence) {
      steps[steps.length - 1] = { upToPence: band.upToPence, pence };
    } else {
      steps.push({ upToPence: band.upToPence, pence });
    }
  }
  return steps;
}

/** The cheapest and dearest delivery on any plan, for "from £3.99 to £13.50". */
export function deliveryPriceRange(fees: Pick<DeliveryFees, 'delivery'>): {
  lowestPence: number;
  highestPence: number;
} {
  const all = fees.delivery.bands.flatMap((band) =>
    DELIVERY_PLANS.map((plan) => bandPrice(band, plan)),
  );
  return { lowestPence: Math.min(...all), highestPence: Math.max(...all) };
}

/**
 * A plan's delivery prices in one plain phrase, from its steps: "£7.99 for shopping up to
 * £30.00, £9.99 up to £60.00, and £13.50 over £60.00"; on Membership "£5.99 for shopping up to
 * £60.00, and £9.99 over £60.00"; a plan with one price reads "£5.99, whatever the size of the
 * shop". `formatMoney` is the caller's, so the currency symbol stays in configuration.
 */
export function deliveryStepsWords(
  plan: DeliveryPlan,
  fees: Pick<DeliveryFees, 'delivery'>,
  formatMoney: (pence: number) => string,
): string {
  const steps = deliverySteps(plan, fees);
  const first = steps[0];
  if (!first) throw new TypeError('There are no delivery bands.');
  if (steps.length === 1) return `${formatMoney(first.pence)}, whatever the size of the shop`;
  return steps
    .map((step, index) => {
      if (step.upToPence === null) {
        const previous = steps[index - 1]?.upToPence ?? 0;
        return `and ${formatMoney(step.pence)} over ${formatMoney(previous)}`;
      }
      return index === 0
        ? `${formatMoney(step.pence)} for shopping up to ${formatMoney(step.upToPence)}`
        : `${formatMoney(step.pence)} up to ${formatMoney(step.upToPence)}`;
    })
    .join(', ');
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
export function processorCostPence(
  totalTransactionPence: number,
  processor: ProcessorModel,
): number {
  assertWholePence(totalTransactionPence, 'Transaction total');
  const percentagePart = Math.ceil(
    (totalTransactionPence * processor.percentageBasisPoints) / 10_000,
  );
  return percentagePart + processor.fixedPence;
}

/**
 * What the Runner earns for delivering an order whole (Rule Two, amended by ruling 60): five
 * pounds, or `largeOrderRunnerPaymentPence` (£7) when the shop prices come to
 * `largeOrderFromPence` (£120) or more. A part of a split job pays its own figure instead.
 */
export function runnerPaymentFor(
  goodsPence: number,
  fees: { readonly largeOrderRunnerPaymentPence: number; readonly largeOrderFromPence: number },
): number {
  return goodsPence >= fees.largeOrderFromPence
    ? fees.largeOrderRunnerPaymentPence
    : RUNNER_PAYMENT_PENCE;
}

/** What pricing a basket over one order reads (ruling 61). */
export interface BasketPartFees extends DeliveryFees {
  /** The most one basket may hold, kept as linked orders (£450). */
  readonly maximumBasketGoodsPence: number;
  /** The delivery for each linked order after the first (£13.50), whatever the plan. */
  readonly extraRunnerDeliveryPence: number;
}

/** One line of a basket to be priced in parts: which line, its shop price, and how many. */
export type BasketPartLine = SplitLine;

/** One linked order of a basket kept whole (ruling 61): its items, its prices and its Runner. */
export interface BasketPartPricing extends BasketPricing {
  /** 1 for the first order, 2 for the next, and so on: one Runner each. */
  readonly part: number;
  readonly lines: ReadonlyArray<{ key: string; quantity: number; unitPricePence: number }>;
  /** Whether this order's delivery is the extra-Runner delivery, taken when it is collected. */
  readonly extra: boolean;
}

/** A basket kept whole, as linked orders, and what it all comes to. */
export interface BasketInParts extends BasketPricing {
  readonly parts: readonly BasketPartPricing[];
  /** The extra-Runner deliveries, taken only when each of those Runners collects. */
  readonly extraDeliveryPence: number;
}

/**
 * A basket over the most one order carries, priced as linked orders (ruling 61, Anthony,
 * 10 October 2026). The first order is filled with items up to `maximumOrderGoodsPence` (£150),
 * then the next up to £150, and so on, dearest first; no product is ever split. The first order
 * keeps the Shopper's own delivery for its plan; every order after it costs
 * `extraRunnerDeliveryPence` (£13.50) whatever the plan. A basket within one order is one part,
 * priced exactly as `priceBasket`. Refuses a basket over `maximumBasketGoodsPence` (£450).
 *
 * So £172 of shopping on pay as you go is £150 with £13.50 delivery and £22 with £13.50 more.
 */
export function priceBasketInParts(
  lines: readonly BasketPartLine[],
  plan: DeliveryPlan,
  fees: BasketPartFees,
): BasketInParts {
  for (const line of lines) assertProductAllowed(line.unitPricePence, fees);
  const goods = lines.reduce((sum, line) => sum + line.unitPricePence * line.quantity, 0);
  if (goods > fees.maximumBasketGoodsPence) {
    throw new BasketOverMaximumError(goods, fees.maximumBasketGoodsPence);
  }
  const packed =
    goods <= fees.maximumOrderGoodsPence
      ? [
          {
            lines: lines.map(({ key, quantity, unitPricePence }) => ({
              key,
              quantity,
              unitPricePence,
            })),
            goodsPence: goods,
          },
        ]
      : packFirstFit(lines, fees.maximumOrderGoodsPence, () => ({
          tag: null,
          capacityPence: fees.maximumOrderGoodsPence,
        }));
  const parts = packed.map((bin, index): BasketPartPricing => {
    const itemChargesPence = itemChargesForLines(
      bin.lines.map((line) => ({ shopPricePence: line.unitPricePence, quantity: line.quantity })),
      fees,
    );
    const extra = index > 0;
    const feePence = extra
      ? fees.extraRunnerDeliveryPence
      : deliveryFeePence(bin.goodsPence, plan, fees);
    return {
      part: index + 1,
      lines: bin.lines,
      extra,
      goodsPence: bin.goodsPence,
      itemChargesPence,
      feePence,
      totalPence: bin.goodsPence + itemChargesPence + feePence,
      plan,
    };
  });
  const sum = (pick: (part: BasketPartPricing) => number) =>
    parts.reduce((total, part) => total + pick(part), 0);
  return {
    parts,
    goodsPence: goods,
    itemChargesPence: sum((part) => part.itemChargesPence),
    feePence: sum((part) => part.feePence),
    totalPence: sum((part) => part.totalPence),
    extraDeliveryPence: sum((part) => (part.extra ? part.feePence : 0)),
    plan,
  };
}

/**
 * What the Shopper is told, before paying, when their basket is over one order (ruling 61):
 * plainly and gently, with both choices.
 */
export function overOneRunnerWords(
  fees: Pick<BasketPartFees, 'maximumOrderGoodsPence' | 'extraRunnerDeliveryPence'>,
  formatMoney: (pence: number) => string,
): string {
  // "over £150", as Anthony said it: whole pounds without the pence.
  const most = formatMoney(fees.maximumOrderGoodsPence).replace(/\.00$/, '');
  return `Your shopping is over ${most}, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra ${formatMoney(fees.extraRunnerDeliveryPence)} delivery.`;
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
