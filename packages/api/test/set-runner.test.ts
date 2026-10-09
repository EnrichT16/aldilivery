/**
 * Regular orders on a clock (STILL_TO_DO item 4; Rule Five).
 *
 * The server sends the notice thirty minutes before, by notification or text, honours the one
 * word skip however it comes, and then places and pays for a Set the Shopper agreed should send
 * itself, exactly once for each occurrence. A Set that is only a reminder is never paid for.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { twilioSignature } from '../src/lib/twilio-voice.js';
import { sweepSets } from '../src/services/set-runner.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const AGREED = 'Send it and pay for it with my saved card each time, unless I say skip.';
/** Wednesday 16 September 2026, the first time the Set is due (times here are UTC). */
const FIRE_AT = new Date('2026-09-16T09:00:00.000Z');
const ORIGIN = 'https://shop.example.test';
const TOKEN = 'twilio-auth-token-for-tests';

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;
let texts: Array<{ to: string; body: string }>;
let canText: boolean;

beforeEach(async () => {
  texts = [];
  canText = true;
  harness = await buildTestApp(new Date('2026-09-09T09:00:00.000Z'), {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN },
    sendText: async (to, body) => {
      if (!canText) throw new Error('No signal.');
      texts.push({ to, body });
    },
  });
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

async function createSet(autoSend: boolean) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/sets',
    headers: shopper.authHeader,
    payload: {
      name: 'Weekly shop',
      deliveryAddress: '12 Example Street',
      frequency: 'weekly',
      dayOfWeek: 3,
      timeOfDay: '09:00',
      paymentMethodId: shopper.paymentMethodId,
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      ...(autoSend ? { autoSend: { confirmed: true, statement: AGREED } } : {}),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { set: { id: string; nextFireAt: string }; promise: string };
}

/** The minute sweep, at a given moment. */
async function sweepAt(at: string) {
  harness.setNow(new Date(at));
  return sweepSets(harness.app.ctx, harness.app.log);
}

const charges = () => harness.payments.calls.filter((call) => call.kind === 'saved_card_charge');

describe('a Set that sends itself', () => {
  it('says so when it is set up, and needs a saved card of the Shopper’s own', async () => {
    const { promise } = await createSet(true);
    expect(promise).toContain('sent and paid for with your saved card');
    const without = await harness.app.inject({
      method: 'POST',
      url: '/sets',
      headers: shopper.authHeader,
      payload: {
        name: 'Weekly shop',
        deliveryAddress: '12 Example Street',
        frequency: 'weekly',
        dayOfWeek: 3,
        timeOfDay: '09:00',
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        autoSend: { confirmed: true, statement: AGREED },
      },
    });
    expect(without.statusCode).toBe(400);
  });

  it('sends the notice by text at least thirty minutes before, with the skip word', async () => {
    await createSet(true);
    // A minute's sweep a little before the half hour sends it, so it is never late.
    expect(await sweepAt('2026-09-16T08:20:00.000Z')).toEqual([]);
    const outcomes = await sweepAt('2026-09-16T08:28:00.000Z');
    expect(outcomes).toEqual([expect.objectContaining({ kind: 'notice-sent' })]);
    expect(texts).toHaveLength(1);
    expect(texts[0]?.body).toContain('goes in 32 minutes');
    expect(texts[0]?.body).toContain('"skip"');
    // Once only.
    await sweepAt('2026-09-16T08:29:00.000Z');
    expect(texts).toHaveLength(1);
  });

  it('places the order and pays with the saved card, with the agreement written on it first', async () => {
    await createSet(true);
    await sweepAt('2026-09-16T08:29:00.000Z');
    const outcomes = await sweepAt('2026-09-16T09:00:30.000Z');
    expect(outcomes).toEqual([expect.objectContaining({ kind: 'placed' })]);

    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    expect(order.status).toBe('paid');
    expect(order.totalEstimatePence).toBe(250 + 1350);
    expect(order.confirmationChannel).toBe('set');
    expect(order.confirmationStatement).toContain(AGREED);
    expect(order.spokenConfirmationAt).not.toBeNull();
    expect(order.setFireAt?.toISOString()).toBe(FIRE_AT.toISOString());
    expect(charges()).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({ amountPence: 1600, reference: `order:${order.id}` }),
      }),
    ]);
    expect(texts.at(-1)?.body).toContain('£16.00 has been taken from your card ending 4242');

    // The Set moves on to next week, needing its own notice.
    const set = (await harness.repository.sets.listForShopper(shopper.shopperId))[0]!;
    expect(set.nextFireAt.toISOString()).toBe('2026-09-23T09:00:00.000Z');
    expect(set.noticeSentAt).toBeNull();
  });

  it('places each occurrence once only, however often the sweep runs', async () => {
    const { set } = await createSet(true);
    await sweepAt('2026-09-16T08:29:00.000Z');
    // A sweep that stopped half way: the order is there, the Set did not move on.
    const stored = (await harness.repository.sets.findById(set.id))!;
    await sweepAt('2026-09-16T09:00:00.000Z');
    await harness.repository.sets.update(set.id, {
      nextFireAt: stored.nextFireAt,
      noticeSentAt: stored.noticeSentAt,
    });
    await sweepAt('2026-09-16T09:01:00.000Z');
    expect(charges()).toHaveLength(1);
    expect(await harness.repository.orders.listForShopper(shopper.shopperId)).toHaveLength(1);
  });

  it('is stopped by the skip word texted back, and nothing is taken', async () => {
    await createSet(true);
    await sweepAt('2026-09-16T08:29:00.000Z');
    const params = { From: '+447700900001', Body: 'Skip.' };
    const reply = await harness.app.inject({
      method: 'POST',
      url: '/api/webhooks/twilio/sms',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': twilioSignature(TOKEN, `${ORIGIN}/api/webhooks/twilio/sms`, params),
      },
      payload: new URLSearchParams(params).toString(),
    });
    expect(reply.body).toContain('That one is cancelled');
    expect(await sweepAt('2026-09-16T09:00:00.000Z')).toEqual([
      expect.objectContaining({ kind: 'skipped' }),
    ]);
    expect(charges()).toHaveLength(0);
  });

  it('is stopped by the skip in the app too', async () => {
    const { set } = await createSet(true);
    await sweepAt('2026-09-16T08:29:00.000Z');
    await harness.app.inject({
      method: 'POST',
      url: `/sets/${set.id}/skip`,
      headers: shopper.authHeader,
      payload: { reply: 'skip' },
    });
    await sweepAt('2026-09-16T09:00:00.000Z');
    expect(charges()).toHaveLength(0);
  });

  it('is never paid for when the notice could not reach the Shopper', async () => {
    await createSet(true);
    canText = false;
    await sweepAt('2026-09-16T08:29:00.000Z');
    canText = true;
    expect(await sweepAt('2026-09-16T09:00:00.000Z')).toEqual([
      expect.objectContaining({ kind: 'missed', because: 'notice_not_sent' }),
    ]);
    expect(charges()).toHaveLength(0);
    expect(texts.at(-1)?.body).toContain('was not sent this time');
  });

  it('is not sent over the Shopper’s own spending limit', async () => {
    await createSet(true);
    await harness.repository.shoppers.update(shopper.shopperId, { budgetCapPence: 100 });
    await sweepAt('2026-09-16T08:29:00.000Z');
    expect(await sweepAt('2026-09-16T09:00:00.000Z')).toEqual([
      expect.objectContaining({ kind: 'not-placed', because: 'over the spending limit' }),
    ]);
    expect(charges()).toHaveLength(0);
  });

  it('cancels the order and takes nothing when the card is refused', async () => {
    await createSet(true);
    harness.payments.declineNextCharge = true;
    await sweepAt('2026-09-16T08:29:00.000Z');
    expect(await sweepAt('2026-09-16T09:00:00.000Z')).toEqual([
      expect.objectContaining({ kind: 'not-placed', because: 'payment refused' }),
    ]);
    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders[0]?.status).toBe('cancelled');
    expect(texts.at(-1)?.body).toContain('your card did not go through');
  });
});

describe('a Set that only reminds', () => {
  it('is never paid for: a reminder, then a draft', async () => {
    await createSet(false);
    await sweepAt('2026-09-16T08:29:00.000Z');
    expect(texts[0]?.body).toContain('Nothing is sent or paid until you say so');
    await sweepAt('2026-09-16T09:00:00.000Z');
    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders.map((order) => order.status)).toEqual(['draft']);
    expect(harness.payments.calls).toHaveLength(0);
  });
});
