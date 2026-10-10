/**
 * Runners are paid back for the shopping (ruling 55, "choice 1"), and agree to the Runner
 * agreement before their first job.
 *
 * The Runner pays at the till with their own card. When the till total goes in, they are paid
 * back straight away, within the same limit the Shopper's card is settled within; anything that
 * needs a person waits for one, with an Approve button; never more than one delivery carries;
 * never twice; and the money goes straight to their own account (Rule Ten).
 */

import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { offerOrder } from '../src/services/dispatch.js';
import {
  planReimbursement,
  sendReimbursement,
  sweepReimbursements,
} from '../src/services/reimburse.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let texts: Array<{ to: string; body: string }>;
let milk: string;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(new Date('2026-10-09T10:00:00.000Z'), {
    autoOffer: true,
    autoPayout: true,
    env: { ownerAlertPhone: '+447700900999' },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

/** Two pints of milk, £2.50 of shopping, accepted and being shopped. */
async function orderBeingShopped(as: SignedInRunner = runner): Promise<string> {
  const placed = await post(
    '/orders',
    {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 799,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().order.id as string;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  expect((await post(`/jobs/${offer.id}/accept`, {}, as.authHeader)).statusCode).toBe(200);
  await post(`/orders/${orderId}/status`, { status: 'shopping' }, as.authHeader);
  return orderId;
}

function till(orderId: string, receiptTotalPence: number) {
  return post(`/orders/${orderId}/receipt`, { receiptTotalPence }, runner.authHeader);
}

const payBacks = () =>
  harness.payments.calls.filter(
    (call) =>
      call.kind === 'transfer' &&
      String((call.input as { idempotencyKey?: string }).idempotencyKey ?? '').startsWith(
        'reimburse:',
      ),
  );

describe('how much is paid back', () => {
  const plan = (receiptTotalPence: number, tillNeedsPerson: string | null = null) =>
    planReimbursement({
      receiptTotalPence,
      goodsEstimatePence: 2000,
      maximumGoodsPence: 6000,
      tillNeedsPerson,
    });

  it('is the till total, up to the estimate plus the larger of £5 or a fifth', () => {
    expect(plan(1500)).toEqual({ pence: 1500, waitReason: null });
    expect(plan(2500)).toEqual({ pence: 2500, waitReason: null });
    expect(plan(2501)).toEqual({ pence: 2501, waitReason: 'over the limit' });
  });

  it('waits for a person whenever the till does', () => {
    expect(plan(1900, 'bank transfer')).toEqual({ pence: 1900, waitReason: 'bank transfer' });
  });

  it('is never more than one delivery carries', () => {
    expect(
      planReimbursement({
        receiptTotalPence: 6500,
        goodsEstimatePence: 5900,
        maximumGoodsPence: 6000,
        tillNeedsPerson: null,
      }),
    ).toEqual({ pence: 6000, waitReason: 'over what one delivery carries' });
  });
});

describe('paying the Runner back for the shopping', () => {
  it('pays the till total straight to the Runner’s own account, and says so plainly', async () => {
    const orderId = await orderBeingShopped();
    const sent = await till(orderId, 240);
    expect(sent.statusCode, sent.body).toBe(200);

    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 240 });
    expect(sent.json().message).toContain("You've been paid back £2.40 for the shopping.");
    expect(payBacks()).toHaveLength(1);
    expect(payBacks()[0]!.input).toMatchObject({
      amountPence: 240,
      orderId,
      destinationAccountId: 'acct_test_runner',
      idempotencyKey: `reimburse:${orderId}`,
      sourcePaymentIntentId: expect.stringMatching(/^pi_/),
    });

    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order).toMatchObject({
      reimbursementPence: 240,
      reimbursementStatus: 'paid',
      reimbursementTransferId: expect.stringMatching(/^tr_/),
      reimbursementApprovedBy: null,
    });
    expect(order.reimbursedAt).toEqual(harness.now());
  });

  it('says both together when the delivery is paid: the shopping and the five pounds', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 300);
    await post(`/orders/${orderId}/status`, { status: 'delivering' }, runner.authHeader);
    const delivered = await post(
      `/orders/${orderId}/status`,
      { status: 'delivered' },
      runner.authHeader,
    );
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.json().notes[0]).toBe(
      "You've been paid back £3.00 for the shopping and £5.00 for the delivery.",
    );
    // Rule Two untouched: the pay-back is the Runner's own money coming back, not pay.
    expect(delivered.json().payout.earnedPence).toBe(500);
  });

  it('is shown on the Runner’s page, apart from what they earned', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 240);
    const page = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/dashboard',
      headers: runner.authHeader,
    });
    expect(page.json().paidBack).toEqual([
      expect.objectContaining({ pence: 240, status: 'paid', reference: expect.any(String) }),
    ]);
    expect(page.json().paidBackTotalPence).toBe(240);
    const current = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(current.json().job).toMatchObject({
      reimbursementPence: 240,
      reimbursementStatus: 'paid',
    });
  });

  it('happens once only, however often it is asked for', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 240);
    // The till total goes in once; a second one would settle the card and pay back again.
    expect((await till(orderId, 9000)).statusCode).toBe(409);
    await sendReimbursement(harness.app.ctx, orderId, null);
    await sendReimbursement(harness.app.ctx, orderId, 'Anthony');
    expect(await sweepReimbursements(harness.app.ctx)).toBe(0);
    expect(payBacks()).toHaveLength(1);
  });

  it('is owed, not lost, when the Runner’s payout account is not ready, and sent once it is', async () => {
    await harness.repository.runners.update(runner.runnerId, { stripeConnectedAccountId: null });
    const orderId = await orderBeingShopped();
    const sent = await till(orderId, 240);
    expect(sent.json().reimbursement).toMatchObject({ kind: 'owed', pence: 240 });
    expect(payBacks()).toHaveLength(0);

    await harness.repository.runners.update(runner.runnerId, {
      stripeConnectedAccountId: 'acct_test_runner',
    });
    expect(await sweepReimbursements(harness.app.ctx)).toBe(1);
    expect(payBacks()).toHaveLength(1);
    expect((await harness.repository.orders.findById(orderId))!.reimbursementStatus).toBe('paid');
  });
});

describe('a pay-back that needs a person', () => {
  it('waits when the till is too far over the estimate, and the owner is told', async () => {
    const orderId = await orderBeingShopped();
    const sent = await till(orderId, 1000);
    expect(sent.json().settled).toMatchObject({ kind: 'needs-person' });
    expect(sent.json().reimbursement).toMatchObject({
      kind: 'waiting',
      pence: 1000,
      reason: 'over the limit',
    });
    expect(payBacks()).toHaveLength(0);
    expect(texts).toContainEqual({
      to: '+447700900999',
      body: expect.stringContaining('waiting for you to approve in the Payments tab'),
    });
    // Nothing can send it without a person.
    await expect(sendReimbursement(harness.app.ctx, orderId, null)).rejects.toThrow(/approve/);
    expect(await sweepReimbursements(harness.app.ctx)).toBe(0);
  });

  it('is listed for staff, and approving it pays the Runner and tells them by text', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 1000);

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/staff/reimbursements',
      headers: STAFF,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().waiting).toEqual([
      expect.objectContaining({
        orderId,
        amountPence: 1000,
        receiptTotalPence: 1000,
        reason: 'over the limit',
        transferReference: `reimburse:${orderId}`,
      }),
    ]);

    const approved = await post(
      `/staff/reimbursements/${orderId}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().outcome).toMatchObject({ kind: 'paid', pence: 1000 });
    expect(payBacks()).toHaveLength(1);
    expect(await harness.repository.orders.findById(orderId)).toMatchObject({
      reimbursementStatus: 'paid',
      reimbursementApprovedBy: 'Anthony',
    });
    expect(texts).toContainEqual({
      to: '+447700900101',
      body: expect.stringContaining("You've been paid back £10.00 for the shopping."),
    });

    // Not twice.
    expect((await post(`/staff/reimbursements/${orderId}/approve`, {}, STAFF)).statusCode).toBe(
      409,
    );
  });

  it('never pays back more than the till said, nor more than one delivery carries', async () => {
    const orderId = await orderBeingShopped();
    // The whole-order goods cap (ruling 58, £150 pending Anthony): shop prices only.
    await till(orderId, 16000);
    expect((await harness.repository.orders.findById(orderId))!.reimbursementPence).toBe(15000);

    const approved = await post(
      `/staff/reimbursements/${orderId}/approve`,
      { amountPence: 20000 },
      STAFF,
    );
    expect(approved.json().outcome).toMatchObject({ kind: 'paid', pence: 15000 });
    expect(payBacks()[0]!.input).toMatchObject({ amountPence: 15000 });
  });

  it('can be approved for less, if the person decides so', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 1000);
    const approved = await post(
      `/staff/reimbursements/${orderId}/approve`,
      { amountPence: 800 },
      STAFF,
    );
    expect(approved.json().outcome).toMatchObject({ kind: 'paid', pence: 800 });
  });

  it('is only for staff whose job includes payments', async () => {
    expect(
      (await harness.app.inject({ method: 'GET', url: '/staff/reimbursements' })).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/staff/reimbursements',
          headers: runner.authHeader,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('the owner’s money', () => {
  it('shows what Runners were paid back, and what is waiting', async () => {
    await post(
      '/staff/owner',
      { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
      STAFF,
    );
    const signedIn = await post('/staff/sign-in', {
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    const owner = { 'x-staff-token': signedIn.json().token as string };

    const first = await orderBeingShopped();
    await till(first, 240);
    await post(`/orders/${first}/status`, { status: 'delivering' }, runner.authHeader);
    await post(`/orders/${first}/status`, { status: 'delivered' }, runner.authHeader);
    const second = await orderBeingShopped();
    await till(second, 1000);

    const money = await harness.app.inject({ method: 'GET', url: '/staff/money', headers: owner });
    expect(money.statusCode, money.body).toBe(200);
    expect(money.json().runnerPayBack).toEqual({
      todayPence: 240,
      weekPence: 240,
      monthPence: 240,
      allTimePence: 240,
      waitingCount: 1,
      waitingPence: 1000,
      owedCount: 0,
      owedPence: 0,
    });
  });
});

describe('the Runner agreement, before the first job', () => {
  it('is kept with the date, the version and how it was given, when agreed at sign-up', async () => {
    const saved = (await harness.repository.runners.findById(runner.runnerId))!;
    expect(saved).toMatchObject({
      agreementAcceptedAt: harness.now(),
      agreementVersion: RUNNER_AGREEMENT_VERSION,
      agreementChannel: 'button',
    });
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: runner.authHeader });
    expect(me.json().runner.agreementCurrent).toBe(true);
  });

  it('must be agreed before any job is accepted, or even offered', async () => {
    // Take the agreed Runner off shift, so only the new one could be offered the job.
    await harness.repository.runners.update(runner.runnerId, { available: false });
    const newcomer = await signUpRunner(harness, {
      name: 'Kemi',
      phone: '+447700900102',
      agreed: false,
    });
    const me = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: newcomer.authHeader,
    });
    expect(me.json().runner.agreementCurrent).toBe(false);

    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: milk, quantity: 1 }],
        deliveryAddress: '12 Example Street',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 125 + 50 + 799,
        },
      },
      shopper.authHeader,
    );
    const orderId = placed.json().order.id as string;
    expect(await harness.repository.offers.listForOrder(orderId)).toHaveLength(0);

    // Even an offer made some other way cannot be accepted.
    await harness.repository.orders.update(orderId, { status: 'offered' });
    const offer = await harness.repository.offers.create({
      orderId,
      runnerId: newcomer.runnerId,
      expiresAt: new Date(harness.now().getTime() + 60_000),
      queuePosition: 1,
    });
    const refused = await post(`/jobs/${offer.id}/accept`, {}, newcomer.authHeader);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/agree to the Runner agreement/);

    // An old page cannot agree to a newer agreement.
    const stale = await post(
      '/runners/me/agreement',
      { accepted: true, version: '2000-01-01' },
      newcomer.authHeader,
    );
    expect(stale.statusCode).toBe(400);

    const agreed = await post(
      '/runners/me/agreement',
      { accepted: true, version: RUNNER_AGREEMENT_VERSION, channel: 'voice' },
      newcomer.authHeader,
    );
    expect(agreed.statusCode, agreed.body).toBe(200);
    expect(agreed.json().runner).toMatchObject({
      agreementVersion: RUNNER_AGREEMENT_VERSION,
      agreementChannel: 'voice',
      agreementCurrent: true,
    });

    expect((await post(`/jobs/${offer.id}/accept`, {}, newcomer.authHeader)).statusCode).toBe(200);
  });

  it('asks every Runner who agreed to the 9 October version to agree again (ruling 61)', async () => {
    expect(RUNNER_AGREEMENT_VERSION).toBe('2026-10-10');
    await harness.repository.runners.update(runner.runnerId, {
      agreementVersion: '2026-10-09',
      agreementAcceptedAt: new Date('2026-10-09T09:00:00.000Z'),
    });
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: runner.authHeader });
    expect(JSON.stringify(me.json())).toContain('"agreementCurrent":false');
    // Not offered anything until they agree to the current version.
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: milk, quantity: 1 }],
        deliveryAddress: '12 Example Street',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 125 + 50 + 799,
        },
      },
      shopper.authHeader,
    );
    expect(placed.statusCode, placed.body).toBe(201);
    const orderId = placed.json().order.id as string;
    expect(await harness.repository.offers.listForOrder(orderId)).toHaveLength(0);
    await post('/runners/me/agreement', { accepted: true, version: RUNNER_AGREEMENT_VERSION }, runner.authHeader);
    await harness.app.inject({ method: 'POST', url: `/jobs/${orderId}/offer`, headers: STAFF });
    expect((await harness.repository.offers.listForOrder(orderId))[0]?.runnerId).toBe(runner.runnerId);
  });

  it('is offered work once agreed', async () => {
    await harness.repository.runners.update(runner.runnerId, { available: false });
    const newcomer = await signUpRunner(harness, {
      name: 'Kemi',
      phone: '+447700900102',
      agreed: false,
    });
    await post(
      '/runners/me/agreement',
      { accepted: true, version: RUNNER_AGREEMENT_VERSION },
      newcomer.authHeader,
    );
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: milk, quantity: 1 }],
        deliveryAddress: '12 Example Street',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 125 + 50 + 799,
        },
      },
      shopper.authHeader,
    );
    const orderId = placed.json().order.id as string;
    await offerOrder(harness.app.ctx, orderId).catch(() => undefined);
    const offers = await harness.repository.offers.listForOrder(orderId);
    expect(offers.map((offer) => offer.runnerId)).toContain(newcomer.runnerId);
  });

  it('cannot be agreed without saying yes', async () => {
    const bad = await post(
      '/runners/me/agreement',
      { accepted: false, version: RUNNER_AGREEMENT_VERSION },
      runner.authHeader,
    );
    expect(bad.statusCode).toBe(400);
  });
});
