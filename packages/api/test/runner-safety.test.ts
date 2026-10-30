/**
 * Runners: the SOS button, when money reaches the bank, leaving and the cool bag deposit,
 * insurance reminders, and the private referral reward (Section M; rulings 12, 14 and 16;
 * docs/LEGAL_REVIEW.md).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import { offerOrder } from '../src/services/dispatch.js';
import { instantFeePence } from '../src/services/payout-schedule.js';
import { reminderDue, sweepInsuranceReminders } from '../src/services/insurance.js';
import { sweepDeposits } from '../src/services/runner-leaving.js';
import {
  buildTestApp,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const OWNER_PHONE = '+447700900999';
let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;
let runner: SignedInRunner;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(new Date('2026-10-18T10:00:00.000Z'), {
    env: { ownerAlertPhone: OWNER_PHONE, primaryOrigin: 'https://ozi.example' },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  runner = await signUpRunner(harness);
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

/** An order straight into the state a test needs, without walking the whole way there. */
async function orderFor(
  shopper: SignedInShopper,
  patch: Partial<Order>,
  address = '12 Example Street, Gillingham ME7 1AA',
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
  return harness.repository.orders.update(order.id, patch);
}

describe('the SOS button', () => {
  it('texts the owner a private link to where the Runner is, and never a Shopper number', async () => {
    const shopper = await signUpShopper(harness, { phone: '+447700900222' });
    const order = await orderFor(shopper, { status: 'delivering', runnerId: runner.runnerId });

    const pressed = await post(
      '/runners/me/sos',
      { location: { latitude: 51.3891, longitude: 0.5469, accuracyMetres: 12 } },
      runner.authHeader,
    );
    expect(pressed.statusCode, pressed.body).toBe(201);
    expect(pressed.json().call999).toBe('If you are in danger, call 999 now.');
    expect(pressed.json().message).toBe('We have been told, with where you are.');
    expect(pressed.json().sos).toEqual(expect.objectContaining({ on: true, located: true }));

    expect(texts).toHaveLength(1);
    const text = texts[0]!;
    expect(text.to).toBe(OWNER_PHONE);
    expect(text.body).toContain('Tomasz');
    expect(text.body).toContain('+447700900101');
    expect(text.body).toContain('area ME7');
    expect(text.body).not.toContain('+447700900222');
    expect(text.body).not.toContain(order.deliveryAddress);
    const link = /https:\/\/ozi\.example\/api(\/sos\/\S+)/.exec(text.body)?.[1];
    expect(link).toBeDefined();

    // The page behind the link shows where they are, and moves as they move.
    let page = await get(link!);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('51.38910, 0.54690');
    expect(page.body).toContain('http-equiv="refresh"');
    expect(page.body).not.toContain('+447700900222');

    await post('/runners/me/sos/location', { latitude: 51.4, longitude: 0.55 }, runner.authHeader);
    page = await get(link!);
    expect(page.body).toContain('51.40000, 0.55000');

    // A second press does not text again.
    expect((await post('/runners/me/sos', {}, runner.authHeader)).statusCode).toBe(200);
    expect(texts).toHaveLength(1);

    // Staff see it, with the Runner's own number and the job's reference only.
    const staff = await get('/staff/sos', STAFF);
    expect(staff.statusCode).toBe(200);
    const row = staff.json().sos[0];
    expect(row).toEqual(
      expect.objectContaining({ on: true, latitude: 51.4, longitude: 0.55, alerted: true }),
    );
    expect(row.reference).toMatch(/^OZ-/);
    expect(JSON.stringify(staff.json())).not.toContain('+447700900222');

    // Over: the link keeps working for an hour, then stops.
    expect((await post('/runners/me/sos/end', {}, runner.authHeader)).json().sos.on).toBe(false);
    page = await get(link!);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('http-equiv="refresh"');
    harness.setNow(new Date('2026-10-18T11:01:00.000Z'));
    expect((await get(link!)).statusCode).toBe(404);
  });

  it('stops working after the configured hours even while still on, and a wrong code finds nothing', async () => {
    await post('/runners/me/sos', {}, runner.authHeader);
    const link = /\/api(\/sos\/\S+)/.exec(texts[0]!.body)![1]!;
    expect(texts[0]!.body).toContain('has not shared where they are yet');
    expect((await get(link)).statusCode).toBe(200);
    expect((await get('/sos/not-the-right-code-at-all-123456')).statusCode).toBe(404);
    harness.setNow(new Date('2026-10-18T22:00:01.000Z'));
    expect((await get(link)).statusCode).toBe(404);
  });

  // Only what really happened (Anthony, 30 October 2026).
  it('says the office was told, but not where, when the phone has not shared it yet', async () => {
    const pressed = await post('/runners/me/sos', {}, runner.authHeader);
    expect(pressed.statusCode).toBe(201);
    expect(pressed.json().call999).toBe('If you are in danger, call 999 now.');
    expect(pressed.json().message).toBe('We have been told. We do not know where you are yet.');
    expect(texts).toHaveLength(1);

    // Once the phone says where, the words say so too.
    const moved = await post(
      '/runners/me/sos/location',
      { latitude: 51.39, longitude: 0.55 },
      runner.authHeader,
    );
    expect(moved.json().message).toBe('We have been told, with where you are.');
    const again = await get('/runners/me/sos', runner.authHeader);
    expect(again.json().message).toBe('We have been told, with where you are.');
  });

  it('never says "told" when the text to the office fails, even with a location', async () => {
    const failing = await buildTestApp(new Date('2026-10-18T10:00:00.000Z'), {
      env: { ownerAlertPhone: OWNER_PHONE, primaryOrigin: 'https://ozi.example' },
      sendText: async () => {
        throw new Error('Twilio is down');
      },
    });
    const someone = await signUpRunner(failing);
    const pressed = await failing.app.inject({
      method: 'POST',
      url: '/runners/me/sos',
      payload: { location: { latitude: 51.39, longitude: 0.55 } },
      headers: someone.authHeader,
    });
    expect(pressed.statusCode).toBe(201);
    expect(pressed.json().message).toBe('We could not reach the office. Please call 999.');
    expect(pressed.json().message).not.toMatch(/told/);
    expect(pressed.json().sos).toEqual(expect.objectContaining({ alerted: false, located: true }));
    const shown = await failing.app.inject({
      method: 'GET',
      url: '/runners/me/sos',
      headers: someone.authHeader,
    });
    expect(shown.json().message).toBe('We could not reach the office. Please call 999.');
    await failing.close();
  });

  it('is still on the staff screen when no alert phone is set up, and staff can mark it over', async () => {
    const quiet = await buildTestApp(new Date('2026-10-18T10:00:00.000Z'));
    const someone = await signUpRunner(quiet);
    const pressed = await quiet.app.inject({
      method: 'POST',
      url: '/runners/me/sos',
      payload: {},
      headers: someone.authHeader,
    });
    expect(pressed.statusCode).toBe(201);
    // Nobody could be texted: never "told" (Anthony, 30 October 2026).
    expect(pressed.json().message).toBe('We could not reach the office. Please call 999.');
    expect(pressed.json().message).not.toMatch(/told/);
    const list = await quiet.app.inject({ method: 'GET', url: '/staff/sos', headers: STAFF });
    const row = list.json().sos[0];
    expect(row.alertProblem).toMatch(/No alert phone/);
    const ended = await quiet.app.inject({
      method: 'POST',
      url: `/staff/sos/${row.id}/end`,
      payload: { by: 'Kemi' },
      headers: STAFF,
    });
    expect(ended.statusCode, ended.body).toBe(200);
    await quiet.close();
  });

  it('is for Runners only', async () => {
    const shopper = await signUpShopper(harness);
    expect((await post('/runners/me/sos', {}, shopper.authHeader)).statusCode).toBe(401);
    expect((await get('/staff/sos')).statusCode).toBe(403);
  });
});

describe('when money reaches the bank (ruling 16)', () => {
  it('is weekly by default, set on Stripe when the account is made, and can be daily', async () => {
    const fresh = await signUpRunner(harness, { phone: '+447700900102', name: 'Ada' });
    await harness.repository.runners.update(fresh.runnerId, { stripeConnectedAccountId: null });
    const setup = await post(
      '/runners/me/payouts/setup',
      {},
      {
        ...fresh.authHeader,
        origin: 'https://ozi.example',
      },
    );
    expect(setup.statusCode, setup.body).toBe(200);
    expect(harness.payments.calls.filter((call) => call.kind === 'payout_schedule')).toEqual([
      { kind: 'payout_schedule', input: expect.objectContaining({ interval: 'weekly' }) },
    ]);

    const before = (await get('/runners/me/payout-schedule', runner.authHeader)).json();
    expect(before.schedule).toBe('weekly');
    expect(before.words).toMatch(/once a week, on a Friday/);
    expect(before.controls).toMatch(/straight away/);

    const daily = await post(
      '/runners/me/payout-schedule',
      { schedule: 'daily' },
      runner.authHeader,
    );
    expect(daily.statusCode, daily.body).toBe(200);
    expect(daily.json().message).toMatch(/every day/);
    expect(harness.payments.calls.at(-1)).toEqual({
      kind: 'payout_schedule',
      input: { accountId: 'acct_test_runner', interval: 'daily' },
    });
    expect((await harness.repository.runners.findById(runner.runnerId))?.payoutSchedule).toBe(
      'daily',
    );
  });

  it("works out Stripe's fee for an instant payout, never below the minimum", () => {
    expect(instantFeePence(1000, harness.config)).toBe(50);
    expect(instantFeePence(10_000, harness.config)).toBe(100);
    expect(instantFeePence(12_345, harness.config)).toBe(124);
  });

  it('shows the fee first, and sends only the figure the Runner saw, less the fee', async () => {
    let quote = (await get('/runners/me/payout-schedule', runner.authHeader)).json().instant;
    expect(quote.possible).toBe(false);

    harness.payments.instantAvailable.set('acct_test_runner', 4250);
    quote = (await get('/runners/me/payout-schedule', runner.authHeader)).json().instant;
    expect(quote).toEqual(
      expect.objectContaining({
        availablePence: 4250,
        feePence: 50,
        youGetPence: 4200,
        possible: true,
      }),
    );
    expect(quote.words).toBe(
      '£42.50 can go to your debit card now. The instant payout fee for that is £0.50, paid by you, so you would get £42.00.',
    );

    // The amount changed since they looked: nothing is sent.
    const stale = await post(
      '/runners/me/payouts/instant',
      { youGetPence: 3000 },
      runner.authHeader,
    );
    expect(stale.statusCode).toBe(409);
    expect(harness.payments.calls.some((call) => call.kind === 'instant_payout')).toBe(false);

    const taken = await post(
      '/runners/me/payouts/instant',
      { youGetPence: 4200 },
      runner.authHeader,
    );
    expect(taken.statusCode, taken.body).toBe(200);
    expect(taken.json().message).toBe(
      '£42.00 is on its way to your debit card. The instant payout fee was £0.50.',
    );
    expect(harness.payments.calls.at(-1)).toEqual({
      kind: 'instant_payout',
      input: expect.objectContaining({ accountId: 'acct_test_runner', amountPence: 4200 }),
    });
  });

  it('does not move the pay-back for the shopping: transfers still go straight away', async () => {
    // The schedule is a setting on the Runner's Stripe account, not on our transfers: changing
    // it makes no transfer and holds none back.
    const transfers = harness.payments.calls.filter((call) => call.kind === 'transfer').length;
    await post('/runners/me/payout-schedule', { schedule: 'weekly' }, runner.authHeader);
    expect(harness.payments.calls.filter((call) => call.kind === 'transfer')).toHaveLength(
      transfers,
    );
  });
});

describe('leaving, and the cool bag deposit (docs/LEGAL_REVIEW.md)', () => {
  it('pays back the deposit held at once when a Runner closes their Runner account', async () => {
    await harness.repository.runners.update(runner.runnerId, {
      coolBagWithheldPence: 600,
      coolBagDepositStatus: 'withholding',
      completedDeliveryCount: 6,
    });
    const refused = await post('/runners/me/leave', {}, runner.authHeader);
    expect(refused.statusCode).toBe(400);

    const left = await post('/runners/me/leave', { confirm: true }, runner.authHeader);
    expect(left.statusCode, left.body).toBe(200);
    expect(left.json().message).toContain(
      'Your cool bag deposit of £6.00 has been paid back to your account.',
    );
    const transfer = harness.payments.calls.find(
      (call) =>
        call.kind === 'transfer' &&
        (call.input as { idempotencyKey?: string }).idempotencyKey === `coolbag:${runner.runnerId}`,
    );
    expect(transfer?.input).toEqual(
      expect.objectContaining({ amountPence: 600, destinationAccountId: 'acct_test_runner' }),
    );
    const after = await harness.repository.runners.findById(runner.runnerId);
    expect(after).toEqual(
      expect.objectContaining({
        available: false,
        coolBagWithheldPence: 0,
        coolBagRefundedPence: 600,
        coolBagDepositStatus: 'released',
      }),
    );
    expect(after?.leftAt).not.toBeNull();

    // Gone: not back on shift, and never offered a job.
    const back = await post('/runners/me/availability', { available: true }, runner.authHeader);
    expect(back.statusCode).toBe(409);
    // Nothing is paid twice, however often the sweep runs.
    expect(await sweepDeposits(harness.app.ctx)).toBe(0);
  });

  it('cannot leave in the middle of a job', async () => {
    const shopper = await signUpShopper(harness);
    await orderFor(shopper, { status: 'shopping', runnerId: runner.runnerId });
    expect((await post('/runners/me/leave', { confirm: true }, runner.authHeader)).statusCode).toBe(
      409,
    );
  });

  it('when staff remove a Runner, waits for a written decision if money is owed, and keeps no more than is owed', async () => {
    const shopper = await signUpShopper(harness);
    const order = await orderFor(shopper, { status: 'completed', runnerId: runner.runnerId });
    const report = await harness.repository.problems.create({
      orderId: order.id,
      reportedBy: 'shopper',
      reporterId: shopper.shopperId,
      summary: 'Jars broken',
      refundRequestedPence: 700,
      status: 'decided',
      decideBy: harness.now(),
      decision: 'runner_at_fault',
      refundPence: 700,
      refundReference: null,
      decisionNote: 'Heavy jars should go in a separate bag.',
      decidedBy: 'Kemi',
      decidedAt: harness.now(),
      createdAt: harness.now(),
    });
    await harness.repository.recoveries.create({
      runnerId: runner.runnerId,
      reportId: report.id,
      amountPence: 700,
      recoveredPence: 100,
      writtenOff: false,
      writtenOffBy: null,
      writtenOffAt: null,
      createdAt: harness.now(),
    });
    await harness.repository.runners.update(runner.runnerId, {
      coolBagWithheldPence: 1000,
      coolBagDepositStatus: 'held',
    });

    const removed = await post(
      `/staff/runners/${runner.runnerId}/remove`,
      { by: 'Kemi', reason: 'Asked to stop after repeated late deliveries.' },
      STAFF,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().deposit).toEqual({ kind: 'waiting', pence: 1000, owedPence: 600 });
    expect(texts.at(-1)?.to).toBe(OWNER_PHONE);
    expect(harness.payments.calls.some((call) => call.kind === 'transfer')).toBe(false);
    // The sweep does not pay it either while a decision is waiting.
    expect(await sweepDeposits(harness.app.ctx)).toBe(0);

    const list = await get('/staff/runners/deposits', STAFF);
    expect(list.json().deposits).toEqual([
      expect.objectContaining({ heldPence: 1000, owedPence: 600 }),
    ]);

    const tooMuch = await post(
      `/staff/runners/${runner.runnerId}/deposit`,
      { by: 'Kemi', keepPence: 900, note: 'Kept against the broken jars.' },
      STAFF,
    );
    expect(tooMuch.statusCode).toBe(400);

    const decided = await post(
      `/staff/runners/${runner.runnerId}/deposit`,
      { by: 'Kemi', keepPence: 600, note: 'Kept against the broken jars, as written to them.' },
      STAFF,
    );
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json().message).toBe(
      '£6.00 kept against what is owed. Your cool bag deposit of £4.00 has been paid back to your account.',
    );
    expect(await harness.repository.recoveries.listOutstanding(runner.runnerId)).toEqual([]);
    const after = await harness.repository.runners.findById(runner.runnerId);
    expect(after?.coolBagRefundedPence).toBe(400);
    expect(after?.coolBagRefundNote).toMatch(/Kemi: Kept against the broken jars/);
  });

  it('is owed until the payout account is ready, then sent by the sweep', async () => {
    await harness.repository.runners.update(runner.runnerId, {
      coolBagWithheldPence: 300,
      stripeConnectedAccountId: null,
    });
    const left = await post('/runners/me/leave', { confirm: true }, runner.authHeader);
    expect(left.json().deposit).toEqual({ kind: 'owed', pence: 300 });
    await harness.repository.runners.update(runner.runnerId, {
      stripeConnectedAccountId: 'acct_later',
    });
    expect(await sweepDeposits(harness.app.ctx)).toBe(1);
    expect(await sweepDeposits(harness.app.ctx)).toBe(0);
  });
});

describe('insurance reminders for Runners who drive (ruling 14)', () => {
  async function insuredUntil(day: string) {
    return harness.repository.runners.update(runner.runnerId, {
      motorInsuranceUntil: new Date(`${day}T00:00:00.000Z`),
      vehicleType: 'car',
      travelModes: ['on_foot', 'car'],
    });
  }

  it('reminds 30, 7 and 1 days before, once each, by text and on the Runner page', async () => {
    await insuredUntil('2026-11-30');
    await harness.repository.runnerDocuments.create({
      runnerId: runner.runnerId,
      kind: 'insurance',
      image: null,
      contentType: null,
      shareCode: null,
      expiresOn: new Date('2026-11-30T00:00:00.000Z'),
      status: 'accepted',
      reviewNote: null,
      reviewedBy: 'Kemi',
      reviewedAt: harness.now(),
      createdAt: harness.now(),
    });
    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(0);

    harness.setNow(new Date('2026-10-31T09:00:00.000Z'));
    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(1);
    expect(texts.at(-1)).toEqual({
      to: '+447700900101',
      body: expect.stringContaining('runs out in 30 days'),
    });
    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(0);

    const page = (await get('/runners/me/dashboard', runner.authHeader)).json();
    expect(page.insurance).toEqual(expect.objectContaining({ daysLeft: 30, paused: false }));
    // The insurance row comes back in Your documents, so a new certificate can be sent.
    const documents = (await get('/runners/me/documents', runner.authHeader)).json();
    expect(documents.stillNeeded.map((row: { kind: string }) => row.kind)).toContain('insurance');

    harness.setNow(new Date('2026-11-23T09:00:00.000Z'));
    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(1);
    expect(texts.at(-1)?.body).toContain('runs out in 7 days');
    harness.setNow(new Date('2026-11-29T09:00:00.000Z'));
    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(1);
    expect(texts.at(-1)?.body).toContain('runs out tomorrow');
  });

  it('pauses driving jobs once it has run out, until a new certificate is accepted', async () => {
    const shopper = await signUpShopper(harness);
    await insuredUntil('2026-10-17');
    await harness.repository.runners.update(runner.runnerId, { available: true });

    expect(await sweepInsuranceReminders(harness.app.ctx)).toBe(1);
    expect(texts.at(-1)?.body).toContain('Jobs by car, motorbike or van are paused');
    expect((await harness.repository.runners.findById(runner.runnerId))?.available).toBe(false);

    // Back on shift by car is refused; walking is fine, and is offered work.
    await harness.repository.runners.update(runner.runnerId, { available: true });
    const order = await orderFor(shopper, { status: 'paid' });
    expect((await offerOrder(harness.app.ctx, order.id)).offer).toBeNull();
    await post('/runners/me/travel-mode', { mode: 'on_foot' }, runner.authHeader);
    expect((await offerOrder(harness.app.ctx, order.id)).offer?.runnerId).toBe(runner.runnerId);

    // A new certificate, accepted: the reminders start again for the new date.
    const renewed = await insuredUntil('2027-10-17');
    expect(reminderDue(renewed, harness.now(), [30, 7, 1])).toBeNull();
    expect(
      reminderDue(
        renewed,
        new Date('2027-10-10T09:00:00.000Z'),
        harness.config.runners.insuranceReminderDays,
      ),
    ).toBe(7);
  });
});

// The private referral reward of £150 at 100 referrals (rulings 12 and 16) was replaced by the
// referral levels for everybody (Anthony, 30 October 2026): see referrals.test.ts.
describe('a Runner’s link', () => {
  it('a Shopper can come by a Runner’s link', async () => {
    const code = (await harness.repository.runners.findById(runner.runnerId))!.referralCode;
    const made = await post('/shoppers', {
      displayName: 'Bola',
      phone: '+447700900321',
      joinedVia: `runner:${code}`,
    });
    expect(made.statusCode, made.body).toBe(201);
    expect((await harness.repository.shoppers.listReferred()).map((s) => s.joinedVia)).toEqual([
      `runner:${code}`,
    ]);
  });
});
