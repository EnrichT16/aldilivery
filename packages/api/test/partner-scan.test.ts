/**
 * Partner onboarding (ruling 75, 22 October 2026): a shop chooses free or Partner Plus as it
 * joins, and a shop paying from the start goes straight to Stripe Checkout; products are scanned
 * from shelf labels and barcodes into drafts, one listing per product however many packs, with
 * an estimate marked when the label shows no price; and paid Partner Plus shops are listed
 * above free ones on /shops and in search.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { LabelReading, OziBrain } from '../src/lib/language-model.js';
import type { OpenPricesLookup } from '../src/lib/open-prices.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

/** A stand-in language model that reads whatever label the test says it sees. */
function labelBrain(reading: () => LabelReading | null): OziBrain & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: 'model',
    model: 'stand-in',
    seen,
    understand: async () => null,
    estimate: async (name) => ({
      kind: 'grocery',
      name,
      category: 'Cupboard',
      pricePence: 175,
      reply: null,
    }),
    readLabel: async (photo) => {
      seen.push(photo.data);
      return reading();
    },
  };
}

async function start(options: { brain?: OziBrain; openPrices?: OpenPricesLookup } = {}) {
  harness = await buildTestApp(new Date('2026-10-22T10:00:00.000Z'), options);
}

let joinedCount = 0;

async function join(details: Record<string, unknown> = {}) {
  joinedCount += 1;
  return harness.app.inject({
    method: 'POST',
    url: '/partner/join',
    payload: {
      name: `Corner Shop ${joinedCount}`,
      kind: 'shop',
      address: '12 High Street, Gillingham',
      postcode: 'ME7 1AA',
      hours: 'Monday to Saturday 7am to 5pm',
      contactName: 'Bola',
      mobile: '07700 900 222',
      email: 'bola@example.com',
      about: 'Groceries.',
      username: `cornershop${joinedCount}`,
      password: 'a-long-enough-password',
      termsAgreed: true,
      ...details,
    },
  });
}

async function joinedShop(details: Record<string, unknown> = {}) {
  const joined = await join(details);
  expect(joined.statusCode, joined.body).toBe(201);
  const headers = { 'x-business-token': joined.json().token as string };
  const shopId = joined.json().shop.id as string;
  return { joined, headers, shopId };
}

function dashboard(headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers });
}

describe('choosing the plan at sign-up', () => {
  it('pay now: skips the free month and makes the Stripe Checkout page at once', async () => {
    await start();
    const { joined, headers } = await joinedShop({ plan: 'plus', payNow: true });
    const checkout = joined.json().checkout;
    expect(checkout.url).toMatch(/^https:\/\/checkout/);
    expect(checkout.receipt).toBeTruthy();
    expect(joined.json().message).toMatch(/Taking you to pay £14\.99 for Partner Plus/);
    const link = harness.payments.calls.find((call) => call.kind === 'payment_link');
    expect(link?.input).toEqual(
      expect.objectContaining({
        purpose: 'partner',
        amountPence: 1499,
        description: expect.stringContaining('Partner Plus for Corner Shop'),
      }),
    );

    // Not paid until Stripe says so, and the free month is not offered any more.
    let plan = (await dashboard(headers)).json().plan;
    expect(plan).toEqual(
      expect.objectContaining({ tier: 'plus', paid: false, firstMonthFree: false }),
    );

    // Back on the dashboard with ?paid=<session>: the existing confirm route records it.
    const sessionId = String(checkout.url).split('/').pop();
    const confirmed = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/confirm',
      headers,
      payload: { receipt: checkout.receipt, sessionId },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().recorded).toBe(true);
    plan = (await dashboard(headers)).json().plan;
    expect(plan).toEqual(expect.objectContaining({ tier: 'plus', paid: true, productLimit: null }));
    expect(plan.paidUntil).toBe('2026-11-22T10:00:00.000Z');
  });

  it('free month: Partner Plus is on at once, with no Stripe page', async () => {
    await start();
    const { joined, headers } = await joinedShop({ plan: 'plus' });
    expect(joined.json().checkout).toBeNull();
    expect(joined.json().message).toMatch(/your first month is free/);
    expect(harness.payments.calls.some((call) => call.kind === 'payment_link')).toBe(false);
    const body = (await dashboard(headers)).json();
    expect(body.plan).toEqual(
      expect.objectContaining({ tier: 'plus', paid: true, firstMonthFree: false }),
    );
    expect(body.payments[0]).toEqual(expect.objectContaining({ amountPence: 0 }));
  });

  it('free: finishes as before, no checkout, and says nothing of "for ever"', async () => {
    await start();
    const { joined, headers } = await joinedShop({ plan: 'free' });
    expect(joined.json().checkout).toBeNull();
    expect(joined.json().message).toMatch(/Your basic listing is free, with no monthly fee\./);
    expect(joined.json().message).not.toMatch(/for ever/);
    const plan = (await dashboard(headers)).json().plan;
    expect(plan).toEqual(expect.objectContaining({ tier: 'free', productLimit: 10 }));
    expect(plan.words).not.toMatch(/for ever/);
    // Offers do not exist yet, and Plus is first only among shops at the same distance
    // (30 October 2026).
    expect(plan.words).not.toMatch(/offers/i);
    expect(plan.words).not.toMatch(/above free shops/);
    expect(plan.words).toMatch(/first place among shops at the same distance/);
  });
});

describe('scanning products', () => {
  it('reads a shelf label through the language model into a draft, adding nothing by itself', async () => {
    const brain = labelBrain(() => ({
      name: 'Braeburn apples',
      size: '6 pack',
      pricePence: 240,
      barcode: '5012345678900',
    }));
    await start({ brain });
    const { headers } = await joinedShop();
    const read = await harness.app.inject({
      method: 'POST',
      url: '/partner/scan/label',
      headers,
      payload: { photo: 'AAAA', photoType: 'image/jpeg' },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().draft).toEqual({
      name: 'Braeburn apples, 6 pack',
      pricePence: 240,
      priceEstimated: false,
      barcode: '5012345678900',
    });
    expect(brain.seen).toEqual(['AAAA']);
    expect((await dashboard(headers)).json().products).toHaveLength(0);
  });

  it('gives an estimate, marked so, when the label shows no price', async () => {
    await start({
      brain: labelBrain(() => ({
        name: 'Plain flour',
        size: '1.5kg',
        pricePence: null,
        barcode: null,
      })),
    });
    const { headers } = await joinedShop();
    await harness.repository.catalogue.create({
      name: 'Plain flour, 1.5kg',
      category: 'Cupboard',
      estimatedPricePence: 95,
      source: 'community',
      externalRef: null,
      ageRestricted: false,
      lastSeenAt: new Date('2026-10-20T10:00:00.000Z'),
    });
    const read = await harness.app.inject({
      method: 'POST',
      url: '/partner/scan/label',
      headers,
      payload: { photo: 'AAAA', photoType: 'image/png' },
    });
    expect(read.json().draft).toEqual({
      name: 'Plain flour, 1.5kg',
      pricePence: 95,
      priceEstimated: true,
      barcode: null,
    });

    // Sent with "Add all": the product carries the estimate mark, for the shop and the owner.
    const added = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Plain flour, 1.5kg', pricePence: 95, priceEstimated: true },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().product.priceEstimated).toBe(true);
    expect(added.json().message).toMatch(/price is an estimate: please check it/);
    const staffList = await harness.app.inject({
      method: 'GET',
      url: '/staff/partner-products',
      headers: STAFF,
    });
    expect(staffList.json().products[0]).toEqual(
      expect.objectContaining({ name: 'Plain flour, 1.5kg', priceEstimated: true }),
    );

    // The shop setting the price takes the mark away.
    const id = added.json().product.id as string;
    await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${id}/price`,
      headers,
      payload: { pricePence: 110 },
    });
    expect((await dashboard(headers)).json().products[0]).toEqual(
      expect.objectContaining({ pricePence: 110, priceEstimated: false }),
    );
  });

  it('says plainly when labels cannot be read, and never fails the page', async () => {
    await start();
    const { headers } = await joinedShop();
    const read = await harness.app.inject({
      method: 'POST',
      url: '/partner/scan/label',
      headers,
      payload: { photo: 'AAAA', photoType: 'image/jpeg' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().draft).toBeNull();
    expect(read.json().message).toMatch(/type the product in/);
  });

  it('looks a barcode up in the open food database, its price marked as an estimate', async () => {
    await start({
      brain: labelBrain(() => null),
      openPrices: {
        lookUp: async () => [],
        lookUpBarcode: async (barcode) =>
          barcode === '5000000000001'
            ? { barcode, name: 'Baked beans, 415g', pricePence: 85 }
            : null,
      },
    });
    const { headers } = await joinedShop();
    const known = await harness.app.inject({
      method: 'POST',
      url: '/partner/scan/barcode',
      headers,
      payload: { barcode: '5000000000001' },
    });
    expect(known.json().draft).toEqual({
      name: 'Baked beans, 415g',
      pricePence: 85,
      priceEstimated: true,
      barcode: '5000000000001',
    });
    const unknown = await harness.app.inject({
      method: 'POST',
      url: '/partner/scan/barcode',
      headers,
      payload: { barcode: '5000000000002' },
    });
    expect(unknown.json().draft).toEqual({
      name: '',
      pricePence: null,
      priceEstimated: false,
      barcode: '5000000000002',
    });
  });

  it('lists one product once: the same barcode, or the same name and price, is "already added"', async () => {
    await start();
    const { headers } = await joinedShop();
    const add = (payload: object) =>
      harness.app.inject({ method: 'POST', url: '/partner/products', headers, payload });
    expect(
      (await add({ name: 'Apples, 6 pack', pricePence: 240, barcode: '5012345678900' })).statusCode,
    ).toBe(201);
    const sameBarcode = await add({ name: 'Apples', pricePence: 250, barcode: '5012345678900' });
    expect(sameBarcode.statusCode).toBe(409);
    expect(sameBarcode.json().error.message).toBe('Apples, 6 pack is already added.');
    const sameNameAndPrice = await add({ name: 'apples 6-pack', pricePence: 240 });
    expect(sameNameAndPrice.statusCode).toBe(409);
    expect(sameNameAndPrice.json().error.message).toMatch(/already added/);
    // A different price is a different listing (a bigger bag, say).
    expect((await add({ name: 'Apples, 6 pack', pricePence: 300 })).statusCode).toBe(201);
    expect((await dashboard(headers)).json().products).toHaveLength(2);
  });
});

describe('Partner Plus above free shops', () => {
  it('on /shops (and the home page that reads it) and in search', async () => {
    await start();
    const free = await joinedShop({ name: 'Aardvark Bakery', plan: 'free' });
    const plus = await joinedShop({ name: 'Zebra Bakery', plan: 'plus' });
    for (const shop of [free, plus]) {
      await harness.app.inject({
        method: 'POST',
        url: `/staff/partners/${shop.shopId}`,
        headers: STAFF,
        payload: { status: 'approved' },
      });
      const added = await harness.app.inject({
        method: 'POST',
        url: '/partner/products',
        headers: shop.headers,
        payload: { name: 'Sourdough loaf', pricePence: 350 },
      });
      const decided = await harness.app.inject({
        method: 'POST',
        url: `/staff/partner-products/${added.json().product.id as string}/decide`,
        headers: STAFF,
        payload: { approve: true },
      });
      expect(decided.statusCode, decided.body).toBe(200);
    }

    const shops = (await harness.app.inject({ method: 'GET', url: '/shops' })).json()
      .shops as Array<{
      name: string;
      partnerPlus: boolean;
    }>;
    const names = shops.map((shop) => shop.name);
    expect(names.indexOf('Zebra Bakery')).toBeLessThan(names.indexOf('Aardvark Bakery'));
    expect(shops.find((shop) => shop.name === 'Zebra Bakery')?.partnerPlus).toBe(true);
    expect(shops.find((shop) => shop.name === 'Aardvark Bakery')?.partnerPlus).toBe(false);

    const found = (
      await harness.app.inject({ method: 'GET', url: '/catalogue/search?q=sourdough' })
    ).json().items as Array<{ name: string }>;
    const loaves = found.map((item) => item.name).filter((name) => name.startsWith('Sourdough'));
    expect(loaves).toEqual(['Sourdough loaf (Zebra Bakery)', 'Sourdough loaf (Aardvark Bakery)']);
  });
});
