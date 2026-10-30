/**
 * Checkout insights (Anthony, 30 October 2026): why people do not pay.
 *
 * A checkout viewed is recorded with the breakdown shown, the kind of order, the area, the
 * no-Runner warning, new or returning, and the channel; paying records it paid. "Can we ask what
 * stopped you?" is asked at most once a day and a tap records the answer. The staff page counts
 * it all for 7, 30 or 90 days, and only the founder and the operations manager may open it. The
 * rows are kept 12 months (proved in retention.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AnalyticsEvent } from '../src/domain.js';
import { personKey } from '../src/lib/analytics.js';
import { bandOf, checkoutInsights, checkoutsFrom } from '../src/services/checkout-insights.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  STAFF,
  TEST_SECRET,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let milk: string;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-30T10:00:00.000Z'));
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

async function staffToken(role: string, username: string): Promise<Record<string, string>> {
  const made = (await post('/staff/team', { name: username, username, role }, STAFF)).json() as {
    password: string;
  };
  const token = (await post('/staff/sign-in', { username, password: made.password })).json()
    .token as string;
  return { 'x-staff-token': token };
}

const VIEW = {
  goodsPence: 250,
  itemChargesPence: 100,
  feePence: 1099,
  totalPence: 1449,
  restaurant: false,
  area: '12 Example Street, Gillingham ME7 1AA',
  noRunnerWarning: true,
  channel: 'web',
};

async function events(kind: AnalyticsEvent['kind']) {
  return harness.repository.analytics.list({ since: new Date(0), kind });
}

describe('recording checkouts', () => {
  it('records a checkout viewed with everything shown, and paid when the Shopper pays', async () => {
    const viewed = await post('/checkout/viewed', VIEW, shopper.authHeader);
    expect(viewed.statusCode, viewed.body).toBe(200);
    const [row] = await events('checkout_viewed');
    expect(row).toMatchObject({
      shopperKey: personKey(shopper.shopperId, TEST_SECRET),
      goodsPence: 250,
      itemChargesPence: 100,
      feePence: 1099,
      totalPence: 1449,
      restaurant: false,
      toArea: 'ME7',
      noRunnerWarning: true,
      returning: false,
      channel: 'web',
    });
    // Only the district: no address, no name, no card.
    expect(JSON.stringify(row)).not.toContain('Example Street');

    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 1449,
        },
      },
      shopper.authHeader,
    );
    expect(placed.statusCode, placed.body).toBe(201);
    const [paid] = await events('checkout_paid');
    expect(paid).toMatchObject({
      shopperKey: personKey(shopper.shopperId, TEST_SECRET),
      goodsPence: 250,
      itemChargesPence: 100,
      feePence: 1099,
      totalPence: 1449,
      restaurant: false,
      toArea: 'ME7',
      returning: false,
      channel: 'web',
    });
    // Having ordered once, the next checkout is a returning Shopper's.
    await post('/checkout/viewed', VIEW, shopper.authHeader);
    const views = await events('checkout_viewed');
    expect(views[1]?.returning).toBe(true);
  });

  it('is for signed-in Shoppers only', async () => {
    expect((await post('/checkout/viewed', VIEW)).statusCode).toBe(401);
  });
});

describe('"Can we ask what stopped you?"', () => {
  it('is asked once, records a tap, and is not asked again the same day', async () => {
    const asked = await post('/checkout/why/ask', {}, shopper.authHeader);
    expect(asked.json()).toEqual({
      ask: true,
      question: 'Can we ask what stopped you?',
      answers: [
        { answer: 'price', label: 'The price' },
        { answer: 'looking', label: 'Just looking' },
        { answer: 'no_runner', label: 'No Runner in my area' },
        { answer: 'other', label: 'Something else' },
      ],
    });
    const answered = await post(
      '/checkout/why',
      { answer: 'price', totalPence: 1449, area: 'ME7 1AA' },
      shopper.authHeader,
    );
    expect(answered.statusCode, answered.body).toBe(200);
    expect((await events('checkout_reason')).map((row) => row.answer)).toEqual([null, 'price']);
    // A second tap for the same question is not counted twice.
    expect((await post('/checkout/why', { answer: 'other' }, shopper.authHeader)).statusCode).toBe(
      409,
    );
    // Not asked again within the day, even after leaving another checkout.
    harness.setNow(new Date('2026-10-30T20:00:00.000Z'));
    expect((await post('/checkout/why/ask', {}, shopper.authHeader)).json().ask).toBe(false);
    harness.setNow(new Date('2026-10-31T10:30:00.000Z'));
    expect((await post('/checkout/why/ask', {}, shopper.authHeader)).json().ask).toBe(true);
  });

  it('may be skipped: asked and not answered, nothing more is kept', async () => {
    await post('/checkout/why/ask', {}, shopper.authHeader);
    expect((await events('checkout_reason')).filter((row) => row.answer)).toHaveLength(0);
    expect((await post('/checkout/why/ask', {}, shopper.authHeader)).json().ask).toBe(false);
  });

  it('cannot be answered without being asked', async () => {
    expect((await post('/checkout/why', { answer: 'price' }, shopper.authHeader)).statusCode).toBe(
      409,
    );
  });
});

/** A made-up checkout row for the sums. */
function row(
  kind: AnalyticsEvent['kind'],
  shopperKey: string,
  minutes: number,
  extra: Partial<AnalyticsEvent> = {},
): AnalyticsEvent {
  return {
    id: `${kind}-${shopperKey}-${minutes}`,
    at: new Date(Date.UTC(2026, 9, 30, 9, 0) + minutes * 60_000),
    kind,
    shopperKey,
    runnerKey: null,
    shop: null,
    area: null,
    toArea: 'ME7',
    ageBand: null,
    viaOrganisation: false,
    itemCount: 0,
    goodsPence: 0,
    categories: '',
    query: null,
    travelMode: null,
    totalPence: 1500,
    restaurant: false,
    noRunnerWarning: false,
    returning: false,
    channel: 'web',
    answer: null,
    ...extra,
  };
}

describe('the sums', () => {
  const settings = {
    totalBandsPence: [2000, 4000, 6000],
    periodsDays: [7, 30, 90],
    sameCheckoutMinutes: 30,
    paidWithinHours: 2,
    askOncePerHours: 24,
  };

  it('counts views close together as one checkout, paid when that Shopper paid soon after', () => {
    const checkouts = checkoutsFrom(
      [
        row('checkout_viewed', 'a', 0),
        row('checkout_viewed', 'a', 10),
        row('checkout_viewed', 'a', 300),
      ],
      [row('checkout_paid', 'a', 20)],
      settings,
    );
    expect(checkouts.map((checkout) => checkout.paid)).toEqual([true, false]);
  });

  it('puts totals in the bands from config', () => {
    expect(bandOf(1999, settings.totalBandsPence)).toBe(0);
    expect(bandOf(2000, settings.totalBandsPence)).toBe(1);
    expect(bandOf(5999, settings.totalBandsPence)).toBe(2);
    expect(bandOf(6000, settings.totalBandsPence)).toBe(3);
  });

  it('counts viewed, paid and abandoned, by band, kind, warning, new or returning, and why', () => {
    const insights = checkoutInsights(
      [
        row('checkout_viewed', 'a', 0, { totalPence: 1500 }),
        row('checkout_paid', 'a', 5),
        row('checkout_viewed', 'b', 0, {
          totalPence: 2500,
          restaurant: true,
          noRunnerWarning: true,
        }),
        row('checkout_viewed', 'c', 0, { totalPence: 4500, returning: true }),
        row('checkout_paid', 'c', 30),
        row('checkout_viewed', 'd', 0, { totalPence: 7000, channel: 'phone' }),
        row('checkout_reason', 'b', 1, { answer: null }),
        row('checkout_reason', 'b', 2, { answer: 'price' }),
        row('checkout_reason', 'd', 2, { answer: 'no_runner' }),
      ],
      7,
      settings,
      '£',
    );
    expect(insights).toMatchObject({ viewed: 4, paid: 2, abandoned: 2, paidPercent: 50 });
    expect(insights.byTotal).toEqual([
      { label: 'Under £20', viewed: 1, paid: 1, abandoned: 0, paidPercent: 100 },
      { label: '£20 to £40', viewed: 1, paid: 0, abandoned: 1, paidPercent: 0 },
      { label: '£40 to £60', viewed: 1, paid: 1, abandoned: 0, paidPercent: 100 },
      { label: 'Over £60', viewed: 1, paid: 0, abandoned: 1, paidPercent: 0 },
    ]);
    expect(insights.byKind[0]).toMatchObject({ label: 'Restaurant', viewed: 1, abandoned: 1 });
    expect(insights.byKind[1]).toMatchObject({ label: 'Groceries', viewed: 3, paid: 2 });
    expect(insights.byWarning[0]).toMatchObject({ viewed: 1, abandoned: 1 });
    expect(insights.byShopper[0]).toMatchObject({
      label: 'Returning Shoppers',
      viewed: 1,
      paid: 1,
    });
    expect(insights.byShopper[1]).toMatchObject({ label: 'New Shoppers', viewed: 3, paid: 1 });
    expect(insights.byChannel[2]).toMatchObject({ label: 'By telephone', viewed: 1 });
    // Fewer than 10 Shoppers in ME7: counted with the other small areas, nobody picked out.
    expect(insights.byArea).toEqual([
      expect.objectContaining({ label: 'Areas with fewer than 10 Shoppers', viewed: 4 }),
    ]);
    expect(insights.reasons).toEqual([
      { answer: 'price', label: 'The price', count: 1 },
      { answer: 'looking', label: 'Just looking', count: 0 },
      { answer: 'no_runner', label: 'No Runner in my area', count: 1 },
      { answer: 'other', label: 'Something else', count: 0 },
    ]);
    expect(insights.summary).toBe(
      'In the last 7 days, 4 checkouts were viewed and 2 paid, 50%. 2 were left without paying.',
    );
  });
});

describe('the Checkout insights page', () => {
  it('is for the founder and the operations manager only', async () => {
    expect((await get('/staff/checkout-insights?days=7', STAFF)).statusCode).toBe(200);
    expect(
      (await get('/staff/checkout-insights', await staffToken('operations_manager', 'ngozi')))
        .statusCode,
    ).toBe(200);
    expect(
      (await get('/staff/checkout-insights', await staffToken('partnerships', 'tunde'))).statusCode,
    ).toBe(403);
    expect(
      (await get('/staff/checkout-insights', await staffToken('customer_care', 'kemi'))).statusCode,
    ).toBe(403);
    expect((await get('/staff/checkout-insights')).statusCode).toBe(403);
  });

  it('shows the numbers for 7, 30 or 90 days, and no other period', async () => {
    await post('/checkout/viewed', VIEW, shopper.authHeader);
    await post(
      '/checkout/viewed',
      { ...VIEW, totalPence: 6500, restaurant: true },
      shopper.authHeader,
    );
    harness.setNow(new Date('2026-10-30T12:00:00.000Z'));
    const week = (await get('/staff/checkout-insights?days=7', STAFF)).json();
    // Two views within half an hour by one Shopper are one checkout: the last one shown.
    expect(week).toMatchObject({ days: 7, viewed: 1, paid: 0, abandoned: 1, periods: [7, 30, 90] });
    expect(week.byTotal[3]).toMatchObject({ label: 'Over £60', viewed: 1 });
    expect(week.byKind[0]).toMatchObject({ label: 'Restaurant', viewed: 1 });
    harness.setNow(new Date('2026-11-20T12:00:00.000Z'));
    expect((await get('/staff/checkout-insights?days=7', STAFF)).json().viewed).toBe(0);
    expect((await get('/staff/checkout-insights?days=30', STAFF)).json().viewed).toBe(1);
    expect((await get('/staff/checkout-insights?days=14', STAFF)).statusCode).toBe(400);
  });
});
