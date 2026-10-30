/**
 * Areas, Runner location and local jobs, and the last checks before a job (Anthony, 30 October
 * 2026). Every area is open (30 October 2026): nobody is refused for where they are. Where there
 * is no approved Runner yet, or the area is paused, a Shopper is warned only as they order, and is
 * texted once when a Runner joins. Jobs go only to Runners in the same area, nearest first.
 * Nobody is offered a job before their face photo is accepted.
 *
 * No test here reaches the network: postcodes.io is a stand-in.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { areaOf } from '@aldilivery/core';

import type { Order } from '../src/domain.js';
import { STAFF_ROLES } from '../src/lib/staff.js';
import { areaWarning } from '../src/services/allocate.js';
import { locatePostcode, sweepAreas } from '../src/services/areas.js';
import { inJobArea, offerOrder } from '../src/services/dispatch.js';
import { mayBeAssigned } from '../src/services/order-rescue.js';
import { mayBeOffered } from '../src/services/runner-pool.js';
import { decideRunnerDocument } from '../src/services/runner-documents.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

// 11:00 in London: not the quiet hours for texts.
const START = new Date('2026-10-30T11:00:00.000Z');

/** Places a stand-in postcodes.io knows. */
const PLACES: Record<string, { latitude: number; longitude: number }> = {
  'ME7 1AA': { latitude: 51.3891, longitude: 0.5469 },
  // About four miles off: outside the near band (dispatch.nearBandMiles), inside the radius.
  'ME7 2BB': { latitude: 51.33, longitude: 0.55 },
  'M1 1AE': { latitude: 53.4808, longitude: -2.2426 },
  'B1 1AA': { latitude: 52.4862, longitude: -1.8904 },
};

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;
let lookups: string[];

async function build(options: { failLookups?: boolean } = {}) {
  texts = [];
  lookups = [];
  return buildTestApp(START, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    findPostcode: async (postcode) => {
      lookups.push(postcode);
      if (options.failLookups) throw new Error('postcodes.io cannot be reached');
      return PLACES[postcode] ?? null;
    },
  });
}

beforeEach(async () => {
  harness = await build();
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

/** An order straight into the state a test needs. */
async function paidOrder(
  shopper: SignedInShopper,
  address: string,
  patch: Partial<Order> = {},
): Promise<Order> {
  const order = await harness.repository.orders.create({
    shopperId: shopper.shopperId,
    goodsEstimatePence: 250,
    feePence: 1350,
    totalEstimatePence: 1600,
    deliveryAddress: address,
    paymentMethodId: shopper.paymentMethodId,
    items: [{ name: 'Milk', quantity: 1, estimatedPricePence: 250 }],
  });
  return harness.repository.orders.update(order.id, { status: 'paid', ...patch });
}

describe('what an area is', () => {
  it('is the letters of the postcode, with the London areas as one', () => {
    const settings = harness.config.areas;
    expect(areaOf('12 Example Street, Gillingham ME7 1AA', settings)).toBe('ME');
    expect(areaOf('M1 1AE', settings)).toBe('M');
    expect(areaOf('AB10 1XG', settings)).toBe('AB');
    expect(areaOf('CF10 1EP', settings)).toBe('CF');
    expect(areaOf('BT1 5GS', settings)).toBe('BT');
    for (const postcode of ['E1 6AN', 'EC1A 1BB', 'N1 9GU', 'NW1 6XE', 'SE1 7PB', 'SW1A 1AA']) {
      expect(areaOf(postcode, settings)).toBe('London');
    }
    expect(areaOf('W1A 1AA', settings)).toBe('London');
    expect(areaOf('WC2N 5DU', settings)).toBe('London');
    expect(areaOf('12 Example Street, Birmingham', settings)).toBeNull();
  });

  it('is called by its configured name, or by its letters when it has none', async () => {
    const known = await get('/areas/check?postcode=M1%201AE');
    expect(known.json()).toMatchObject({ area: 'M', name: 'Manchester', hasRunner: false });
    const unknown = await get('/areas/check?postcode=ZZ1%201ZZ');
    expect(unknown.json()).toMatchObject({ area: 'ZZ', name: 'ZZ' });
    expect((await get('/areas/check?postcode=hello')).statusCode).toBe(400);
  });
});

describe('every area is open', () => {
  it('says yes to anybody asking, and only whether there is a Runner yet', async () => {
    // Medway has shops from config/shops-seed.json, but no Runner yet.
    let check = (await get('/areas/check?postcode=ME7%201AA')).json();
    expect(check).toMatchObject({
      area: 'ME',
      name: 'Medway',
      hasRunner: false,
      paused: false,
      warn: true,
    });
    expect(check.words).toBe(harness.config.areas.openWords.replace('{area}', 'Medway'));
    expect(check.warning).toBe(harness.config.areas.noRunnerWords);
    expect(JSON.stringify(check)).not.toMatch(/isn't running|not running/i);

    // A Runner waiting for approval does not count.
    await signUpRunner(harness, { verified: false });
    expect((await get('/areas/check?postcode=ME7%201AA')).json().hasRunner).toBe(false);

    await signUpRunner(harness, { phone: '+447700900102' });
    check = (await get('/areas/check?postcode=ME7%201AA')).json();
    expect(check).toMatchObject({ hasRunner: true, warn: false });
    expect(check.warning).toBeUndefined();

    // Manchester has a Runner and no shop: a shop is not needed for anything any more.
    await signUpRunner(harness, { phone: '+447700900103', homePostcode: 'M1 1AE' });
    expect((await get('/areas/check?postcode=M1%201AE')).json()).toMatchObject({
      hasRunner: true,
      warn: false,
    });
  });

  it('can be paused and unpaused by staff with the Areas tab, which warns but blocks nothing', async () => {
    await signUpRunner(harness);
    await signUpRunner(harness, { phone: '+447700900102', verified: false });
    await signUpShopper(harness);
    expect((await get('/areas/check?postcode=ME7%201AA')).json().warn).toBe(false);

    const paused = await post('/staff/areas/ME/pause', { paused: true, by: 'Kemi' }, STAFF);
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json().message).toBe(
      'Medway is paused. Shoppers there can still order, and are warned as they do.',
    );
    expect((await get('/areas/check?postcode=ME7%201AA')).json()).toMatchObject({
      hasRunner: true,
      paused: true,
      warn: true,
    });

    const list = (await get('/staff/areas', STAFF)).json().areas;
    const medway = list.find((row: { area: string }) => row.area === 'ME');
    expect(medway).toMatchObject({
      name: 'Medway',
      paused: true,
      hasRunner: true,
      statusWords: 'Paused',
      runnersApproved: 1,
      runnersWaiting: 1,
      pausedBy: 'Kemi',
    });
    expect(medway.shopsApproved).toBeGreaterThan(0);
    expect(medway).not.toHaveProperty('ready');
    expect(medway).not.toHaveProperty('running');

    const unpaused = await post('/staff/areas/ME/pause', { paused: false, by: 'Kemi' }, STAFF);
    expect(unpaused.json().message).toBe('Medway is no longer paused.');
    expect((await get('/areas/check?postcode=ME7%201AA')).json().warn).toBe(false);

    // Only staff whose job has the Areas tab.
    expect(STAFF_ROLES.founder.areas).toContain('areas');
    expect(STAFF_ROLES.operations_manager.areas).toContain('areas');
    expect(STAFF_ROLES.customer_care.areas).not.toContain('areas');
    expect((await get('/staff/areas')).statusCode).not.toBe(200);
  });

  it('lists the most active areas first, each with whether it has a Runner', async () => {
    const shopper = await signUpShopper(harness);
    await signUpRunner(harness, { homePostcode: 'M1 1AE' });
    await paidOrder(shopper, '1 Market Street, Manchester M1 1AE');
    await paidOrder(shopper, '1 Market Street, Manchester M1 1AE');
    await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA');

    const list = (await get('/staff/areas', STAFF)).json().areas as Array<{
      area: string;
      statusWords: string;
      ordersToday: number;
      ordersThisWeek: number;
    }>;
    expect(list[0]).toMatchObject({ area: 'M', ordersToday: 2, ordersThisWeek: 2 });
    expect(list[0]!.statusWords).toBe('Has a Runner (driver)');
    expect(list.find((row) => row.area === 'ME')!.statusWords).toBe('No Runner (driver) yet');
  });
});

describe('a Shopper where there is no Runner yet', () => {
  async function placeOrder(shopper: SignedInShopper, address: string) {
    const items = await seedCatalogue(harness.repository);
    return post(
      '/orders',
      {
        lines: [
          { catalogueItemId: items.milk, quantity: 2 },
          { catalogueItemId: items.bread, quantity: 1 },
        ],
        deliveryAddress: address,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 89 + 150 + 1099,
        },
      },
      shopper.authHeader,
    );
  }

  it('signs up with no word about Runners or areas: the warning is only for ordering', async () => {
    const signedUp = await post('/shoppers', {
      displayName: 'Margaret',
      phone: '+447700900001',
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
    });
    expect(signedUp.statusCode, signedUp.body).toBe(201);
    expect(signedUp.json()).not.toHaveProperty('area');
    expect(signedUp.body).not.toContain(harness.config.areas.noRunnerWords);
    expect(signedUp.body).not.toMatch(/isn't running|not running/i);

    // Changing an address is not ordering either: nobody is noted as warned.
    const shopper = await signUpShopper(harness, { phone: '+447700900002' });
    await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: shopper.authHeader,
      payload: { deliveryAddress: '1 Market Street, Manchester M1 1AE' },
    });
    expect(await harness.repository.areaWaiting.list()).toHaveLength(0);
  });

  it('is never refused: the order is sent and paid, and they are texted once when a Runner joins', async () => {
    const shopper = await signUpShopper(harness, { phone: '+447700900002' });
    const placed = await placeOrder(shopper, '3 Other Road, Chatham ME4 4AA');
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.body).not.toMatch(/isn't running|not running|Nothing has been charged/i);
    expect(
      harness.payments.calls.filter((call) => call.kind === 'payment_intent').length,
    ).toBeGreaterThan(0);
    const waiting = await harness.repository.areaWaiting.list();
    expect(waiting).toMatchObject([{ area: 'ME', shopperId: shopper.shopperId }]);

    // Warned on the screen as well: still once.
    await post('/me/area/warned', { address: '3 Other Road, Chatham ME4 4AA' }, shopper.authHeader);
    expect(await harness.repository.areaWaiting.list()).toHaveLength(1);

    // Nothing is texted while there is no Runner.
    expect(await sweepAreas(harness.app.ctx)).toBe(0);

    // A Runner is approved: each Shopper warned there is texted once.
    await signUpRunner(harness);
    const joined = () =>
      texts.filter((text) =>
        text.body.includes('A Runner (driver) has joined in your area. You can order now.'),
      );
    expect(await sweepAreas(harness.app.ctx)).toBe(1);
    expect(joined()).toEqual([
      {
        to: '+447700900002',
        body: `${harness.config.productName}: A Runner (driver) has joined in your area. You can order now.`,
      },
    ]);
    expect(await sweepAreas(harness.app.ctx)).toBe(0);
    expect(joined()).toHaveLength(1);
  });

  it('is not texted in the quiet hours, only after them', async () => {
    const shopper = await signUpShopper(harness);
    expect((await placeOrder(shopper, '12 Example Street, Gillingham ME7 1AA')).statusCode).toBe(
      201,
    );
    await signUpRunner(harness);
    harness.setNow(new Date('2026-10-30T22:30:00.000Z'));
    expect(await sweepAreas(harness.app.ctx)).toBe(0);
    harness.setNow(new Date('2026-10-31T09:30:00.000Z'));
    expect(await sweepAreas(harness.app.ctx)).toBe(1);
  });

  it('is not texted while the area is paused, even with a Runner', async () => {
    await signUpRunner(harness);
    await post('/staff/areas/ME/pause', { paused: true, by: 'Kemi' }, STAFF);
    const shopper = await signUpShopper(harness);
    const warned = await post(
      '/me/area/warned',
      { address: '12 Example Street, Gillingham ME7 1AA' },
      shopper.authHeader,
    );
    expect(warned.json()).toEqual({ noted: true });
    expect(await sweepAreas(harness.app.ctx)).toBe(0);
    await post('/staff/areas/ME/pause', { paused: false, by: 'Kemi' }, STAFF);
    expect(await sweepAreas(harness.app.ctx)).toBe(1);
  });

  it('can ask about its own area: { area, name, hasRunner, paused }', async () => {
    const shopper = await signUpShopper(harness);
    await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: shopper.authHeader,
      payload: { deliveryAddress: '1 Market Street, Manchester M1 1AE' },
    });
    const mine = (await get('/me/area', shopper.authHeader)).json();
    expect(mine).toMatchObject({
      area: 'M',
      name: 'Manchester',
      hasRunner: false,
      paused: false,
      warn: true,
    });
    // Or of the address an order goes to.
    await signUpRunner(harness);
    const there = (await get('/me/area?postcode=ME7%201AA', shopper.authHeader)).json();
    expect(there).toMatchObject({ area: 'ME', hasRunner: true, warn: false });
  });
});

describe('a telephone order paid by link where there is no Runner yet', () => {
  it('goes ahead as normal: paid, not given back, not cancelled', async () => {
    const shopper = await signUpShopper(harness, { phone: '+447700900888' });
    await harness.repository.shoppers.update(shopper.shopperId, { deliveryAddress: '' });
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      status: 'confirmed',
      goodsEstimatePence: 89,
      feePence: 1099,
      totalEstimatePence: 1239,
      deliveryAddress: '',
      items: [],
    });
    const before = harness.payments.calls.filter((call) => call.kind === 'refund').length;
    // The rehearsal payment page gives an Aberdeen (AB) address, where there is no Runner yet.
    const paid = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'rehearsal' },
      payload: JSON.stringify({
        id: 'evt_link_far',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_rehearsal_far', metadata: { orderId: order.id } } },
      }),
    });
    expect(paid.statusCode, paid.body).toBe(200);
    const after = await harness.repository.orders.findById(order.id);
    expect(after?.status).toBe('paid');
    expect(after?.deliveryAddress).toMatch(/AB\d/);
    expect(harness.payments.calls.filter((call) => call.kind === 'refund')).toHaveLength(before);
  });
});

describe('a Shopper inviting a driver', () => {
  it('has a referral link that lands on Runner sign-up and records them on the new Runner', async () => {
    await harness.close();
    harness = await buildTestApp(START, { env: { primaryOrigin: 'https://shop.example.test' } });
    const shopper = await signUpShopper(harness);
    const handle = (await harness.repository.shoppers.findById(shopper.shopperId))!.handle;
    const share = (await get('/share', shopper.authHeader)).json();
    expect(share.runnerLink).toBe(`https://shop.example.test/runner/sign-up?via=shopper-${handle}`);

    const response = await post('/runners', {
      name: 'Tomasz',
      phone: '+447700900101',
      adult: true,
      homePostcode: 'ME7 1AA',
      referredBy: `shopper-${handle}`,
    });
    expect(response.statusCode, response.body).toBe(201);
    const runner = await harness.repository.runners.findById(response.json().runner.id);
    expect(runner?.referredBy).toBe(`shopper:${handle}`);

    // A handle nobody has is not kept.
    const stranger = await post('/runners', {
      name: 'Jo',
      phone: '+447700900102',
      adult: true,
      homePostcode: 'ME7 1AA',
      referredBy: 'shopper-nobody-at-all',
    });
    expect(stranger.statusCode).toBe(201);
    expect(
      (await harness.repository.runners.findById(stranger.json().runner.id))?.referredBy,
    ).toBeNull();
  });
});

describe('postcodes into places', () => {
  it('asks postcodes.io once when a postcode is saved, and keeps the answer', async () => {
    expect(await locatePostcode(harness.app.ctx, '12 Example Street, ME7 1AA')).toEqual(
      PLACES['ME7 1AA'],
    );
    expect(await locatePostcode(harness.app.ctx, 'me71aa')).toEqual(PLACES['ME7 1AA']);
    expect(lookups).toEqual(['ME7 1AA']);
    // An address with no postcode asks nobody.
    expect(await locatePostcode(harness.app.ctx, '12 Example Street')).toBeNull();
    expect(lookups).toHaveLength(1);
  });

  it('never stops a sign-up when postcodes.io cannot be reached', async () => {
    await harness.close();
    harness = await build({ failLookups: true });
    const response = await post('/runners', {
      name: 'Tomasz',
      phone: '+447700900101',
      adult: true,
      homePostcode: 'ME7 1AA',
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(await locatePostcode(harness.app.ctx, 'ME7 1AA')).toBeNull();
    // Still in Medway, from the letters.
    expect((await get('/areas/check?postcode=ME7%201AA')).json().area).toBe('ME');
  });
});

describe('signing up to run', () => {
  it('needs the 18 or over tick and a home postcode, and keeps both', async () => {
    const without = await post('/runners', { name: 'Tomasz', phone: '+447700900101' });
    expect(without.statusCode).toBe(400);
    expect(without.body).toContain('18 or over');

    const noPostcode = await post('/runners', {
      name: 'Tomasz',
      phone: '+447700900101',
      adult: true,
    });
    expect(noPostcode.statusCode).toBe(400);

    const response = await post('/runners', {
      name: 'Tomasz',
      phone: '+447700900101',
      adult: true,
      homePostcode: 'me7 1aa',
    });
    expect(response.statusCode, response.body).toBe(201);
    const stored = await harness.repository.runners.findById(response.json().runner.id);
    expect(stored?.adultConfirmedAt).toEqual(START);
    expect(stored?.homePostcode).toBe('ME7 1AA');
  });

  it('lets a Runner who signed up earlier give their home postcode', async () => {
    const runner = await signUpRunner(harness);
    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/runners/me/home-postcode',
      headers: runner.authHeader,
      payload: { postcode: 'm1 1ae' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ homePostcode: 'M1 1AE', area: 'M' });
    expect(saved.json().message).toContain('Manchester');
  });
});

describe('where a Runner is', () => {
  it('is kept only while on shift or on a job, with the time', async () => {
    const runner = await signUpRunner(harness, { verified: false });
    const off = await post(
      '/runners/me/location',
      { latitude: 51.39, longitude: 0.55 },
      runner.authHeader,
    );
    expect(off.json().kept).toBe(false);
    expect((await harness.repository.runners.findById(runner.runnerId))?.locationAt).toBeNull();

    await harness.repository.runners.update(runner.runnerId, { available: true });
    harness.setNow(new Date(START.getTime() + 60_000));
    const on = await post(
      '/runners/me/location',
      { latitude: 51.39, longitude: 0.55 },
      runner.authHeader,
    );
    expect(on.json().kept).toBe(true);
    const stored = await harness.repository.runners.findById(runner.runnerId);
    expect(stored).toMatchObject({ latitude: 51.39, longitude: 0.55 });
    expect(stored?.locationAt).toEqual(new Date(START.getTime() + 60_000));
  });

  it('shows staff when a Runner on a job was last seen, with a maps link', async () => {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA', {
      status: 'shopping',
      runnerId: runner.runnerId,
    });
    await post('/runners/me/location', { latitude: 51.39, longitude: 0.55 }, runner.authHeader);
    const row = (await get('/staff/runners/now', STAFF))
      .json()
      .runners.find((entry: { id: string }) => entry.id === runner.runnerId);
    expect(row.lastSeenAt).toBe(START.toISOString());
    expect(row.mapsLink).toBe('https://www.google.com/maps/search/?api=1&query=51.390000,0.550000');
  });
});

describe('local jobs', () => {
  it('offers a job only to Runners in the same area, nearest first', async () => {
    const shopper = await signUpShopper(harness);
    // On shift in Manchester, right by nothing in Medway.
    await signUpRunner(harness, { name: 'Far', phone: '+447700900102', homePostcode: 'M1 1AE' });
    const further = await signUpRunner(harness, {
      name: 'Further',
      phone: '+447700900103',
      latitude: 51.42,
      longitude: 0.55,
    });
    const nearer = await signUpRunner(harness, {
      name: 'Nearer',
      phone: '+447700900104',
      latitude: 51.389,
      longitude: 0.547,
    });
    const order = await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA', {
      latitude: 51.3891,
      longitude: 0.5469,
    });
    const result = await offerOrder(harness.app.ctx, order.id);
    expect(result.offer?.runnerId).toBe(nearer.runnerId);
    expect(result.offer && 'queueLength' in result ? result.queueLength : 0).toBe(2);
    expect(further.runnerId).not.toBe(nearer.runnerId);
  });

  it('never offers a job in another area, nor to a Runner with no home postcode', async () => {
    const shopper = await signUpShopper(harness);
    await signUpRunner(harness, { homePostcode: 'M1 1AE' });
    const noHome = await signUpRunner(harness, { phone: '+447700900102' });
    await harness.repository.runners.update(noHome.runnerId, { homePostcode: '' });
    const order = await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA');
    const result = await offerOrder(harness.app.ctx, order.id);
    expect(result.offer).toBeNull();
    // With no home postcode they get no jobs at all, not even at an address with no postcode.
    const runner = await harness.repository.runners.findById(noHome.runnerId);
    if (!runner) throw new Error('missing runner');
    expect(inJobArea(harness.app.ctx.config, runner, { deliveryAddress: 'The Old Mill' })).toBe(
      false,
    );
  });

  it('uses the home postcode’s place when the live position is old', async () => {
    const shopper = await signUpShopper(harness);
    await locatePostcode(harness.app.ctx, 'ME7 2BB');
    await locatePostcode(harness.app.ctx, 'ME7 1AA');
    // Said it was next door two hours ago; lives four miles off.
    const stale = await signUpRunner(harness, {
      name: 'Stale',
      phone: '+447700900102',
      homePostcode: 'ME7 2BB',
      latitude: 51.3891,
      longitude: 0.5469,
    });
    await harness.repository.runners.update(stale.runnerId, {
      locationAt: new Date(START.getTime() - 2 * 3600_000),
    });
    // Lives right at the door, and has not shared anything.
    const home = await signUpRunner(harness, { name: 'Home', phone: '+447700900103' });
    await harness.repository.runners.update(home.runnerId, { locationAt: null });

    const order = await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA');
    const result = await offerOrder(harness.app.ctx, order.id);
    expect(result.offer?.runnerId).toBe(home.runnerId);
    expect(result.offer?.distanceMiles).toBe(0);
  });

  it('warns the office when it sends a job to a Runner in another area, but lets it', async () => {
    const shopper = await signUpShopper(harness);
    const runner = await signUpRunner(harness, { homePostcode: 'M1 1AE' });
    const stored = (await harness.repository.runners.findById(runner.runnerId))!;
    const order = await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA');
    expect(areaWarning(harness.app.ctx, stored, order)).toBe(
      'Tomasz is in Manchester, and this order is in Medway',
    );
    const local = await paidOrder(shopper, '1 Market Street, Manchester M1 1AE');
    expect(areaWarning(harness.app.ctx, stored, local)).toBeNull();
  });
});

describe('the face photo before any job', () => {
  it('is needed to be offered, given or to take a job, and counts once accepted', async () => {
    const runner = await signUpRunner(harness);
    await harness.repository.runners.update(runner.runnerId, { facePhotoAcceptedAt: null });
    let stored = (await harness.repository.runners.findById(runner.runnerId))!;
    expect(mayBeOffered(stored, START)).toBe(false);
    expect(mayBeAssigned(stored)).toBe(false);

    const shopper = await signUpShopper(harness);
    const order = await paidOrder(shopper, '12 Example Street, Gillingham ME7 1AA');
    expect((await offerOrder(harness.app.ctx, order.id)).offer).toBeNull();

    // An offer made anyway cannot be taken.
    const offer = await harness.repository.offers.create({
      orderId: order.id,
      runnerId: runner.runnerId,
      expiresAt: new Date(START.getTime() + 60_000),
      queuePosition: 0,
    });
    const taken = await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
    expect(taken.statusCode).toBe(403);
    expect(taken.json().error.message).toContain('finish your checks');
    await harness.repository.offers.update(offer.id, { outcome: 'expired' });

    // A person accepts the face photo.
    const photo = await harness.repository.runnerDocuments.create({
      runnerId: runner.runnerId,
      kind: 'face_photo',
      image: Buffer.from('face'),
      contentType: 'image/jpeg',
      shareCode: null,
      expiresOn: null,
      status: 'submitted',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: START,
    });
    await decideRunnerDocument(harness.app.ctx, photo, { decision: 'accept', by: 'Kemi' });
    stored = (await harness.repository.runners.findById(runner.runnerId))!;
    expect(stored.facePhotoAcceptedAt).toEqual(START);
    expect(mayBeOffered(stored, START)).toBe(true);
    expect(mayBeAssigned(stored)).toBe(true);
  });
});
