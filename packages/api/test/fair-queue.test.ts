/**
 * The fair queue sharpened (ruling 64, Anthony, 16 October 2026), proved through the real routes
 * and the real dispatcher: who an order is offered to, in what order, held for how long, and what
 * a Runner is told about their own place in line.
 *
 * - Earned-today balance: the Runner who has earned least today goes first, then the one who has
 *   waited longest; the Shopper's regular Runner stays first only while within £15 of the lowest
 *   earner on shift.
 * - Chaining: a Runner on their way to the door is offered the job next door before anybody
 *   else, held two minutes, and may say no with nothing held against them.
 * - Distance band first: Runners within a mile and a half are asked first, and the offer widens
 *   after the configured seconds.
 * - Queue position: one plain sentence, and never anybody else's money.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sweepOffers } from '../src/services/dispatch.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

/** Midday in the UK, so "today" is unambiguous whichever way the clock is moved. */
const START = new Date('2026-10-16T11:00:00.000Z');
const HOME = { latitude: 52.4862, longitude: -1.8904 };
/** About 0.35 miles north of home: inside the near band and the chain radius. */
const NEAR = { latitude: HOME.latitude + 0.005, longitude: HOME.longitude };
/** About 0.7 miles north of home: inside the chain radius. */
const NEXT_DOOR = { latitude: HOME.latitude + 0.01, longitude: HOME.longitude };
/** About 3.5 miles north of home: the far band, well outside the chain radius. */
const FAR = { latitude: HOME.latitude + 0.05, longitude: HOME.longitude };

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;
let defaults: { bandSeconds: number; fairShareMaxLeadPence: number };

beforeEach(async () => {
  harness = await buildTestApp(START, { autoOffer: true });
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  defaults = {
    bandSeconds: harness.config.dispatch.bandSeconds,
    fairShareMaxLeadPence: harness.config.dispatch.fairShareMaxLeadPence,
  };
});

afterEach(async () => {
  // A test that tried another figure puts Anthony's back.
  Object.assign(harness.config.dispatch, defaults);
  await harness.close();
});

function later(seconds: number): void {
  harness.setNow(new Date(harness.now().getTime() + seconds * 1000));
}

/** Two pints of milk to a place. The agreed total is the server's own: the plan sets delivery. */
async function placeOrder(where = HOME, agreedTotalPence = 250 + 100 + 799): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
      ...where,
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence,
      },
    },
  });
  if (response.statusCode === 400) {
    const { details } = (response.json() as { error: { details?: { totalPence?: number } } }).error;
    if (details?.totalPence && details.totalPence !== agreedTotalPence) {
      return placeOrder(where, details.totalPence);
    }
  }
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { order: { id: string } }).order.id;
}

async function offersFor(orderId: string) {
  return harness.repository.offers.listForOrder(orderId);
}

async function pendingRunnerFor(orderId: string): Promise<string | undefined> {
  return (await offersFor(orderId)).find((offer) => offer.outcome === 'pending')?.runnerId;
}

/** A Runner on shift at a place, with their last job at a time (never, by default). */
async function runnerAt(
  name: string,
  phone: string,
  where: { latitude: number; longitude: number },
  lastJobCompletedAt: Date | null = null,
): Promise<SignedInRunner> {
  const runner = await signUpRunner(harness, { name, phone, ...where });
  await harness.repository.runners.update(runner.runnerId, { lastJobCompletedAt });
  return runner;
}

/** A job this Runner delivered today, earning this much: what the dashboard would show them. */
async function earnedToday(runner: SignedInRunner, pence: number): Promise<void> {
  const order = await harness.repository.orders.create({
    shopperId: shopper.shopperId,
    status: 'delivered',
    goodsEstimatePence: 100,
    feePence: 799,
    totalEstimatePence: 899,
    deliveryAddress: '1 High Street, Birmingham',
    items: [],
  });
  await harness.repository.orders.update(order.id, {
    runnerId: runner.runnerId,
    deliveredAt: new Date(START.getTime() - 30 * 60_000),
  });
  await harness.repository.payouts.create({
    orderId: order.id,
    runnerId: runner.runnerId,
    earnedPence: pence,
    coolBagWithheldPence: 0,
    transferredPence: pence,
  });
}

async function act(
  runner: SignedInRunner,
  method: 'POST',
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await harness.app.inject({ method, url, headers: runner.authHeader, payload });
  return response;
}

/** Take an offered order and carry it as far as "I am on my way". */
async function setOff(runner: SignedInRunner, orderId: string): Promise<void> {
  const offer = (await offersFor(orderId)).find((row) => row.outcome === 'pending')!;
  expect(offer.runnerId).toBe(runner.runnerId);
  expect((await act(runner, 'POST', `/jobs/${offer.id}/accept`)).statusCode).toBe(200);
  expect(
    (await act(runner, 'POST', `/orders/${orderId}/status`, { status: 'shopping' })).statusCode,
  ).toBe(200);
  expect(
    (await act(runner, 'POST', `/orders/${orderId}/receipt`, { receiptTotalPence: 250 }))
      .statusCode,
  ).toBe(200);
  expect(
    (await act(runner, 'POST', `/orders/${orderId}/status`, { status: 'delivering' })).statusCode,
  ).toBe(200);
}

describe('rule 1: earned-today balance', () => {
  const minutesAgo = (minutes: number) => new Date(START.getTime() - minutes * 60_000);

  it.each([
    {
      name: 'the Runner who has earned least today is offered the job first, however recently they finished',
      ayesha: { earned: 500, lastJob: minutesAgo(180) },
      tomasz: { earned: 0, lastJob: minutesAgo(1) },
      first: 'tomasz',
    },
    {
      name: 'with the same earnings, the Runner who has waited longest since their last job goes first',
      ayesha: { earned: 0, lastJob: minutesAgo(120) },
      tomasz: { earned: 0, lastJob: minutesAgo(1) },
      first: 'ayesha',
    },
    {
      name: 'a Runner who has never had a job has waited longest of all',
      ayesha: { earned: 0, lastJob: minutesAgo(600) },
      tomasz: { earned: 0, lastJob: null },
      first: 'tomasz',
    },
  ])('$name', async ({ ayesha, tomasz, first }) => {
    const runners = {
      ayesha: await runnerAt('Ayesha', '+447700900201', HOME, ayesha.lastJob),
      tomasz: await runnerAt('Tomasz', '+447700900202', HOME, tomasz.lastJob),
    };
    if (ayesha.earned > 0) await earnedToday(runners.ayesha, ayesha.earned);
    if (tomasz.earned > 0) await earnedToday(runners.tomasz, tomasz.earned);

    const orderId = await placeOrder();
    expect(await pendingRunnerFor(orderId)).toBe(runners[first as 'ayesha' | 'tomasz'].runnerId);
  });

  it('counts only today: yesterday’s earnings do not put a Runner behind', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME, minutesAgo(600));
    const tomasz = await runnerAt('Tomasz', '+447700900202', HOME, minutesAgo(1));
    await earnedToday(ayesha, 3000);
    // Said and done yesterday, for the record: moved back a day.
    for (const order of await harness.repository.orders.listForRunner(ayesha.runnerId)) {
      await harness.repository.orders.update(order.id, {
        deliveredAt: new Date(START.getTime() - 24 * 60 * 60_000),
      });
    }
    const orderId = await placeOrder();
    expect(await pendingRunnerFor(orderId)).toBe(ayesha.runnerId);
    expect(tomasz.runnerId).not.toBe(ayesha.runnerId);
  });

  describe('the regular Runner (ruling 58) keeps their preference only within the lead', () => {
    async function onPlusWithRegular(regular: SignedInRunner): Promise<void> {
      await harness.repository.shoppers.update(shopper.shopperId, {
        plan: 'plus',
        planUntil: new Date(START.getTime() + 30 * 24 * 60 * 60_000),
      });
      const past = await harness.repository.orders.create({
        shopperId: shopper.shopperId,
        status: 'delivered',
        goodsEstimatePence: 100,
        feePence: 599,
        totalEstimatePence: 699,
        deliveryAddress: '12 Example Street, Birmingham',
        items: [],
      });
      await harness.repository.orders.update(past.id, {
        runnerId: regular.runnerId,
        // Yesterday, so it is their regular Runner without being today's earnings.
        deliveredAt: new Date(START.getTime() - 24 * 60 * 60_000),
      });
    }

    it.each([
      { lead: 1500, first: 'regular', name: 'exactly £15 ahead: still first' },
      { lead: 1501, first: 'other', name: 'a penny more than £15 ahead: back in the fair order' },
    ])('$name', async ({ lead, first }) => {
      const regular = await runnerAt('Regular', '+447700900201', FAR, minutesAgo(1));
      const other = await runnerAt('Other', '+447700900202', HOME, minutesAgo(1));
      await onPlusWithRegular(regular);
      await earnedToday(regular, lead);

      const orderId = await placeOrder();
      expect(await pendingRunnerFor(orderId)).toBe(
        (first === 'regular' ? regular : other).runnerId,
      );
    });

    it('the lead is changed in one line of configuration', async () => {
      Object.assign(harness.config.dispatch, { fairShareMaxLeadPence: 2000 });
      const regular = await runnerAt('Regular', '+447700900201', FAR, minutesAgo(1));
      await runnerAt('Other', '+447700900202', HOME, minutesAgo(1));
      await onPlusWithRegular(regular);
      await earnedToday(regular, 1800);
      const orderId = await placeOrder();
      expect(await pendingRunnerFor(orderId)).toBe(regular.runnerId);
    });
  });
});

describe('rule 2: chaining from the door', () => {
  it('offers the job next door to the Runner on their way, held two minutes, before the free Runner', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const first = await placeOrder(HOME);
    await setOff(ayesha, first);
    // Tomasz comes on shift, free, right by the second order: the general queue would be his.
    const tomasz = await runnerAt('Tomasz', '+447700900202', NEXT_DOOR);

    const second = await placeOrder(NEXT_DOOR);
    const offer = (await offersFor(second)).find((row) => row.outcome === 'pending')!;
    expect(offer.runnerId).toBe(ayesha.runnerId);
    expect(offer.chained).toBe(true);
    expect(offer.expiresAt.getTime() - harness.now().getTime()).toBe(
      harness.config.dispatch.chainMinutesBeforeDone * 60_000,
    );
    expect(tomasz.runnerId).not.toBe(ayesha.runnerId);

    // Her app shows it as the next job, near where she is, with the no explained.
    const mine = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: ayesha.authHeader,
    });
    const shown = (mine.json() as { offers: Array<Record<string, unknown>> }).offers[0]!;
    expect(shown['chained']).toBe(true);
    expect(shown['chainedWords']).toMatch(/Your next job, near where you are now/);

    // She takes it. The job in hand stays the one she is delivering, until it is delivered.
    expect((await act(ayesha, 'POST', `/jobs/${offer.id}/accept`)).statusCode).toBe(200);
    const current = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: ayesha.authHeader,
    });
    expect(current.json().job).toMatchObject({ orderId: first, status: 'delivering' });
    expect(
      (await act(ayesha, 'POST', `/orders/${first}/status`, { status: 'delivered' })).statusCode,
    ).toBe(200);
    const next = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: ayesha.authHeader,
    });
    expect(next.json().job).toMatchObject({ orderId: second, status: 'accepted' });
  });

  it('is offered the moment they set off, when the job was already waiting', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const first = await placeOrder(HOME);
    const offer = (await offersFor(first))[0]!;
    await act(ayesha, 'POST', `/jobs/${offer.id}/accept`);
    // Nobody is free, so the second order waits.
    const second = await placeOrder(NEXT_DOOR);
    expect(await offersFor(second)).toHaveLength(0);

    await act(ayesha, 'POST', `/orders/${first}/status`, { status: 'shopping' });
    await act(ayesha, 'POST', `/orders/${first}/receipt`, { receiptTotalPence: 250 });
    expect(await offersFor(second)).toHaveLength(0);
    await act(ayesha, 'POST', `/orders/${first}/status`, { status: 'delivering' });
    expect((await offersFor(second))[0]).toMatchObject({
      runnerId: ayesha.runnerId,
      chained: true,
    });
  });

  it('lets them say no with nothing held against them: the job goes to the queue at once', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const first = await placeOrder(HOME);
    await setOff(ayesha, first);
    const tomasz = await runnerAt('Tomasz', '+447700900202', FAR);

    const second = await placeOrder(NEXT_DOOR);
    const chained = (await offersFor(second))[0]!;
    expect((await act(ayesha, 'POST', `/jobs/${chained.id}/decline`)).statusCode).toBe(200);
    const offers = await offersFor(second);
    expect(offers.map((row) => [row.outcome, row.chained])).toEqual([
      ['declined', true],
      ['pending', false],
    ]);
    expect(offers[1]!.runnerId).toBe(tomasz.runnerId);

    // Once delivered and free, she is offered the next order like anybody else.
    await act(ayesha, 'POST', `/orders/${first}/status`, { status: 'delivered' });
    const third = await placeOrder(HOME);
    expect(await pendingRunnerFor(third)).toBe(ayesha.runnerId);
  });

  it('does not chain when the offer lapses either, and does not ask them twice', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const first = await placeOrder(HOME);
    await setOff(ayesha, first);
    const second = await placeOrder(NEXT_DOOR);
    expect((await offersFor(second))[0]!.chained).toBe(true);

    later(121);
    await sweepOffers(harness.app.ctx);
    const offers = await offersFor(second);
    expect(offers.map((row) => row.outcome)).toEqual(['expired']);
  });

  it.each([
    { name: 'a job beyond the chain radius goes to the queue', where: FAR, earned: 0 },
    { name: 'a Runner more than the lead ahead is not chained', where: NEXT_DOOR, earned: 1600 },
  ])('$name', async ({ where, earned }) => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    if (earned > 0) await earnedToday(ayesha, earned);
    const first = await placeOrder(HOME);
    await setOff(ayesha, first);
    const tomasz = await runnerAt('Tomasz', '+447700900202', FAR);

    const second = await placeOrder(where);
    const offer = (await offersFor(second))[0]!;
    expect(offer).toMatchObject({ runnerId: tomasz.runnerId, chained: false });
  });

  it('never chains a Runner who already has the next job in hand', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const first = await placeOrder(HOME);
    await setOff(ayesha, first);
    const second = await placeOrder(NEXT_DOOR);
    const chained = (await offersFor(second))[0]!;
    await act(ayesha, 'POST', `/jobs/${chained.id}/accept`);

    const third = await placeOrder(NEXT_DOOR);
    expect(await offersFor(third)).toHaveLength(0);
  });
});

describe('rule 3: distance band first', () => {
  it('asks the near band first, even when the far Runner has waited longer', async () => {
    const near = await runnerAt('Near', '+447700900201', NEAR, new Date(START.getTime() - 60_000));
    await runnerAt('Far', '+447700900202', FAR, null);
    const orderId = await placeOrder();
    expect(await pendingRunnerFor(orderId)).toBe(near.runnerId);
  });

  it('widens to the far band once bandSeconds have passed with nobody near accepting', async () => {
    await runnerAt('Near', '+447700900201', NEAR);
    const far = await runnerAt('Far', '+447700900202', FAR);
    const orderId = await placeOrder();

    later(61);
    await sweepOffers(harness.app.ctx);
    const offers = await offersFor(orderId);
    expect(offers.map((row) => row.outcome)).toEqual(['expired', 'pending']);
    expect(offers[1]!.runnerId).toBe(far.runnerId);
  });

  it('stays with the near band for longer when bandSeconds says so, asking a lapsed Runner again', async () => {
    Object.assign(harness.config.dispatch, { bandSeconds: 180 });
    const near = await runnerAt('Near', '+447700900201', NEAR);
    const far = await runnerAt('Far', '+447700900202', FAR);
    const orderId = await placeOrder();

    later(61);
    await sweepOffers(harness.app.ctx);
    let offers = await offersFor(orderId);
    expect(offers.map((row) => row.runnerId)).toEqual([near.runnerId, near.runnerId]);

    later(61);
    await sweepOffers(harness.app.ctx);
    offers = await offersFor(orderId);
    expect(offers.map((row) => row.runnerId)).toEqual([
      near.runnerId,
      near.runnerId,
      near.runnerId,
    ]);

    later(61);
    await sweepOffers(harness.app.ctx);
    offers = await offersFor(orderId);
    expect(offers.at(-1)!.runnerId).toBe(far.runnerId);
  });

  it('widens at once when everybody near has said no', async () => {
    Object.assign(harness.config.dispatch, { bandSeconds: 180 });
    const near = await runnerAt('Near', '+447700900201', NEAR);
    const far = await runnerAt('Far', '+447700900202', FAR);
    const orderId = await placeOrder();
    const first = (await offersFor(orderId))[0]!;
    await act(near, 'POST', `/jobs/${first.id}/decline`);
    expect(await pendingRunnerFor(orderId)).toBe(far.runnerId);
  });

  it('records the Runner’s place in the fair queue on the offer, for an honest answer later', async () => {
    const near = await runnerAt('Near', '+447700900201', NEAR);
    await runnerAt('Far', '+447700900202', FAR);
    const orderId = await placeOrder();
    const offer = (await offersFor(orderId))[0]!;
    expect(offer).toMatchObject({ runnerId: near.runnerId, queuePosition: 0 });
    expect(offer.distanceMiles).toBeGreaterThan(0.3);
    expect(offer.distanceMiles).toBeLessThan(0.4);
  });
});

describe('rule 4: their place in line', () => {
  async function position(runner: SignedInRunner) {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/queue-position',
      headers: runner.authHeader,
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { position: number | null; reason: string | null; words: string };
  }

  it('tells each Runner their own place, in one sentence, with no money in it', async () => {
    const ayesha = await runnerAt('Ayesha', '+447700900201', HOME);
    const tomasz = await runnerAt('Tomasz', '+447700900202', FAR);
    await earnedToday(ayesha, 500);

    expect(await position(tomasz)).toEqual({
      position: 0,
      reason: null,
      words: 'You are first in line for the next job.',
    });
    const hers = await position(ayesha);
    expect(hers).toEqual({
      position: 1,
      reason: null,
      words: 'You are second in line for the next job.',
    });
    expect(JSON.stringify(hers)).not.toMatch(/[Pp]ence|£|earn/);
  });

  it('says why when they are not in line', async () => {
    const runner = await runnerAt('Ayesha', '+447700900201', HOME);
    await harness.repository.runners.update(runner.runnerId, { available: false });
    expect(await position(runner)).toMatchObject({
      position: null,
      reason: 'off_shift',
      words: expect.stringMatching(/off shift/),
    });

    await harness.repository.runners.update(runner.runnerId, { available: true });
    const orderId = await placeOrder();
    const offer = (await offersFor(orderId))[0]!;
    await act(runner, 'POST', `/jobs/${offer.id}/accept`);
    expect(await position(runner)).toMatchObject({
      position: null,
      reason: 'job_in_hand',
      words: 'You have a job in hand. You are back in line as soon as it is delivered.',
    });

    const unchecked = await signUpRunner(harness, {
      name: 'New',
      phone: '+447700900203',
      verified: false,
    });
    await harness.repository.runners.update(unchecked.runnerId, { available: true });
    expect(await position(unchecked)).toMatchObject({
      position: null,
      reason: 'checks_not_done',
    });
  });

  it('needs a Runner’s sign-in', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/queue-position',
      headers: shopper.authHeader,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(401);
    expect(response.statusCode).toBeLessThan(404);
  });
});
