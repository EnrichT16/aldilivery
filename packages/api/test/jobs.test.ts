/**
 * Offering, accepting and paying for jobs, through the real routes.
 *
 * The unit tests in `allocation.test.ts` prove the queue is fair. These prove the API
 * behaves the way the queue says it should, including the part that matters most to a
 * Runner standing in the rain: what happens when the sixty seconds run out.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';

import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-09-09T12:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

beforeEach(async () => {
  harness = await buildTestApp(START);
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
});

async function placeOrder(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
      latitude: 52.4862,
      longitude: -1.8904,
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        channel: 'button',
        statement: 'Send my order.',
        agreedTotalPence: 1050,
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { order: { id: string } }).order.id;
}

describe('offering a job', () => {
  it('offers to the Runner who has waited longest', async () => {
    const waitingLongest = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    const justFinished = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });

    await harness.repository.runners.update(waitingLongest.runnerId, {
      lastJobCompletedAt: new Date(START.getTime() - 90 * 60_000),
    });
    await harness.repository.runners.update(justFinished.runnerId, {
      lastJobCompletedAt: new Date(START.getTime() - 60_000),
    });

    const orderId = await placeOrder();
    const response = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { offer: { runnerId: string; queuePosition: number }; holdSeconds: number };
    expect(body.offer.runnerId).toBe(waitingLongest.runnerId);
    expect(body.offer.queuePosition).toBe(0);
    expect(body.holdSeconds).toBe(60);
  });

  it('says plainly when no Runner is free, rather than failing', async () => {
    const orderId = await placeOrder();
    const response = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ offer: null });
  });

  it('does not offer to a Runner whose checks are unfinished', async () => {
    await signUpRunner(harness, { name: 'Unchecked', phone: '+447700900203', verified: false });
    await harness.repository.runners.update(
      (await harness.repository.runners.findByPhone('+447700900203'))!.id,
      { available: true },
    );

    const orderId = await placeOrder();
    const response = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    expect(response.json()).toMatchObject({ offer: null });
  });

  it('does not make a second offer while one is still live', async () => {
    await signUpRunner(harness, { phone: '+447700900201' });
    const orderId = await placeOrder();

    const first = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const second = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });

    expect(second.json()).toMatchObject({ alreadyOffered: true });
    expect((second.json() as { offer: { id: string } }).offer.id).toBe(
      (first.json() as { offer: { id: string } }).offer.id,
    );
  });
});

describe('the sixty second hold', () => {
  let runnerOne: SignedInRunner;
  let runnerTwo: SignedInRunner;
  let orderId: string;

  beforeEach(async () => {
    runnerOne = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900201' });
    runnerTwo = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900202' });
    await harness.repository.runners.update(runnerOne.runnerId, {
      lastJobCompletedAt: new Date(START.getTime() - 90 * 60_000),
    });
    await harness.repository.runners.update(runnerTwo.runnerId, {
      lastJobCompletedAt: new Date(START.getTime() - 60 * 60_000),
    });
    orderId = await placeOrder();
  });

  it('lets the Runner accept within the minute', async () => {
    const offered = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const offerId = (offered.json() as { offer: { id: string } }).offer.id;

    harness.setNow(new Date(START.getTime() + 45_000));
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offerId}/accept`,
      headers: runnerOne.authHeader,
    });

    expect(accepted.statusCode).toBe(200);
    const body = accepted.json() as { order: { runnerId: string; status: string }; youWillEarnPence: number };
    expect(body.order.runnerId).toBe(runnerOne.runnerId);
    expect(body.order.status).toBe('accepted');
    expect(body.youWillEarnPence).toBe(RUNNER_PAYMENT_PENCE);
  });

  it('refuses an acceptance after the minute has passed, and says another job will come', async () => {
    const offered = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const offerId = (offered.json() as { offer: { id: string } }).offer.id;

    harness.setNow(new Date(START.getTime() + 61_000));
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offerId}/accept`,
      headers: runnerOne.authHeader,
    });

    expect(accepted.statusCode).toBe(409);
    expect((accepted.json() as { error: { message: string } }).error.message).toContain('Another will come');
  });

  it('passes the job to the next Runner once the hold has lapsed', async () => {
    await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });

    harness.setNow(new Date(START.getTime() + 61_000));
    const second = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });

    expect((second.json() as { offer: { runnerId: string } }).offer.runnerId).toBe(runnerTwo.runnerId);
  });

  it('passes it on when a Runner declines, without waiting the full minute', async () => {
    const offered = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const offerId = (offered.json() as { offer: { id: string } }).offer.id;

    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offerId}/decline`,
      headers: runnerOne.authHeader,
    });

    const second = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    expect((second.json() as { offer: { runnerId: string } }).offer.runnerId).toBe(runnerTwo.runnerId);
  });

  it('will not let one Runner accept a job offered to another', async () => {
    const offered = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const offerId = (offered.json() as { offer: { id: string } }).offer.id;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offerId}/accept`,
      headers: runnerTwo.authHeader,
    });
    expect(response.statusCode).toBe(403);
  });

  it('tells a Runner how many seconds are left on their offer', async () => {
    await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    harness.setNow(new Date(START.getTime() + 20_000));

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: runnerOne.authHeader,
    });
    const body = mine.json() as { offers: Array<{ secondsLeft: number }> };
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]?.secondsLeft).toBe(40);
  });
});

describe('Rule Two, through the payout route', () => {
  it('pays a Runner five pounds for a delivered order', async () => {
    const runner = await signUpRunner(harness, { phone: '+447700900201' });
    const orderId = await placeOrder();

    const offered = await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer` });
    const offerId = (offered.json() as { offer: { id: string } }).offer.id;
    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offerId}/accept`,
      headers: runner.authHeader,
    });

    await harness.repository.orders.update(orderId, { status: 'delivered' });

    const payout = await harness.app.inject({ method: 'POST', url: `/orders/${orderId}/payout` });
    expect(payout.statusCode).toBe(200);

    const body = payout.json() as {
      payout: { earnedPence: number; transferredPence: number; coolBagWithheldPence: number };
      notes: string[];
    };
    expect(body.payout.earnedPence).toBe(500);
    expect(body.payout.coolBagWithheldPence).toBe(100);
    expect(body.payout.transferredPence).toBe(400);
    expect(body.notes.join(' ')).toContain('You earned £5.00');
    expect(body.notes.join(' ')).toContain('cool bag deposit');

    const transfers = harness.payments.calls.filter((call) => call.kind === 'transfer');
    expect(transfers).toHaveLength(1);
    expect((transfers[0]!.input as { amountPence: number }).amountPence).toBe(400);
  });

  it('will not pay for the same order twice', async () => {
    const runner = await signUpRunner(harness, { phone: '+447700900201' });
    const orderId = await placeOrder();
    await harness.repository.orders.update(orderId, {
      runnerId: runner.runnerId,
      status: 'delivered',
    });

    await harness.app.inject({ method: 'POST', url: `/orders/${orderId}/payout` });
    const second = await harness.app.inject({ method: 'POST', url: `/orders/${orderId}/payout` });
    expect(second.statusCode).toBe(409);
  });

  it('will not pay before the order has been delivered', async () => {
    const runner = await signUpRunner(harness, { phone: '+447700900201' });
    const orderId = await placeOrder();
    await harness.repository.orders.update(orderId, {
      runnerId: runner.runnerId,
      status: 'shopping',
    });

    const response = await harness.app.inject({ method: 'POST', url: `/orders/${orderId}/payout` });
    expect(response.statusCode).toBe(409);
  });
});

describe('pooling, through the route', () => {
  it('groups nearby orders and still pays five pounds for each', async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    await harness.repository.orders.update(second, { latitude: 52.4875, longitude: -1.8912 });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/jobs/pool',
      payload: { orderIds: [first, second] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      pools: Array<{ orderIds: string[]; runnerPaymentPence: number }>;
      radiusMiles: number;
    };
    expect(body.radiusMiles).toBe(1);
    expect(body.pools).toHaveLength(1);
    expect(body.pools[0]?.runnerPaymentPence).toBe(1000);
  });
});
