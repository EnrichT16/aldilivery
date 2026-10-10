/**
 * Paying by bank transfer to the business account (ruling 50): the order waits with its own
 * reference, the owner is told, staff mark it as received in the Payments tab, and only then is
 * it paid and sent to a Runner. A receipt can be downloaded for any paid order.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setBankSettings } from '../src/lib/bank.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  STAFF,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

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
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
    env: { ownerAlertPhone: '+447700900999' },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  ({ milk } = await seedCatalogue(harness.repository));
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  setBankSettings(null);
  await harness.close();
});

function order(payBy: 'bank' | 'card' = 'bank') {
  return harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street',
      payBy,
      ...(payBy === 'card' ? { paymentMethodId: shopper.paymentMethodId } : {}),
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 799,
      },
    },
  });
}

describe('paying by bank transfer', () => {
  it('waits with a reference, tells the owner, and is paid only when staff mark it received', async () => {
    const placed = await order();
    expect(placed.statusCode, placed.body).toBe(201);
    const body = placed.json();
    expect(body.bank).toMatchObject({
      accountName: 'Example Shop Ltd',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      amountPence: 250 + 100 + 799,
    });
    expect(body.bank.reference).toMatch(/^OZI-[A-Z2-9]{6}$/);
    expect(body.order).toMatchObject({ status: 'confirmed', paidBy: 'bank' });
    expect(harness.payments.calls).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(texts).toContainEqual(
      expect.objectContaining({
        to: '+447700900999',
        body: expect.stringContaining(body.bank.reference),
      }),
    );

    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/payments',
      headers: STAFF,
    });
    expect(list.json().waiting).toEqual([
      expect.objectContaining({ reference: body.bank.reference, amountPence: 250 + 100 + 799 }),
    ]);

    const received = await harness.app.inject({
      method: 'POST',
      url: `/staff/payments/${body.order.id}/received`,
      headers: STAFF,
    });
    expect(received.statusCode, received.body).toBe(200);
    const paid = await harness.repository.orders.findById(body.order.id);
    expect(paid?.status).toBe('paid');
    const after = await harness.app.inject({
      method: 'GET',
      url: '/staff/payments',
      headers: STAFF,
    });
    expect(after.json().waiting).toEqual([]);
    expect(after.json().received[0]).toMatchObject({ reference: body.bank.reference });

    const receipt = await harness.app.inject({
      method: 'GET',
      url: `/orders/${body.order.id}/receipt.pdf`,
      headers: shopper.authHeader,
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect(receipt.body).toContain(body.bank.reference);
  });

  it('can be cancelled before it arrives, and is refused while switched off', async () => {
    const placed = (await order()).json();
    const cancelled = await harness.app.inject({
      method: 'POST',
      url: `/staff/payments/${placed.order.id}/cancel`,
      headers: STAFF,
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await harness.repository.orders.findById(placed.order.id))?.status).toBe('cancelled');

    setBankSettings({
      ...{
        enabled: false,
        accountName: '',
        sortCode: '',
        accountNumber: '',
        referencePrefix: 'OZI',
        payWithinHours: 24,
      },
    });
    expect((await order()).statusCode).toBe(400);
    // A card still works as before.
    expect((await order('card')).statusCode).toBe(201);
  });

  it('is only for staff whose job includes payments', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/staff/payments' })).statusCode).toBe(
      403,
    );
  });
});
