/**
 * The proving tests for the fee engine, against the pricing ruled on 29 Sep 2026
 * (docs/BUILD_PROMPT.md, Section B): standard delivery is thirteen pounds fifty, flat; one
 * delivery carries at most sixty pounds of shopping; the Runner's five pounds is untouched.
 *
 * The figures are read from the real `config/store.json`, and also pinned here, so an edit to
 * the live configuration that changes a ruled price fails this suite and has to be made on
 * purpose.
 */

import { describe, expect, it } from 'vitest';

import {
  BasketOverMaximumError,
  feeForGoodsPence,
  orderEconomics,
  platformNetPence,
  priceBasket,
  processorCostPence,
  RUNNER_PAYMENT_PENCE,
} from '../src/index.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const fees = config.fees;
const processor = config.fees.processor;

describe('the ruled figures', () => {
  it('charges thirteen pounds fifty for standard delivery', () => {
    expect(fees.standardDeliveryPence).toBe(1350);
  });

  it('carries at most sixty pounds of shopping in one delivery', () => {
    expect(fees.maximumGoodsPence).toBe(6000);
  });

  it('pays the Runner exactly five pounds, from the constant and never from the file (Rule Two)', () => {
    expect(RUNNER_PAYMENT_PENCE).toBe(500);
    expect(fees.runnerPaymentPence).toBe(RUNNER_PAYMENT_PENCE);
  });
});

describe('feeForGoodsPence', () => {
  it('is the same flat fee for every basket from one penny to the maximum, one penny at a time', () => {
    for (let goodsPence = 1; goodsPence <= fees.maximumGoodsPence; goodsPence += 1) {
      if (feeForGoodsPence(goodsPence, fees) !== 1350) {
        throw new Error(`The fee changed at a goods total of ${goodsPence}p.`);
      }
    }
  });

  it('prices a basket of one penny without any small order fee (Rule Four)', () => {
    expect(priceBasket(1, fees)).toEqual({ goodsPence: 1, feePence: 1350, totalPence: 1351 });
  });

  it('has no input that could carry surge pricing (Rule Four)', () => {
    // Two parameters: the goods total and the configured fees. Nothing else can reach it.
    expect(feeForGoodsPence.length).toBe(2);
  });

  it('accepts exactly sixty pounds, and offers two deliveries one penny over', () => {
    expect(feeForGoodsPence(6000, fees)).toBe(1350);
    expect(() => feeForGoodsPence(6001, fees)).toThrow(BasketOverMaximumError);
    expect(() => feeForGoodsPence(6001, fees)).toThrow(/split into two deliveries/);
  });

  it('refuses nonsense input', () => {
    expect(() => feeForGoodsPence(-1, fees)).toThrow(TypeError);
    expect(() => feeForGoodsPence(12.5, fees)).toThrow(TypeError);
  });
});

describe('processorCostPence', () => {
  it('models 1.5 percent of the whole transaction plus 20 pence', () => {
    expect(processorCostPence(10_000, processor)).toBe(170);
  });

  it('rounds up, never down', () => {
    expect(processorCostPence(1, processor)).toBe(21);
  });
});

describe('orderEconomics', () => {
  it('pays the Runner five pounds whatever the basket, and the parts add back up to the fee', () => {
    for (const goodsPence of [1, 1000, 2500, 4500, 6000]) {
      const e = orderEconomics(goodsPence, fees, processor);
      expect(e.runnerPaymentPence).toBe(500);
      expect(e.runnerPaymentPence + e.processorCostPence + e.platformNetPence).toBe(e.feePence);
    }
  });

  it('reports what the platform keeps at the largest basket, without flooring it', () => {
    // 6000p of goods and 1350p of fee is a 7350p charge: the processor takes 111p + 20p.
    expect(platformNetPence(6000, fees, processor)).toBe(1350 - 500 - 131);
  });
});
