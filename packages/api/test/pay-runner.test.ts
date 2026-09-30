/**
 * Paying Runners: setting up where their pay goes, and the five pounds reaching it.
 *
 * Until 27 Sep 2026 no Runner had anywhere for their pay to go, the payout ran only when
 * somebody called a staff route by hand, and any Runner's earnings could be read by anybody who
 * knew their id. These prove each of those is fixed, with a gateway that behaves like Stripe
 * Connect: an account is not ready until the Runner has finished Stripe's form.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { rehearsalGateway, type RehearsalGateway } from '../src/lib/payments.js';
import { sweepPayouts } from '../src/services/pay-runner.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

/** Stripe Connect, with a switch for whether the Runner has finished Stripe's form. */
function connectGateway(): RehearsalGateway & { formFinished: boolean } {
  const base = rehearsalGateway();
  const gateway = {
    ...base,
    calls: base.calls,
    formFinished: false,
    async getConnectedAccount() {
      return { detailsSubmitted: gateway.formFinished, transfersActive: gateway.formFinished };
    },
  };
  return gateway;
}

let harness: TestHarness;
let gateway: ReturnType<typeof connectGateway>;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let items: Awaited<ReturnType<typeof seedCatalogue>>;

beforeEach(async () => {
  gateway = connectGateway();
  harness = await buildTestApp(undefined, { payments: gateway, autoOffer: true, autoPayout: true });
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
  // A real Runner starts with nowhere to be paid. The helper gives one; take it away.
  await harness.repository.runners.update(runner.runnerId, { stripeConnectedAccountId: null });
});

async function deliverAnOrder(): Promise<string> {
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
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = (placed.json() as { order: { id: string } }).order.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  const as = runner.authHeader;
  await harness.app.inject({ method: 'POST', url: `/jobs/${offer.id}/accept`, headers: as });
  const step = (status: string) =>
    harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/status`,
      headers: as,
      payload: { status },
    });
  await step('shopping');
  await harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/receipt`,
    headers: as,
    payload: { receiptTotalPence: 240 },
  });
  await step('delivering');
  const delivered = await step('delivered');
  expect(delivered.statusCode, delivered.body).toBe(200);
  return orderId;
}

function setUpPay() {
  return harness.app.inject({
    method: 'POST',
    url: '/runners/me/payouts/setup',
    headers: { ...runner.authHeader, origin: 'https://ozidelivery.example' },
  });
}

function myPay() {
  return harness.app.inject({
    method: 'GET',
    url: '/runners/me/payouts',
    headers: runner.authHeader,
  });
}

describe('setting up where the pay goes', () => {
  it('makes the Runner a Stripe account once, and always gives a fresh link to Stripe’s form', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/payouts/setup',
      headers: { ...runner.authHeader, origin: 'https://ozidelivery.example' },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().url).toBe('https://ozidelivery.example/runner/home?pay=back');

    const account = (await harness.repository.runners.findById(runner.runnerId))!
      .stripeConnectedAccountId;
    expect(account).toMatch(/^acct_/);

    await harness.app.inject({
      method: 'POST',
      url: '/runners/me/payouts/setup',
      headers: { ...runner.authHeader, origin: 'https://ozidelivery.example' },
    });
    expect(gateway.calls.filter((c) => c.kind === 'connected_account')).toHaveLength(1);
    expect(
      (await harness.repository.runners.findById(runner.runnerId))!.stripeConnectedAccountId,
    ).toBe(account);
  });

  it('says where the Runner is with it: not started, not finished, ready', async () => {
    expect((await myPay()).json().setup).toBe('not_started');

    await setUpPay();
    expect((await myPay()).json().setup).toBe('incomplete');

    gateway.formFinished = true;
    expect((await myPay()).json().setup).toBe('ready');
  });

  it('is only ever the Runner’s own: nobody else, and not a Shopper', async () => {
    expect(
      (await harness.app.inject({ method: 'GET', url: '/runners/me/payouts' })).statusCode,
    ).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/runners/me/payouts',
          headers: shopper.authHeader,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await harness.app.inject({ method: 'GET', url: `/runners/${runner.runnerId}/payouts` }))
        .statusCode,
    ).toBe(404);
  });
});

describe('the five pounds', () => {
  it('is paid the moment the order is delivered, from the Shopper’s own payment', async () => {
    await setUpPay();
    gateway.formFinished = true;

    const orderId = await deliverAnOrder();

    const transfers = gateway.calls.filter((c) => c.kind === 'transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.input).toMatchObject({
      orderId,
      destinationAccountId: expect.stringMatching(/^acct_/),
      sourcePaymentIntentId: expect.stringMatching(/^pi_/),
    });
    const payout = await harness.repository.payouts.findByOrderId(orderId);
    // Rule Two: five pounds earned, whatever part is held towards the cool bag.
    expect(payout!.earnedPence).toBe(500);
    expect(payout!.transferredPence + payout!.coolBagWithheldPence).toBe(500);
    expect((await harness.repository.orders.findById(orderId))!.status).toBe('completed');
  });

  it('is owed, not lost, when the Runner has not set up yet — and paid once they have', async () => {
    const orderId = await deliverAnOrder();

    expect(await harness.repository.payouts.findByOrderId(orderId)).toBeNull();
    expect((await harness.repository.orders.findById(orderId))!.status).toBe('delivered');
    expect((await myPay()).json()).toMatchObject({ owedPence: 500, owedDeliveries: 1 });

    // Not ready yet: the sweep leaves it alone.
    expect(await sweepPayouts(harness.app.ctx)).toBe(0);

    await setUpPay();
    gateway.formFinished = true;
    expect(await sweepPayouts(harness.app.ctx)).toBe(1);

    expect(await harness.repository.payouts.findByOrderId(orderId)).not.toBeNull();
    expect((await myPay()).json()).toMatchObject({ owedPence: 0, totalEarnedPence: 500 });

    // And never twice.
    expect(await sweepPayouts(harness.app.ctx)).toBe(0);
    expect(gateway.calls.filter((c) => c.kind === 'transfer')).toHaveLength(1);
  });
});
