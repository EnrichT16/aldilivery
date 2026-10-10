/**
 * Rule Six: no age restricted goods in version one.
 * Rule Four: no surge pricing, no small order fee, no minimum spend.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

beforeEach(async () => {
  harness = await buildTestApp();
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
});

describe('Rule Six: age restricted goods', () => {
  it('never appear in search results', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/catalogue/search?q=wine' });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('are not returned even when asked for by their own identifier', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `/catalogue/${items.wine}` });
    expect(response.json()).toMatchObject({ found: false, item: null });
  });

  it('are refused at basket time, by name, so the Shopper knows why', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.wine, quantity: 1 }] },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('age_restricted_item');
    expect(body.error.message).toContain('Bottle of red wine');
  });

  it('are refused again at order time, even if a basket somehow got through', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines: [
          { catalogueItemId: items.milk, quantity: 1 },
          { catalogueItemId: items.wine, quantity: 1 },
        ],
        deliveryAddress: '12 Example Street',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 2024,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('taint the whole basket rather than being quietly dropped from it', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: {
        lines: [
          { catalogueItemId: items.milk, quantity: 1 },
          { catalogueItemId: items.wine, quantity: 1 },
        ],
      },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('Rule Four: no minimum spend and no small order fee', () => {
  it('prices a single penny item like any other basket', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.penny, quantity: 1 }] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      goodsEstimatePence: number;
      feePence: number;
      totalPence: number;
    };
    expect(body.goodsEstimatePence).toBe(1);
    expect(body.feePence).toBe(harness.config.fees.delivery.payAsYouGoSmallOrderPence);
    // One item charge of 50p, the smaller pay-as-you-go delivery, and no small order fee.
    expect(body.totalPence).toBe(1 + 50 + body.feePence);
  });

  it('charges the smaller pay-as-you-go delivery up to £15 of shopping, and the larger above', async () => {
    const small = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.beans, quantity: 1 }] },
    });
    const larger = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 10 }] },
    });

    const smallFee = (small.json() as { feePence: number }).feePence;
    const largerFee = (larger.json() as { feePence: number }).feePence;
    // Ten pints at £1.25 is £12.50: still the smaller fee. Thirteen is £16.25: the larger.
    expect(smallFee).toBe(799);
    expect(largerFee).toBe(799);
    const over = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 13 }] },
    });
    expect(over.json()).toMatchObject({
      goodsEstimatePence: 1625,
      itemChargesPence: 650,
      feePence: 1350,
      totalPence: 1625 + 650 + 1350,
    });
  });

  it('states the fee in words before anything is confirmed', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 2 }] },
    });

    const body = response.json() as {
      inWords: { fee: string; total: string };
      explanation: string[];
    };
    expect(body.inWords.fee).toBe('£7.99');
    expect(body.inWords.total).toBe('£11.49');
    // The shopping is said with its item charges in it, and the parts are named.
    expect(body.explanation.join(' ')).toContain(
      'The shopping is about £3.50, with the item charges included: £2.50 at the shop\'s prices and £1.00 of item charges.',
    );
  });

  it('says who carries a large order, and that it may come in parts, only for a large order (rulings 59 and 60)', async () => {
    const price = async (quantity: number) =>
      (
        await harness.app.inject({
          method: 'POST',
          url: '/basket/price',
          payload: { lines: [{ catalogueItemId: items.milk, quantity }] },
        })
      ).json() as { carNeeded: boolean; explanation: string[] };

    // 48 pints is £60.00 at the shop: not over the line. 49 is £61.25.
    const atLimit = await price(48);
    expect(atLimit.carNeeded).toBe(false);
    expect(atLimit.explanation.join(' ')).not.toContain('Large orders');
    const large = await price(49);
    expect(large.carNeeded).toBe(true);
    expect(large.explanation).toContain(
      'Large orders go to a Runner with a motorbike, car or van. If none is free, it may come in parts, for the same price.',
    );
    // Over £70 a motorbike cannot carry it.
    const larger = await price(57);
    expect(larger.explanation).toContain(
      'Large orders go to a Runner with a car or van. If none is free, it may come in parts, for the same price.',
    );
  });

  it('refuses an empty basket kindly rather than pricing nothing', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('the most one order carries, and the most one product may cost', () => {
  async function product(pence: number): Promise<string> {
    return (
      await harness.repository.catalogue.create({
        name: `A product at ${pence}p`,
        category: 'Household',
        estimatedPricePence: pence,
        source: 'community',
      })
    ).id;
  }

  it('prices exactly the whole-order cap of shopping', async () => {
    // Ten at £15.00 is £150.00, the cap (pending Anthony).
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: await product(1500), quantity: 10 }] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      goodsEstimatePence: 15000,
      itemChargesPence: 10 * 150,
      feePence: 1350,
    });
  });

  it('says plainly when a basket is over one order, and offers both choices (ruling 61)', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: await product(1500), quantity: 11 }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      overOneRunner: true,
      choice:
        'Your shopping is over £150, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50 delivery.',
      goodsEstimatePence: 16500,
      feePence: 2700,
    });
  });

  it('refuses a basket over the most one basket holds (£450), in plain words', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: await product(5000), quantity: 10 }] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: 'basket_too_large',
      message:
        'This comes to £500.00 of shopping, and one basket holds up to £450.00, brought by several Runners. Please take something out.',
    });
  });

  it('sells a product at £60, and refuses one a penny over, in plain words', async () => {
    const sixty = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: await product(6000), quantity: 1 }] },
    });
    expect(sixty.statusCode).toBe(200);
    expect(sixty.json()).toMatchObject({ itemChargesPence: 550, totalPence: 6000 + 550 + 1350 });
    const over = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: await product(6001), quantity: 1 }] },
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toMatchObject({
      code: 'product_too_dear',
      message:
        "We can't bring A product at 6001p: no single product can cost more than £60.00. Please choose something else.",
    });
  });
});
