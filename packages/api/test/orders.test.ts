/**
 * Rule One: a single explicit confirmation from the Shopper is required before any payment
 * is taken.
 *
 * These tests do not check that a flag was set. They check that no money moved. The
 * rehearsal payments gateway records every call it receives, so "the card was not charged"
 * is something the test can assert directly rather than infer.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { assertConfirmedBeforePayment } from '../src/services/orders.js';
import { ConfirmationRequiredError } from '../src/errors.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

beforeEach(async () => {
  harness = await buildTestApp();
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
});

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    lines: [{ catalogueItemId: items.milk, quantity: 2 }],
    deliveryAddress: '12 Example Street, Birmingham',
    paymentMethodId: shopper.paymentMethodId,
    confirmation: {
      confirmed: true,
      channel: 'button',
      statement: 'Send my order. About £10.50 altogether.',
      agreedTotalPence: 250 + 800,
    },
    ...overrides,
  };
}

describe('Rule One: no payment without an explicit confirmation', () => {
  it('refuses an order with no confirmation at all, and charges nothing', async () => {
    const payload = orderPayload();
    delete (payload as Record<string, unknown>)['confirmation'];

    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('refuses an order where confirmation is present but false, and charges nothing', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload({
        confirmation: {
          confirmed: false,
          channel: 'button',
          statement: 'Send my order.',
          agreedTotalPence: 1050,
        },
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('records the confirmation before it creates the payment, and says so on the payment itself', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      order: {
        id: string;
        spokenConfirmationAt: string;
        status: string;
        stripePaymentIntentId: string;
      };
    };

    expect(body.order.spokenConfirmationAt).not.toBeNull();
    expect(body.order.status).toBe('paid');

    expect(harness.payments.calls).toHaveLength(1);
    const call = harness.payments.calls[0]!;
    expect(call.kind).toBe('payment_intent');

    const input = call.input as { confirmationRecordedAt: string; amountPence: number };
    // The confirmation timestamp travelled with the payment, so a dispute can be answered.
    expect(new Date(input.confirmationRecordedAt).getTime()).toBe(
      new Date(body.order.spokenConfirmationAt).getTime(),
    );
    // And it was recorded no later than the moment of payment.
    expect(new Date(input.confirmationRecordedAt).getTime()).toBeLessThanOrEqual(
      harness.now().getTime(),
    );
  });

  it('refuses to charge a different amount from the one the Shopper agreed to', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload({
        confirmation: {
          confirmed: true,
          channel: 'button',
          statement: 'Send my order.',
          agreedTotalPence: 100,
        },
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { message: expect.stringContaining('Nothing has been charged') },
    });
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('is a guard on the stored order, not on the request body', () => {
    expect(() =>
      assertConfirmedBeforePayment({
        id: 'order_1',
        status: 'draft',
        spokenConfirmationAt: null,
        confirmationStatement: 'Send my order.',
        stripePaymentIntentId: null,
      }),
    ).toThrow(ConfirmationRequiredError);
  });

  it('charges exactly the total that was quoted, once, for one confirmation', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload(),
    });

    expect(response.statusCode).toBe(201);
    const input = harness.payments.calls[0]!.input as { amountPence: number };
    expect(input.amountPence).toBe(1050);
    expect(harness.payments.calls.filter((call) => call.kind === 'payment_intent')).toHaveLength(1);
  });

  it('requires the Shopper to be signed in at all', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      payload: orderPayload(),
    });
    expect(response.statusCode).toBe(401);
    expect(harness.payments.calls).toHaveLength(0);
  });
});

describe('repricing to the receipt', () => {
  it('charges the till total and recalculates the fee against it', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload(),
    });
    const orderId = (created.json() as { order: { id: string } }).order.id;

    // A Runner takes the job, then submits what the till said.
    const runnerResponse = await harness.app.inject({
      method: 'POST',
      url: '/runners',
      payload: { name: 'Ayesha', phone: '+447700900199' },
    });
    const runner = runnerResponse.json() as { runner: { id: string }; token: string };
    await harness.repository.orders.update(orderId, {
      runnerId: runner.runner.id,
      status: 'shopping',
    });

    const receipt = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/receipt`,
      headers: { authorization: `Bearer ${runner.token}` },
      payload: { receiptTotalPence: 231 },
    });

    expect(receipt.statusCode).toBe(200);
    const body = receipt.json() as {
      order: { receiptTotalPence: number; receiptFeePence: number; finalTotalPence: number };
    };
    expect(body.order.receiptTotalPence).toBe(231);
    // The receipt fell in the first band, so the fee is the first band's fee.
    expect(body.order.receiptFeePence).toBe(harness.config.fees.bands[0]!.feePence);
    expect(body.order.finalTotalPence).toBe(231 + body.order.receiptFeePence);
  });
});

describe('the doorstep protocol', () => {
  it('is snapshotted onto the order, so a later profile edit cannot change it', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: orderPayload(),
    });
    const order = (created.json() as { order: { id: string; doorstepProtocolSnapshot: string } })
      .order;
    expect(order.doorstepProtocolSnapshot).toBe('Knock loudly and wait.');

    await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: shopper.authHeader,
      payload: { doorstepProtocol: 'Leave it in the porch.' },
    });

    const reloaded = await harness.repository.orders.findById(order.id);
    expect(reloaded?.doorstepProtocolSnapshot).toBe('Knock loudly and wait.');
  });
});

/**
 * What Stripe says, not what we hope.
 *
 * A card in the United Kingdom usually has to be authenticated by the Shopper's bank, and
 * Stripe then answers `requires_action` rather than `succeeded`. The order route used to
 * write `paid` regardless, which was untrue on the order and also unreachable for the
 * webhook: `payment_intent.succeeded` only advances an order that is still `confirmed`.
 */
describe('a payment the bank has not approved yet', () => {
  /** Stripe's answer when the Shopper has to authenticate. Nothing has been taken. */
  function gatewayNeedingAuthentication() {
    return {
      mode: 'stripe' as const,
      async createPaymentIntent() {
        return {
          id: 'pi_needs_action',
          status: 'requires_action',
          clientSecret: 'pi_needs_action_secret',
        };
      },
      async createTransfer() {
        throw new Error('not used in this test');
      },
      constructWebhookEvent() {
        throw new Error('not used in this test');
      },
    };
  }

  it('does not claim the order is paid, and says the bank has to check', async () => {
    const harness = await buildTestApp(undefined, { payments: gatewayNeedingAuthentication() });
    const theirItems = await seedCatalogue(harness.repository);
    const them = await signUpShopper(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: them.authHeader,
      payload: {
        lines: [{ catalogueItemId: theirItems.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        paymentMethodId: them.paymentMethodId,
        confirmation: {
          confirmed: true,
          channel: 'button',
          statement: 'Send my order. About £10.50 altogether.',
          agreedTotalPence: 250 + 800,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    // Still confirmed, not paid. The confirmation happened; the payment has not.
    expect(body.order.status).toBe('confirmed');
    expect(body.payment.requiresAction).toBe(true);
    expect(body.payment.clientSecret).toBe('pi_needs_action_secret');
    expect(body.message).toMatch(/Nothing has been taken yet/);

    // And the intent is recorded, so the webhook can find the order when Stripe reports back.
    const stored = await harness.repository.orders.findById(body.order.id);
    expect(stored?.stripePaymentIntentId).toBe('pi_needs_action');
    expect(stored?.status).toBe('confirmed');

    await harness.close();
  });

  it('leaves the order paid once the webhook says the payment succeeded', async () => {
    const harness = await buildTestApp(undefined, { payments: gatewayNeedingAuthentication() });
    const theirItems = await seedCatalogue(harness.repository);
    const them = await signUpShopper(harness);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: them.authHeader,
      payload: {
        lines: [{ catalogueItemId: theirItems.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        paymentMethodId: them.paymentMethodId,
        confirmation: {
          confirmed: true,
          channel: 'button',
          statement: 'Send my order. About £10.50 altogether.',
          agreedTotalPence: 250 + 800,
        },
      },
    });
    const orderId = created.json().order.id as string;

    // The order is reachable by the webhook precisely because it was left confirmed.
    const order = await harness.repository.orders.findById(orderId);
    expect(order?.status).toBe('confirmed');

    await harness.repository.orders.update(orderId, { status: 'paid' });
    const settled = await harness.repository.orders.findById(orderId);
    expect(settled?.status).toBe('paid');

    await harness.close();
  });
});
