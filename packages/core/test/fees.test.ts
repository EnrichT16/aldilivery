/**
 * The proving tests for the fee engine, against the pricing ruled on 9 October 2026
 * (docs/BUILD_PROMPT.md, ruling 58): an item charge on every unit, delivery by plan and shop
 * size, no product over £60, a whole-order goods cap, and the Runner's five pounds untouched.
 *
 * The figures are read from the real `config/store.json`, and also pinned here, so an edit to
 * the live configuration that changes a ruled price fails this suite and has to be made on
 * purpose.
 */

import { describe, expect, it } from 'vitest';

import {
  BasketOverMaximumError,
  deliveryFeePence,
  displayPricePence,
  itemChargePence,
  itemChargesForLines,
  orderEconomics,
  organisationMonthlyPence,
  overOneRunnerWords,
  priceBasket,
  priceBasketInParts,
  formatPence,
  processorCostPence,
  ProductOverMaximumError,
  RUNNER_PAYMENT_PENCE,
  type DeliveryPlan,
} from '../src/index.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const fees = config.fees;
const processor = config.fees.processor;

const lines = (prices: number[]) => prices.map((shopPricePence) => ({ shopPricePence, quantity: 1 }));

/** John's shop, ten products, £58.36 at shop prices. */
const JOHN = [140, 125, 95, 249, 279, 499, 650, 700, 1249, 1850];
/** Mary's milk, bread and eggs, £4.69. */
const MARY = [125, 95, 249];

describe('the ruled figures', () => {
  it('prices delivery by plan: £7.99 / £13.50 pay as you go, £7.99 members, £5.99 Plus', () => {
    expect(fees.delivery).toEqual({
      payAsYouGoSmallOrderPence: 799,
      payAsYouGoSmallOrderUpToPence: 1500,
      payAsYouGoPence: 1350,
      membershipPence: 799,
      plusPence: 599,
    });
  });

  it('charges 50p on every unit, and 50p more for every whole £6', () => {
    expect(fees.itemCharge).toEqual({ basePence: 50, stepPence: 50, everyPence: 600 });
  });

  it('sells no product over £60, and caps one order at £150 of shopping (pending Anthony)', () => {
    expect(fees.maximumProductPence).toBe(6000);
    expect(fees.maximumOrderGoodsPence).toBe(15000);
  });

  it('pays the Runner exactly five pounds, from the constant and never from the file (Rule Two)', () => {
    expect(RUNNER_PAYMENT_PENCE).toBe(500);
    expect(fees.runnerPaymentPence).toBe(RUNNER_PAYMENT_PENCE);
  });

  it('prices the plans at £10, £15 and £20 a month', () => {
    expect(config.extras.membershipPence).toBe(1000);
    expect(config.extras.plusPence).toBe(1500);
    expect(config.extras.familyPence).toBe(2000);
    expect(config.extras.familyMaximum).toBe(4);
  });
});

describe('itemChargePence', () => {
  it('follows 50p + 50p × floor(price / £6) at every band edge', () => {
    const cases: Array<[number, number]> = [
      [0, 50],
      [1, 50],
      [599, 50],
      [600, 100],
      [1199, 100],
      [1200, 150],
      [1799, 150],
      [1800, 200],
      [2399, 200],
      [2400, 250],
      [6000, 550],
    ];
    for (const [price, charge] of cases) expect(itemChargePence(price, fees)).toBe(charge);
  });

  it('matches the formula for every price from 0p to £60, one penny at a time', () => {
    for (let price = 0; price <= 6000; price += 1) {
      if (itemChargePence(price, fees) !== 50 + 50 * Math.floor(price / 600)) {
        throw new Error(`The item charge is wrong at ${price}p.`);
      }
    }
  });

  it('counts each unit on its own: three bananas are three charges', () => {
    expect(itemChargesForLines([{ shopPricePence: 20, quantity: 3 }], fees)).toBe(150);
  });

  it('shows the price with the charge already in it', () => {
    expect(displayPricePence(140, fees)).toBe(190);
    expect(displayPricePence(1850, fees)).toBe(2050);
  });
});

describe('deliveryFeePence', () => {
  it('is £7.99 pay as you go up to £15.00 of shopping and £13.50 from £15.01', () => {
    for (let goods = 0; goods <= 1500; goods += 1) {
      if (deliveryFeePence(goods, 'payg', fees) !== 799) throw new Error(`Wrong at ${goods}p.`);
    }
    for (let goods = 1501; goods <= fees.maximumOrderGoodsPence; goods += 1) {
      if (deliveryFeePence(goods, 'payg', fees) !== 1350) throw new Error(`Wrong at ${goods}p.`);
    }
  });

  it('is £7.99 for members and £5.99 on Plus, whatever the size', () => {
    for (const goods of [1, 1500, 1501, 5836, fees.maximumOrderGoodsPence]) {
      expect(deliveryFeePence(goods, 'membership', fees)).toBe(799);
      expect(deliveryFeePence(goods, 'plus', fees)).toBe(599);
    }
  });

  it('always covers the Runner’s five pounds (Rule Two)', () => {
    for (const plan of ['payg', 'membership', 'plus'] as DeliveryPlan[]) {
      for (const goods of [1, 1500, 1501, 15000]) {
        expect(deliveryFeePence(goods, plan, fees)).toBeGreaterThan(RUNNER_PAYMENT_PENCE);
      }
    }
  });

  it('has no input that could carry surge pricing (Rule Four): goods, plan and fees only', () => {
    expect(deliveryFeePence.length).toBe(3);
  });

  it('accepts the whole-order cap exactly, and offers two deliveries one penny over', () => {
    expect(deliveryFeePence(15000, 'payg', fees)).toBe(1350);
    expect(() => deliveryFeePence(15001, 'payg', fees)).toThrow(BasketOverMaximumError);
    expect(() => deliveryFeePence(15001, 'plus', fees)).toThrow(/split into two deliveries/);
  });

  it('refuses nonsense input', () => {
    expect(() => deliveryFeePence(-1, 'payg', fees)).toThrow(TypeError);
    expect(() => deliveryFeePence(12.5, 'payg', fees)).toThrow(TypeError);
  });
});

describe('priceBasket, the worked examples', () => {
  it('John, first month, pay as you go: £58.36 + £8.50 + £13.50 = £80.36', () => {
    expect(priceBasket(lines(JOHN), 'payg', fees)).toEqual({
      goodsPence: 5836,
      itemChargesPence: 850,
      feePence: 1350,
      totalPence: 8036,
      plan: 'payg',
    });
  });

  it('John, as a Member: £58.36 + £8.50 + £7.99 = £74.85', () => {
    expect(priceBasket(lines(JOHN), 'membership', fees).totalPence).toBe(7485);
  });

  it('John on Plus: £58.36 + £8.50 + £5.99 = £72.85', () => {
    expect(priceBasket(lines(JOHN), 'plus', fees).totalPence).toBe(7285);
  });

  it('Mary, pay as you go: £4.69 + £1.50 + £7.99 = £14.18', () => {
    expect(priceBasket(lines(MARY), 'payg', fees)).toEqual({
      goodsPence: 469,
      itemChargesPence: 150,
      feePence: 799,
      totalPence: 1418,
      plan: 'payg',
    });
  });

  it('prices a basket of one penny without any small order fee (Rule Four)', () => {
    expect(priceBasket(lines([1]), 'payg', fees).totalPence).toBe(1 + 50 + 799);
  });

  it('refuses any one product over £60, plainly', () => {
    expect(() => priceBasket(lines([6000]), 'payg', fees)).not.toThrow();
    expect(() => priceBasket(lines([6001]), 'payg', fees)).toThrow(ProductOverMaximumError);
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
  it('pays the Runner five pounds on every plan, and the business keeps the rest and the item charges', () => {
    for (const plan of ['payg', 'membership', 'plus'] as DeliveryPlan[]) {
      const e = orderEconomics(priceBasket(lines(JOHN), plan, fees), processor);
      expect(e.runnerPaymentPence).toBe(500);
      expect(e.runnerPaymentPence + e.processorCostPence + e.platformNetPence).toBe(
        e.feePence + e.itemChargesPence,
      );
    }
  });

  it('reports what the business keeps on John’s pay-as-you-go order', () => {
    // £80.36 charged: the processor takes 121p + 20p. £13.50 − £5 + £8.50 − £1.41.
    expect(orderEconomics(priceBasket(lines(JOHN), 'payg', fees), processor).platformNetPence).toBe(
      1350 - 500 + 850 - 141,
    );
  });
});

describe('organisationMonthlyPence', () => {
  const pricing = config.extras.organisations;

  it('charges £10 a client, every 51st client £5', () => {
    expect(pricing).toEqual({
      clientMonthlyPence: 1000,
      discountEveryNthClient: 51,
      discountedClientMonthlyPence: 500,
    });
    expect(organisationMonthlyPence(0, pricing)).toBe(0);
    expect(organisationMonthlyPence(1, pricing)).toBe(1000);
    expect(organisationMonthlyPence(50, pricing)).toBe(50_000);
    expect(organisationMonthlyPence(51, pricing)).toBe(50_500);
    expect(organisationMonthlyPence(102, pricing)).toBe(101_000);
  });

  it('is £1,190 for 120 clients (118 × £10 and 2 × £5)', () => {
    expect(organisationMonthlyPence(120, pricing)).toBe(119_000);
  });

  it('equals the sum over clients numbered 1 to N, for every N up to 400', () => {
    let sum = 0;
    for (let n = 1; n <= 400; n += 1) {
      sum += n % 51 === 0 ? 500 : 1000;
      expect(organisationMonthlyPence(n, pricing)).toBe(sum);
    }
  });
});

describe('baskets over £150 (ruling 61)', () => {
  /** So many units of one price, as basket lines. */
  const of = (unitPricePence: number, quantity: number, key = 'x') => ({ key, unitPricePence, quantity });

  it('reads £450 for the whole basket, £13.50 for each extra Runner and £5 for a tiny extra', () => {
    expect(fees.maximumBasketGoodsPence).toBe(45000);
    expect(fees.extraRunnerDeliveryPence).toBe(1350);
    expect(config.dispatch.tinyExtraBelowPence).toBe(500);
  });

  it('keeps £148 as one order, priced exactly as before', () => {
    const basket = priceBasketInParts([of(400, 37)], 'payg', fees);
    expect(basket.parts).toHaveLength(1);
    expect(basket.extraDeliveryPence).toBe(0);
    expect(basket.totalPence).toBe(priceBasket([{ shopPricePence: 400, quantity: 37 }], 'payg', fees).totalPence);
  });

  it('makes £172 kept two orders, £13.50 + £13.50 delivery on pay as you go', () => {
    const basket = priceBasketInParts([of(200, 86)], 'payg', fees);
    expect(basket.parts.map((part) => [part.goodsPence, part.feePence, part.extra])).toEqual([
      [15000, 1350, false],
      [2200, 1350, true],
    ]);
    expect(basket.feePence).toBe(2700);
    expect(basket.extraDeliveryPence).toBe(1350);
    expect(basket.totalPence).toBe(17200 + basket.itemChargesPence + 2700);
  });

  it('charges each extra Runner £13.50 whatever the plan; the first order keeps the plan price', () => {
    const plus = priceBasketInParts([of(200, 86)], 'plus', fees);
    expect(plus.parts.map((part) => part.feePence)).toEqual([599, 1350]);
    const member = priceBasketInParts([of(200, 86)], 'membership', fees);
    expect(member.parts.map((part) => part.feePence)).toEqual([799, 1350]);
  });

  it('fills the first order up to £150, then the next, never splitting a product', () => {
    const basket = priceBasketInParts([of(5000, 3, 'a'), of(2500, 3, 'b'), of(150, 1, 'c')], 'payg', fees);
    expect(basket.parts.map((part) => part.goodsPence)).toEqual([15000, 7650]);
    // £151.50: a tiny extra of £1.50.
    const tiny = priceBasketInParts([of(5000, 3, 'a'), of(150, 1, 'c')], 'payg', fees);
    expect(tiny.parts.map((part) => part.goodsPence)).toEqual([15000, 150]);
  });

  it('refuses a basket over £450', () => {
    expect(priceBasketInParts([of(5000, 9)], 'payg', fees).parts).toHaveLength(3);
    expect(() => priceBasketInParts([of(5000, 9), of(1, 1, 'p')], 'payg', fees)).toThrow(BasketOverMaximumError);
  });

  it('tells the Shopper plainly, with both choices', () => {
    expect(overOneRunnerWords(fees, (pence) => formatPence(pence))).toBe(
      'Your shopping is over £150, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50 delivery.',
    );
  });
});
