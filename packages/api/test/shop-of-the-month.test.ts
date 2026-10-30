/**
 * Shop of the Month and review points (ruling 70, 16 and 17 October 2026): rating a Shop Partner
 * after a delivery earns the same points for one star as for five; one rewarded review per shop
 * per month; the points wait seven days and are lost if the order is refunded; from a hundred
 * points they become delivery credit; the standings need ten reviews and are balanced for how
 * many there were; the winner wears a badge with words on the public pages.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  balancedScore,
  lastPeriod,
  periodAt,
  settleShopReviews,
} from '../src/services/shop-of-the-month.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const DAY = 24 * 3600 * 1000;
const START = new Date('2026-10-17T10:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let bakery: { id: string; name: string };
let loaf: string;
let milk: string;

function later(days: number): Date {
  return new Date(START.getTime() + days * DAY);
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

/** A Shop Partner on Partner Plus, approved, with one product in the catalogue under its name. */
async function partnerShop(name: string, plan: 'plus' | 'free' = 'plus') {
  const shop = await harness.repository.partnerShops.create({
    name,
    address: '12 High Street, Gillingham',
    telephone: '',
    about: 'Fresh bread.',
    monthlyPence: plan === 'plus' ? 1499 : 0,
    kind: 'shop',
    status: 'approved',
    plan,
    source: 'staff',
    approvedAt: START,
  });
  await harness.repository.partnerShops.update(shop.id, { paidUntil: later(365) });
  const product = await harness.repository.partnerProducts.create({
    partnerShopId: shop.id,
    name: 'Sourdough loaf',
    pricePence: 350,
    tags: 'bread',
    expiresOn: null,
    photo: null,
    photoType: null,
  });
  const item = await harness.repository.catalogue.create({
    name: `Sourdough loaf (${name})`,
    category: `From ${name}`,
    estimatedPricePence: 350,
    source: 'partner_feed',
    externalRef: `partner:${product.id}`,
  });
  await harness.repository.partnerProducts.update(product.id, {
    status: 'approved',
    catalogueItemId: item.id,
  });
  return { shop: { id: shop.id, name: shop.name }, itemId: item.id };
}

/** An order of these things, priced by the basket and paid, then delivered by the Runner. */
async function deliverOrder(
  who: SignedInShopper,
  lines: Array<{ catalogueItemId: string; quantity: number }>,
): Promise<string> {
  const priced = await post('/basket/price', { lines }, who.authHeader);
  const placed = await post(
    '/orders',
    {
      lines,
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: who.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: (priced.json() as { totalPence: number }).totalPence,
      },
    },
    who.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().order.id as string;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  expect((await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader)).statusCode).toBe(200);
  await post(`/orders/${orderId}/status`, { status: 'shopping' }, runner.authHeader);
  await post(`/orders/${orderId}/receipt`, { receiptTotalPence: 350 }, runner.authHeader);
  await post(`/orders/${orderId}/status`, { status: 'delivering' }, runner.authHeader);
  const delivered = await post(
    `/orders/${orderId}/status`,
    { status: 'delivered' },
    runner.authHeader,
  );
  expect(delivered.statusCode, delivered.body).toBe(200);
  return orderId;
}

beforeEach(async () => {
  harness = await buildTestApp(START, { autoOffer: true });
  ({ milk } = await seedCatalogue(harness.repository));
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness, { name: 'Tomasz Nowak' });
  const made = await partnerShop('Corner Bakery');
  bakery = made.shop;
  loaf = made.itemId;
});

afterEach(async () => {
  await harness.close();
});

describe('rating a shop after a delivery', () => {
  it('asks about the shops in a delivered order, and only those', async () => {
    const before = await get('/me/reviews/pending', shopper.authHeader);
    expect(before.statusCode).toBe(200);
    expect(before.json().pending).toEqual([]);
    expect(before.json().balance.words).toBe('You have 0 points, worth 0p.');
    expect(before.json().rules).toEqual({
      pointsPerReview: 10,
      pencePerPoint: 1,
      spendFromPoints: 100,
      pendingDays: 7,
    });

    // Milk alone is from the main store: nobody is asked to rate a Shop Partner.
    await deliverOrder(shopper, [{ catalogueItemId: milk, quantity: 1 }]);
    expect((await get('/me/reviews/pending', shopper.authHeader)).json().pending).toEqual([]);

    const orderId = await deliverOrder(shopper, [
      { catalogueItemId: loaf, quantity: 1 },
      { catalogueItemId: milk, quantity: 1 },
    ]);
    const pending = (await get('/me/reviews/pending', shopper.authHeader)).json().pending;
    expect(pending).toEqual([{ orderId, deliveredAt: START.toISOString(), shop: bakery }]);
  });

  it('earns the same points for one star as for five, pending for seven days, then as credit', async () => {
    const orderId = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);

    const early = await post(
      `/orders/${orderId}/shop-review`,
      { shop: bakery.id, stars: 1, message: 'The loaf was stale.' },
      shopper.authHeader,
    );
    expect(early.statusCode, early.body).toBe(201);
    expect(early.json().points).toBe(10);
    expect(early.json().message).toContain('10 points are on their way');
    expect(early.json().balance).toEqual(
      expect.objectContaining({ points: 0, pendingPoints: 10, worthPence: 0 }),
    );

    // Nothing is given before the days are up.
    harness.setNow(later(6));
    let report = await settleShopReviews(harness.app.ctx);
    expect(report).toEqual({ earned: 0, voided: 0, creditedPence: 0 });

    harness.setNow(later(7));
    report = await settleShopReviews(harness.app.ctx);
    expect(report).toEqual({ earned: 1, voided: 0, creditedPence: 0 });
    const balance = (await get('/me/reviews', shopper.authHeader)).json();
    expect(balance.balance.points).toBe(10);
    expect(balance.balance.words).toBe('You have 10 points, worth 10p.');
    expect(balance.reviews[0]).toEqual(
      expect.objectContaining({
        shopName: 'Corner Bakery',
        stars: 1,
        points: 10,
        status: 'earned',
      }),
    );
    // Running the sweep again changes nothing.
    expect(await settleShopReviews(harness.app.ctx)).toEqual({
      earned: 0,
      voided: 0,
      creditedPence: 0,
    });
  });

  it('is one rewarded review per shop per month, and never for a shop that was not in the order', async () => {
    const first = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);
    const second = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);
    const other = await partnerShop('Other Grocer');

    expect(
      (
        await post(
          `/orders/${first}/shop-review`,
          { shop: other.shop.id, stars: 5 },
          shopper.authHeader,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          `/orders/${first}/shop-review`,
          { shop: bakery.id, stars: 5 },
          shopper.authHeader,
        )
      ).statusCode,
    ).toBe(201);
    const again = await post(
      `/orders/${first}/shop-review`,
      { shop: bakery.id, stars: 4 },
      shopper.authHeader,
    );
    expect(again.statusCode).toBe(409);
    const sameMonth = await post(
      `/orders/${second}/shop-review`,
      { shop: bakery.id, stars: 4 },
      shopper.authHeader,
    );
    expect(sameMonth.statusCode).toBe(409);
    expect(sameMonth.json().error.message).toMatch(/already rated Corner Bakery this month/);
    // The second order no longer asks about the bakery this month.
    expect((await get('/me/reviews/pending', shopper.authHeader)).json().pending).toEqual([]);

    // Next month the shop can be rated again, from a fresh delivery.
    harness.setNow(new Date('2026-11-02T10:00:00.000Z'));
    const third = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);
    expect(
      (
        await post(
          `/orders/${third}/shop-review`,
          { shop: bakery.id, stars: 3 },
          shopper.authHeader,
        )
      ).statusCode,
    ).toBe(201);
    // Somebody else's order is not theirs to rate.
    const stranger = await signUpShopper(harness, { phone: '+447700900002' });
    expect(
      (
        await post(
          `/orders/${third}/shop-review`,
          { shop: bakery.id, stars: 5 },
          stranger.authHeader,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('loses the points when the order is refunded before they are earned', async () => {
    const orderId = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);
    await post(`/orders/${orderId}/shop-review`, { shop: bakery.id, stars: 5 }, shopper.authHeader);
    await harness.repository.orders.update(orderId, { status: 'refunded' });

    harness.setNow(later(8));
    expect(await settleShopReviews(harness.app.ctx)).toEqual({
      earned: 0,
      voided: 1,
      creditedPence: 0,
    });
    const mine = (await get('/me/reviews', shopper.authHeader)).json();
    expect(mine.balance.points).toBe(0);
    expect(mine.reviews[0].status).toBe('void');
  });

  it('turns a hundred points into a pound of credit on the account, leaving the rest', async () => {
    // Ten reviews already earned in earlier months, then one more from a real delivery: 110
    // points, so one lot of a hundred becomes a pound of credit and ten points stay.
    for (let n = 0; n < 10; n += 1) {
      await harness.repository.shopReviews.create({
        orderId: `earlier-order-${n}`,
        shopperId: shopper.shopperId,
        partnerShopId: bakery.id,
        stars: 4,
        message: '',
        points: 10,
        status: 'earned',
        earnedAt: new Date(START.getTime() - 30 * DAY),
        createdAt: new Date(START.getTime() - 37 * DAY),
      });
    }
    const orderId = await deliverOrder(shopper, [{ catalogueItemId: loaf, quantity: 1 }]);
    await post(`/orders/${orderId}/shop-review`, { shop: bakery.id, stars: 5 }, shopper.authHeader);
    expect((await get('/me/reviews', shopper.authHeader)).json().balance.points).toBe(100);
    expect((await harness.repository.shoppers.findById(shopper.shopperId))?.creditPence).toBe(0);

    harness.setNow(later(7));
    expect(await settleShopReviews(harness.app.ctx)).toEqual({
      earned: 1,
      voided: 0,
      creditedPence: 100,
    });
    expect((await harness.repository.shoppers.findById(shopper.shopperId))?.creditPence).toBe(100);
    const mine = (await get('/me/reviews', shopper.authHeader)).json();
    expect(mine.balance).toEqual(
      expect.objectContaining({ points: 10, worthPence: 10, pointsToSpend: 90 }),
    );
    expect(mine.balance.words).toBe('You have 10 points, worth 10p.');
    // Running the sweep again gives nothing twice.
    expect((await settleShopReviews(harness.app.ctx)).creditedPence).toBe(0);
  });
});

describe('Shop of the Month', () => {
  /** So many reviews of a shop in a month, each from a different Shopper, at these stars. */
  async function reviews(shopId: string, stars: number[], at: Date): Promise<void> {
    for (const [index, value] of stars.entries()) {
      await harness.repository.shopReviews.create({
        orderId: `order-${shopId}-${at.getUTCMonth()}-${index}`,
        shopperId: `shopper-${index}`,
        partnerShopId: shopId,
        stars: value,
        message: '',
        points: 10,
        status: 'earned',
        earnedAt: at,
        createdAt: at,
      });
    }
  }

  it('knows the calendar periods and their words', () => {
    expect(periodAt('month', START).title).toBe('Shop of the Month, October 2026');
    expect(lastPeriod('month', START).title).toBe('Shop of the Month, September 2026');
    expect(periodAt('quarter', START).title).toBe('Shop of the Quarter, October to December 2026');
    expect(lastPeriod('quarter', START).title).toBe('Shop of the Quarter, July to September 2026');
    expect(periodAt('half', START).title).toBe('Shop of the Half Year, July to December 2026');
    expect(lastPeriod('half', START).title).toBe('Shop of the Half Year, January to June 2026');
    expect(lastPeriod('month', new Date('2027-01-15T00:00:00.000Z')).title).toBe(
      'Shop of the Month, December 2026',
    );
  });

  it('balances a few perfect reviews against many good ones', () => {
    // Two fives against forty at 4.8, with a global mean of 4 and a prior of ten.
    expect(balancedScore(2, 5, 4, 10)).toBeCloseTo(4.17, 2);
    expect(balancedScore(40, 4.8, 4, 10)).toBeCloseTo(4.64, 2);
  });

  it('needs ten reviews in the period, on paid Partner Plus, and ranks by the balanced score', async () => {
    const september = new Date('2026-09-15T12:00:00.000Z');
    const grocer = await partnerShop('Other Grocer');
    const free = await partnerShop('Free Listing Shop', 'free');
    const paused = await partnerShop('Paused Shop');
    await harness.repository.partnerShops.update(paused.shop.id, { active: false });
    // Marked Partner Plus but never paid (30 October 2026): it cannot win either.
    const unpaid = await partnerShop('Unpaid Plus Shop');
    await harness.repository.partnerShops.update(unpaid.shop.id, { paidUntil: null });

    // The bakery: ten reviews averaging 4.5. The grocer: twelve averaging 4.75.
    await reviews(bakery.id, [5, 5, 5, 5, 5, 4, 4, 4, 4, 4], september);
    await reviews(grocer.shop.id, [5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4], september);
    // A free listing with perfect reviews, and a paused shop, never win.
    await reviews(free.shop.id, Array<number>(12).fill(5), september);
    await reviews(paused.shop.id, Array<number>(12).fill(5), september);
    await reviews(unpaid.shop.id, Array<number>(12).fill(5), september);
    // Nine perfect reviews are one short this month.
    const nearly = await partnerShop('Nearly There');
    await reviews(nearly.shop.id, Array<number>(9).fill(5), START);
    await reviews(bakery.id, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], START);

    const page = await get('/shops/of-the-month');
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.awards).toEqual([
      {
        kind: 'month',
        title: 'Shop of the Month, September 2026',
        shop: grocer.shop,
        reviews: 12,
        average: 4.8,
      },
      {
        kind: 'quarter',
        title: 'Shop of the Quarter, July to September 2026',
        shop: grocer.shop,
        reviews: 12,
        average: 4.8,
      },
    ]);
    expect(body.standings.period.title).toBe('Shop of the Month, October 2026');
    expect(body.standings.minimumReviews).toBe(10);
    expect(
      body.standings.rows.map((row: { shop: { name: string }; qualifies: boolean }) => [
        row.shop.name,
        row.qualifies,
      ]),
    ).toEqual([
      ['Corner Bakery', true],
      ['Nearly There', false],
    ]);
    expect(JSON.stringify(body)).not.toContain('shopper-');

    // The badge, with words, on the public shops list and the shop's own page.
    const shops = (await get('/shops')).json().shops as Array<{ name: string; awards: string[] }>;
    expect(shops.find((shop) => shop.name === 'Other Grocer')?.awards).toEqual([
      'Shop of the Month, September 2026',
      'Shop of the Quarter, July to September 2026',
    ]);
    expect(shops.find((shop) => shop.name === 'Corner Bakery')?.awards).toEqual([]);
    expect((await get(`/shops/${grocer.shop.id}`)).json().shop.awards).toEqual([
      'Shop of the Month, September 2026',
      'Shop of the Quarter, July to September 2026',
    ]);

    // Staff see the full standings for the month, the quarter and the half year.
    const staff = await harness.app.inject({
      method: 'GET',
      url: '/staff/shop-of-the-month',
      headers: STAFF,
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().standings.month.rows).toHaveLength(2);
    expect(staff.json().standings.quarter.period.title).toBe(
      'Shop of the Quarter, October to December 2026',
    );
    expect(staff.json().standings.half.rows[0].shop.name).toBe('Other Grocer');
    expect((await get('/staff/shop-of-the-month')).statusCode).toBe(403);
  });
});
