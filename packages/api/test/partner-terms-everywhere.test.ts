/**
 * A partner's terms, on every path (Anthony, 30 October 2026):
 *
 * - A Shopper (or anyone but staff) is never sent a partner's till prices, counter prices,
 *   discount or mark-up: not with the basket, the order, past orders, the order page, the shop
 *   page or the catalogue. Staff see everything; the Runner on the job is told the counter amount.
 * - Every path that makes order lines keeps a partner's shop price and counter price: an order,
 *   a booked order, a regular order (sent or left as a draft), and the parts of a split order.
 * - The large-order Runner pay (£120), the large restaurant fee and the most one Runner carries
 *   (£150) are counted on what the Runner pays at the till, never the marked-up price.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Order, PartnerShop } from '../src/domain.js';
import { STAFF_ONLY_FIELDS } from '../src/lib/staff-only.js';
import { sweepSets } from '../src/services/set-runner.js';
import { splitOrder } from '../src/services/split.js';
import {
  STAFF,
  buildTestApp,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const NOW = new Date('2026-10-23T09:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;

beforeEach(async () => {
  harness = await buildTestApp(NOW, { autoOffer: true, sendText: async () => undefined });
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = shopper.authHeader) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string> = shopper.authHeader) {
  return harness.app.inject({ method: 'GET', url, headers });
}

let made = 0;

/** An approved partner with one thing, its agreed discount and mark-up set by staff. */
async function partner(
  kind: 'food' | 'shop',
  pricePence: number,
  terms: { discount: number; markup: number },
): Promise<{ shop: PartnerShop; item: string }> {
  made += 1;
  const shop = await harness.repository.partnerShops.create({
    name: `Partner ${made}`,
    address: '1 High Street, Gillingham',
    telephone: '',
    about: 'Good things.',
    monthlyPence: 0,
    kind,
    plan: 'free',
    status: 'approved',
    postcode: 'ME7 1AA',
    approvedAt: harness.now(),
  });
  const product = await harness.repository.partnerProducts.create({
    partnerShopId: shop.id,
    name: 'Thing',
    pricePence,
    tags: 'thing',
    expiresOn: null,
    photo: null,
    photoType: null,
  });
  const item = await harness.repository.catalogue.create({
    name: `Thing (${shop.name})`,
    category: `From ${shop.name}`,
    estimatedPricePence: pricePence,
    source: 'partner_feed',
    externalRef: `partner:${product.id}`,
  });
  await harness.repository.partnerProducts.update(product.id, {
    status: 'approved',
    catalogueItemId: item.id,
  });
  const set = await post(
    `/staff/partners/${shop.id}`,
    { agreedDiscountPercent: terms.discount, agreedMarkupPercent: terms.markup },
    STAFF,
  );
  expect(set.statusCode, set.body).toBe(200);
  return { shop, item: item.id };
}

async function priceOf(lines: Array<{ catalogueItemId: string; quantity: number }>) {
  const priced = await post('/basket/price', { lines });
  expect(priced.statusCode, priced.body).toBe(200);
  return priced;
}

async function place(
  lines: Array<{ catalogueItemId: string; quantity: number }>,
  extra: Record<string, unknown> = {},
  statement = 'Send my order and pay.',
) {
  const priced = await priceOf(lines);
  const placed = await post('/orders', {
    lines,
    deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
    paymentMethodId: shopper.paymentMethodId,
    confirmation: {
      confirmed: true,
      addressConfirmed: true,
      channel: 'button',
      statement,
      agreedTotalPence: priced.json().totalPence as number,
    },
    ...extra,
  });
  expect(placed.statusCode, placed.body).toBe(201);
  return { placed, order: (await harness.repository.orders.findById(placed.json().order.id))! };
}

/** Every field name anywhere in a response. */
function fieldsOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((inner) => fieldsOf(inner, into));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      fieldsOf(inner, into);
    }
  }
  return into;
}

function expectNoPartnerTerms(body: string): void {
  const found = [...fieldsOf(JSON.parse(body))].filter((key) => STAFF_ONLY_FIELDS.has(key));
  expect(found).toEqual([]);
}

describe('what a Shopper is sent', () => {
  it('never has a partner’s till price, counter price, discount or mark-up, anywhere', async () => {
    const { shop, item } = await partner('food', 1000, { discount: 20, markup: 50 });
    const priced = await priceOf([{ catalogueItemId: item, quantity: 1 }]);
    expectNoPartnerTerms(priced.body);
    const { placed, order } = await place([{ catalogueItemId: item, quantity: 1 }]);
    expectNoPartnerTerms(placed.body);
    // The order does keep them, for staff, the Runner and Ozi's books.
    expect(order.items[0]).toMatchObject({ shopPricePence: 1000, counterPricePence: 800 });
    expect(order.restaurantDiscountPercent).toBe(20);

    for (const url of [
      '/orders',
      `/orders/${order.id}`,
      '/orders/current',
      `/shops/${shop.id}`,
      '/shops',
      `/catalogue/search?q=Thing`,
      '/me',
    ]) {
      const response = await get(url);
      expect(response.statusCode, `${url}: ${response.body}`).toBeLessThan(500);
      expectNoPartnerTerms(response.body);
    }
    // What the Shopper does see: what they pay for the dish.
    const mine = (await get(`/orders/${order.id}`)).json();
    expect(JSON.stringify(mine)).toContain('1500');
  });

  it('tells the Runner on the job the counter amount, and staff everything', async () => {
    const runner = await signUpRunner(harness);
    const { item } = await partner('food', 1000, { discount: 20, markup: 50 });
    const { order } = await place([{ catalogueItemId: item, quantity: 1 }]);
    const offer = (await harness.repository.offers.listForOrder(order.id))[0]!;
    expect((await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader)).statusCode).toBe(200);
    const job = (await get('/jobs/current', runner.authHeader)).json().job;
    expect(job.goodsEstimatePence).toBe(800);
    expect(job.items[0].estimatedPricePence).toBe(800);

    const staff = (await get(`/staff/orders/${order.id}`, STAFF)).body;
    expect(staff).toContain('counterPricePence');
  });
});

describe('every path keeps the shop price and counter price on its lines', () => {
  it('a booked order', async () => {
    const { item } = await partner('shop', 1000, { discount: 10, markup: 50 });
    const { order } = await place(
      [{ catalogueItemId: item, quantity: 2 }],
      { schedule: { deliveryDay: '2026-10-31', window: 'morning', pay: 'now' } },
      'Send my order and pay. Delivered on Saturday 31 October, in the morning.',
    );
    expect(order.deliveryDay).toBe('2026-10-31');
    expect(order.items[0]).toMatchObject({
      estimatedPricePence: 1500,
      shopPricePence: 1000,
      counterPricePence: 900,
    });
  });

  async function regularOrder(autoSend: boolean, item: string) {
    const made = await post('/sets', {
      name: 'Weekly shop',
      deliveryAddress: '12 Example Street',
      frequency: 'weekly',
      dayOfWeek: 3,
      timeOfDay: '09:00',
      paymentMethodId: shopper.paymentMethodId,
      lines: [{ catalogueItemId: item, quantity: 2 }],
      ...(autoSend
        ? {
            autoSend: {
              confirmed: true,
              statement: 'Send it and pay for it with my saved card each time, unless I say skip.',
            },
          }
        : {}),
    });
    expect(made.statusCode, made.body).toBe(201);
    const fireAt = new Date(made.json().set.nextFireAt as string);
    harness.setNow(new Date(fireAt.getTime() - 32 * 60_000));
    await sweepSets(harness.app.ctx, harness.app.log);
    harness.setNow(fireAt);
    await sweepSets(harness.app.ctx, harness.app.log);
    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders).toHaveLength(1);
    return orders[0]!;
  }

  it('a regular order that sends itself', async () => {
    const { item } = await partner('shop', 1000, { discount: 10, markup: 50 });
    const order = await regularOrder(true, item);
    expect(order.items[0]).toMatchObject({ shopPricePence: 1000, counterPricePence: 900 });
  });

  it('a regular order left as a draft', async () => {
    const { item } = await partner('shop', 1000, { discount: 10, markup: 50 });
    const order = await regularOrder(false, item);
    expect(order.status).toBe('draft');
    expect(order.items[0]).toMatchObject({ shopPricePence: 1000, counterPricePence: 900 });
  });

  it('the parts of a split order', async () => {
    // Three £30 things at 50% mark-up and 10% off: £45 each shown, £27 at the till.
    const { item } = await partner('shop', 3000, { discount: 10, markup: 50 });
    const { order } = await place([{ catalogueItemId: item, quantity: 3 }]);
    const later = new Date(NOW.getTime() + 60 * 60_000);
    harness.setNow(later);
    const parts = await splitOrder(harness.app.ctx, order as Order, later);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      for (const line of part.items) {
        expect(line).toMatchObject({
          estimatedPricePence: 4500,
          shopPricePence: 3000,
          counterPricePence: 2700,
        });
      }
    }
  });
});

describe('the thresholds are counted on what the Runner pays at the till', () => {
  it('a restaurant: £14 and £7 only when the counter amount is £120 or more', async () => {
    // £25 dishes at 50% mark-up: £37.50 shown. Four: £150 shown, £100 at the counter.
    const marked = await partner('food', 2500, { discount: 0, markup: 50 });
    const below = await priceOf([{ catalogueItemId: marked.item, quantity: 4 }]);
    expect(below.json()).toMatchObject({ goodsEstimatePence: 15_000, feePence: 1200 });
    const { order: small } = await place([{ catalogueItemId: marked.item, quantity: 4 }]);
    expect(small).toMatchObject({ feePence: 1200, runnerPaymentPence: 500 });

    // £30 dishes at 25% mark-up: £37.50 shown. Four: £150 shown, £120 at the counter.
    const big = await partner('food', 3000, { discount: 0, markup: 25 });
    const { order: large } = await place([{ catalogueItemId: big.item, quantity: 4 }]);
    expect(large).toMatchObject({ feePence: 1400, runnerPaymentPence: 700 });
    expect(large.feePence - large.runnerPaymentPence).toBe(700);
  });

  it('a restaurant: the most one order carries is the counter amount', async () => {
    // £40 dishes at 25% mark-up: £50 shown. Three: £150 shown, £120 at the counter, accepted;
    // four: £160 at the counter, over £150, refused.
    const { item } = await partner('food', 4000, { discount: 0, markup: 25 });
    await priceOf([{ catalogueItemId: item, quantity: 3 }]);
    const four = await post('/basket/price', { lines: [{ catalogueItemId: item, quantity: 4 }] });
    expect(four.statusCode).toBe(422);
  });

  it('groceries: one Runner carries £150 at the till, though the Shopper sees more', async () => {
    // £40 in the shop at 50% mark-up: £60 shown. Three: £180 shown, £120 at the till: one order,
    // one Runner, paid the large-order £7.
    const { item } = await partner('shop', 4000, { discount: 0, markup: 50 });
    const priced = (await priceOf([{ catalogueItemId: item, quantity: 3 }])).json();
    expect(priced.goodsEstimatePence).toBe(18_000);
    expect(priced.choice ?? null).toBeNull();
    const { order } = await place([{ catalogueItemId: item, quantity: 3 }]);
    expect(order.basketGroupId ?? null).toBeNull();
    expect(order.runnerPaymentPence).toBe(700);
  });
});
