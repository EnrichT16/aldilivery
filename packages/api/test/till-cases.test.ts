/**
 * The owner's till screen (STILL_TO_DO item 1) and the photo of the till receipt (item 2).
 *
 * A till total that needs a person waits on the Payments tab, with the estimate, the till
 * total, the difference and the receipt photo; a person takes the extra from the saved card,
 * gives the difference back, or marks it settled by hand, and the Shopper is told each time.
 * Without a photo, paying a Runner back more than £30 waits for a person too.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planReimbursement } from '../src/services/reimburse.js';
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

/** A tiny JPEG's worth of bytes: enough to be a photo as far as the server is concerned. */
const PHOTO = {
  data: Buffer.from('a photo of a receipt').toString('base64'),
  contentType: 'image/jpeg',
};

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(new Date('2026-10-09T10:00:00.000Z'), {
    autoOffer: true,
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

/** Milk, £1.25 a pint pack, accepted and being shopped. */
async function orderBeingShopped(packs = 2): Promise<string> {
  const goods = 125 * packs;
  const placed = await post(
    '/orders',
    {
      lines: [{ catalogueItemId: milk, quantity: packs }],
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: goods + 1350,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().order.id as string;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  expect((await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader)).statusCode).toBe(200);
  await post(`/orders/${orderId}/status`, { status: 'shopping' }, runner.authHeader);
  return orderId;
}

function till(orderId: string, receiptTotalPence: number, photo?: typeof PHOTO) {
  return post(
    `/orders/${orderId}/receipt`,
    { receiptTotalPence, ...(photo ? { photo } : {}) },
    runner.authHeader,
  );
}

const shopperTexts = () => texts.filter((text) => text.to === '+447700900001');

describe('the owner’s till screen', () => {
  it('lists a large extra with the estimate, the till total, the difference and the reason', async () => {
    const orderId = await orderBeingShopped();
    expect((await till(orderId, 1000)).json().settled.kind).toBe('needs-person');

    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/till-cases',
      headers: STAFF,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().waiting).toEqual([
      expect.objectContaining({
        orderId,
        estimatePence: 1600,
        tillTotalPence: 2350,
        differencePence: 750,
        reason: 'over the limit',
        hasReceiptPhoto: false,
      }),
    ]);
  });

  it('takes the extra from the saved card, never more than the till total, and tells the Shopper', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 1000);
    const asked = await post(
      `/staff/till-cases/${orderId}/charge`,
      { amountPence: 99_999, by: 'Anthony' },
      STAFF,
    );
    expect(asked.statusCode, asked.body).toBe(200);
    expect(harness.payments.calls).toContainEqual(
      expect.objectContaining({
        kind: 'saved_card_charge',
        input: expect.objectContaining({ amountPence: 750, reference: `till-person:${orderId}` }),
      }),
    );
    expect(shopperTexts().at(-1)?.body).toContain(
      '£7.50 has now been taken from your card ending 4242',
    );

    const order = await harness.repository.orders.findById(orderId);
    expect(order).toMatchObject({ tillStatus: 'settled', tillSettledBy: 'Anthony' });
    // Settled once: a second press finds nothing waiting.
    expect((await post(`/staff/till-cases/${orderId}/charge`, {}, STAFF)).statusCode).toBe(409);
    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/till-cases',
      headers: STAFF,
    });
    expect(list.json().waiting).toEqual([]);
    expect(list.json().settled[0]).toMatchObject({ orderId, settledBy: 'Anthony' });
  });

  it('gives a difference back to the card when the refund had failed', async () => {
    const orderId = await orderBeingShopped();
    // The automatic refund is refused once, so the till waits for a person.
    const original = harness.payments.refundPayment.bind(harness.payments);
    let refuse = true;
    harness.payments.refundPayment = async (input) => {
      if (refuse) {
        refuse = false;
        throw new Error('The bank said no.');
      }
      return original(input);
    };
    expect((await till(orderId, 200)).json().settled).toMatchObject({
      kind: 'needs-person',
      reason: 'refund failed',
    });

    const given = await post(`/staff/till-cases/${orderId}/refund`, {}, STAFF);
    expect(given.statusCode, given.body).toBe(200);
    expect(harness.payments.calls).toContainEqual(
      expect.objectContaining({
        kind: 'refund',
        input: expect.objectContaining({ amountPence: 50, reference: `till-person:${orderId}` }),
      }),
    );
    expect(shopperTexts().at(-1)?.body).toContain('£0.50 is going back to your card');
    // Taking more would be wrong: the till came to less.
    expect((await post(`/staff/till-cases/${orderId}/charge`, {}, STAFF)).statusCode).toBe(409);
  });

  it('marks an extra as let go, in plain words to the Shopper, and checks the direction', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 1000);
    const wrong = await post(
      `/staff/till-cases/${orderId}/settle`,
      { outcome: 'refunded_by_hand' },
      STAFF,
    );
    expect(wrong.statusCode).toBe(400);
    const done = await post(`/staff/till-cases/${orderId}/settle`, { outcome: 'let_go' }, STAFF);
    expect(done.statusCode, done.body).toBe(200);
    expect(shopperTexts().at(-1)?.body).toContain('You do not need to pay the difference');
    expect(harness.payments.calls.some((call) => call.kind === 'saved_card_charge')).toBe(false);
  });

  it('is for the Payments tab only: nobody signed out sees or does anything', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 1000);
    expect((await harness.app.inject({ method: 'GET', url: '/staff/till-cases' })).statusCode).toBe(
      403,
    );
    expect((await post(`/staff/till-cases/${orderId}/charge`, {})).statusCode).toBe(403);
    expect(
      (await post(`/staff/till-cases/${orderId}/charge`, {}, shopper.authHeader)).statusCode,
    ).toBe(403);
  });
});

describe('the photo of the till receipt', () => {
  it('goes in with the till total, and staff on the Payments tab can see it', async () => {
    const orderId = await orderBeingShopped();
    expect((await till(orderId, 1000, PHOTO)).statusCode).toBe(200);
    const photo = await harness.app.inject({
      method: 'GET',
      url: `/staff/orders/${orderId}/receipt-photo`,
      headers: STAFF,
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.rawPayload.toString()).toBe('a photo of a receipt');
    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/till-cases',
      headers: STAFF,
    });
    expect(list.json().waiting[0].hasReceiptPhoto).toBe(true);
    const payBacks = await harness.app.inject({
      method: 'GET',
      url: '/staff/reimbursements',
      headers: STAFF,
    });
    expect(payBacks.json().waiting[0].hasReceiptPhoto).toBe(true);
  });

  it('is never shown to the Shopper, or to anybody not signed in to staff', async () => {
    const orderId = await orderBeingShopped();
    await till(orderId, 250, PHOTO);
    for (const headers of [{}, shopper.authHeader, runner.authHeader]) {
      const photo = await harness.app.inject({
        method: 'GET',
        url: `/staff/orders/${orderId}/receipt-photo`,
        headers,
      });
      expect(photo.statusCode).toBe(403);
    }
  });

  it('refuses something that is not a photo', async () => {
    const orderId = await orderBeingShopped();
    const sent = await till(orderId, 250, { data: PHOTO.data, contentType: 'application/pdf' });
    expect(sent.statusCode).toBe(400);
  });

  it('is needed to pay a Runner back more than £30 without a person looking', async () => {
    // 26 packs of milk: £32.50 of shopping, the till exactly as estimated.
    const orderId = await orderBeingShopped(26);
    const sent = await till(orderId, 3250);
    expect(sent.json().reimbursement).toMatchObject({
      kind: 'waiting',
      reason: 'no receipt photo',
    });
    expect(sent.json().message).toContain('add a photo of the receipt');

    // The photo, added afterwards, lets it go at once.
    const added = await post(`/orders/${orderId}/receipt-photo`, PHOTO, runner.authHeader);
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().reimbursement).toMatchObject({ kind: 'paid', pence: 3250 });
  });

  it('pays a Runner back more than £30 straight away when the photo came with the till total', async () => {
    const orderId = await orderBeingShopped(26);
    const sent = await till(orderId, 3250, PHOTO);
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 3250 });
  });

  it('is only added by the Runner with the order', async () => {
    const orderId = await orderBeingShopped();
    const other = await signUpRunner(harness, { name: 'Ade', phone: '+447700900102' });
    expect(
      (await post(`/orders/${orderId}/receipt-photo`, PHOTO, other.authHeader)).statusCode,
    ).toBe(403);
    expect(
      (await post(`/orders/${orderId}/receipt-photo`, PHOTO, shopper.authHeader)).statusCode,
    ).toBe(401);
  });

  it('is part of the pay-back plan only above the amount set', () => {
    const plan = (pence: number, has: boolean) =>
      planReimbursement({
        receiptTotalPence: pence,
        goodsEstimatePence: pence,
        maximumGoodsPence: 6000,
        tillNeedsPerson: null,
        receiptPhoto: { has, neededAbovePence: 3000 },
      }).waitReason;
    expect(plan(3000, false)).toBeNull();
    expect(plan(3001, false)).toBe('no receipt photo');
    expect(plan(3001, true)).toBeNull();
  });
});
