/**
 * Telling the Shopper how their order is going (Section G, rulings 28 and 45): a notification
 * where they allowed one, otherwise a text to a mobile, never a Runner's number.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { tellShopper } from '../src/services/order-updates.js';
import { buildTestApp, signUpRunner, signUpShopper, type TestHarness } from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

async function anOrder(shopperId: string, runnerId: string | null, doorWord?: string) {
  const order = await harness.repository.orders.create({
    shopperId,
    status: 'paid',
    goodsEstimatePence: 100,
    feePence: 1350,
    totalEstimatePence: 1450,
    deliveryAddress: '1 High Street',
    items: [],
  });
  return runnerId
    ? harness.repository.orders.update(order.id, { runnerId, ...(doorWord ? { doorWord } : {}) })
    : order;
}

describe('order updates', () => {
  it('texts a Shopper with no notifications, by the Runner’s first name only', async () => {
    const texts: Array<{ to: string; body: string }> = [];
    harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
      sendText: async (to, body) => {
        texts.push({ to, body });
      },
    });
    const shopper = await signUpShopper(harness);
    const runner = await signUpRunner(harness, { name: 'Tomasz Nowak', phone: '+447700900555' });
    const order = await anOrder(shopper.shopperId, runner.runnerId);
    await tellShopper(harness.app.ctx, order, 'delivering', harness.app.log);
    expect(texts).toEqual([
      {
        to: '+447700900001',
        body: `${harness.config.productName}: Tomasz has your shopping and is on the way to you.`,
      },
    ]);
    expect(texts[0]!.body).not.toContain('7700900555');
  });

  it('gives the door words when a Runner takes it, and the feedback credit when it arrives', async () => {
    const texts: string[] = [];
    harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
      sendText: async (_to, body) => {
        texts.push(body);
      },
    });
    const shopper = await signUpShopper(harness);
    const runner = await signUpRunner(harness, { name: 'Sam Okoro', phone: '+447700900555' });
    const order = await anOrder(shopper.shopperId, runner.runnerId, 'blue kettle');
    await tellShopper(harness.app.ctx, order, 'accepted', harness.app.log);
    await tellShopper(harness.app.ctx, order, 'delivered', harness.app.log);
    expect(texts).toEqual([
      `${harness.config.productName}: Sam has your order. At your door Sam will say: 'blue kettle'.`,
      `${harness.config.productName}: Sam has delivered your shopping. Tell us how it went and get £1 off next time.`,
    ]);
    // The motto belongs on the first screen, not in a text about a delivery.
    expect(texts[1]).not.toContain(harness.config.motto);
  });

  it('uses a notification instead, where the Shopper allowed one', async () => {
    const texts: string[] = [];
    const pushed: string[] = [];
    harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
      sendText: async (_to, body) => {
        texts.push(body);
      },
      sendPush: async (_target, message) => {
        pushed.push(message.body);
        return 'sent';
      },
    });
    const shopper = await signUpShopper(harness);
    await harness.repository.pushSubscriptions.save({
      shopperId: shopper.shopperId,
      endpoint: 'https://push.example.test/1',
      p256dh: 'key',
      auth: 'auth',
      createdAt: harness.now(),
    });
    const order = await anOrder(shopper.shopperId, null);
    await tellShopper(harness.app.ctx, order, 'paid', harness.app.log);
    expect(pushed).toEqual(['We have your order and are finding a Runner now.']);
    expect(texts).toEqual([]);
  });
});
