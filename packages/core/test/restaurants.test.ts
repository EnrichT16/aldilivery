/**
 * Restaurant, café and takeaway pricing (Anthony, 30 October 2026): the flat restaurant fee in
 * place of delivery, the smallest restaurant order, the agreed discount for Ozi and what it does
 * to the counter price, Ozi's share, and the Preferred Partner level. Grocery pricing is proved
 * unchanged beside it. The figures are read from the real config/store.json and pinned here.
 */

import { describe, expect, it } from 'vitest';

import { parseStoreConfig } from '../src/config.js';
import { BasketOverMaximumError, deliveryFeePence, priceBasket } from '../src/fees.js';
import { formatPence } from '../src/money.js';
import { loadStoreConfig } from '../src/node.js';
import {
  counterPricePence,
  isPreferredPartner,
  preferredRankingWords,
  priceRestaurantBasket,
  RestaurantBelowMinimumError,
  restaurantDiscountPence,
  restaurantFeeShares,
  restaurantFeeWords,
  restaurantMinimumWords,
  restaurantProfitPence,
  shopPriceFromCounterPence,
} from '../src/restaurants.js';
import { RUNNER_PAYMENT_PENCE } from '../src/rules.js';

const config = loadStoreConfig();
const settings = config.restaurants;
const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

describe('the restaurant figures in config/store.json', () => {
  it('are the figures Anthony ruled: £12 fee, £10 smallest order, 20% for Preferred Partner', () => {
    expect(settings).toEqual({
      feePence: 1200,
      minimumOrderPence: 1000,
      preferredDiscountPercent: 20,
      maximumDiscountPercent: 50,
    });
  });

  it("splits the fee £5 to the Runner and £7 to Ozi, Ozi's share worked out, never set", () => {
    expect(restaurantFeeShares(settings, RUNNER_PAYMENT_PENCE)).toEqual({
      runnerPence: 500,
      ozisPence: 700,
    });
    const raw = JSON.parse(JSON.stringify(config)) as { restaurants: Record<string, unknown> };
    raw.restaurants['ozisSharePence'] = 700;
    expect(() => parseStoreConfig(raw)).toThrow(/fee less the Runner's pay/);
  });

  it("refuses a fee that does not cover the Runner's pay (Rule Two)", () => {
    const raw = JSON.parse(JSON.stringify(config)) as { restaurants: Record<string, unknown> };
    raw.restaurants['feePence'] = 400;
    expect(() => parseStoreConfig(raw)).toThrow(/must cover the Runner's pay/);
  });
});

describe('pricing a restaurant order', () => {
  it('charges dishes at shop prices, the item charge on every dish, and £12 in place of delivery', () => {
    // Two £6.50 dishes: £13 at shop prices, £1 item charge each, £12 restaurant fee.
    const pricing = priceRestaurantBasket(
      [{ shopPricePence: 650, quantity: 2 }],
      'payg',
      config.fees,
      settings,
    );
    expect(pricing).toEqual({
      goodsPence: 1300,
      itemChargesPence: 200,
      feePence: 1200,
      allowanceExtraPence: 0,
      totalPence: 2700,
      plan: 'payg',
    });
    // The same on every plan: the restaurant fee replaces the plan's delivery bands.
    expect(
      priceRestaurantBasket([{ shopPricePence: 650, quantity: 2 }], 'plus', config.fees, settings)
        .feePence,
    ).toBe(1200);
  });

  it('refuses a basket below £10, and says so plainly', () => {
    expect(() =>
      priceRestaurantBasket([{ shopPricePence: 999, quantity: 1 }], 'payg', config.fees, settings),
    ).toThrow(RestaurantBelowMinimumError);
    expect(
      priceRestaurantBasket([{ shopPricePence: 1000, quantity: 1 }], 'payg', config.fees, settings)
        .goodsPence,
    ).toBe(1000);
    expect(restaurantMinimumWords(settings, money)).toBe(
      'The smallest restaurant order is £10. Please add something more.',
    );
    expect(restaurantFeeWords(settings, money)).toContain('flat restaurant fee of £12');
  });

  it('refuses a restaurant basket over what one order carries', () => {
    expect(() =>
      priceRestaurantBasket([{ shopPricePence: 5000, quantity: 4 }], 'payg', config.fees, settings),
    ).toThrow(BasketOverMaximumError);
  });

  it('leaves grocery pricing exactly as it was', () => {
    // £25 of groceries on pay as you go: £10.99 delivery, as ruled on 20 October 2026.
    expect(deliveryFeePence(2500, 'payg', config.fees)).toBe(1099);
    expect(priceBasket([{ shopPricePence: 469, quantity: 1 }], 'payg', config.fees)).toEqual({
      goodsPence: 469,
      itemChargesPence: 50,
      feePence: 1099,
      allowanceExtraPence: 0,
      totalPence: 1618,
      plan: 'payg',
    });
  });
});

describe('the agreed discount', () => {
  it('takes the discount off what the Runner pays at the counter: £10 at 20% is £8', () => {
    expect(counterPricePence(1000, 20)).toBe(800);
    expect(counterPricePence(1000, 0)).toBe(1000);
    expect(counterPricePence(1299, 15)).toBe(1104);
    expect(restaurantDiscountPence(1000, 20)).toBe(200);
    expect(() => counterPricePence(1000, 100)).toThrow(TypeError);
  });

  it('turns what was paid at the counter back into shop prices for the Shopper', () => {
    // Paid exactly what was expected: exactly the shop prices agreed to.
    expect(shopPriceFromCounterPence(802, { shopPricePence: 1002, discountPercent: 20 })).toBe(
      1002,
    );
    // A dish missing: the shop-price value of what was really paid.
    expect(shopPriceFromCounterPence(400, { shopPricePence: 1000, discountPercent: 20 })).toBe(500);
    expect(shopPriceFromCounterPence(700, { shopPricePence: 1000, discountPercent: 0 })).toBe(700);
  });

  it("makes Ozi's profit the discount plus the item charges, never the fee", () => {
    // £20 of dishes at 20%: £4 discount, plus £3 of item charges.
    expect(restaurantProfitPence(2000, 20, 300)).toBe(700);
    expect(restaurantProfitPence(2000, 0, 300)).toBe(300);
  });
});

describe('Ozi Preferred Partner', () => {
  it('is a restaurant with an agreed discount of at least 20%, never a shop', () => {
    expect(isPreferredPartner({ kind: 'food', discountPercent: 20 }, settings)).toBe(true);
    expect(isPreferredPartner({ kind: 'food', discountPercent: 19 }, settings)).toBe(false);
    expect(isPreferredPartner({ kind: 'shop', discountPercent: 30 }, settings)).toBe(false);
  });

  it('says plainly that the ranking is commercial', () => {
    expect(preferredRankingWords(config.assistantName)).toBe(
      'Preferred Partners, who give Ozi a better price, are shown first.',
    );
  });
});
