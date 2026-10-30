/**
 * Orders no Runner takes (Anthony, 30 October 2026). A paid order no Runner has accepted two
 * hours (`dispatch.autoRefundAfterMinutes`, 120) after it was paid is cancelled with a full
 * refund through the same path staff use; a booked order counts from the start of its window.
 * The Shopper is told the reason by text and in their inbox; the audit log says "Ozi
 * (automatic)". An order the office sent to a named Runner, or one already with a Runner, is
 * left alone; a split order is cancelled whole only when no part has a Runner; the refund is
 * made once, however often the sweep runs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NO_RUNNER_REFUND_REASON, refundUntakenOrders } from '../src/services/order-rescue.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const NOW = new Date('2026-10-30T10:00:00.000Z');
const MINUTE = 60_000;

let harness: TestHarness;
let shopper: SignedInShopper;
let milk: string;
let texts: Array<{ to: string; body: string }>;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(NOW, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string>) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function placeOrder(): Promise<string> {
  const lines = [{ catalogueItemId: milk, quantity: 2 }];
  const priced = await post('/basket/price', { lines }, shopper.authHeader);
  expect(priced.statusCode, priced.body).toBe(200);
  const placed = await post(
    '/orders',
    {
      lines,
      deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: priced.json().totalPence as number,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json().order.id as string;
}

const sweep = () => refundUntakenOrders(harness.app.ctx, harness.app.log);
const refunds = () => harness.payments.calls.filter((call) => call.kind === 'refund');
const at = (minutes: number) => harness.setNow(new Date(NOW.getTime() + minutes * MINUTE));

describe('a paid order no Runner takes', () => {
  it('is cancelled with a full refund two hours after it was paid, and not before', async () => {
    const orderId = await placeOrder();
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(['paid', 'offered']).toContain(order.status);

    at(119);
    expect(await sweep()).toEqual([]);
    expect(refunds()).toHaveLength(0);

    at(120);
    expect(await sweep()).toEqual([orderId]);
    const cancelled = (await harness.repository.orders.findById(orderId))!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe(`Cancelled by Ozi (automatic): ${NO_RUNNER_REFUND_REASON}`);
    // The whole amount, once.
    expect(refunds()).toHaveLength(1);
    expect(refunds()[0]!.input).toMatchObject({
      amountPence: order.totalEstimatePence,
      reference: `cancel:${orderId}`,
    });
  });

  it('tells the Shopper the reason by text and in their inbox, and writes it in the audit log', async () => {
    const orderId = await placeOrder();
    at(121);
    await sweep();
    const text = texts.find((row) => row.body.includes(NO_RUNNER_REFUND_REASON));
    expect(text?.body).toMatch(
      /^[^:]+: No Runner was able to take your order, so it has been cancelled and your money given back in full\. £\d+\.\d\d is going back to your card\./,
    );
    const inbox = (
      await harness.app.inject({ method: 'GET', url: '/inbox', headers: shopper.authHeader })
    ).json();
    expect(inbox.messages.map((row: { text: string }) => row.text).join(' ')).toContain(
      NO_RUNNER_REFUND_REASON,
    );
    expect(inbox.unread).toBe(1);
    const entries = await harness.repository.audit.list({ limit: 20 });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorName: 'Ozi (automatic)',
          action: 'order.auto-cancelled',
          target: `order=${orderId}`,
        }),
      ]),
    );
  });

  it('refunds once, however often the sweep runs', async () => {
    const orderId = await placeOrder();
    at(130);
    expect(await sweep()).toEqual([orderId]);
    expect(await sweep()).toEqual([]);
    at(500);
    expect(await sweep()).toEqual([]);
    expect(refunds()).toHaveLength(1);
    expect(texts.filter((row) => row.body.includes(NO_RUNNER_REFUND_REASON))).toHaveLength(1);
  });
});

describe('what is left alone', () => {
  it('an order a Runner has taken', async () => {
    const orderId = await placeOrder();
    const runner = await signUpRunner(harness);
    await harness.repository.orders.update(orderId, {
      runnerId: runner.runnerId,
      status: 'accepted',
    });
    at(300);
    expect(await sweep()).toEqual([]);
    expect((await harness.repository.orders.findById(orderId))?.status).toBe('accepted');
  });

  it('an order the office sent to a named Runner, which a person is handling', async () => {
    const orderId = await placeOrder();
    const runner = await signUpRunner(harness);
    await harness.repository.allocations.create({
      orderId,
      runnerId: runner.runnerId,
      allocatedById: null,
      allocatedByName: 'Grace',
      allocatedAt: harness.now(),
    });
    at(300);
    expect(await sweep()).toEqual([]);
    expect(refunds()).toHaveLength(0);
  });

  it('a booked order before two hours from the start of its window', async () => {
    const orderId = await placeOrder();
    // Booked for the morning of Saturday 31 October: the window starts at 08:00 (GMT).
    await harness.repository.orders.update(orderId, {
      deliveryDay: '2026-10-31',
      deliveryWindow: 'morning',
      offerAt: new Date('2026-10-31T07:00:00.000Z'),
    });
    harness.setNow(new Date('2026-10-31T09:59:00.000Z'));
    expect(await sweep()).toEqual([]);
    harness.setNow(new Date('2026-10-31T10:00:00.000Z'));
    expect(await sweep()).toEqual([orderId]);
  });
});

describe('a split order', () => {
  async function splitInto(orderId: string, parts: number) {
    const whole = (await harness.repository.orders.findById(orderId))!;
    await harness.repository.orders.update(orderId, { splitAt: harness.now() });
    const made = [];
    for (let part = 1; part <= parts; part += 1) {
      made.push(
        await harness.repository.orders.create({
          shopperId: whole.shopperId,
          status: 'offered',
          goodsEstimatePence: 100,
          feePence: 0,
          totalEstimatePence: 100,
          deliveryAddress: whole.deliveryAddress,
          splitParentId: orderId,
          splitPart: part,
          splitOf: parts,
          items: [],
        }),
      );
    }
    return made;
  }

  it('is cancelled whole, once, when no part has a Runner; its parts are never refunded alone', async () => {
    const orderId = await placeOrder();
    const parts = await splitInto(orderId, 2);
    at(121);
    expect(await sweep()).toEqual([orderId]);
    for (const part of parts) {
      expect((await harness.repository.orders.findById(part.id))?.status).toBe('cancelled');
    }
    expect(refunds()).toHaveLength(1);
  });

  it('is left for a person once any part has a Runner', async () => {
    const orderId = await placeOrder();
    const [first] = await splitInto(orderId, 2);
    const runner = await signUpRunner(harness);
    await harness.repository.orders.update(first!.id, {
      runnerId: runner.runnerId,
      status: 'accepted',
    });
    at(300);
    expect(await sweep()).toEqual([]);
    expect(refunds()).toHaveLength(0);
  });
});
