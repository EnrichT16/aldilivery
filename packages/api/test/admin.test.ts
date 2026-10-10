/**
 * The admin panel's missing parts (Section Q, docs/STILL_TO_DO.md item 12): orders live and
 * past with their timelines, Runners working now and their earnings, signups by period,
 * cancellations and refunds with reasons, price freshness, and, for the owner alone, opening
 * a Shopper's account, refunds above a threshold, and exporting a Shopper's data.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csvField } from '../src/routes/admin.js';
import {
  STAFF,
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

const NOW = new Date('2026-10-14T10:00:00.000Z');

beforeEach(async () => {
  harness = await buildTestApp(NOW, { autoOffer: true });
  items = await seedCatalogue(harness.repository);
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function placeOrder(shopper: SignedInShopper, milk = 2): Promise<string> {
  const placed = await post(
    '/orders',
    {
      lines: [{ catalogueItemId: items.milk, quantity: milk }],
      deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: milk * 175 + (milk * 125 <= 1500 ? 799 : 1350),
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json().order.id as string;
}

async function ownerHeaders(): Promise<Record<string, string>> {
  await post('/staff/owner', {
    name: 'Anthony',
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

async function staffHeaders(role: string, username: string): Promise<Record<string, string>> {
  const made = await post('/staff/team', { name: username, username, role });
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', { username, password: made.json().password });
  return { 'x-staff-token': signedIn.json().token as string };
}

describe('orders, live and past', () => {
  it('lists live orders, finds one by the Shopper’s name, and opens its timeline', async () => {
    const runner = await signUpRunner(harness);
    const margaret = await signUpShopper(harness, { displayName: 'Margaret Okafor' });
    const live = await placeOrder(margaret);
    const offer = (await harness.repository.offers.listForOrder(live))[0]!;
    await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);

    const care = await staffHeaders('customer_care', 'chidi');
    const list = await get('/staff/orders?view=live', care);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().orders).toEqual([
      expect.objectContaining({
        id: live,
        status: 'accepted',
        statusWords: 'A Runner has it',
        shopperName: 'Margaret Okafor',
        area: 'ME7',
        itemCount: 2,
      }),
    ]);
    // Past orders are a separate list; this one is not there yet.
    expect((await get('/staff/orders?view=past', care)).json().orders).toEqual([]);
    expect((await get('/staff/orders?view=all&search=okafor', care)).json().orders).toHaveLength(1);
    expect((await get('/staff/orders?view=all&search=nobody', care)).json().orders).toHaveLength(0);
    expect((await get('/staff/orders?status=delivered', care)).json().orders).toHaveLength(0);

    const detail = await get(`/staff/orders/${live}`, care);
    expect(detail.statusCode, detail.body).toBe(200);
    const said = detail.json().timeline.map((event: { what: string }) => event.what);
    expect(said[0]).toBe('The order was started.');
    expect(said).toEqual(
      expect.arrayContaining([
        'The Shopper said yes to send it and pay, by button.',
        expect.stringMatching(/^Offered to /),
        expect.stringMatching(/accepted it\.$/),
      ]),
    );
    // The full address is not shown here: only the owner opens a Shopper's account.
    expect(detail.body).not.toContain('12 Example Street');
  });

  it('filters by the day an order was made', async () => {
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await harness.repository.orders.update(orderId, { createdAt: NOW });
    const day = (from: string, to: string) =>
      get(`/staff/orders?view=all&from=${from}&to=${to}`).then((r) => r.json().orders.length);
    expect(await day('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z')).toBe(1);
    expect(await day('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z')).toBe(0);
  });

  it('is not part of every job', async () => {
    const onboarding = await staffHeaders('onboarding', 'tunde');
    expect((await get('/staff/orders', onboarding)).statusCode).toBe(403);
  });
});

describe('Runners working now', () => {
  it('shows who is on shift or on a job, and what each has earned', async () => {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
    await harness.repository.payouts.create({
      orderId: 'an-earlier-order',
      runnerId: runner.runnerId,
      earnedPence: 500,
      coolBagWithheldPence: 100,
      transferredPence: 400,
    });

    const finance = await staffHeaders('finance', 'ngozi');
    const response = await get('/staff/runners/now', finance);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.onAJob).toBe(1);
    expect(body.runners[0]).toEqual(
      expect.objectContaining({
        id: runner.runnerId,
        activeNow: true,
        job: expect.objectContaining({ id: orderId, status: 'accepted' }),
        earnedWeekPence: 500,
        earnedAllTimePence: 500,
      }),
    );
  });
});

describe('signups by period', () => {
  it('counts Shoppers and Runners in each of the last twelve months', async () => {
    await signUpShopper(harness, { phone: '+447700900101' });
    const older = await signUpShopper(harness, { phone: '+447700900102' });
    await harness.repository.shoppers.update(older.shopperId, {
      createdAt: new Date('2026-09-20T10:00:00Z'),
    });
    const runner = await signUpRunner(harness);
    await harness.repository.runners.update(runner.runnerId, { createdAt: NOW });

    const response = await get('/staff/reports/signups?period=month');
    expect(response.statusCode, response.body).toBe(200);
    const buckets = response.json().buckets as Array<{
      label: string;
      shoppers: number;
      runners: number;
    }>;
    expect(buckets).toHaveLength(12);
    expect(buckets.at(-1)).toEqual(
      expect.objectContaining({ label: 'October 2026', shoppers: 1, runners: 1 }),
    );
    expect(buckets.at(-2)).toEqual(
      expect.objectContaining({ label: 'September 2026', shoppers: 1, runners: 0 }),
    );
    const between = (
      await get('/staff/reports/signups?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z')
    ).json().between;
    expect(between).toEqual(expect.objectContaining({ shoppers: 1, runners: 1 }));
    const days = (await get('/staff/reports/signups?period=day')).json().buckets;
    expect(days.at(-1).label).toBe('Wednesday 14 October');
  });
});

describe('cancellations, with reasons', () => {
  it('says why each order was cancelled, and counts them by reason', async () => {
    const shopper = await signUpShopper(harness);
    const draft = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      goodsEstimatePence: 250,
      feePence: 1350,
      totalEstimatePence: 1600,
      deliveryAddress: 'Somewhere ME7 1AA',
      items: [{ name: 'Milk', quantity: 1, estimatedPricePence: 125 }],
    });
    const cancelled = await post(
      `/orders/${draft.id}/status`,
      { status: 'cancelled' },
      shopper.authHeader,
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const other = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      goodsEstimatePence: 250,
      feePence: 1350,
      totalEstimatePence: 1600,
      deliveryAddress: 'Somewhere ME7 1AA',
      items: [],
    });
    await harness.repository.orders.update(other.id, { status: 'cancelled', cancelledAt: NOW });

    const response = await get('/staff/reports/cancellations');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().count).toBe(2);
    expect(response.json().byReason).toEqual(
      expect.arrayContaining([
        { reason: 'The Shopper cancelled before paying.', count: 1 },
        { reason: 'No reason was recorded.', count: 1 },
      ]),
    );
  });
});

describe('refunds', () => {
  async function deliveredOrder(
    milk: number,
  ): Promise<{ orderId: string; shopper: SignedInShopper }> {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper, milk);
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
    await harness.repository.orders.update(orderId, { status: 'delivered', deliveredAt: NOW });
    return { orderId, shopper };
  }

  async function complaint(orderId: string, shopper: SignedInShopper): Promise<string> {
    const made = await post(
      `/orders/${orderId}/problems`,
      { summary: 'The eggs were broken', refundRequestedPence: 0 },
      shopper.authHeader,
    );
    expect(made.statusCode, made.body).toBe(201);
    return made.json().report.id as string;
  }

  it('lists each refund with why it went out; the total is for the owner alone', async () => {
    const { orderId, shopper } = await deliveredOrder(2);
    const reportId = await complaint(orderId, shopper);
    const decided = await post(`/staff/problems/${reportId}/decide`, {
      decision: 'shop_at_fault',
      refundPence: 250,
      note: 'The shop packed them badly.',
      by: 'Kemi',
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const response = await get('/staff/reports/refunds');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.totalPence).toBeNull();
    expect(body.refunds[0]).toEqual(
      expect.objectContaining({
        amountPence: 250,
        orderId,
        group: 'complaints',
        reason: expect.stringContaining('The eggs were broken'),
      }),
    );
    expect(body.refunds[0].reason).toContain('the shop was responsible');

    const owner = await ownerHeaders();
    expect((await get('/staff/reports/refunds', owner)).json().totalPence).toBe(250);
  });

  it('a refund above the threshold is the owner’s alone to give', async () => {
    const { orderId, shopper } = await deliveredOrder(24);
    const reportId = await complaint(orderId, shopper);
    const threshold = harness.config.admin.ownerOnlyRefundAbovePence;
    expect(threshold).toBe(2500);
    const decision = {
      decision: 'platform_at_fault',
      refundPence: threshold + 1,
      note: 'Everything went wrong.',
      by: 'Kemi',
    };
    const refused = await post(`/staff/problems/${reportId}/decide`, decision);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/is for the owner to give/);
    const owner = await ownerHeaders();
    const given = await post(`/staff/problems/${reportId}/decide`, decision, owner);
    expect(given.statusCode, given.body).toBe(200);
  });
});

describe('price freshness', () => {
  it('counts prices by how recently they were seen, oldest first', async () => {
    const old = await harness.repository.catalogue.create({
      name: 'Tinned peaches',
      category: 'Cupboard',
      estimatedPricePence: 60,
      source: 'community',
      lastSeenAt: new Date('2026-08-01T00:00:00Z'),
    });
    const response = await get('/staff/reports/prices');
    expect(response.statusCode, response.body).toBe(200);
    const catalogue = response.json().catalogue;
    expect(catalogue.stale).toBe(1);
    expect(catalogue.oldest[0]).toEqual(expect.objectContaining({ id: old.id }));
    // The age restricted row is never counted: it is never for sale.
    expect(catalogue.total).toBe(5);
  });
});

describe('the owner’s alone', () => {
  it('opens a Shopper’s account and exports their data, and both go in the audit log', async () => {
    const shopper = await signUpShopper(harness, { displayName: '=Sneaky Formula' });
    await placeOrder(shopper);

    // Not the staff key, and not a founder-role account that is not the owner.
    const founder = await staffHeaders('founder', 'kemi');
    for (const headers of [STAFF, founder]) {
      expect((await get(`/staff/shoppers/${shopper.shopperId}`, headers)).statusCode).toBe(403);
      expect(
        (await get(`/staff/shoppers/${shopper.shopperId}/export.csv`, headers)).statusCode,
      ).toBe(403);
      expect((await get('/staff/shoppers?search=sneaky', headers)).statusCode).toBe(403);
    }

    const owner = await ownerHeaders();
    const found = await get('/staff/shoppers?search=sneaky', owner);
    expect(found.json().shoppers).toEqual([expect.objectContaining({ id: shopper.shopperId })]);
    const opened = await get(`/staff/shoppers/${shopper.shopperId}`, owner);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().account.phone).toMatch(/^\+44/);
    expect(opened.json().orders).toHaveLength(1);
    expect(opened.body).not.toMatch(/pinHash|spokenCodeHash|scrypt/);

    const exported = await get(`/staff/shoppers/${shopper.shopperId}/export.csv`, owner);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toMatch(/^text\/csv/);
    expect(exported.headers['content-disposition']).toMatch(/attachment; filename="shopper-/);
    expect(exported.body.split('\r\n')[0]).toBe('"section","entry","field","value"');
    expect(exported.body).toContain(`"account","1","phone","'+44`);
    expect(exported.body).toContain('"orders","1","deliveryAddress","12 Example Street');
    // A name starting with = is never read as a spreadsheet formula.
    expect(exported.body).toContain(`"'=Sneaky Formula"`);

    const log = (await get('/staff/audit', owner)).json().entries as Array<{
      action: string;
      target: string;
      actorName: string;
    }>;
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['shopper.searched', 'shopper.opened', 'shopper.exported']),
    );
    expect(log.find((entry) => entry.action === 'shopper.exported')).toEqual(
      expect.objectContaining({ target: `shopper=${shopper.shopperId}`, actorName: 'Anthony' }),
    );
  });

  it('writes CSV fields safely', () => {
    expect(csvField('plain')).toBe('"plain"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('+44 7700')).toBe(`"'+44 7700"`);
    expect(csvField(null)).toBe('""');
    expect(csvField(new Date('2026-10-14T10:00:00Z'))).toBe('"2026-10-14T10:00:00.000Z"');
  });
});
