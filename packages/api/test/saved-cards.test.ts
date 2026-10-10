/**
 * A saved card can be charged again (BUILD_LOG, Step 38). Stripe spends a card that is not
 * attached to a customer after one payment, so every card is attached to the Shopper's own
 * Stripe customer when it is saved, and orders and call charges are made through it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { CreatePaymentIntentInput } from '../src/lib/payments.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let milk: string;

beforeEach(async () => {
  harness = await buildTestApp();
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
});

function order() {
  return harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
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
}

function intents(): CreatePaymentIntentInput[] {
  return harness.payments.calls
    .filter((call) => call.kind === 'payment_intent')
    .map((call) => call.input as CreatePaymentIntentInput);
}

describe('saving a card', () => {
  it('gives the Shopper a Stripe customer and keeps it to themselves', async () => {
    const stored = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(stored?.stripeCustomerId).toMatch(/^cus_/);
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    expect(me.json().shopper).not.toHaveProperty('stripeCustomerId');
  });

  it('uses the same customer for every card, and every order goes through it', async () => {
    const customer = (await harness.repository.shoppers.findById(shopper.shopperId))!
      .stripeCustomerId;
    await harness.app.inject({
      method: 'POST',
      url: '/payment-methods',
      headers: shopper.authHeader,
      payload: { stripePaymentMethodId: 'pm_second', lastFour: '1111', region: 'NG' },
    });
    expect((await harness.repository.shoppers.findById(shopper.shopperId))!.stripeCustomerId).toBe(
      customer,
    );
    expect((await order()).statusCode).toBe(201);
    expect((await order()).statusCode).toBe(201);
    expect(intents().map((intent) => intent.customerId)).toEqual([customer, customer]);
  });

  it('says plainly when Stripe will not keep a card, and saves nothing', async () => {
    harness.payments.refuseNextSave = true;
    const response = await harness.app.inject({
      method: 'POST',
      url: '/payment-methods',
      headers: shopper.authHeader,
      payload: { stripePaymentMethodId: 'pm_bad', lastFour: '0002', region: 'GB' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/could not save that card/);
    const cards = await harness.repository.paymentMethods.listForShopper(shopper.shopperId);
    expect(cards.map((card) => card.lastFour)).toEqual(['4242']);
  });
});

describe('a card saved before this change', () => {
  beforeEach(async () => {
    await harness.repository.shoppers.update(shopper.shopperId, { stripeCustomerId: null });
  });

  it('is attached at the next order, and the order goes through', async () => {
    expect((await order()).statusCode).toBe(201);
    const customer = (await harness.repository.shoppers.findById(shopper.shopperId))!
      .stripeCustomerId;
    expect(customer).toMatch(/^cus_/);
    expect(intents()[0]?.customerId).toBe(customer);
  });

  it('asks for the card again when Stripe has already spent it, charging nothing', async () => {
    harness.payments.refuseNextSave = true;
    const response = await order();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/^Please add your card again\./);
    expect(response.json().error.details).toEqual({ card: 'add_again' });
    expect(intents()).toEqual([]);
  });
});
