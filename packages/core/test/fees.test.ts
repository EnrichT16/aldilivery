/**
 * The proving tests for the fee engine, against the pricing ruled on 9 October 2026
 * (docs/BUILD_PROMPT.md, ruling 58) and re-priced on 20 October 2026 (ruling 73): an item
 * charge on every unit, delivery by plan and shop size, a monthly order allowance on every
 * plan, no product over £60, a whole-order goods cap, and the Runner's five pounds untouched.
 *
 * The figures are read from the real `config/store.json`, and also pinned here, so an edit to
 * the live configuration that changes a ruled price fails this suite and has to be made on
 * purpose.
 */

import { describe, expect, it } from 'vitest';

import {
  allowanceExtraPence,
  allowancePlanWords,
  allowanceWords,
  bandPrice,
  BasketOverMaximumError,
  DELIVERY_PLANS,
  deliveryBandFor,
  deliveryFeePence,
  deliveryPriceRange,
  deliverySteps,
  deliveryStepsWords,
  displayPricePence,
  itemChargePence,
  itemChargesForLines,
  orderAllowanceFor,
  orderEconomics,
  ordinalWord,
  organisationMonthlyPence,
  overOneRunnerWords,
  priceBasket,
  priceBasketInParts,
  formatPence,
  processorCostPence,
  ProductOverMaximumError,
  RUNNER_PAYMENT_PENCE,
  type AllowancePlan,
  type DeliveryPlan,
} from '../src/index.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const fees = config.fees;
const processor = config.fees.processor;

const lines = (prices: number[]) =>
  prices.map((shopPricePence) => ({ shopPricePence, quantity: 1 }));

/** John's shop, ten products, £58.36 at shop prices. */
const JOHN = [140, 125, 95, 249, 279, 499, 650, 700, 1249, 1850];
/** Mary's milk, bread and eggs, £4.69. */
const MARY = [125, 95, 249];

describe('the ruled figures', () => {
  it('prices delivery in three bands by goods value and plan (ruling 73, 20 October 2026)', () => {
    expect(fees.delivery).toEqual({
      bands: [
        { upToPence: 3000, payAsYouGoPence: 1099, membershipPence: 799, plusPence: 699 },
        { upToPence: 6000, payAsYouGoPence: 1299, membershipPence: 799, plusPence: 699 },
        { upToPence: null, payAsYouGoPence: 1499, membershipPence: 999, plusPence: 899 },
      ],
      allowance: {
        membershipOrders: 5,
        plusOrders: 8,
        familyOrdersEach: 5,
        extraChargePence: 599,
        extraEvery: 3,
      },
    });
  });

  it('gives one free Ozi Finds It a month on Membership and two on Plus and Family', () => {
    expect(config.extras.freeFindItsPerMonth).toBe(1);
    expect(config.extras.plusFreeFindItsPerMonth).toBe(2);
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
  /** What each plan pays for every goods total from 0p to the cap, one penny at a time. */
  function expectEveryPenny(plan: DeliveryPlan, expected: (goods: number) => number): void {
    for (let goods = 0; goods <= fees.maximumOrderGoodsPence; goods += 1) {
      if (deliveryFeePence(goods, plan, fees) !== expected(goods)) {
        throw new Error(`Wrong on ${plan} at ${goods}p: ${deliveryFeePence(goods, plan, fees)}p.`);
      }
    }
  }

  it('is £10.99 pay as you go up to £30.00, £12.99 from £30.01 to £60.00 and £14.99 from £60.01', () => {
    expectEveryPenny('payg', (goods) => (goods <= 3000 ? 1099 : goods <= 6000 ? 1299 : 1499));
    expect(deliveryFeePence(3000, 'payg', fees)).toBe(1099);
    expect(deliveryFeePence(3001, 'payg', fees)).toBe(1299);
    expect(deliveryFeePence(6000, 'payg', fees)).toBe(1299);
    expect(deliveryFeePence(6001, 'payg', fees)).toBe(1499);
  });

  it('is £7.99 for members up to £60.00 and £9.99 from £60.01', () => {
    expectEveryPenny('membership', (goods) => (goods <= 6000 ? 799 : 999));
    expect(deliveryFeePence(6000, 'membership', fees)).toBe(799);
    expect(deliveryFeePence(6001, 'membership', fees)).toBe(999);
  });

  it('is £6.99 on Plus and Family and Carer up to £60.00 and £8.99 from £60.01', () => {
    expectEveryPenny('plus', (goods) => (goods <= 6000 ? 699 : 899));
    expect(deliveryFeePence(6000, 'plus', fees)).toBe(699);
    expect(deliveryFeePence(6001, 'plus', fees)).toBe(899);
  });

  it('is never dearer for a smaller shop, on any plan (Rule Four)', () => {
    for (const plan of DELIVERY_PLANS) {
      let previous = 0;
      for (let goods = 0; goods <= fees.maximumOrderGoodsPence; goods += 1) {
        const fee = deliveryFeePence(goods, plan, fees);
        if (fee < previous) throw new Error(`${plan} gets cheaper at ${goods}p.`);
        previous = fee;
      }
    }
  });

  it('covers the Runner’s five pounds in every pay-as-you-go band (Rule Two)', () => {
    for (const goods of [0, 1, 3000, 3001, 6000, 6001, 15000]) {
      expect(deliveryFeePence(goods, 'payg', fees)).toBeGreaterThan(RUNNER_PAYMENT_PENCE);
    }
  });

  it('finds the band a goods total falls in, and each plan’s price in it', () => {
    expect(deliveryBandFor(0, fees).upToPence).toBe(3000);
    expect(deliveryBandFor(3000, fees).upToPence).toBe(3000);
    expect(deliveryBandFor(3001, fees).upToPence).toBe(6000);
    expect(deliveryBandFor(6001, fees).upToPence).toBeNull();
    const top = deliveryBandFor(15000, fees);
    expect(bandPrice(top, 'payg')).toBe(1499);
    expect(bandPrice(top, 'membership')).toBe(999);
    expect(bandPrice(top, 'plus')).toBe(899);
    expect(() =>
      deliveryBandFor(1, {
        delivery: {
          bands: [{ upToPence: 0, payAsYouGoPence: 799, membershipPence: 599, plusPence: 399 }],
        },
      }),
    ).toThrow(TypeError);
  });

  it('joins neighbouring bands with the same price into steps, for the screens and Ozi', () => {
    expect(deliverySteps('payg', fees)).toEqual([
      { upToPence: 3000, pence: 1099 },
      { upToPence: 6000, pence: 1299 },
      { upToPence: null, pence: 1499 },
    ]);
    expect(deliverySteps('membership', fees)).toEqual([
      { upToPence: 6000, pence: 799 },
      { upToPence: null, pence: 999 },
    ]);
    expect(deliverySteps('plus', fees)).toEqual([
      { upToPence: 6000, pence: 699 },
      { upToPence: null, pence: 899 },
    ]);
  });

  it('says each plan’s prices in one plain phrase', () => {
    const say = (plan: DeliveryPlan) =>
      deliveryStepsWords(plan, fees, (pence) => formatPence(pence));
    expect(say('payg')).toBe(
      '£10.99 for shopping up to £30.00, £12.99 up to £60.00, and £14.99 over £60.00',
    );
    expect(say('membership')).toBe('£7.99 for shopping up to £60.00, and £9.99 over £60.00');
    expect(say('plus')).toBe('£6.99 for shopping up to £60.00, and £8.99 over £60.00');
    const flat = {
      delivery: {
        bands: [{ upToPence: null, payAsYouGoPence: 1350, membershipPence: 799, plusPence: 599 }],
      },
    };
    expect(deliveryStepsWords('plus', flat, (pence) => formatPence(pence))).toBe(
      '£5.99, whatever the size of the shop',
    );
  });

  it('knows the cheapest and dearest delivery on any plan: £6.99 to £14.99', () => {
    expect(deliveryPriceRange(fees)).toEqual({ lowestPence: 699, highestPence: 1499 });
  });

  it('has no input that could carry surge pricing (Rule Four): goods, plan and fees only', () => {
    expect(deliveryFeePence.length).toBe(3);
  });

  it('accepts the whole-order cap exactly, and offers two deliveries one penny over', () => {
    expect(deliveryFeePence(15000, 'payg', fees)).toBe(1499);
    expect(() => deliveryFeePence(15001, 'payg', fees)).toThrow(BasketOverMaximumError);
    expect(() => deliveryFeePence(15001, 'plus', fees)).toThrow(/split into two deliveries/);
  });

  it('refuses nonsense input', () => {
    expect(() => deliveryFeePence(-1, 'payg', fees)).toThrow(TypeError);
    expect(() => deliveryFeePence(12.5, 'payg', fees)).toThrow(TypeError);
  });
});

describe('priceBasket, the worked examples', () => {
  it('John, first month, pay as you go: £58.36 + £8.50 + £12.99 = £79.85 (over £30, up to £60)', () => {
    expect(priceBasket(lines(JOHN), 'payg', fees)).toEqual({
      goodsPence: 5836,
      itemChargesPence: 850,
      feePence: 1299,
      allowanceExtraPence: 0,
      totalPence: 7985,
      plan: 'payg',
    });
  });

  it('John, as a Member: £58.36 + £8.50 + £7.99 = £74.85', () => {
    expect(priceBasket(lines(JOHN), 'membership', fees).totalPence).toBe(7485);
  });

  it('John on Plus: £58.36 + £8.50 + £6.99 = £73.85', () => {
    expect(priceBasket(lines(JOHN), 'plus', fees).totalPence).toBe(7385);
  });

  it('a £75 shop (car-and-two-bags territory): £14.99, £9.99 and £8.99 by plan', () => {
    const big = lines([2500, 2500, 2500]);
    expect(priceBasket(big, 'payg', fees).feePence).toBe(1499);
    expect(priceBasket(big, 'membership', fees).feePence).toBe(999);
    expect(priceBasket(big, 'plus', fees).feePence).toBe(899);
  });

  it('Mary, pay as you go: £4.69 + £1.50 + £10.99 = £17.18', () => {
    expect(priceBasket(lines(MARY), 'payg', fees)).toEqual({
      goodsPence: 469,
      itemChargesPence: 150,
      feePence: 1099,
      allowanceExtraPence: 0,
      totalPence: 1718,
      plan: 'payg',
    });
  });

  it('a Member’s 6th order this month, £25 of ten things under £6: £25 + £5 + £7.99 + £5.99 = £43.98', () => {
    const tenThings = lines([250, 250, 250, 250, 250, 250, 250, 250, 250, 250]);
    const extra = allowanceExtraPence('membership', 6, fees.delivery.allowance);
    expect(priceBasket(tenThings, 'membership', fees, extra)).toEqual({
      goodsPence: 2500,
      itemChargesPence: 500,
      feePence: 799,
      allowanceExtraPence: 599,
      totalPence: 4398,
      plan: 'membership',
    });
  });

  it('prices a basket of one penny without any small order fee (Rule Four)', () => {
    expect(priceBasket(lines([1]), 'payg', fees).totalPence).toBe(1 + 50 + 1099);
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
    // £79.85 charged: the processor takes 120p + 20p. £12.99 − £5 + £8.50 − £1.40.
    expect(orderEconomics(priceBasket(lines(JOHN), 'payg', fees), processor).platformNetPence).toBe(
      1299 - 500 + 850 - 140,
    );
  });

  it('still pays the Runner five pounds on a £6.99 Plus delivery; the item charges help carry it', () => {
    // Mary's £4.69 on Plus: £1.50 of item charges and £6.99 delivery, £13.18 charged, 40p of card fee.
    const e = orderEconomics(priceBasket(lines(MARY), 'plus', fees), processor);
    expect(e.feePence).toBe(699);
    expect(e.runnerPaymentPence).toBe(500);
    expect(e.platformNetPence).toBe(699 - 500 + 150 - 40);
  });

  it('keeps the extra delivery charge for the business; the Runner still gets five pounds', () => {
    const e = orderEconomics(priceBasket(lines(MARY), 'membership', fees, 599), processor);
    expect(e.runnerPaymentPence).toBe(500);
    expect(e.runnerPaymentPence + e.processorCostPence + e.platformNetPence).toBe(
      e.feePence + e.itemChargesPence + e.allowanceExtraPence,
    );
  });
});

describe('the monthly order allowance (ruling 73)', () => {
  const allowance = fees.delivery.allowance;

  it('includes 5 orders on Membership, 8 on Plus, 5 each on Family, none on pay as you go', () => {
    expect(orderAllowanceFor('membership', allowance)).toBe(5);
    expect(orderAllowanceFor('plus', allowance)).toBe(8);
    expect(orderAllowanceFor('family', allowance)).toBe(5);
    expect(orderAllowanceFor('payg', allowance)).toBeNull();
  });

  it('charges £5.99 on the 6th, 9th, 12th and 15th Membership orders, and no others', () => {
    const charged = Array.from({ length: 20 }, (_, i) => i + 1).filter(
      (n) => allowanceExtraPence('membership', n, allowance) > 0,
    );
    expect(charged).toEqual([6, 9, 12, 15, 18]);
    expect(allowanceExtraPence('membership', 6, allowance)).toBe(599);
    expect(allowanceExtraPence('membership', 7, allowance)).toBe(0);
  });

  it('charges on the 9th, 12th and 15th Plus orders', () => {
    const charged = Array.from({ length: 16 }, (_, i) => i + 1).filter(
      (n) => allowanceExtraPence('plus', n, allowance) > 0,
    );
    expect(charged).toEqual([9, 12, 15]);
  });

  it('follows n > allowance and (n − allowance − 1) % 3 === 0 on every plan, up to 100 orders', () => {
    for (const plan of ['membership', 'plus', 'family'] as AllowancePlan[]) {
      const included = orderAllowanceFor(plan, allowance) as number;
      for (let n = 1; n <= 100; n += 1) {
        const expected = n > included && (n - included - 1) % 3 === 0 ? 599 : 0;
        expect(allowanceExtraPence(plan, n, allowance)).toBe(expected);
      }
    }
  });

  it('never charges the extra on pay as you go', () => {
    for (let n = 1; n <= 100; n += 1) expect(allowanceExtraPence('payg', n, allowance)).toBe(0);
  });

  it('refuses an order number that is not a whole number from 1', () => {
    expect(() => allowanceExtraPence('membership', 0, allowance)).toThrow(TypeError);
    expect(() => allowanceExtraPence('membership', 1.5, allowance)).toThrow(TypeError);
  });

  it('tells the Shopper plainly before the yes', () => {
    const say = (plan: AllowancePlan, n: number) =>
      allowanceWords(plan, n, allowance, (pence) => formatPence(pence));
    expect(say('membership', 6)).toBe(
      'This is your 6th order this month. Your plan includes 5, so this one has an extra £5.99 delivery charge.',
    );
    expect(say('family', 6)).toBe(
      'This is your 6th order this month. Your plan includes 5 for each person, so this one has an extra £5.99 delivery charge.',
    );
    expect(say('plus', 8)).toMatch(
      /^This is your 8th order this month, the last one your plan includes\./,
    );
    expect(say('membership', 7)).toBe(
      'This is your 7th order this month. Your plan includes 5, and this one has no extra delivery charge.',
    );
    expect(say('membership', 3)).toBeNull();
    expect(say('payg', 30)).toBeNull();
  });

  it('says each plan’s allowance in one plain phrase', () => {
    const say = (plan: AllowancePlan) =>
      allowancePlanWords(plan, allowance, (pence) => formatPence(pence));
    expect(say('membership')).toBe(
      '5 orders a month; after that, an extra £5.99 delivery charge on the next order and every 3rd order after it',
    );
    expect(say('family')).toBe(
      '5 orders a month for each person; after that, an extra £5.99 delivery charge on the next order and every 3rd order after it',
    );
    expect(say('payg')).toBeNull();
  });

  it('writes ordinals as people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalWord)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });

  it('puts the extra on the first order only of a basket kept whole', () => {
    const basket = priceBasketInParts(
      [{ key: 'x', unitPricePence: 200, quantity: 86 }],
      'membership',
      fees,
      599,
    );
    expect(basket.parts.map((part) => part.allowanceExtraPence)).toEqual([599, 0]);
    expect(basket.allowanceExtraPence).toBe(599);
    expect(basket.totalPence).toBe(17200 + basket.itemChargesPence + basket.feePence + 599);
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
  const of = (unitPricePence: number, quantity: number, key = 'x') => ({
    key,
    unitPricePence,
    quantity,
  });

  it('reads £450 for the whole basket, £13.50 for each extra Runner and £5 for a tiny extra', () => {
    expect(fees.maximumBasketGoodsPence).toBe(45000);
    expect(fees.extraRunnerDeliveryPence).toBe(1350);
    expect(config.dispatch.tinyExtraBelowPence).toBe(500);
  });

  it('keeps £148 as one order, priced exactly as before', () => {
    const basket = priceBasketInParts([of(400, 37)], 'payg', fees);
    expect(basket.parts).toHaveLength(1);
    expect(basket.extraDeliveryPence).toBe(0);
    expect(basket.totalPence).toBe(
      priceBasket([{ shopPricePence: 400, quantity: 37 }], 'payg', fees).totalPence,
    );
  });

  it('makes £172 kept two orders, £14.99 + £13.50 delivery on pay as you go', () => {
    const basket = priceBasketInParts([of(200, 86)], 'payg', fees);
    expect(basket.parts.map((part) => [part.goodsPence, part.feePence, part.extra])).toEqual([
      [15000, 1499, false],
      [2200, 1350, true],
    ]);
    expect(basket.feePence).toBe(2849);
    expect(basket.extraDeliveryPence).toBe(1350);
    expect(basket.totalPence).toBe(17200 + basket.itemChargesPence + 2849);
  });

  it('charges each extra Runner £13.50 whatever the plan; the first order keeps the plan price', () => {
    // The first order is £150 of shopping, so it is in the over-£60 band of its plan.
    const plus = priceBasketInParts([of(200, 86)], 'plus', fees);
    expect(plus.parts.map((part) => part.feePence)).toEqual([899, 1350]);
    const member = priceBasketInParts([of(200, 86)], 'membership', fees);
    expect(member.parts.map((part) => part.feePence)).toEqual([999, 1350]);
  });

  it('fills the first order up to £150, then the next, never splitting a product', () => {
    const basket = priceBasketInParts(
      [of(5000, 3, 'a'), of(2500, 3, 'b'), of(150, 1, 'c')],
      'payg',
      fees,
    );
    expect(basket.parts.map((part) => part.goodsPence)).toEqual([15000, 7650]);
    // £151.50: a tiny extra of £1.50.
    const tiny = priceBasketInParts([of(5000, 3, 'a'), of(150, 1, 'c')], 'payg', fees);
    expect(tiny.parts.map((part) => part.goodsPence)).toEqual([15000, 150]);
  });

  it('refuses a basket over £450', () => {
    expect(priceBasketInParts([of(5000, 9)], 'payg', fees).parts).toHaveLength(3);
    expect(() => priceBasketInParts([of(5000, 9), of(1, 1, 'p')], 'payg', fees)).toThrow(
      BasketOverMaximumError,
    );
  });

  it('tells the Shopper plainly, with both choices', () => {
    expect(overOneRunnerWords(fees, (pence) => formatPence(pence))).toBe(
      'Your shopping is over £150, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50 delivery.',
    );
  });
});
