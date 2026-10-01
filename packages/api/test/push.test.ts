/**
 * Notifications: a Shopper allows them on a device, and a Runner's question reaches that device
 * even when the Your order page is closed. The address must be a real push service, because the
 * server sends a request to whatever address is saved.
 */

import { describe, expect, it, vi } from 'vitest';

import { isPushServiceEndpoint, type PushMessage, type PushTarget } from '../src/lib/push.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const DEVICE = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authsecret' },
};

function subscribe(harness: TestHarness, shopper: SignedInShopper, body: unknown = DEVICE) {
  return harness.app.inject({
    method: 'POST',
    url: '/push-subscriptions',
    headers: shopper.authHeader,
    payload: body as Record<string, unknown>,
  });
}

async function withPush(outcome: 'sent' | 'gone' | 'fails' = 'sent') {
  const sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  const harness = await buildTestApp(undefined, {
    autoOffer: true,
    sendPush: async (target, message) => {
      sent.push({ target, message });
      if (outcome === 'fails') throw new Error('push service down');
      return outcome;
    },
  });
  const items = await seedCatalogue(harness.repository);
  const shopper = await signUpShopper(harness);
  const runner = await signUpRunner(harness);
  return { harness, items, shopper, runner, sent };
}

/** An order taken by the Runner and being shopped, ready for a question. */
async function shopping(setup: Awaited<ReturnType<typeof withPush>>) {
  const { harness, items, shopper, runner } = setup;
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        channel: 'button',
        statement: 'Send my order.',
        agreedTotalPence: 1600,
      },
    },
  });
  const orderId = (placed.json() as { order: { id: string } }).order.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  await harness.app.inject({
    method: 'POST',
    url: `/jobs/${offer.id}/accept`,
    headers: runner.authHeader,
  });
  await harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/status`,
    headers: runner.authHeader,
    payload: { status: 'shopping' },
  });
  const itemId = (await harness.repository.orders.findById(orderId))!.items[0]!.id;
  const ask = () =>
    harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
      payload: { orderItemId: itemId },
    });
  return { orderId, ask };
}

describe('the push service address', () => {
  it('accepts the browsers’ own push services over https', () => {
    expect(isPushServiceEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isPushServiceEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      true,
    );
    expect(isPushServiceEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isPushServiceEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('refuses anything else, so the server cannot be made to call any address', () => {
    expect(isPushServiceEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isPushServiceEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isPushServiceEndpoint('https://evilpush.apple.com.example/x')).toBe(false);
    expect(isPushServiceEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isPushServiceEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isPushServiceEndpoint('not a url')).toBe(false);
  });
});

describe('allowing notifications', () => {
  it('says in /config whether they can be offered', async () => {
    const off = await buildTestApp();
    expect((await off.app.inject({ url: '/config' })).json().push).toEqual({ publicKey: null });
    const { harness } = await withPush();
    expect((await harness.app.inject({ url: '/config' })).json().push).toEqual({
      publicKey: 'test-public-key',
    });
  });

  it('saves a device for the signed-in Shopper, once however often it is sent', async () => {
    const { harness, shopper } = await withPush();
    expect((await subscribe(harness, shopper)).statusCode).toBe(201);
    expect((await subscribe(harness, shopper)).statusCode).toBe(201);
    expect(
      await harness.repository.pushSubscriptions.listForShopper(shopper.shopperId),
    ).toHaveLength(1);
  });

  it('refuses an address that is not a push service, and anybody not signed in as a Shopper', async () => {
    const { harness, shopper, runner } = await withPush();
    const bad = await subscribe(harness, shopper, { ...DEVICE, endpoint: 'https://example.com/x' });
    expect(bad.statusCode).toBe(400);
    const asRunner = await harness.app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      headers: runner.authHeader,
      payload: DEVICE,
    });
    expect(asRunner.statusCode).toBe(401);
    const nobody = await harness.app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      payload: DEVICE,
    });
    expect(nobody.statusCode).toBe(401);
  });

  it('says plainly when notifications are not switched on', async () => {
    const harness = await buildTestApp();
    const shopper = await signUpShopper(harness);
    const response = await subscribe(harness, shopper);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe('Notifications are not switched on yet.');
  });

  it('turns them off for a device, but only the Shopper’s own', async () => {
    const { harness, shopper } = await withPush();
    await subscribe(harness, shopper);
    const other = await signUpShopper(harness, { phone: '+447700900999' });
    await harness.app.inject({
      method: 'DELETE',
      url: '/push-subscriptions',
      headers: other.authHeader,
      payload: { endpoint: DEVICE.endpoint },
    });
    expect(
      await harness.repository.pushSubscriptions.listForShopper(shopper.shopperId),
    ).toHaveLength(1);
    await harness.app.inject({
      method: 'DELETE',
      url: '/push-subscriptions',
      headers: shopper.authHeader,
      payload: { endpoint: DEVICE.endpoint },
    });
    expect(await harness.repository.pushSubscriptions.listForShopper(shopper.shopperId)).toEqual(
      [],
    );
  });
});

describe('a question reaching a closed page', () => {
  it('notifies every device the Shopper allowed, once per question, opening Your order', async () => {
    const setup = await withPush();
    await subscribe(setup.harness, setup.shopper);
    const { ask } = await shopping(setup);

    expect((await ask()).statusCode).toBe(201);
    await vi.waitFor(() => expect(setup.sent).toHaveLength(1));
    expect(setup.sent[0]!.target.endpoint).toBe(DEVICE.endpoint);
    expect(setup.sent[0]!.message).toMatchObject({
      title: 'A question from your Runner',
      body: expect.stringMatching(/^Tomasz cannot find .*milk.*\. Open this to choose/i),
      url: '/my-order',
    });

    // Asking about the same item again gives back the same question and sends nothing new.
    await ask();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(setup.sent).toHaveLength(1);
  });

  it('forgets a device the push service says is gone', async () => {
    const setup = await withPush('gone');
    await subscribe(setup.harness, setup.shopper);
    const { ask } = await shopping(setup);
    await ask();
    await vi.waitFor(async () =>
      expect(
        await setup.harness.repository.pushSubscriptions.listForShopper(setup.shopper.shopperId),
      ).toEqual([]),
    );
  });

  it('still asks the question when the push service fails', async () => {
    const setup = await withPush('fails');
    await subscribe(setup.harness, setup.shopper);
    const { ask } = await shopping(setup);
    expect((await ask()).statusCode).toBe(201);
    await vi.waitFor(() => expect(setup.sent).toHaveLength(1));
    // The device is kept: a failure is not the same as gone.
    expect(
      await setup.harness.repository.pushSubscriptions.listForShopper(setup.shopper.shopperId),
    ).toHaveLength(1);
  });
});
