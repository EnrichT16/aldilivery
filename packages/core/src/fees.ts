/**
 * The fee engine.
 *
 * Every figure in this file is an integer number of pence. Money is never a float in this
 * codebase: floats lose halfpennies, and a lost halfpenny in the wrong direction is a broken
 * promise to a Runner.
 *
 * Standard delivery was ruled on 29 Sep 2026 (docs/BUILD_PROMPT.md, Section B): one flat fee,
 * the same whatever the basket, and a maximum basket. There are no fee bands and no
 * basket-linked fee, and the old two pound net floor is superseded. Both figures are in
 * config/store.json, because the owner can change pricing; the Runner's five pounds is a
 * constant in rules.ts, because it is untouched.
 *
 * The functions here are pure: same inputs, same outputs, no clock, no random, no I/O.
 */

import { RUNNER_PAYMENT_PENCE } from './rules.js';

/** Standard delivery, as configured. */
export interface DeliveryFees {
  /** The flat fee for one standard delivery. */
  readonly standardDeliveryPence: number;
  /**
   * The most shopping one delivery carries. An operational limit, not a price: it is what one
   * Runner can carry safely on foot or onto a bus. Above it, the Shopper is offered two
   * deliveries.
   */
  readonly maximumGoodsPence: number;
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

/** What the Shopper is told, before they confirm anything. */
export interface BasketPricing {
  readonly goodsPence: number;
  readonly feePence: number;
  readonly totalPence: number;
}

/** The internal view of the same order: who gets what. */
export interface OrderEconomics extends BasketPricing {
  readonly runnerPaymentPence: number;
  readonly processorCostPence: number;
  readonly platformNetPence: number;
}

/** A basket over the maximum for one delivery. The Shopper is offered two deliveries. */
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

function assertWholePence(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a whole, non-negative number of pence, received ${value}.`);
  }
}

/**
 * The fee, in pence, for one standard delivery of this much shopping.
 *
 * Rule Four lives in this signature. The only inputs are the goods total and the configured
 * fees. There is no time of day, no distance, no weather, no demand and no history of the
 * Shopper, so there is nothing a future edit could multiply the fee by. And the goods total
 * only decides whether the basket fits in one delivery: it never changes the fee.
 *
 * There is no minimum: a basket of one penny is priced and accepted.
 */
export function feeForGoodsPence(goodsPence: number, fees: DeliveryFees): number {
  assertWholePence(goodsPence, 'Goods total');
  if (goodsPence > fees.maximumGoodsPence) {
    throw new BasketOverMaximumError(goodsPence, fees.maximumGoodsPence);
  }
  return fees.standardDeliveryPence;
}

/**
 * What the payment processor takes from a transaction, in pence: a percentage of the goods and
 * the fee together, because that is what the card is charged, plus a fixed amount. Rounded up,
 * so any report of what the platform keeps errs on the low side.
 */
export function processorCostPence(totalTransactionPence: number, processor: ProcessorModel): number {
  assertWholePence(totalTransactionPence, 'Transaction total');
  const percentagePart = Math.ceil((totalTransactionPence * processor.percentageBasisPoints) / 10_000);
  return percentagePart + processor.fixedPence;
}

/**
 * What the platform keeps, in pence: the fee, minus the Runner's five pounds, minus the
 * modelled processor cost. Reported, never floored: the floor it used to be held to was
 * superseded on 29 Sep 2026.
 */
export function platformNetPence(
  goodsPence: number,
  fees: DeliveryFees,
  processor: ProcessorModel,
): number {
  return orderEconomics(goodsPence, fees, processor).platformNetPence;
}

/** Goods, fee and total together, so the API and the web never do this arithmetic twice. */
export function priceBasket(goodsPence: number, fees: DeliveryFees): BasketPricing {
  const feePence = feeForGoodsPence(goodsPence, fees);
  return { goodsPence, feePence, totalPence: goodsPence + feePence };
}

/** The full economics of an order, for internal reporting and for the payout routes. */
export function orderEconomics(
  goodsPence: number,
  fees: DeliveryFees,
  processor: ProcessorModel,
): OrderEconomics {
  const { feePence, totalPence } = priceBasket(goodsPence, fees);
  const cost = processorCostPence(totalPence, processor);
  return {
    goodsPence,
    feePence,
    totalPence,
    runnerPaymentPence: RUNNER_PAYMENT_PENCE,
    processorCostPence: cost,
    platformNetPence: feePence - RUNNER_PAYMENT_PENCE - cost,
  };
}
