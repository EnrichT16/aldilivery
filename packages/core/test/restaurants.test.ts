/**
 * Restaurant, café and takeaway pricing (Anthony, 30 October 2026): the flat restaurant fee in
 * place of delivery, the smallest restaurant order, the agreed discount for Ozi and what it does
 * to the counter price, Ozi's share, and the Preferred Partner level. Grocery pricing is proved
 * unchanged beside it. The figures are read from the real config/store.json and pinned here.
 */

import { describe, expect, it } from 'vitest';

import { parseStoreConfig } from '../src/config.js';
import {
  BasketOverMaximumError,
  carriedGoodsPence,
  deliveryFeePence,
  priceBasket,
  priceBasketInParts,
  runnerPaymentFor,
} from '../src/fees.js';
import { formatPence } from '../src/money.js';
import { loadStoreConfig } from '../src/node.js';
import {
  counterPricePence,
  isPreferredPartner,
  preferredRankingWords,
  priceRestaurantBasket,
  RestaurantBelowMinimumError,
  restaurantDiscountPence,
  restaurantFeeForRunnerPay,
  restaurantFeePence,
  restaurantFeeShares,
  restaurantFeeWords,
  restaurantMinimumWords,
  markedUpPricePence,
  markupDisclosureWords,
  shownPriceFromCounterPence,
  shopPriceFromCounterPence,
} from '../src/restaurants.js';
import { RUNNER_PAYMENT_PENCE } from '../src/rules.js';

const config = loadStoreConfig();
const settings = config.restaurants;
const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

describe('the restaurant figures in config/store.json', () => {
  it('are the figures Anthony ruled: £12 fee, £10 smallest order, 20% for Preferred Partner', () => {
    expect(settings).toEqual({
      ozisSharePence: 700,
      feePence: 1200,
      largeOrderFeePence: 1400,
      largeOrderFromPence: 12000,
      minimumOrderPence: 1000,
      preferredDiscountPercent: 20,
      maximumDiscountPercent: 50,
      maximumMarkupPercent: 100,
    });
  });

  it("splits the fee £5 to the Runner and £7 to Ozi, the fee worked out from Ozi's share", () => {
    expect(restaurantFeeShares(settings, RUNNER_PAYMENT_PENCE)).toEqual({
      runnerPence: 500,
      ozisPence: 700,
    });
    // A big order's Runner is paid £7, and Ozi still keeps £7 (Anthony, 30 October 2026).
    expect(restaurantFeeShares(settings, config.fees.largeOrderRunnerPaymentPence)).toEqual({
      runnerPence: 700,
      ozisPence: 700,
    });
    expect(restaurantFeeForRunnerPay(settings, 500)).toBe(1200);
    expect(restaurantFeeForRunnerPay(settings, 700)).toBe(1400);
  });

  it("refuses a restaurant fee set on its own: it is always Runner pay plus Ozi's share", () => {
    const raw = JSON.parse(JSON.stringify(config)) as { restaurants: Record<string, unknown> };
    raw.restaurants['feePence'] = 1300;
    expect(() => parseStoreConfig(raw)).toThrow(/not set on its own/);
  });

  it("moves both fees with Ozi's share, so one figure changes both", () => {
    const raw = JSON.parse(JSON.stringify(config)) as { restaurants: Record<string, unknown> };
    raw.restaurants = { ...raw.restaurants, ozisSharePence: 800 };
    delete raw.restaurants['feePence'];
    delete raw.restaurants['largeOrderFeePence'];
    const changed = parseStoreConfig(raw).restaurants;
    expect(changed.feePence).toBe(1300);
    expect(changed.largeOrderFeePence).toBe(1500);
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

  it('charges £14 from £120 of dishes, where the Runner is paid £7, and £12 just below', () => {
    expect(restaurantFeePence(settings, 11999)).toBe(1200);
    expect(restaurantFeePence(settings, 12000)).toBe(1400);
    const big = priceRestaurantBasket(
      [{ shopPricePence: 3000, quantity: 4 }],
      'payg',
      config.fees,
      settings,
    );
    expect(big.feePence).toBe(1400);
    expect(big.feePence - runnerPaymentFor(big.goodsPence, config.fees)).toBe(700);
    const justBelow = priceRestaurantBasket(
      [{ shopPricePence: 5999, quantity: 2 }],
      'plus',
      config.fees,
      settings,
    );
    expect(justBelow.goodsPence).toBe(11998);
    expect(justBelow.feePence).toBe(1200);
    expect(justBelow.feePence - runnerPaymentFor(justBelow.goodsPence, config.fees)).toBe(700);
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
    expect(restaurantFeeWords(settings, money)).toContain(
      'flat restaurant fee of £12 in place of delivery (£14 for £120 of dishes or more)',
    );
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
});

describe('the agreed mark-up (Anthony, 30 October 2026)', () => {
  it('turns a £10 dish into £15 at 50%, and leaves it alone at 0%', () => {
    expect(markedUpPricePence(1000, 50)).toBe(1500);
    expect(markedUpPricePence(1000, 0)).toBe(1000);
    expect(markedUpPricePence(333, 50)).toBe(500);
    expect(() => markedUpPricePence(1000, -1)).toThrow(TypeError);
    expect(settings.maximumMarkupPercent).toBe(100);
  });

  it('prices the dish shown with its mark-up, the item charge on that, then the fee', () => {
    // £10 at 50%: £15 shown, the item charge on £15 is 50p + 2 × 50p = £1.50, fee £12.
    const shown = markedUpPricePence(1000, 50);
    const pricing = priceRestaurantBasket(
      [{ shopPricePence: shown, quantity: 1 }],
      'payg',
      config.fees,
      settings,
    );
    expect(pricing).toMatchObject({
      goodsPence: 1500,
      itemChargesPence: 150,
      feePence: 1200,
      totalPence: 2850,
    });
    // The Runner pays the counter price: £10 less 20%, £8. Ozi keeps £5 + £2.
    expect(counterPricePence(1000, 20)).toBe(800);
  });

  it('bills the shown prices from the counter amount the Runner paid', () => {
    expect(shownPriceFromCounterPence(800, { shownPence: 1500, counterPence: 800 })).toBe(1500);
    // Half the order missing: half the counter, half the shown prices.
    expect(shownPriceFromCounterPence(400, { shownPence: 1500, counterPence: 800 })).toBe(750);
    expect(shownPriceFromCounterPence(400, { shownPence: 0, counterPence: 0 })).toBe(400);
  });

  it('tells Shoppers prices may be higher, for a restaurant and for a shop', () => {
    expect(markupDisclosureWords('Ozi', 'food')).toBe(
      'Prices on Ozi may be higher than in the restaurant.',
    );
    expect(markupDisclosureWords('Ozi', 'shop')).toBe(
      'Prices on Ozi may be higher than in the shop.',
    );
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

describe('thresholds on what the Runner pays at the till (30 October 2026)', () => {
  it('gives the large restaurant fee on the counter amount, not the marked-up price', () => {
    // £37.50 shown, £25 at the counter, four of them: £150 shown, £100 at the counter.
    const marked = [{ shopPricePence: 3750, quantity: 4, counterPricePence: 2500 }];
    expect(carriedGoodsPence(marked)).toBe(10_000);
    expect(priceRestaurantBasket(marked, 'payg', config.fees, settings).feePence).toBe(1200);
    // £37.50 shown, £30 at the counter: £120 at the counter, the £14 fee and the £7 Runner pay.
    const big = [{ shopPricePence: 3750, quantity: 4, counterPricePence: 3000 }];
    expect(priceRestaurantBasket(big, 'payg', config.fees, settings).feePence).toBe(1400);
    expect(runnerPaymentFor(carriedGoodsPence(big), config.fees)).toBe(700);
  });

  it('counts the most one order carries on the counter amount', () => {
    // £50 shown, £40 at the counter: three is £120 carried (accepted), four £160 (refused).
    const line = (quantity: number) => [
      { shopPricePence: 5000, quantity, counterPricePence: 4000 },
    ];
    expect(priceRestaurantBasket(line(3), 'payg', config.fees, settings).goodsPence).toBe(15_000);
    expect(() => priceRestaurantBasket(line(4), 'payg', config.fees, settings)).toThrow(
      BasketOverMaximumError,
    );
    // Groceries the same: £180 shown, £120 at the till, one order.
    expect(
      priceBasket(
        [{ shopPricePence: 6000, quantity: 3, counterPricePence: 4000 }],
        'payg',
        config.fees,
      ).goodsPence,
    ).toBe(18_000);
    expect(() => deliveryFeePence(18_000, 'payg', config.fees)).toThrow(BasketOverMaximumError);
    expect(deliveryFeePence(18_000, 'payg', config.fees, 12_000)).toBe(1499);
    const parts = priceBasketInParts(
      [{ key: 'a', unitPricePence: 6000, quantity: 3, counterPricePence: 4000 }],
      'payg',
      config.fees,
    );
    expect(parts.parts).toHaveLength(1);
    // Groceries with no partner terms are unchanged: £180 is two orders.
    expect(
      priceBasketInParts([{ key: 'a', unitPricePence: 6000, quantity: 3 }], 'payg', config.fees)
        .parts,
    ).toHaveLength(2);
  });
});
