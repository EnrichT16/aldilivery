/**
 * From a paid order to a delivered one, with offers made the way the real server makes them.
 *
 * Until 27 Sep 2026 nothing ever offered a paid order to anybody, a Shopper could mark their
 * own order paid, and an offered Runner was sent the whole order — address and all — before
 * saying yes. These prove each of those is fixed, and walk one order all the way to the door.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { canCarry, sweepOffers } from '../src/services/dispatch.js';
import {
  buildTestApp,
  STAFF,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-09-09T12:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

beforeEach(async () => {
  harness = await buildTestApp(START, { autoOffer: true });
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness, {
    doorstepProtocol: 'Knock twice, I am slow to the door.',
  });
});

async function placeOrder(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [
        { catalogueItemId: items.milk, quantity: 2 },
        { catalogueItemId: items.bread, quantity: 1 },
      ],
      deliveryAddress: '12 Example Street, Birmingham',
      latitude: 52.4862,
      longitude: -1.8904,
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 89 + 150 + 799,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { order: { id: string } }).order.id;
}

function later(seconds: number) {
  harness.setNow(new Date(harness.now().getTime() + seconds * 1000));
}

async function offersFor(orderId: string) {
  return harness.repository.offers.listForOrder(orderId);
}

describe('offering without anybody pressing anything', () => {
  it('offers a paid order to a Runner on shift the moment it is paid', async () => {
    const runner = await signUpRunner(harness);
    const orderId = await placeOrder();

    const offers = await offersFor(orderId);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ runnerId: runner.runnerId, outcome: 'pending' });
    expect((await harness.repository.orders.findById(orderId))!.status).toBe('offered');
  });

  it('offers an order that was waiting as soon as a Runner comes on shift', async () => {
    const orderId = await placeOrder();
    expect(await offersFor(orderId)).toHaveLength(0);

    const runner = await signUpRunner(harness, { verified: false });
    await harness.repository.runners.update(runner.runnerId, {
      rightToWorkVerified: true,
      criminalRecordCheckVerified: true,
      // Registered with a car: driving needs the licence and insurance accepted too.
      drivingLicenceVerified: true,
      motorInsuranceUntil: new Date('2099-12-31T00:00:00.000Z'),
    });
    await harness.app.inject({
      method: 'POST',
      url: '/runners/me/availability',
      headers: runner.authHeader,
      payload: { available: true },
    });

    expect((await offersFor(orderId))[0]).toMatchObject({ runnerId: runner.runnerId });
  });

  it('moves a lapsed offer on to the next Runner at the next sweep', async () => {
    const first = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    const second = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });
    const orderId = await placeOrder();
    const firstOffered = (await offersFor(orderId))[0]!.runnerId;

    later(61);
    expect(await sweepOffers(harness.app.ctx)).toBe(1);

    const offers = await offersFor(orderId);
    expect(offers.map((o) => o.outcome)).toEqual(['expired', 'pending']);
    expect(offers[1]!.runnerId).toBe(
      firstOffered === first.runnerId ? second.runnerId : first.runnerId,
    );
  });

  it('asks a Runner again who only missed the sixty seconds, but not one who said no', async () => {
    const runner = await signUpRunner(harness);
    const orderId = await placeOrder();

    later(61);
    await sweepOffers(harness.app.ctx);
    const offers = await offersFor(orderId);
    expect(offers.map((o) => o.outcome)).toEqual(['expired', 'pending']);
    expect(offers[1]!.runnerId).toBe(runner.runnerId);

    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offers[1]!.id}/decline`,
      headers: runner.authHeader,
    });
    later(61);
    await sweepOffers(harness.app.ctx);
    expect((await offersFor(orderId)).filter((o) => o.outcome === 'pending')).toHaveLength(0);
  });

  it('offers to the next Runner straight away when one declines', async () => {
    const ayesha = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });
    const orderId = await placeOrder();
    const first = (await offersFor(orderId))[0]!;
    const offeredTo = first.runnerId === ayesha.runnerId ? ayesha : tomasz;

    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${first.id}/decline`,
      headers: offeredTo.authHeader,
    });

    const offers = await offersFor(orderId);
    expect(offers.map((o) => o.outcome)).toEqual(['declined', 'pending']);
    expect(offers[1]!.runnerId).not.toBe(first.runnerId);
  });

  it('never offers a second job to a Runner who is already doing one', async () => {
    const runner = await signUpRunner(harness);
    const firstOrder = await placeOrder();
    const offer = (await offersFor(firstOrder))[0]!;
    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });

    const secondOrder = await placeOrder();
    expect(await offersFor(secondOrder)).toHaveLength(0);
  });

  it('never offers an order that has not been paid for', async () => {
    await signUpRunner(harness);
    const orderId = await placeOrder();
    await harness.repository.orders.update(orderId, { status: 'cancelled', runnerId: null });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${orderId}/offer`,
      headers: STAFF,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/not paid for/);
  });
});

describe('what a Runner sees', () => {
  it('sees only a summary of an offered job, not the address', async () => {
    const runner = await signUpRunner(harness);
    await placeOrder();

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: runner.authHeader,
    });
    const body = mine.json() as { offers: Array<Record<string, unknown>> };
    expect(body.offers[0]!['job']).toEqual({
      itemCount: 3,
      goodsEstimatePence: expect.any(Number),
      runnerPaymentPence: 500,
      distanceMiles: expect.any(Number),
      // Not part of a split job (ruling 60).
      split: null,
    });
    expect(JSON.stringify(body)).not.toContain('Example Street');
    expect(JSON.stringify(body)).not.toContain('Knock twice');
  });

  it('sees the list, the address and the doorstep words once they have accepted', async () => {
    const runner = await signUpRunner(harness);
    const orderId = await placeOrder();
    const offer = (await offersFor(orderId))[0]!;

    const none = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(none.json()).toEqual({ job: null });

    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    const current = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(current.json().job).toMatchObject({
      orderId,
      status: 'accepted',
      deliveryAddress: '12 Example Street, Birmingham',
      doorstepProtocol: 'Knock twice, I am slow to the door.',
      substitutionDefault: 'ask_me',
      runnerPaymentPence: 500,
    });
    expect(current.json().job.items).toHaveLength(2);
  });
});

describe('who may move an order on', () => {
  it('will not let a Shopper mark their own order paid, or anything else that is not theirs', async () => {
    const orderId = await placeOrder();
    await harness.repository.orders.update(orderId, { status: 'confirmed' });

    for (const status of ['paid', 'offered', 'accepted', 'shopping', 'delivered', 'refunded']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/orders/${orderId}/status`,
        headers: shopper.authHeader,
        payload: { status },
      });
      expect(response.statusCode, status).toBe(403);
    }
    expect((await harness.repository.orders.findById(orderId))!.status).toBe('confirmed');
  });

  it('lets a Shopper cancel before payment, and tells them to phone after it', async () => {
    const orderId = await placeOrder();

    const paid = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/status`,
      headers: shopper.authHeader,
      payload: { status: 'cancelled' },
    });
    expect(paid.statusCode).toBe(403);
    expect(paid.json().error.message).toMatch(/phone us/);

    await harness.repository.orders.update(orderId, { status: 'confirmed' });
    const unpaid = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/status`,
      headers: shopper.authHeader,
      payload: { status: 'cancelled' },
    });
    expect(unpaid.statusCode).toBe(200);
  });

  it('walks one order from offer to the door, with the receipt before the road', async () => {
    const runner = await signUpRunner(harness);
    const orderId = await placeOrder();
    const offer = (await offersFor(orderId))[0]!;
    const step = (status: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/orders/${orderId}/status`,
        headers: runner.authHeader,
        payload: { status },
      });

    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    expect((await step('shopping')).statusCode).toBe(200);

    // No going on the road before the till total is in.
    expect((await step('delivering')).statusCode).toBe(409);

    const receipt = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/receipt`,
      headers: runner.authHeader,
      payload: { receiptTotalPence: 400 },
    });
    expect(receipt.statusCode).toBe(200);

    // A Runner cannot mark it paid or refunded either.
    expect((await step('refunded')).statusCode).toBe(403);

    expect((await step('delivering')).statusCode).toBe(200);
    later(600);
    expect((await step('delivered')).statusCode).toBe(200);

    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.status).toBe('delivered');
    const after = (await harness.repository.runners.findById(runner.runnerId))!;
    // Their place in the rotation moves on at the door, not at a payout that may be days away.
    expect(after.lastJobCompletedAt).toEqual(harness.now());

    const current = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(current.json()).toEqual({ job: null });
  });
});

/**
 * Rulings 59 and 60 (Anthony, 10 October 2026): each way of travelling carries up to its own most
 * of shopping at shop prices (`dispatch.maxGoodsPenceByMode`): on foot and by bicycle £60, by
 * motorbike £70, by car and van any order up to the £150 cap; a motorbike, car or van needs an
 * accepted, in-date licence and insurance.
 */
describe('carrying limits by way of travelling', () => {
  /** Places an order of so many pints of milk (£1.25 each), at the price the basket says. */
  async function placeMilk(pints: number): Promise<string> {
    const lines = [{ catalogueItemId: items.milk, quantity: pints }];
    const priced = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      headers: shopper.authHeader,
      payload: { lines },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines,
        deliveryAddress: '12 Example Street, Birmingham',
        latitude: 52.4862,
        longitude: -1.8904,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: (priced.json() as { totalPence: number }).totalPence,
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { order: { id: string } }).order.id;
  }
  /** Fifty pints: £62.50 at the shop, over what walking and cycling carry. */
  const placeLargeOrder = () => placeMilk(50);

  async function travelling(runnerId: string, vehicleType: 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van') {
    await harness.repository.runners.update(runnerId, { vehicleType });
  }

  it('reads the limits from configuration: £60, £60, £70, £150, £150', () => {
    expect(harness.config.dispatch.maxGoodsPenceByMode).toEqual({
      foot: 6000,
      bicycle: 6000,
      motorbike: 7000,
      car: 15000,
      van: 15000,
    });
    expect(harness.config.dispatch.waitingAlertMinutes).toBe(15);
    expect(harness.config.dispatch.splitAfterMinutes).toBe(15);
  });

  it('does not offer a large order to a Runner on foot or by bicycle', async () => {
    const walker = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    const cyclist = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });
    await travelling(walker.runnerId, 'on_foot');
    await travelling(cyclist.runnerId, 'bicycle');

    const orderId = await placeLargeOrder();
    expect(await offersFor(orderId)).toHaveLength(0);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${orderId}/offer`,
      headers: STAFF,
    });
    expect(response.json().message).toMatch(/Runner with a motorbike, car or van/);
  });

  it('offers a large order to a Runner with a car, passing over one on a bicycle', async () => {
    const cyclist = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    await travelling(cyclist.runnerId, 'bicycle');
    const driver = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });

    const orderId = await placeLargeOrder();
    const offers = await offersFor(orderId);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.runnerId).toBe(driver.runnerId);
  });

  it('offers a motorbike Runner up to £70, and passes over them above it', async () => {
    const rider = await signUpRunner(harness);
    await travelling(rider.runnerId, 'motorbike');
    const upTo70 = await placeMilk(56); // £70.00
    expect((await offersFor(upTo70))[0]!.runnerId).toBe(rider.runnerId);
    await harness.repository.offers.update((await offersFor(upTo70))[0]!.id, { outcome: 'declined' });

    const over70 = await placeMilk(57); // £71.25
    expect(await offersFor(over70)).toHaveLength(0);
  });

  it('needs an accepted licence and in-date insurance for a motorbike, as for a car', async () => {
    const rider = await signUpRunner(harness);
    await travelling(rider.runnerId, 'motorbike');
    await harness.repository.runners.update(rider.runnerId, { drivingLicenceVerified: false });
    const orderId = await placeLargeOrder();
    expect(await offersFor(orderId)).toHaveLength(0);
  });

  it('still offers an ordinary order to a Runner on foot or by bicycle', async () => {
    const cyclist = await signUpRunner(harness);
    await travelling(cyclist.runnerId, 'bicycle');
    const orderId = await placeOrder();
    expect((await offersFor(orderId))[0]!.runnerId).toBe(cyclist.runnerId);
  });

  it('does not offer a large order to a car Runner whose insurance has run out (ruling 56)', async () => {
    const driver = await signUpRunner(harness);
    await harness.repository.runners.update(driver.runnerId, {
      motorInsuranceUntil: new Date('2026-09-01T00:00:00.000Z'),
    });
    const orderId = await placeLargeOrder();
    expect(await offersFor(orderId)).toHaveLength(0);
  });

  it('will not let a Runner who switched to a bicycle accept a large order, or see it', async () => {
    const driver = await signUpRunner(harness);
    const orderId = await placeLargeOrder();
    const offer = (await offersFor(orderId))[0]!;
    await travelling(driver.runnerId, 'bicycle');

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: driver.authHeader,
    });
    expect(mine.json()).toEqual({ offers: [] });

    const accept = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: driver.authHeader,
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json().error.message).toMatch(
      /£62\.50 of shopping, more than £60\.00, so it goes to a Runner with a motorbike, car or van/,
    );
    expect((await harness.repository.orders.findById(orderId))!.runnerId).toBeNull();

    await travelling(driver.runnerId, 'car');
    const taken = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: driver.authHeader,
    });
    expect(taken.statusCode, taken.body).toBe(200);
  });

  it('counts only shop prices, mode by mode', async () => {
    const runner = (await harness.repository.runners.findById(
      (await signUpRunner(harness)).runnerId,
    ))!;
    const at = harness.now();
    const as = (vehicleType: 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van') => ({ ...runner, vehicleType });
    expect(canCarry(harness.config, as('on_foot'), { goodsEstimatePence: 6000 }, at)).toBe(true);
    expect(canCarry(harness.config, as('on_foot'), { goodsEstimatePence: 6001 }, at)).toBe(false);
    expect(canCarry(harness.config, as('bicycle'), { goodsEstimatePence: 6001 }, at)).toBe(false);
    expect(canCarry(harness.config, as('motorbike'), { goodsEstimatePence: 7000 }, at)).toBe(true);
    expect(canCarry(harness.config, as('motorbike'), { goodsEstimatePence: 7001 }, at)).toBe(false);
    expect(canCarry(harness.config, as('car'), { goodsEstimatePence: 15000 }, at)).toBe(true);
    expect(canCarry(harness.config, as('van'), { goodsEstimatePence: 15000 }, at)).toBe(true);
    const unchecked = { ...as('car'), drivingLicenceVerified: false };
    expect(canCarry(harness.config, unchecked, { goodsEstimatePence: 6001 }, at)).toBe(false);
    // An ordinary order goes to anyone.
    expect(canCarry(harness.config, unchecked, { goodsEstimatePence: 6000 }, at)).toBe(true);
  });
});

describe('a large order nobody who can carry it has taken', () => {
  it('waits, and texts the owner once after fifteen minutes', async () => {
    const texts: Array<{ to: string; body: string }> = [];
    harness = await buildTestApp(START, {
      autoOffer: true,
      env: { ownerAlertPhone: '+447700900999' },
      sendText: async (to, body) => {
        texts.push({ to, body });
      },
    });
    items = await seedCatalogue(harness.repository);
    shopper = await signUpShopper(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines: [{ catalogueItemId: items.milk, quantity: 50 }],
        deliveryAddress: '12 Example Street, Birmingham',
        latitude: 52.4862,
        longitude: -1.8904,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 6250 + 2500 + 1350,
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const orderId = (response.json() as { order: { id: string } }).order.id;
    const ownerTexts = () => texts.filter((text) => text.to === '+447700900999');

    later(14 * 60);
    await sweepOffers(harness.app.ctx);
    expect(ownerTexts()).toHaveLength(0);

    later(60);
    await sweepOffers(harness.app.ctx);
    later(60);
    await sweepOffers(harness.app.ctx);
    // Once: either the waiting alert, or the split that follows it at the same moment.
    expect(ownerTexts()).toHaveLength(1);
    expect(ownerTexts()[0]!.body).toContain('£62.50');
    expect((await harness.repository.orders.findById(orderId))!.waitingAlertSentAt).not.toBeNull();
  });
});
