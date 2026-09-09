/**
 * Rule Six: no age restricted goods in version one.
 * Rule Four: no surge pricing, no small order fee, no minimum spend.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, seedCatalogue, signUpShopper, type SignedInShopper, type TestHarness } from './helpers.js';

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
          channel: 'button',
          statement: 'Send my order.',
          agreedTotalPence: 1474,
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
    const body = response.json() as { goodsEstimatePence: number; feePence: number; totalPence: number };
    expect(body.goodsEstimatePence).toBe(1);
    expect(body.feePence).toBe(harness.config.fees.bands[0]!.feePence);
    expect(body.totalPence).toBe(1 + body.feePence);
  });

  it('charges the same fee for two baskets in the same band, whatever their size', async () => {
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
    expect(smallFee).toBe(largerFee);
  });

  it('states the fee in words before anything is confirmed', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 2 }] },
    });

    const body = response.json() as { inWords: { fee: string; total: string }; explanation: string[] };
    expect(body.inWords.fee).toBe('£8.00');
    expect(body.inWords.total).toBe('£10.50');
    expect(body.explanation.join(' ')).toContain('That is the only fee.');
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
