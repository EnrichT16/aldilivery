/**
 * Restaurant pricing and Ozi Preferred Partners (Anthony, 30 October 2026).
 *
 * A restaurant, café or takeaway order: dishes at shop prices with the normal item charge, the
 * flat £12 restaurant fee in place of delivery (£5 of it the Runner's), a £10 smallest order,
 * never mixed with other shopping; no commission; an agreed discount for Ozi that the Runner is
 * told, the till is checked against, the spending card is loaded with and the pay-back is
 * limited by, while the Shopper pays shop prices and Ozi keeps the difference. A restaurant whose
 * discount is 20% or more is a Preferred Partner: first in the lists and in search, with a badge
 * and the reason said, Partner Plus free, a free Spotlight week a month, and the tie on Shop of
 * the Month. Staff see every restaurant's discount, level and orders. Grocery pricing is
 * unchanged beside it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PartnerShop } from '../src/domain.js';
import { standingsFor, periodAt } from '../src/services/shop-of-the-month.js';
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

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let milk: string;
let started = false;

async function start(issuing = false): Promise<void> {
  harness = await buildTestApp(new Date('2026-10-30T10:00:00.000Z'), {
    autoOffer: true,
    autoPayout: true,
    env: { stripeIssuingEnabled: issuing },
  });
  started = true;
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  if (started) await harness.close();
  started = false;
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

let made = 0;

/** An approved restaurant with one dish in the catalogue. */
async function restaurant(
  discount: number,
  dishPence = 1000,
  extra: Partial<PartnerShop> = {},
): Promise<{ shop: PartnerShop; dish: string }> {
  made += 1;
  const shop = await harness.repository.partnerShops.create({
    name: `Mama Joy ${made}`,
    address: '1 High Street, Gillingham',
    telephone: '',
    about: 'Jollof rice and stews.',
    monthlyPence: 0,
    kind: 'food',
    plan: 'free',
    status: 'approved',
    postcode: 'ME7 1AA',
    cuisines: ['African'],
    agreedDiscountPercent: discount,
    approvedAt: harness.now(),
    ...extra,
  });
  const product = await harness.repository.partnerProducts.create({
    partnerShopId: shop.id,
    name: 'Jollof rice',
    pricePence: dishPence,
    tags: 'rice',
    expiresOn: null,
    photo: null,
    photoType: null,
  });
  const item = await harness.repository.catalogue.create({
    name: `Jollof rice (${shop.name})`,
    category: `From ${shop.name}`,
    estimatedPricePence: dishPence,
    source: 'partner_feed',
    externalRef: `partner:${product.id}`,
  });
  await harness.repository.partnerProducts.update(product.id, {
    status: 'approved',
    catalogueItemId: item.id,
  });
  return { shop, dish: item.id };
}

function price(lines: Array<{ catalogueItemId: string; quantity: number }>) {
  return post('/basket/price', { lines }, shopper.authHeader);
}

async function placeOrder(dish: string, quantity: number, agreedTotalPence: number) {
  const placed = await post(
    '/orders',
    {
      lines: [{ catalogueItemId: dish, quantity }],
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json().order.id as string;
}

/** A restaurant order placed, accepted by the Runner and being shopped. */
async function beingShopped(dish: string, quantity: number, agreedTotalPence: number) {
  const orderId = await placeOrder(dish, quantity, agreedTotalPence);
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  const accepted = await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
  expect(accepted.statusCode, accepted.body).toBe(200);
  await post(`/orders/${orderId}/status`, { status: 'shopping' }, runner.authHeader);
  return { orderId, accepted: accepted.json() };
}

describe('a restaurant order is priced apart from groceries', () => {
  it('has the £12 restaurant fee in place of delivery, at shop prices with the item charge', async () => {
    const { dish } = await restaurant(20, 650);
    const priced = await price([{ catalogueItemId: dish, quantity: 2 }]);
    expect(priced.statusCode, priced.body).toBe(200);
    // £13 of dishes at the shop's own price, £1 of item charge on each, £12 restaurant fee.
    expect(priced.json()).toMatchObject({
      goodsEstimatePence: 1300,
      itemChargesPence: 200,
      feePence: 1200,
      allowanceExtraPence: 0,
      totalPence: 2700,
      restaurant: { name: expect.stringContaining('Mama Joy') },
    });
    expect(priced.json().explanation).toContain(
      'The restaurant fee is £12.00, in place of delivery.',
    );
    // The Shopper is never told the counter price: they see and pay shop prices.
    expect(priced.body).not.toContain('1040');
    expect(priced.json().lines[0]).toMatchObject({ unitPricePence: 650, unitDisplayPence: 750 });
  });

  it('refuses a restaurant basket under £10, in plain words', async () => {
    const { dish } = await restaurant(0, 999);
    const priced = await price([{ catalogueItemId: dish, quantity: 1 }]);
    expect(priced.statusCode).toBe(422);
    expect(priced.json().error).toMatchObject({
      code: 'restaurant_minimum',
      message: 'The smallest restaurant order is £10. Please add something more.',
    });
    // A real minimum: the order cannot be sent either.
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: dish, quantity: 1 }],
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 999 + 100 + 1200,
        },
      },
      shopper.authHeader,
    );
    expect(placed.statusCode).toBe(422);
    expect(harness.payments.calls.filter((call) => call.kind === 'payment_intent')).toHaveLength(0);
  });

  it('keeps restaurant dishes apart from groceries, and from another restaurant', async () => {
    const one = await restaurant(0, 1000);
    const two = await restaurant(0, 1000);
    const mixed = await price([
      { catalogueItemId: one.dish, quantity: 1 },
      { catalogueItemId: milk, quantity: 1 },
    ]);
    expect(mixed.statusCode).toBe(422);
    expect(mixed.json().error.code).toBe('restaurant_mixed');
    expect(mixed.json().error.message).toMatch(/Restaurant dishes go as their own order/);
    const twoPlaces = await price([
      { catalogueItemId: one.dish, quantity: 1 },
      { catalogueItemId: two.dish, quantity: 1 },
    ]);
    expect(twoPlaces.json().error.code).toBe('restaurant_mixed');
  });

  it('leaves grocery pricing exactly as it was', async () => {
    const priced = await price([{ catalogueItemId: milk, quantity: 2 }]);
    expect(priced.json()).toMatchObject({
      goodsEstimatePence: 250,
      itemChargesPence: 100,
      feePence: 1099,
      totalPence: 250 + 100 + 1099,
      restaurant: null,
    });
    expect(priced.json().explanation).toContain('Delivery is £10.99.');
  });

  it('places the order with the £12 fee, £5 of it the Runner’s, and the discount kept on it', async () => {
    const { shop, dish } = await restaurant(20, 1000);
    const orderId = await placeOrder(dish, 1, 1000 + 100 + 1200);
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order).toMatchObject({
      goodsEstimatePence: 1000,
      itemChargesPence: 100,
      feePence: 1200,
      totalEstimatePence: 2300,
      runnerPaymentPence: 500,
      restaurantShopId: shop.id,
      restaurantDiscountPercent: 20,
    });
  });

  it('charges £14 on a big order, whose Runner is paid £7, so Ozi still keeps £7', async () => {
    // Four £30 dishes: £120, the large-order line (Rule Two). Anthony, 30 October 2026.
    const { dish } = await restaurant(0, 3000);
    const priced = await price([{ catalogueItemId: dish, quantity: 4 }]);
    expect(priced.statusCode, priced.body).toBe(200);
    expect(priced.json()).toMatchObject({ goodsEstimatePence: 12000, feePence: 1400 });
    expect(priced.json().explanation).toContain(
      'The restaurant fee is £14.00, in place of delivery.',
    );
    const orderId = await placeOrder(dish, 4, priced.json().totalPence as number);
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order).toMatchObject({ feePence: 1400, runnerPaymentPence: 700 });
    expect(order.feePence - order.runnerPaymentPence).toBe(700);
  });
});

describe('the agreed mark-up (Anthony, 30 October 2026)', () => {
  const DISCLOSURE = 'Prices on Ozi may be higher than in the restaurant.';

  it('has the Shopper pay the marked-up price, the item charge on it, and says so', async () => {
    // A £10 dish, 50% mark-up and 20% discount: the Shopper sees £15.
    const { shop, dish } = await restaurant(20, 1000);
    const set = await post(`/staff/partners/${shop.id}`, { agreedMarkupPercent: 50 }, STAFF);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().shop.agreedMarkupPercent).toBe(50);
    expect((await harness.repository.catalogue.findById(dish))?.estimatedPricePence).toBe(1500);

    const priced = await price([{ catalogueItemId: dish, quantity: 1 }]);
    expect(priced.statusCode, priced.body).toBe(200);
    // £15 shown, the item charge on £15 (50p + 2 × 50p), then the £12 restaurant fee.
    expect(priced.json()).toMatchObject({
      goodsEstimatePence: 1500,
      itemChargesPence: 150,
      feePence: 1200,
      totalPence: 2850,
      restaurant: { priceNote: DISCLOSURE },
    });
    expect(priced.json().explanation).toContain(DISCLOSURE);
    // The counter price and the shop price are never told to the Shopper.
    expect(priced.json().lines[0]).not.toHaveProperty('counterPricePence');
    expect(priced.json().lines[0]).not.toHaveProperty('shopPricePence');

    // The restaurant's page shows the price Shoppers pay, and the same words.
    const page = (await get(`/shops/${shop.id}`)).json();
    expect(page.products[0].pricePence).toBe(1500);
    expect(page.shop.priceNote).toBe(DISCLOSURE);
    // Preferred Partner stays the discount's alone.
    expect(page.shop.preferredPartner).toBe(true);
  });

  it('records what the Shopper paid per dish, and the Runner pays and is paid back the counter price', async () => {
    const { shop, dish } = await restaurant(20, 1000);
    await post(`/staff/partners/${shop.id}`, { agreedMarkupPercent: 50 }, STAFF);
    const { orderId } = await beingShopped(dish, 1, 2850);
    const placed = (await harness.repository.orders.findById(orderId))!;
    expect(placed.items[0]).toMatchObject({
      estimatedPricePence: 1500,
      shopPricePence: 1000,
      counterPricePence: 800,
    });
    const current = (await get('/jobs/current', runner.authHeader)).json().job;
    expect(current.goodsEstimatePence).toBe(800);
    expect(current.items[0].estimatedPricePence).toBe(800);

    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 800 },
      runner.authHeader,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().repricing).toMatchObject({ receiptTotalPence: 800, finalTotalPence: 2850 });
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 800 });
    // Ozi keeps the £5 mark-up and the £2 discount on the dish.
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(
      order.finalTotalPence! - order.itemChargesPence - order.feePence - order.receiptTotalPence!,
    ).toBe(700);
  });

  it('refuses a mark-up over the most allowed, 100%', async () => {
    const { shop } = await restaurant(0, 1000);
    expect(
      (await post(`/staff/partners/${shop.id}`, { agreedMarkupPercent: 100 }, STAFF)).statusCode,
    ).toBe(200);
    const tooMuch = await post(`/staff/partners/${shop.id}`, { agreedMarkupPercent: 101 }, STAFF);
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.message).toContain('more than 100%');
    // A mark-up alone never makes a Preferred Partner.
    expect((await get(`/shops/${shop.id}`)).json().shop.preferredPartner).toBe(false);
  });

  it('applies to a grocery shop partner the same way, with the shop words', async () => {
    // £10 in the shop, 50% mark-up, 10% discount: £15 shown, £9 at the till.
    const { shop, dish } = await restaurant(10, 1000, { kind: 'shop', cuisines: [] });
    await post(`/staff/partners/${shop.id}`, { agreedMarkupPercent: 50 }, STAFF);
    const page = (await get(`/shops/${shop.id}`)).json();
    expect(page.shop.priceNote).toBe('Prices on Ozi may be higher than in the shop.');
    const priced = (await price([{ catalogueItemId: dish, quantity: 1 }])).json();
    expect(priced).toMatchObject({ goodsEstimatePence: 1500, itemChargesPence: 150 });
    const { orderId } = await beingShopped(dish, 1, priced.totalPence as number);
    const current = (await get('/jobs/current', runner.authHeader)).json().job;
    expect(current.goodsEstimatePence).toBe(900);
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 900 },
      runner.authHeader,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    // The Shopper pays the £15 shown; the Runner paid and is paid back £9.
    expect(sent.json().repricing.finalTotalPence).toBe(priced.totalPence);
    expect(sent.json().reimbursement).toMatchObject({ pence: 900 });
  });
});

describe('the agreed discount, all the way to the counter', () => {
  it('tells the Runner the discounted amount, checks the till against it, and pays that back', async () => {
    const { dish } = await restaurant(20, 1000);
    const { orderId } = await beingShopped(dish, 1, 2300);
    const current = (await get('/jobs/current', runner.authHeader)).json().job;
    // £10 at shop price, 20% off: the Runner pays £8 at the counter.
    expect(current.goodsEstimatePence).toBe(800);
    expect(current.items[0].estimatedPricePence).toBe(800);
    expect(current.counterWords).toMatch(
      /^Pay Mama Joy \d+ £8\.00 at the counter: the price agreed with/,
    );

    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 800 },
      runner.authHeader,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    // Exactly what was expected at the counter: the Shopper pays exactly the shop prices.
    expect(sent.json().repricing).toEqual({
      receiptTotalPence: 800,
      receiptFeePence: 1200,
      finalTotalPence: 2300,
      differenceFromEstimatePence: 0,
    });
    expect(sent.json().settled).toEqual({ kind: 'even' });
    // The Runner is paid back what they paid: £8, never the £10 shop price.
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 800 });
    // Ozi keeps the difference: the Shopper paid £10 for the dish, the restaurant was paid £8.
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(
      order.finalTotalPence! - order.itemChargesPence - order.feePence - order.receiptTotalPence!,
    ).toBe(200);
  });

  it('holds a pay-back for a person above the limit on the discounted amount, not the shop price', async () => {
    const { dish } = await restaurant(20, 1000);
    const { orderId } = await beingShopped(dish, 1, 2300);
    // The limit is the larger of £5 or a fifth of £8: £5. £13.01 at the counter is over it,
    // though it would have been within it on the £10 shop price.
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 1301 },
      runner.authHeader,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().settled).toMatchObject({ kind: 'needs-person', reason: 'over the limit' });
    expect(sent.json().reimbursement).toMatchObject({ kind: 'waiting', pence: 1301 });
  });

  it('settles a dish missing at the shop price of what was paid', async () => {
    const { dish } = await restaurant(20, 1000);
    const { orderId } = await beingShopped(dish, 2, 2000 + 200 + 1200);
    // Two £10 dishes, £16 expected at the counter; one missing, £8 paid.
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 800 },
      runner.authHeader,
    );
    expect(sent.json().repricing).toMatchObject({
      finalTotalPence: 1000 + 200 + 1200,
      differenceFromEstimatePence: 800,
    });
    expect(sent.json().settled).toEqual({ kind: 'refunded', pence: 1000 });
  });

  it('loads the spending card with the discounted amount, for a restaurant’s counter', async () => {
    await harness.close();
    await start(true);
    const card = await post(
      '/runners/me/card',
      {
        acceptTerms: true,
        address: { line1: '3 Runner Row', city: 'Gillingham', postcode: 'me7 2bb' },
      },
      { ...runner.authHeader, 'user-agent': 'TestPhone/1.0' },
    );
    expect(card.statusCode, card.body).toBe(200);
    const { dish } = await restaurant(20, 1000);
    const { accepted } = await beingShopped(dish, 1, 2300);
    // £8 at the counter, plus the margin of £5: £13, never the £10 shop price plus margin.
    expect(accepted.till).toMatchObject({ payMethodUsed: 'card', cardLimitPence: 1300 });
    const load = harness.payments.calls.find((call) => call.kind === 'card_load');
    expect(load?.input).toMatchObject({ limitPence: 1300, restaurant: true });
  });

  it('pays nothing on a grocery order differently', async () => {
    const placed = await placeOrder(milk, 2, 250 + 100 + 1099);
    const order = (await harness.repository.orders.findById(placed))!;
    expect(order.restaurantShopId).toBeNull();
    expect(order.restaurantDiscountPercent).toBe(0);
  });
});

describe('restaurants pay no commission', () => {
  it('says so on the dashboard, the plan and the statement, and there is nothing to pay', async () => {
    const { shop } = await restaurant(15, 1000);
    await harness.repository.businessUsers.create({
      kind: 'partner',
      partnerShopId: shop.id,
      organisationId: null,
      name: 'Joy',
      office: '',
      username: 'mamajoy',
      passwordHash: (await import('../src/lib/staff.js')).hashPassword('a-long-enough-password'),
    });
    const signedIn = await post('/business/sign-in', {
      username: 'mamajoy',
      password: 'a-long-enough-password',
    });
    const headers = { 'x-business-token': signedIn.json().token as string };
    const dashboard = (await get('/partner/dashboard', headers)).json();
    expect(dashboard).not.toHaveProperty('commission');
    expect(dashboard.plan.words).toMatch(/no commission/);
    expect(dashboard.restaurant).toMatchObject({ discountPercent: 15, preferred: false });
    expect(dashboard.restaurant.words).toContain('our Runners pay your shop price less 15%');
    const plan = await post('/partner/plan/checkout', {}, headers);
    expect(plan.statusCode).toBe(400);
    expect(plan.json().error.message).toMatch(/no commission\. There is nothing to pay/);
  });
});

describe('Ozi Preferred Partner', () => {
  it('lists Preferred Partners first in their area and food type, with a badge and the reason', async () => {
    const plain = await restaurant(10);
    const preferred = await restaurant(20);
    const listed = (await get('/shops?section=restaurants&cuisine=African')).json();
    expect(listed.shops.map((row: { id: string }) => row.id)).toEqual([
      preferred.shop.id,
      plain.shop.id,
    ]);
    expect(listed.shops[0].preferredPartner).toBe(true);
    expect(listed.shops[1].preferredPartner).toBe(false);
    expect(listed.ranking).toBe(
      `Preferred Partners, who give ${harness.config.assistantName} a better price, are shown first.`,
    );
    // Near you first, and the Preferred Partner first among those near.
    const near = (await get('/shops?section=restaurants&near=ME7%201AA')).json();
    expect(near.shops[0].id).toBe(preferred.shop.id);
    // Its own page carries the badge too.
    expect((await get(`/shops/${preferred.shop.id}`)).json().shop.preferredPartner).toBe(true);
  });

  it('says nothing of a ranking when no Preferred Partner is in the list', async () => {
    await restaurant(5);
    expect((await get('/shops?section=restaurants')).json().ranking).toBeNull();
  });

  it('ranks its dishes first in search, and says why', async () => {
    const plain = await restaurant(0);
    const preferred = await restaurant(25);
    const found = (await get('/catalogue/search?q=jollof')).json();
    expect(found.items[0].id).toBe(preferred.dish);
    expect(found.items[1].id).toBe(plain.dish);
    expect(found.items[0].restaurant).toEqual({
      shopId: preferred.shop.id,
      name: preferred.shop.name,
      markedUp: false,
    });
    expect(found.ranking).toMatch(
      /Preferred Partners, who give .+ a better price, are shown first\./,
    );
  });

  it('has Partner Plus free while it keeps the discount, and is never charged', async () => {
    const { shop } = await restaurant(20);
    const staffList = (await get('/staff/partners', STAFF)).json();
    const row = staffList.shops.find((one: { id: string }) => one.id === shop.id);
    expect(row).toMatchObject({ preferredPartner: true, paid: true, monthlyPence: 0 });
    expect(harness.payments.calls.filter((call) => call.kind === 'payment_link')).toHaveLength(0);
    // Below the level again: an ordinary listing, nothing owed.
    await post(`/staff/partners/${shop.id}`, { agreedDiscountPercent: 10 }, STAFF);
    const after = (await get('/staff/partners', STAFF)).json();
    expect(after.shops.find((one: { id: string }) => one.id === shop.id)).toMatchObject({
      preferredPartner: false,
      paid: false,
    });
  });

  it('takes one free Spotlight week each calendar month, from its dashboard or from staff', async () => {
    const { shop } = await restaurant(20);
    const taken = await post(`/staff/partners/${shop.id}/free-spotlight-week`, {}, STAFF);
    expect(taken.statusCode, taken.body).toBe(200);
    expect(taken.json().message).toMatch(/Nothing was charged/);
    const updated = (await harness.repository.partnerShops.findById(shop.id))!;
    expect(updated.spotlight).toBe('spotlight');
    expect(updated.spotlightUntil?.getTime()).toBe(harness.now().getTime() + 7 * 24 * 3_600_000);
    const payments = await harness.repository.partnerPayments.listForShop(shop.id);
    expect(payments).toEqual([
      expect.objectContaining({ kind: 'spotlight', amountPence: 0, months: 0 }),
    ]);
    // Once a month only.
    const again = await post(`/staff/partners/${shop.id}/free-spotlight-week`, {}, STAFF);
    expect(again.statusCode).toBe(409);
    // Next month, another, added to the end of any week still running.
    harness.setNow(new Date('2026-11-02T10:00:00.000Z'));
    expect(
      (await post(`/staff/partners/${shop.id}/free-spotlight-week`, {}, STAFF)).statusCode,
    ).toBe(200);
    // Not for a restaurant below the level.
    const plain = await restaurant(5);
    const refused = await post(`/staff/partners/${plain.shop.id}/free-spotlight-week`, {}, STAFF);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/Preferred Partners/);
  });

  it('wins Shop of the Month on a tie of the Shoppers’ ratings', async () => {
    const plain = await restaurant(0);
    const preferred = await restaurant(20);
    // A Plus shop with the same reviews, so both qualify on the same score.
    const period = periodAt('month', harness.now());
    for (const shop of [plain.shop, preferred.shop]) {
      await harness.repository.partnerShops.update(shop.id, {
        plan: 'plus',
        paidUntil: new Date('2026-12-01T00:00:00.000Z'),
      });
      for (let n = 0; n < harness.config.feedback.reviews.shopOfTheMonthMinimumReviews; n += 1) {
        await harness.repository.shopReviews.create({
          orderId: `order-${shop.id}-${n}`,
          shopperId: `shopper-${n}`,
          partnerShopId: shop.id,
          stars: 5,
          message: '',
          points: 10,
          status: 'earned',
          earnedAt: harness.now(),
          createdAt: harness.now(),
        });
      }
    }
    const standings = await standingsFor(harness.app.ctx, period);
    expect(standings.winner?.shop.id).toBe(preferred.shop.id);
    expect(standings.rows.map((row) => row.preferred)).toEqual([true, false]);
  });
});

describe('the staff list of restaurant partners', () => {
  it('shows each one’s discount, level and orders in the last 30 days, sortable', async () => {
    const none = await restaurant(0);
    const some = await restaurant(10);
    const preferred = await restaurant(25);
    for (const [shopId, count] of [
      [none.shop.id, 3],
      [preferred.shop.id, 1],
    ] as const) {
      for (let n = 0; n < count; n += 1) {
        await harness.repository.analytics.record({
          at: harness.now(),
          kind: 'order_paid',
          shopperKey: `k${n}`,
          runnerKey: null,
          shop: 'x',
          partnerShopId: shopId,
          area: null,
          toArea: 'ME7',
          ageBand: null,
          viaOrganisation: false,
          itemCount: 1,
          goodsPence: 1200,
          categories: '',
          query: null,
          travelMode: null,
        });
      }
    }
    // An order from before the 30 days does not count.
    await harness.repository.analytics.record({
      at: new Date('2026-09-01T10:00:00.000Z'),
      kind: 'order_paid',
      shopperKey: 'old',
      runnerKey: null,
      shop: 'x',
      partnerShopId: some.shop.id,
      area: null,
      toArea: 'ME7',
      ageBand: null,
      viaOrganisation: false,
      itemCount: 1,
      goodsPence: 1200,
      categories: '',
      query: null,
      travelMode: null,
    });
    const list = (await get('/staff/restaurants', STAFF)).json();
    expect(list.restaurants.map((row: { discountPercent: number }) => row.discountPercent)).toEqual(
      [25, 10, 0],
    );
    expect(list.restaurants[0]).toMatchObject({
      id: preferred.shop.id,
      preferredPartner: true,
      ordersLast30Days: 1,
    });
    expect(list).toMatchObject({ withDiscount: 2, withoutDiscount: 1, preferred: 1 });
    const byOrders = (await get('/staff/restaurants?sort=orders', STAFF)).json();
    expect(
      byOrders.restaurants.map((row: { ordersLast30Days: number }) => row.ordersLast30Days),
    ).toEqual([3, 1, 0]);
    const byName = (await get('/staff/restaurants?sort=name&order=desc', STAFF)).json();
    expect(byName.restaurants[0].name).toBe(preferred.shop.name);
    // Only staff who look after partners.
    expect((await get('/staff/restaurants')).statusCode).toBe(403);
  });

  it('records the agreed discount when staff approve or edit, within the most allowed', async () => {
    const { shop } = await restaurant(0);
    const set = await post(`/staff/partners/${shop.id}`, { agreedDiscountPercent: 20 }, STAFF);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().shop.agreedDiscountPercent).toBe(20);
    // The most is restaurants.maximumDiscountPercent, 50: 50 is taken, 51 is not.
    expect(harness.app.ctx.config.restaurants.maximumDiscountPercent).toBe(50);
    const most = await post(`/staff/partners/${shop.id}`, { agreedDiscountPercent: 50 }, STAFF);
    expect(most.statusCode, most.body).toBe(200);
    const tooMuch = await post(`/staff/partners/${shop.id}`, { agreedDiscountPercent: 51 }, STAFF);
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.message).toContain('more than 50%');
    const groceryShop = await harness.repository.partnerShops.create({
      name: 'Corner Shop',
      address: '',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'shop',
    });
    // Since Anthony's final ruling (30 October 2026) a grocery shop may agree one too; a service
    // never does.
    const groceryDiscount = await post(
      `/staff/partners/${groceryShop.id}`,
      { agreedDiscountPercent: 10 },
      STAFF,
    );
    expect(groceryDiscount.statusCode, groceryDiscount.body).toBe(200);
    const service = await harness.repository.partnerShops.create({
      name: 'Garden Help',
      address: '',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'service',
    });
    expect(
      (await post(`/staff/partners/${service.id}`, { agreedDiscountPercent: 10 }, STAFF))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(`/staff/partners/${service.id}`, { agreedMarkupPercent: 10 }, STAFF)).statusCode,
    ).toBe(400);
    const added = await post(
      '/staff/partners',
      { name: 'Spice Hut', kind: 'food', agreedDiscountPercent: 20 },
      STAFF,
    );
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().shop.agreedDiscountPercent).toBe(20);
  });
});
