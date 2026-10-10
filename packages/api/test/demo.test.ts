/**
 * The demo sign-in for app store reviewers, and Runners closing their account in the app
 * (ruling 60, Anthony, 10 October 2026).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

import { sweepOffers } from '../src/services/dispatch.js';
import { sweepRetention } from '../src/services/retention.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-10-10T10:00:00.000Z');
const DEMO_PHONE = '07700 900555';
const DEMO_CODE = '918273';

let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

async function withDemo(env: { phone?: string; code?: string } = { phone: DEMO_PHONE, code: DEMO_CODE }) {
  harness = await buildTestApp(START, {
    autoOffer: true,
    env: { demoSignInPhone: env.phone, demoSignInCode: env.code },
  });
  return harness;
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function demoSignIn(role: 'shopper' | 'runner' = 'shopper', code = DEMO_CODE) {
  await post('/auth/request-code', { phone: DEMO_PHONE, role });
  return post('/auth/verify-code', { phone: DEMO_PHONE, role, code });
}

describe('the demo sign-in', () => {
  it('is off unless both the number and the code are set', async () => {
    await withDemo({ phone: DEMO_PHONE });
    const asked = await post('/auth/request-code', { phone: DEMO_PHONE, role: 'shopper' });
    expect(asked.statusCode).toBe(200);
    // An ordinary code was sent, as for anybody.
    expect(harness.deliveredCodes).toHaveLength(1);
    const tried = await post('/auth/verify-code', { phone: DEMO_PHONE, role: 'shopper', code: DEMO_CODE });
    expect(tried.statusCode).toBe(401);
  });

  it('sends no text, and opens a demo Shopper account with the fixed code', async () => {
    await withDemo();
    const signedIn = await demoSignIn();
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(harness.deliveredCodes).toHaveLength(0);
    expect(signedIn.json()).toMatchObject({ registrationRequired: false, role: 'shopper', demo: true });

    const me = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${signedIn.json().token as string}` },
    });
    expect(me.json().shopper).toMatchObject({ displayName: 'Demo Shopper', isDemo: true });
    // Signing in again finds the same account.
    const again = await demoSignIn();
    expect(again.json().accountId).toBe(signedIn.json().accountId);
  });

  it('refuses a wrong code, and rests after ten wrong tries', async () => {
    await withDemo();
    const wrong = await demoSignIn('shopper', '000000');
    expect(wrong.statusCode).toBe(401);
    for (let n = 1; n < 10; n += 1) await demoSignIn('shopper', '000000');
    const rested = await demoSignIn();
    expect(rested.statusCode).toBe(429);
  });

  it('places a demo order that charges no card and reaches no Runner', async () => {
    await withDemo();
    const items = await seedCatalogue(harness.repository);
    await signUpRunner(harness);
    const signedIn = await demoSignIn();
    const auth = { authorization: `Bearer ${signedIn.json().token as string}` };
    const cards = await harness.app.inject({ method: 'GET', url: '/payment-methods', headers: auth });
    const card = (cards.json() as { paymentMethods?: Array<{ id: string }>; cards?: Array<{ id: string }> });
    const cardId = (card.paymentMethods ?? card.cards ?? [])[0]!.id;
    const lines = [{ catalogueItemId: items.milk, quantity: 2 }];
    const priced = await post('/basket/price', { lines }, auth);

    const placed = await post(
      '/orders',
      {
        lines,
        deliveryAddress: '1 Demo Street, Demo Town (a demo address)',
        paymentMethodId: cardId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: priced.json().totalPence as number,
        },
      },
      auth,
    );
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.json().demo).toBe(true);
    expect(placed.json().message).toMatch(/^Demo account — no real orders\. .*nothing was charged and no Runner is sent/);
    const orderId = placed.json().order.id as string;
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order).toMatchObject({ isDemo: true, status: 'paid', stripePaymentIntentId: null });
    // The one yes is recorded exactly as for a real order (Rule One).
    expect(order.spokenConfirmationAt).not.toBeNull();
    expect(harness.payments.calls.filter((call) => call.kind === 'payment_intent')).toHaveLength(0);
    await sweepOffers(harness.app.ctx);
    expect(await harness.repository.offers.listForOrder(orderId)).toHaveLength(0);
  });

  it('cannot add a real card or buy anything', async () => {
    await withDemo();
    const signedIn = await demoSignIn();
    const auth = { authorization: `Bearer ${signedIn.json().token as string}` };
    const saved = await post('/payment-methods', { stripePaymentMethodId: 'pm_card_visa', lastFour: '4242' }, auth);
    expect(saved.statusCode).toBe(403);
    expect(saved.json().error.message).toMatch(/demo account/);
  });

  it('opens a demo Runner that is never offered a real job', async () => {
    await withDemo();
    const items = await seedCatalogue(harness.repository);
    const signedIn = await demoSignIn('runner');
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const runner = (await harness.repository.runners.findById(signedIn.json().accountId as string))!;
    expect(runner).toMatchObject({ name: 'Demo Runner', isDemo: true });
    await harness.repository.runners.update(runner.id, {
      available: true,
      latitude: 52.4862,
      longitude: -1.8904,
      agreementAcceptedAt: START,
      agreementVersion: RUNNER_AGREEMENT_VERSION,
      agreementChannel: 'button',
    });

    const shopper = await signUpShopper(harness);
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        latitude: 52.4862,
        longitude: -1.8904,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 100 + 799,
        },
      },
      shopper.authHeader,
    );
    expect(placed.statusCode, placed.body).toBe(201);
    expect(await harness.repository.offers.listForOrder(placed.json().order.id as string)).toHaveLength(0);
  });

  it('never turns a real account into the demo one', async () => {
    await withDemo();
    await signUpShopper(harness, { phone: '+447700900555' });
    const signedIn = await demoSignIn();
    expect(signedIn.statusCode).toBe(409);
  });
});

describe('a Runner closing their account in the app', () => {
  it('closes it, refuses while a job is in hand, and removes their details after the same days as a Shopper', async () => {
    harness = await buildTestApp(START, { autoOffer: true });
    const items = await seedCatalogue(harness.repository);
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        latitude: 52.4862,
        longitude: -1.8904,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 100 + 799,
        },
      },
      shopper.authHeader,
    );
    const orderId = placed.json().order.id as string;
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);

    const busy = await post('/runners/me/leave', { confirm: true }, runner.authHeader);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.message).toMatch(/job in hand/);

    await harness.repository.orders.update(orderId, { status: 'completed' });
    await harness.repository.runnerChecks.create({
      runnerId: runner.runnerId,
      kind: 'right_to_work',
      outcome: 'passed',
      evidence: 'Share code checked',
      checkedBy: 'Anthony',
      note: '',
      checkedAt: START,
    } as never);
    const closed = await post('/runners/me/leave', { confirm: true }, runner.authHeader);
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().message).toMatch(/Your Runner account is closed/);

    const days = harness.config.accountDeletion.recycleBinDays;
    harness.setNow(new Date(START.getTime() + (days - 1) * 86_400_000));
    expect((await sweepRetention(harness.app.ctx)).runnersRemoved).toBe(0);
    harness.setNow(new Date(START.getTime() + (days + 1) * 86_400_000));
    expect((await sweepRetention(harness.app.ctx)).runnersRemoved).toBe(1);
    const gone = (await harness.repository.runners.findById(runner.runnerId))!;
    expect(gone).toMatchObject({ name: 'Closed Runner account', phone: `closed:${runner.runnerId}`, latitude: null });
    expect(gone.erasedAt).not.toBeNull();
    // The record of their checks stays two years after they stopped, then goes.
    expect(await harness.repository.runnerChecks.listForRunner(runner.runnerId)).toHaveLength(1);
    harness.setNow(new Date(START.getTime() + (2 * 365 + 1) * 86_400_000));
    expect((await sweepRetention(harness.app.ctx)).runnerChecksRemoved).toBe(1);
  });
});
