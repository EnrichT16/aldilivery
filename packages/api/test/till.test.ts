/**
 * Settling the till total (ruling 52): less goes back to the card at once; a little more is
 * taken from the saved card; a lot more waits for a person, and the owner is told.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let texts: Array<{ to: string; body: string }>;
let orderId: string;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
    autoOffer: true,
    env: { ownerAlertPhone: '+447700900999' },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  const { milk } = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 799,
      },
    },
  });
  expect(placed.statusCode, placed.body).toBe(201);
  orderId = placed.json().order.id;
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
});

afterEach(async () => {
  await harness.close();
});

function receipt(receiptTotalPence: number) {
  return harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/receipt`,
    headers: runner.authHeader,
    payload: { receiptTotalPence },
  });
}

describe('the till total', () => {
  it('gives the difference back to the card when the till came to less', async () => {
    const sent = await receipt(200);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().settled).toEqual({ kind: 'refunded', pence: 50 });
    expect(harness.payments.calls).toContainEqual(
      expect.objectContaining({
        kind: 'refund',
        input: expect.objectContaining({ amountPence: 50, reference: `till:${orderId}` }),
      }),
    );
    expect(texts.some((t) => t.body.includes('going back to your card'))).toBe(true);
  });

  it('takes a small extra from the saved card when the till came to more', async () => {
    const sent = await receipt(300);
    expect(sent.json().settled).toEqual({ kind: 'charged', pence: 50 });
    expect(harness.payments.calls).toContainEqual(
      expect.objectContaining({
        kind: 'saved_card_charge',
        input: expect.objectContaining({ amountPence: 50, reference: `till:${orderId}` }),
      }),
    );
  });

  it('never takes a large extra by itself: a person decides, and the owner is told', async () => {
    const sent = await receipt(1000);
    expect(sent.json().settled).toMatchObject({ kind: 'needs-person', pence: 750 });
    expect(harness.payments.calls.some((c) => c.kind === 'saved_card_charge')).toBe(false);
    expect(texts).toContainEqual(
      expect.objectContaining({
        to: '+447700900999',
        body: expect.stringContaining('Please decide'),
      }),
    );
  });

  it('does nothing when the till matched the estimate', async () => {
    expect((await receipt(250)).json().settled).toEqual({ kind: 'even' });
  });
});
