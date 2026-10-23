/**
 * Ordering now for a later day (ruling 78). A booked order is not offered to Runners until its
 * day, and is offered then; the money is taken now, at the day and time the Shopper chose (tried
 * again every hour up to the most tries, a bank's check stopping the tries and sending a link),
 * or by bank transfer before the day; unpaid at its offer time it is held; the till on the day
 * still settles the difference; cancelling gives every penny back; the Shopper is reminded and
 * the owner has one summary each morning; and the bank page is not for Runners.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setBankSettings } from '../src/lib/bank.js';
import { sweepOffers } from '../src/services/dispatch.js';
import { PAYMENT_FAILED_WORDS, sweepScheduled } from '../src/services/scheduled.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

/** Friday 23 October 2026, 10:00 in London. */
const START = new Date('2026-10-23T09:00:00.000Z');
/** Saturday 31 October 2026 (after the clocks go back, so London is on UTC). */
const DAY = '2026-10-31';
const DAY_WORDS = 'Saturday 31 October';
/** The morning window starts at 08:00; the order is offered 90 minutes before. */
const OFFER_AT = new Date('2026-10-31T06:30:00.000Z');
const TOTAL = 250 + 100 + 1099;
const SHOPPER_PHONE = '+447700900001';
const OWNER_PHONE = '+447700900999';

let harness: TestHarness;
let shopper: SignedInShopper;
let milk: string;
let texts: Array<{ to: string; body: string }>;

beforeEach(async () => {
  texts = [];
  setBankSettings({
    enabled: true,
    accountName: 'Example Shop Ltd',
    sortCode: '12-34-56',
    accountNumber: '12345678',
    referencePrefix: 'OZI',
    payWithinHours: 24,
  });
  harness = await buildTestApp(START, {
    autoOffer: true,
    env: { ownerAlertPhone: OWNER_PHONE },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  ({ milk } = await seedCatalogue(harness.repository));
  shopper = await signUpShopper(harness, { phone: SHOPPER_PHONE });
});

afterEach(async () => {
  setBankSettings(null);
  await harness.close();
});

function book(
  schedule: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  statement = `Send my order and pay. Delivered on ${DAY_WORDS}, in the morning.`,
) {
  return harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street',
      paymentMethodId: shopper.paymentMethodId,
      schedule: { deliveryDay: DAY, window: 'morning', ...schedule },
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement,
        agreedTotalPence: TOTAL,
      },
      ...extra,
    },
  });
}

async function bookOk(schedule: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const placed = await book(schedule, extra);
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json() as {
    order: { id: string; status: string };
    message: string;
    scheduled?: boolean;
    bank?: Record<string, unknown>;
  };
}

const at = (iso: string): void => harness.setNow(new Date(iso));
const sweep = () => sweepScheduled(harness.app.ctx, harness.app.log);
const offerSweep = () => sweepOffers(harness.app.ctx);
const order = async (id: string) => (await harness.repository.orders.findById(id))!;
const callsOf = (kind: string) => harness.payments.calls.filter((call) => call.kind === kind);
const shopperTexts = () => texts.filter((text) => text.to === SHOPPER_PHONE).map((t) => t.body);

describe('booking a later day', () => {
  it('is not offered to Runners early, and is offered on the day', async () => {
    await signUpRunner(harness);
    const placed = await bookOk({ pay: 'now' });
    // Paid now, as agreed: captured at the yes.
    expect(callsOf('payment_intent')).toHaveLength(1);
    expect(placed.order.status).toBe('paid');
    expect(placed.message).toContain(`booked for ${DAY_WORDS}, in the morning`);
    expect(await harness.repository.offers.listForOrder(placed.order.id)).toHaveLength(0);

    at('2026-10-31T06:29:00.000Z');
    await offerSweep();
    expect(await harness.repository.offers.listForOrder(placed.order.id)).toHaveLength(0);
    expect((await order(placed.order.id)).status).toBe('paid');

    at(OFFER_AT.toISOString());
    await offerSweep();
    expect(await harness.repository.offers.listForOrder(placed.order.id)).toHaveLength(1);
    expect((await order(placed.order.id)).status).toBe('offered');
  });

  it('refuses a day more than 28 days ahead, and words that do not name the day', async () => {
    const far = await book({ deliveryDay: '2026-11-21', pay: 'now' });
    expect(far.statusCode).toBe(400);
    expect(far.json().error.message).toContain('28 days');
    const vague = await book({ pay: 'now' }, {}, 'Send my order and pay.');
    expect(vague.statusCode).toBe(400);
    expect(vague.json().error.message).toContain(DAY_WORDS);
    expect(harness.payments.calls).toHaveLength(0);
  });
});

describe('taking the money on a chosen day and time', () => {
  const PAYDAY = { pay: 'scheduled', chargeDay: '2026-10-30', chargeTime: '00:05' };
  const CHARGE_AT = '2026-10-30T00:05:00.000Z';

  it('takes nothing at the yes, and the whole amount at the time', async () => {
    const placed = await bookOk(PAYDAY);
    expect(placed.scheduled).toBe(true);
    expect(placed.order.status).toBe('confirmed');
    expect(harness.payments.calls).toHaveLength(0);
    expect(placed.message).toContain('on Friday 30 October at 00:05');

    at('2026-10-30T00:04:00.000Z');
    await sweep();
    expect(callsOf('off_session_charge')).toHaveLength(0);

    at(CHARGE_AT);
    await sweep();
    const charges = callsOf('off_session_charge');
    expect(charges).toHaveLength(1);
    expect(charges[0]!.input).toMatchObject({ amountPence: TOTAL, customerId: expect.any(String) });
    const paid = await order(placed.order.id);
    expect(paid).toMatchObject({ status: 'paid', chargeStatus: 'paid', chargeTries: 1 });
    // Still not offered: its day has not come.
    expect(await harness.repository.offers.listForOrder(paid.id)).toHaveLength(0);
    // No amount in any text to the Shopper.
    for (const body of shopperTexts()) expect(body).not.toMatch(/£\d/);
  });

  it('tries again every hour up to six tries, telling the Shopper and the desk once', async () => {
    const placed = await bookOk(PAYDAY);
    harness.payments.offSessionOutcomes = Array(10).fill('decline');

    at(CHARGE_AT);
    await sweep();
    expect(await order(placed.order.id)).toMatchObject({
      chargeStatus: 'retrying',
      chargeTries: 1,
    });
    expect(shopperTexts()).toContainEqual(expect.stringContaining(PAYMENT_FAILED_WORDS));
    const matters = await harness.repository.ownerDesk.findMattersFor(
      'scheduled_payment',
      placed.order.id,
    );
    expect(matters).toHaveLength(1);

    // Not before the hour.
    at('2026-10-30T01:04:00.000Z');
    await sweep();
    expect(callsOf('off_session_charge')).toHaveLength(1);

    for (let hour = 1; hour <= 6; hour += 1) {
      at(new Date(new Date(CHARGE_AT).getTime() + hour * 3_600_000).toISOString());
      await sweep();
    }
    // Six tries in all, then no more.
    expect(callsOf('off_session_charge')).toHaveLength(6);
    expect(await order(placed.order.id)).toMatchObject({
      status: 'confirmed',
      chargeStatus: 'failed',
      chargeTries: 6,
      chargeNextTryAt: null,
    });
    const failures = shopperTexts().filter((body) => body.includes(PAYMENT_FAILED_WORDS));
    // After the first refusal, and once more when the tries stop.
    expect(failures).toHaveLength(2);
    for (const body of shopperTexts()) expect(body).not.toMatch(/£\d/);
  });

  it('stops trying when the bank asks to check, and sends a link to pay', async () => {
    const placed = await bookOk(PAYDAY);
    harness.payments.offSessionOutcomes = ['authenticate'];
    at(CHARGE_AT);
    await sweep();
    expect(await order(placed.order.id)).toMatchObject({
      status: 'confirmed',
      chargeStatus: 'needs_authentication',
    });
    expect(callsOf('payment_link')).toHaveLength(1);
    expect(shopperTexts()).toContainEqual(
      expect.stringContaining('https://checkout.rehearsal.invalid/'),
    );
    at('2026-10-30T03:05:00.000Z');
    await sweep();
    expect(callsOf('off_session_charge')).toHaveLength(1);

    // Paid on the link: the order is paid, and still waits for its day.
    const sessionId = 'cs_rehearsal_x';
    const completed = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'rehearsal' },
      payload: {
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: { id: sessionId, metadata: { orderId: placed.order.id } } },
      },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const paid = await order(placed.order.id);
    expect(paid).toMatchObject({
      status: 'paid',
      chargeStatus: 'paid',
      deliveryAddress: '12 Example Street',
    });
    expect(await harness.repository.offers.listForOrder(paid.id)).toHaveLength(0);
  });

  it('is held, not sent to a Runner, when still unpaid at its offer time', async () => {
    await signUpRunner(harness);
    const placed = await bookOk(PAYDAY);
    harness.payments.offSessionOutcomes = Array(10).fill('decline');
    at(CHARGE_AT);
    await sweep();
    at(OFFER_AT.toISOString());
    await sweep();
    await offerSweep();
    const held = await order(placed.order.id);
    expect(held.status).toBe('confirmed');
    expect(held.scheduledHeldAt).not.toBeNull();
    expect(await harness.repository.offers.listForOrder(held.id)).toHaveLength(0);
    expect(shopperTexts()).toContainEqual(expect.stringContaining('no Runner has been sent'));
    expect(texts).toContainEqual(
      expect.objectContaining({
        to: OWNER_PHONE,
        body: expect.stringContaining('not paid by its time'),
      }),
    );

    // It waits, and the Shopper can cancel it: nothing was taken, so nothing to give back.
    const cancelled = await harness.app.inject({
      method: 'POST',
      url: `/orders/${held.id}/booking/cancel`,
      headers: shopper.authHeader,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().message).toContain('Nothing was taken');
    expect((await order(held.id)).status).toBe('cancelled');
    expect(callsOf('refund')).toHaveLength(0);
  });
});

describe('the till on the day', () => {
  let runner: SignedInRunner;

  async function deliverWithTill(receiptTotalPence: number) {
    runner = await signUpRunner(harness);
    const placed = await bookOk({ pay: 'now' });
    at(OFFER_AT.toISOString());
    await offerSweep();
    const offer = (await harness.repository.offers.listForOrder(placed.order.id))[0]!;
    await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    await harness.app.inject({
      method: 'POST',
      url: `/orders/${placed.order.id}/status`,
      headers: runner.authHeader,
      payload: { status: 'shopping' },
    });
    const sent = await harness.app.inject({
      method: 'POST',
      url: `/orders/${placed.order.id}/receipt`,
      headers: runner.authHeader,
      payload: { receiptTotalPence },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    return sent.json().settled as { kind: string; pence: number };
  }

  it('takes the difference from the saved card when prices have gone up', async () => {
    expect(await deliverWithTill(300)).toEqual({ kind: 'charged', pence: 50 });
    expect(callsOf('saved_card_charge')).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 50 }) }),
    ]);
  });

  it('gives the difference back when prices have gone down', async () => {
    expect(await deliverWithTill(200)).toEqual({ kind: 'refunded', pence: 50 });
    expect(callsOf('refund')).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 50 }) }),
    ]);
  });
});

describe('the Shopper changing or cancelling', () => {
  it('gives every penny back when a paid booking is cancelled', async () => {
    const placed = await bookOk({ pay: 'now' });
    const cancelled = await harness.app.inject({
      method: 'POST',
      url: `/orders/${placed.order.id}/booking/cancel`,
      headers: shopper.authHeader,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().refundedPence).toBe(TOTAL);
    expect(callsOf('refund')).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: TOTAL }) }),
    ]);
    expect((await order(placed.order.id)).status).toBe('refunded');
  });

  it('lists booked orders, and moves one to another day', async () => {
    const placed = await bookOk({ pay: 'scheduled', chargeDay: '2026-10-30', chargeTime: '00:05' });
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/orders/booked',
      headers: shopper.authHeader,
    });
    expect(listed.json().orders).toEqual([
      expect.objectContaining({
        id: placed.order.id,
        deliveryWords: `${DAY_WORDS}, in the morning, 8:00 to 12:00`,
        chargeWords: 'on Friday 30 October at 00:05',
        canChange: true,
        canCancel: true,
      }),
    ]);
    const changed = await harness.app.inject({
      method: 'POST',
      url: `/orders/${placed.order.id}/booking`,
      headers: shopper.authHeader,
      payload: { deliveryDay: '2026-11-07', window: 'evening' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const moved = await order(placed.order.id);
    expect(moved).toMatchObject({ deliveryDay: '2026-11-07', deliveryWindow: 'evening' });
    expect(moved.offerAt?.toISOString()).toBe('2026-11-07T15:30:00.000Z');
  });
});

describe('reminders', () => {
  it('reminds the Shopper the day before and on the morning, and gives the owner one summary', async () => {
    const first = await bookOk({ pay: 'now' });
    await bookOk({ pay: 'now' });
    expect(shopperTexts()).toContainEqual(expect.stringContaining(`booked for ${DAY_WORDS}`));

    at('2026-10-30T17:59:00.000Z');
    await sweep();
    expect(shopperTexts().filter((body) => body.includes('comes tomorrow'))).toHaveLength(0);
    at('2026-10-30T18:00:00.000Z');
    await sweep();
    expect(shopperTexts().filter((body) => body.includes('comes tomorrow'))).toHaveLength(2);
    await sweep();
    expect(shopperTexts().filter((body) => body.includes('comes tomorrow'))).toHaveLength(2);

    at('2026-10-31T07:00:00.000Z');
    await sweep();
    await sweep();
    const summaries = await harness.repository.ownerDesk.findMattersFor(
      'scheduled_today',
      `scheduled-${DAY}`,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.summary).toContain('2 booked orders: 2 in the morning');

    at('2026-10-31T07:30:00.000Z');
    await sweep();
    expect(shopperTexts().filter((body) => body.includes('comes today'))).toHaveLength(2);
    expect((await order(first.order.id)).reminderMorningAt).not.toBeNull();
    for (const body of shopperTexts()) expect(body).not.toMatch(/£\d/);
  });
});

describe('Runners and the bank page', () => {
  it('shows Runners how many are booked for tomorrow, and nothing about anybody', async () => {
    const runner = await signUpRunner(harness);
    await bookOk({ pay: 'now' });
    at('2026-10-30T12:00:00.000Z');
    const booked = await harness.app.inject({
      method: 'GET',
      url: '/runner/booked',
      headers: runner.authHeader,
    });
    expect(booked.json()).toEqual({
      day: DAY,
      total: 1,
      morning: 1,
      afternoon: 0,
      evening: 0,
    });
  });

  it('shows the bank details to Shoppers, never to Runners', async () => {
    const runner = await signUpRunner(harness);
    const refused = await harness.app.inject({
      method: 'GET',
      url: '/pay-by-bank',
      headers: runner.authHeader,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain('12345678');

    const shown = await harness.app.inject({
      method: 'GET',
      url: '/pay-by-bank',
      headers: shopper.authHeader,
    });
    expect(shown.json()).toMatchObject({
      enabled: true,
      accountName: 'Example Shop Ltd',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      reference: expect.stringMatching(/^OZI-S[A-Z2-9]{6}$/),
    });
  });

  it('books a bank transfer to arrive by the day before', async () => {
    const placed = await bookOk({ pay: 'bank' }, { payBy: 'bank', paymentMethodId: undefined });
    expect(placed.order.status).toBe('confirmed');
    expect(placed.bank).toMatchObject({ payByDay: '2026-10-30', amountPence: TOTAL });
    expect(placed.message).toContain('by Friday 30 October');
    expect(harness.payments.calls).toHaveLength(0);
  });
});
