/**
 * The Aldilivery fee engine.
 *
 * Every figure in this file is an integer number of pence. Money is never a float in this
 * codebase: floats lose halfpennies, and a lost halfpenny in the wrong direction is a
 * broken promise to a Runner or a broken Rule Three.
 *
 * The three functions the business rests on are `feeForGoodsPence`, `processorCostPence`
 * and `aldiliveryNetPence`. They are pure: same inputs, same outputs, no clock, no random,
 * no I/O, no globals.
 */

import { MINIMUM_NET_PENCE, RUNNER_PAYMENT_PENCE } from './rules.js';

/**
 * One flat fee band.
 *
 * `uptoPence` is inclusive: a band of `{ uptoPence: 3500, feePence: 800 }` charges 800p on
 * a goods total of exactly 3500p.
 */
export interface FeeBand {
  readonly uptoPence: number;
  readonly feePence: number;
}

/**
 * How the payment processor charges us: a percentage of the whole transaction plus a fixed
 * amount. Expressed in basis points so that it stays integer arithmetic — 150 basis points
 * is 1.5 percent.
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
  readonly aldiliveryNetPence: number;
}

/** Thrown when a goods total falls outside every configured band. */
export class GoodsTotalOutOfRangeError extends Error {
  constructor(
    readonly goodsPence: number,
    readonly maximumPence: number,
  ) {
    super(
      `Goods total of ${goodsPence}p is above the largest configured fee band, which ends at ${maximumPence}p. ` +
        `Aldilivery cannot price this basket without breaking the ${MINIMUM_NET_PENCE}p net floor, so it is refused rather than mispriced.`,
    );
    this.name = 'GoodsTotalOutOfRangeError';
  }
}

function assertWholePence(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a whole, non-negative number of pence, received ${value}.`);
  }
}

/**
 * The flat fee, in pence, for a goods total.
 *
 * Rule Four lives in this signature. The only inputs are the goods total and the bands.
 * There is no time of day, no distance, no weather, no demand and no history of the
 * Shopper, so there is nothing a future edit could multiply the fee by. Surge pricing is
 * not blocked here; it is simply not expressible.
 *
 * Rule Four also means there is no floor: a basket of one penny is priced and accepted.
 *
 * Bands are searched in ascending order and `uptoPence` is inclusive. A goods total above
 * the last band throws, because pricing it with the last band's fee would breach Rule
 * Three — see `assertBandsHonourNetFloor`, which is what stops such a band existing.
 */
export function feeForGoodsPence(goodsPence: number, bands: readonly FeeBand[]): number {
  assertWholePence(goodsPence, 'Goods total');
  if (bands.length === 0) {
    throw new TypeError('At least one fee band is required.');
  }

  for (const band of bands) {
    if (goodsPence <= band.uptoPence) {
      return band.feePence;
    }
  }

  const last = bands[bands.length - 1] as FeeBand;
  throw new GoodsTotalOutOfRangeError(goodsPence, last.uptoPence);
}

/**
 * What the payment processor takes from a transaction, in pence.
 *
 * Modelled as a percentage of the whole transaction — the goods and the fee together,
 * because that is the amount the Shopper's card is charged — plus a fixed amount.
 *
 * Rounded UP to the nearest penny. Rounding up is the conservative direction: it can only
 * make our modelled net smaller than reality, never larger, so Rule Three is proved
 * against the pessimistic number.
 */
export function processorCostPence(
  totalTransactionPence: number,
  processor: ProcessorModel,
): number {
  assertWholePence(totalTransactionPence, 'Transaction total');
  const percentagePart = Math.ceil((totalTransactionPence * processor.percentageBasisPoints) / 10_000);
  return percentagePart + processor.fixedPence;
}

/**
 * What Aldilivery keeps, in pence: the fee, minus the Runner's five pounds, minus the
 * modelled processor cost.
 *
 * Rule Three says this is never below `MINIMUM_NET_PENCE`. That is proved for every goods
 * total from 1p to the top of the bands in `test/fees.test.ts`, and guarded at
 * configuration load by `assertBandsHonourNetFloor`.
 */
export function aldiliveryNetPence(
  goodsPence: number,
  bands: readonly FeeBand[],
  processor: ProcessorModel,
): number {
  const feePence = feeForGoodsPence(goodsPence, bands);
  const totalPence = goodsPence + feePence;
  return feePence - RUNNER_PAYMENT_PENCE - processorCostPence(totalPence, processor);
}

/** Goods, fee and total together, so the API and the web never do this arithmetic twice. */
export function priceBasket(goodsPence: number, bands: readonly FeeBand[]): BasketPricing {
  const feePence = feeForGoodsPence(goodsPence, bands);
  return { goodsPence, feePence, totalPence: goodsPence + feePence };
}

/** The full economics of an order, for internal reporting and for the payout routes. */
export function orderEconomics(
  goodsPence: number,
  bands: readonly FeeBand[],
  processor: ProcessorModel,
): OrderEconomics {
  const { feePence, totalPence } = priceBasket(goodsPence, bands);
  const cost = processorCostPence(totalPence, processor);
  return {
    goodsPence,
    feePence,
    totalPence,
    runnerPaymentPence: RUNNER_PAYMENT_PENCE,
    processorCostPence: cost,
    aldiliveryNetPence: feePence - RUNNER_PAYMENT_PENCE - cost,
  };
}

/**
 * The worst point of any band is its very top: the fee is flat across the band while the
 * processor's percentage keeps climbing with the goods total. So a band is safe for the
 * whole of its range if, and only if, it is safe at `uptoPence`.
 *
 * This is why the proving test can be exhaustive and cheap at the same time, and why the
 * configuration loader can validate arbitrary future bands in a handful of sums.
 */
export function worstCaseNetPenceForBand(band: FeeBand, processor: ProcessorModel): number {
  const totalPence = band.uptoPence + band.feePence;
  return band.feePence - RUNNER_PAYMENT_PENCE - processorCostPence(totalPence, processor);
}

/** A band that would breach Rule Three, with the arithmetic that shows it. */
export interface NetFloorBreach {
  readonly band: FeeBand;
  readonly worstCaseNetPence: number;
  readonly shortfallPence: number;
}

/** Every band that breaches the net floor. Empty means the bands are sound. */
export function findNetFloorBreaches(
  bands: readonly FeeBand[],
  processor: ProcessorModel,
  minimumNetPence: number = MINIMUM_NET_PENCE,
): NetFloorBreach[] {
  return bands
    .map((band) => {
      const worstCaseNet = worstCaseNetPenceForBand(band, processor);
      return { band, worstCaseNetPence: worstCaseNet, shortfallPence: minimumNetPence - worstCaseNet };
    })
    .filter((result) => result.shortfallPence > 0);
}

/**
 * Refuse to run on bands that would breach Rule Three.
 *
 * Called at configuration load. Someone editing `config/store.json` cannot introduce a band
 * that loses Aldilivery money: the process will not start, and the error says which band
 * and by how much.
 */
export function assertBandsHonourNetFloor(
  bands: readonly FeeBand[],
  processor: ProcessorModel,
  minimumNetPence: number = MINIMUM_NET_PENCE,
): void {
  const breaches = findNetFloorBreaches(bands, processor, minimumNetPence);
  if (breaches.length > 0) {
    const detail = breaches
      .map(
        (b) =>
          `band up to ${b.band.uptoPence}p at a fee of ${b.band.feePence}p nets ${b.worstCaseNetPence}p at its top, ` +
          `which is ${b.shortfallPence}p short`,
      )
      .join('; ');
    throw new Error(
      `Rule Three: Aldilivery never nets below ${minimumNetPence}p on any order after payment processing costs. ` +
        `The configured fee bands breach that floor — ${detail}. ` +
        `Adjust the band boundaries or the fee. Never lower the floor.`,
    );
  }
}
