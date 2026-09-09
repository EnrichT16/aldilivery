/**
 * The proving tests for the Aldilivery fee engine.
 *
 * The headline test is the exhaustive one: every goods total from 1 penny to the top of the
 * configured bands, one penny at a time, must leave Aldilivery at least 200 pence after the
 * Runner has been paid five pounds and the payment processor has taken its cut.
 *
 * The bands are read from the real `config/store.json`, not from a fixture, so this suite
 * fails if anybody edits the live configuration into a loss.
 */

import { describe, expect, it } from 'vitest';

import {
  aldiliveryNetPence,
  feeForGoodsPence,
  GoodsTotalOutOfRangeError,
  MINIMUM_NET_PENCE,
  orderEconomics,
  priceBasket,
  processorCostPence,
  RUNNER_PAYMENT_PENCE,
  worstCaseNetPenceForBand,
} from '../src/index.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const bands = config.fees.bands;
const processor = config.fees.processor;
const topOfBands = config.fees.maximumGoodsPence;

describe('the inviolable figures', () => {
  it('pays the Runner exactly five pounds (Rule Two)', () => {
    expect(RUNNER_PAYMENT_PENCE).toBe(500);
  });

  it('holds the Aldilivery floor at exactly two pounds (Rule Three)', () => {
    expect(MINIMUM_NET_PENCE).toBe(200);
  });

  it('takes the Runner payment from the constant, never from the configuration file', () => {
    expect(config.fees.runnerPaymentPence).toBe(RUNNER_PAYMENT_PENCE);
    expect(config.fees.minimumNetPence).toBe(MINIMUM_NET_PENCE);
  });
});

describe('feeForGoodsPence', () => {
  it('charges the specified fee at the top of each configured band', () => {
    for (const band of bands) {
      expect(feeForGoodsPence(band.uptoPence, bands)).toBe(band.feePence);
    }
  });

  it('treats every band boundary as inclusive, and steps up one penny later', () => {
    for (let i = 0; i < bands.length - 1; i += 1) {
      const band = bands[i]!;
      const next = bands[i + 1]!;
      expect(feeForGoodsPence(band.uptoPence, bands)).toBe(band.feePence);
      expect(feeForGoodsPence(band.uptoPence + 1, bands)).toBe(next.feePence);
    }
  });

  it('is flat inside a band: the fee never varies with the goods total within a band', () => {
    let lower = 0;
    for (const band of bands) {
      const samples = [lower + 1, Math.floor((lower + band.uptoPence) / 2), band.uptoPence];
      const fees = new Set(samples.map((goods) => feeForGoodsPence(goods, bands)));
      expect(fees).toEqual(new Set([band.feePence]));
      lower = band.uptoPence;
    }
  });

  it('prices a basket of one penny without any small order fee (Rule Four)', () => {
    const oneP = priceBasket(1, bands);
    expect(oneP.goodsPence).toBe(1);
    expect(oneP.feePence).toBe(bands[0]!.feePence);
    expect(oneP.totalPence).toBe(1 + bands[0]!.feePence);
  });

  it('has no input that could carry surge pricing (Rule Four)', () => {
    // The function accepts the goods total and the bands, and nothing else. No clock, no
    // distance, no demand, no Shopper history. Surge pricing is unrepresentable.
    expect(feeForGoodsPence.length).toBe(2);
  });

  it('refuses a goods total above the largest band rather than mispricing it', () => {
    expect(() => feeForGoodsPence(topOfBands + 1, bands)).toThrow(GoodsTotalOutOfRangeError);
  });

  it('refuses nonsense input', () => {
    expect(() => feeForGoodsPence(-1, bands)).toThrow(TypeError);
    expect(() => feeForGoodsPence(10.5, bands)).toThrow(TypeError);
    expect(() => feeForGoodsPence(100, [])).toThrow(TypeError);
  });
});

describe('processorCostPence', () => {
  it('models 1.5 percent of the whole transaction plus 20 pence', () => {
    // 1.5 percent of 10000p is 150p, plus the fixed 20p.
    expect(processorCostPence(10_000, processor)).toBe(170);
    // 1.5 percent of 4300p is 64.5p, rounded up to 65p, plus 20p.
    expect(processorCostPence(4_300, processor)).toBe(85);
    // The fixed part still applies to a zero transaction.
    expect(processorCostPence(0, processor)).toBe(20);
  });

  it('rounds up, never down, so the modelled cost is never optimistic', () => {
    for (let total = 1; total <= 2_000; total += 1) {
      const exact = (total * processor.percentageBasisPoints) / 10_000 + processor.fixedPence;
      expect(processorCostPence(total, processor)).toBeGreaterThanOrEqual(exact);
      expect(processorCostPence(total, processor)).toBeLessThan(exact + 1);
    }
  });

  it('charges on the goods and the fee together, because that is what the card is charged', () => {
    const { totalPence } = priceBasket(5_000, bands);
    expect(totalPence).toBe(5_000 + feeForGoodsPence(5_000, bands));
    expect(processorCostPence(totalPence, processor)).toBe(
      Math.ceil((totalPence * 150) / 10_000) + 20,
    );
  });
});

describe('Rule Three: Aldilivery never nets below two pounds on any order', () => {
  it('holds for every goods total from 1p to 30000p, one penny at a time', () => {
    const failures: Array<{ goodsPence: number; netPence: number }> = [];

    for (let goodsPence = 1; goodsPence <= 30_000; goodsPence += 1) {
      const net = aldiliveryNetPence(goodsPence, bands, processor);
      if (net < MINIMUM_NET_PENCE) {
        failures.push({ goodsPence, netPence: net });
      }
    }

    expect(
      failures.slice(0, 5),
      `Rule Three breached at ${failures.length} goods totals; first few shown`,
    ).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('holds for every goods total from 1p to the top of the configured bands', () => {
    let worst = { goodsPence: 0, netPence: Number.POSITIVE_INFINITY };

    for (let goodsPence = 1; goodsPence <= topOfBands; goodsPence += 1) {
      const net = aldiliveryNetPence(goodsPence, bands, processor);
      if (net < worst.netPence) {
        worst = { goodsPence, netPence: net };
      }
    }

    expect(worst.netPence).toBeGreaterThanOrEqual(MINIMUM_NET_PENCE);
  });

  it('is at its worst at the very top of each band, which is why the exhaustive scan agrees with the shortcut', () => {
    for (const band of bands) {
      const shortcut = worstCaseNetPenceForBand(band, processor);
      const exhaustive = aldiliveryNetPence(band.uptoPence, bands, processor);
      expect(shortcut).toBe(exhaustive);
      expect(shortcut).toBeGreaterThanOrEqual(MINIMUM_NET_PENCE);
    }
  });

  it('pays the Runner five pounds in every band, whatever the net (Rule Two)', () => {
    for (const band of bands) {
      const economics = orderEconomics(band.uptoPence, bands, processor);
      expect(economics.runnerPaymentPence).toBe(500);
      expect(economics.feePence).toBe(
        economics.runnerPaymentPence + economics.processorCostPence + economics.aldiliveryNetPence,
      );
    }
  });
});

describe('orderEconomics', () => {
  it('splits the fee into exactly three parts that add back up', () => {
    for (const goodsPence of [1, 999, 3_500, 3_501, 10_000, 16_500, 24_000, 30_000]) {
      const e = orderEconomics(goodsPence, bands, processor);
      expect(e.totalPence).toBe(e.goodsPence + e.feePence);
      expect(e.runnerPaymentPence + e.processorCostPence + e.aldiliveryNetPence).toBe(e.feePence);
    }
  });
});
