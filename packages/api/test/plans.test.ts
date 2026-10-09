/**
 * Anthony's new pricing (ruling 58, 9 October 2026): item charges on every unit, delivery by
 * plan and shop size, the first month free with pay-as-you-go delivery and a reminder before it
 * ends, the monthly plans (Membership, Plus, Family and Carer) taken monthly only for a Shopper
 * who chose to join, one-button cancelling, and organisations' clients on Membership delivery.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import { regularRunnerFor } from '../src/services/dispatch.js';
import {
  addMonths,
  remindFreeMonthEnding,
  renewPlans,
  sendCheckIns,
  sendWeeklySummaries,
} from '../src/services/plans.js';
import {
  buildTestApp,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-10-09T10:00:00.000Z');
const DAY = 24 * 3600 * 1000;

let harness: TestHarness;
let shopper: SignedInShopper;
let texts: Array<{ to: string; body: string }>;

const log = { warn: () => undefined, info: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(START, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, who: SignedInShopper = shopper) {
  return harness.app.inject({ method: 'POST', url, headers: who.authHeader, payload });
}

function charges() {
  return harness.payments.calls.filter((call) => call.kind === 'saved_card_charge');
}

async function product(name: string, pence: number): Promise<string> {
  return (
    await harness.repository.catalogue.create({
      name,
      category: 'Everyday',
      estimatedPricePence: pence,
      source: 'community',
    })
  ).id;
}

/** John's ten products, £58.36 at shop prices. */
async function johnsBasket() {
  const prices = [140, 125, 95, 249, 279, 499, 650, 700, 1249, 1850];
  const lines = [];
  for (const [index, pence] of prices.entries()) {
    lines.push({ catalogueItemId: await product(`John item ${index + 1}`, pence), quantity: 1 });
  }
  return lines;
}

async function price(lines: object[], who: SignedInShopper = shopper) {
  return (
    await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      headers: who.authHeader,
      payload: { lines },
    })
  ).json();
}

describe('the worked examples, priced by the server', () => {
  it('John, first month, pays as he goes: £58.36 + £8.50 + £13.50 = £80.36', async () => {
    const priced = await price(await johnsBasket());
    expect(priced).toMatchObject({
      goodsEstimatePence: 5836,
      itemChargesPence: 850,
      feePence: 1350,
      totalPence: 8036,
      deliveryPlan: 'payg',
    });
    // Every price shown includes its item charge: the £1.40 product is shown as £1.90.
    expect(priced.lines[0]).toMatchObject({ unitPricePence: 140, unitDisplayPence: 190 });
  });

  it('John, as a Member: £58.36 + £8.50 + £7.99 = £74.85', async () => {
    const lines = await johnsBasket();
    await harness.repository.shoppers.update(shopper.shopperId, {
      plan: 'membership',
      planUntil: addMonths(START, 1),
    });
    expect(await price(lines)).toMatchObject({ totalPence: 7485, deliveryPlan: 'membership' });
  });

  it('Mary, milk, bread and eggs, pays as she goes: £4.69 + £1.50 + £7.99 = £14.18', async () => {
    const lines = [
      { catalogueItemId: await product('Milk', 125), quantity: 1 },
      { catalogueItemId: await product('Bread', 95), quantity: 1 },
      { catalogueItemId: await product('Eggs', 249), quantity: 1 },
    ];
    expect(await price(lines)).toMatchObject({
      goodsEstimatePence: 469,
      itemChargesPence: 150,
      feePence: 799,
      totalPence: 1418,
    });
  });

  it('charges John’s order exactly as quoted, and settles the till on shop prices only', async () => {
    const lines = await johnsBasket();
    const placed = await post('/orders', {
      lines,
      deliveryAddress: '1 High Street',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        statement: 'Send my order and pay.',
        agreedTotalPence: 8036,
      },
    });
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.json().order).toMatchObject({
      goodsEstimatePence: 5836,
      itemChargesPence: 850,
      feePence: 1350,
      totalEstimatePence: 8036,
      deliveryPlan: 'payg',
    });
  });
});

describe('the first month', () => {
  it('starts at sign-up, with pay-as-you-go delivery, not the member price', async () => {
    const me = (
      await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader })
    ).json().shopper;
    expect(me.freeMonthUntil).toBe(addMonths(START, 1).toISOString());
    expect(me).toMatchObject({
      inFreeMonth: true,
      deliveryPlan: 'payg',
      activePlan: null,
      membershipExtras: true,
    });
  });

  it('reminds about three days before it ends, takes nothing, and leaves pay as you go alone', async () => {
    harness.setNow(new Date(addMonths(START, 1).getTime() - 2 * DAY));
    expect(await remindFreeMonthEnding(harness.app.ctx, log)).toBe(1);
    expect(texts.at(-1)?.body).toMatch(/Your free month of Ozi Membership ends on /);
    expect(texts.at(-1)?.body).toMatch(/Nothing will be taken\./);
    expect(texts.at(-1)?.body).toMatch(/you can choose to join for £10\.00 a month/);
    expect(texts.at(-1)?.body).toMatch(/If you don't, you simply pay as you go/);
    // Once only.
    expect(await remindFreeMonthEnding(harness.app.ctx, log)).toBe(0);

    // The month ends: no charge, ever, without joining; still welcome, still pay as you go.
    harness.setNow(new Date(addMonths(START, 1).getTime() + DAY));
    expect(await renewPlans(harness.app.ctx, log)).toBe(0);
    expect(charges()).toEqual([]);
    const me = (
      await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader })
    ).json().shopper;
    expect(me).toMatchObject({ inFreeMonth: false, deliveryPlan: 'payg' });
  });
});

describe('joining a plan', () => {
  it('needs the monthly price and the monthly taking agreed, and takes nothing without both', async () => {
    const refused = await post('/plans/join', { plan: 'membership' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/agree to the price first: £10\.00 a month/);
    const half = await post('/plans/join', { plan: 'membership', priceAccepted: true });
    expect(half.statusCode).toBe(400);
    expect(half.json().error.message).toMatch(/taken each month until you cancel/);
    expect(charges()).toEqual([]);
  });

  it('Membership in the free month: member delivery now, the first £10 when the month ends', async () => {
    const joined = await post('/plans/join', {
      plan: 'membership',
      priceAccepted: true,
      monthlyAccepted: true,
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(charges()).toEqual([]);
    expect(joined.json()).toMatchObject({
      plan: 'membership',
      deliveryPlan: 'membership',
      renews: true,
      monthlyPence: 1000,
    });
    expect(joined.json().message).toMatch(/Your free month carries on: the first £10\.00 is taken on/);

    // At the end of the free month, the first £10 is taken, and the same date next month.
    harness.setNow(new Date(addMonths(START, 1).getTime() + 60_000));
    expect(await renewPlans(harness.app.ctx, log)).toBe(1);
    expect(charges()).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 1000 }) }),
    ]);
    const after = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(after?.planUntil?.toISOString()).toBe(addMonths(START, 2).toISOString());
    expect(texts.at(-1)?.body).toMatch(/£10\.00 was taken for another month of Ozi Membership/);
  });

  it('Plus takes £15 now, brings delivery to £5.99, and shows no adverts', async () => {
    await harness.repository.shoppers.update(shopper.shopperId, { freeMonthUntil: null });
    const joined = await post('/plans/join', {
      plan: 'plus',
      priceAccepted: true,
      monthlyAccepted: true,
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(charges()[0]?.input).toEqual(expect.objectContaining({ amountPence: 1500 }));
    const priced = await price(await johnsBasket());
    expect(priced).toMatchObject({ feePence: 599, totalPence: 5836 + 850 + 599 });
    const advert = await harness.app.inject({
      method: 'GET',
      url: '/spotlight?q=milk',
      headers: shopper.authHeader,
    });
    expect(advert.json()).toEqual({ advert: null });
  });

  it('cancels with one button: nothing more is taken, and it runs to the end of the month', async () => {
    await harness.repository.shoppers.update(shopper.shopperId, { freeMonthUntil: null });
    await post('/plans/join', { plan: 'plus', priceAccepted: true, monthlyAccepted: true });
    const cancelled = await post('/plans/cancel', {});
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().message).toMatch(
      /^Ozi Plus is cancelled\. Nothing more will be taken\. You keep it until .*, then you pay as you go\.$/,
    );
    expect(cancelled.json()).toMatchObject({ plan: 'plus', renews: false, deliveryPlan: 'plus' });

    harness.setNow(new Date(addMonths(START, 1).getTime() + 60_000));
    expect(await renewPlans(harness.app.ctx, log)).toBe(0);
    expect(charges()).toHaveLength(1);
    expect(
      (await harness.app.inject({ method: 'GET', url: '/plans', headers: shopper.authHeader })).json(),
    ).toMatchObject({ plan: null, deliveryPlan: 'payg' });
  });

  it('ends a plan whose card is refused at renewal, says so, and takes nothing', async () => {
    await harness.repository.shoppers.update(shopper.shopperId, { freeMonthUntil: null });
    await post('/plans/join', { plan: 'membership', priceAccepted: true, monthlyAccepted: true });
    harness.setNow(new Date(addMonths(START, 1).getTime() + 60_000));
    harness.payments.declineNextCharge = true;
    expect(await renewPlans(harness.app.ctx, log)).toBe(0);
    expect(texts.at(-1)?.body).toMatch(/so it has stopped and nothing was taken/);
    const after = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(after?.planRenews).toBe(false);
  });
});

describe('Ozi Family and Carer', () => {
  async function familyOf(limitPence: number | null) {
    await harness.repository.shoppers.update(shopper.shopperId, { freeMonthUntil: null });
    const joined = await post('/plans/join', {
      plan: 'family',
      priceAccepted: true,
      monthlyAccepted: true,
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(charges()[0]?.input).toEqual(expect.objectContaining({ amountPence: 2000 }));
    const code = joined.json().familyCode as string;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    if (limitPence !== null) {
      const set = await post('/extras/family/approval-limit', { limitPence });
      expect(set.statusCode, set.body).toBe(200);
    }
    const dad = await signUpShopper(harness, { displayName: 'Dad', phone: '+447700900301' });
    const join = await post('/extras/family/join', { code }, dad);
    expect(join.statusCode, join.body).toBe(200);
    return { code, dad };
  }

  function familyOrder(who: SignedInShopper, lines: object[], agreedTotalPence: number) {
    return post(
      '/orders',
      {
        lines,
        deliveryAddress: '2 Low Road',
        payBy: 'family',
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          statement: 'Send my order and pay.',
          agreedTotalPence,
        },
      },
      who,
    );
  }

  it('is for up to four people in different homes, all on £5.99 delivery', async () => {
    const { code, dad } = await familyOf(null);
    for (const [index, name] of ['Aunt', 'Gran'].entries()) {
      const other = await signUpShopper(harness, { displayName: name, phone: `+44770090040${index}` });
      expect((await post('/extras/family/join', { code }, other)).statusCode).toBe(200);
    }
    const fifth = await signUpShopper(harness, { displayName: 'Cousin', phone: '+447700900499' });
    const full = await post('/extras/family/join', { code }, fifth);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toMatch(/up to 4 people/);
    const milk = await product('Milk', 125);
    expect(await price([{ catalogueItemId: milk, quantity: 2 }], dad)).toMatchObject({
      feePence: 599,
      deliveryPlan: 'plus',
    });
  });

  it('one card pays, and the payer is told at each stage', async () => {
    const { dad } = await familyOf(null);
    const milk = await product('Milk', 125);
    const placed = await familyOrder(dad, [{ catalogueItemId: milk, quantity: 2 }], 250 + 100 + 599);
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json().order;
    expect(order.status).toBe('paid');
    const payer = await harness.repository.shoppers.findById(shopper.shopperId);
    const payerCards = await harness.repository.paymentMethods.listForShopper(shopper.shopperId);
    expect(order.paymentMethodId).toBe(payerCards[0]!.id);
    expect(order.payerShopperId).toBe(payer!.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(texts).toContainEqual(
      expect.objectContaining({
        to: '+447700900001',
        body: expect.stringContaining("Dad's order: it has been ordered"),
      }),
    );
  });

  it('holds an order over the payer’s limit until they approve it, and takes nothing first', async () => {
    const { dad } = await familyOf(1000);
    const milk = await product('Milk', 125);
    const lines = [{ catalogueItemId: milk, quantity: 8 }];
    const total = 1000 + 400 + 599;
    const placed = await familyOrder(dad, lines, total);
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.json()).toMatchObject({ waitingForApproval: true });
    expect(placed.json().order).toMatchObject({ status: 'confirmed', approvalStatus: 'waiting' });
    expect(harness.payments.calls.filter((c) => c.kind === 'payment_intent')).toHaveLength(0);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/plans/family/orders',
      headers: shopper.authHeader,
    });
    expect(list.json().orders[0]).toMatchObject({ person: 'Dad', approvalStatus: 'waiting' });

    const approved = await post(`/plans/family/orders/${placed.json().order.id}/approve`, {});
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().order.status).toBe('paid');
    expect(harness.payments.calls.filter((c) => c.kind === 'payment_intent')).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: total }) }),
    ]);

    // Saying no closes the order; nothing is taken.
    const second = await familyOrder(dad, lines, total);
    const declined = await post(`/plans/family/orders/${second.json().order.id}/decline`, {});
    expect(declined.json().order).toMatchObject({ status: 'cancelled', approvalStatus: 'declined' });
    expect(harness.payments.calls.filter((c) => c.kind === 'payment_intent')).toHaveLength(1);
  });

  it('sends the payer a weekly summary', async () => {
    await familyOf(null);
    expect(await sendWeeklySummaries(harness.app.ctx, log)).toBe(1);
    expect(texts.at(-1)?.body).toMatch(/No orders this week on your family plan\./);
    expect(await sendWeeklySummaries(harness.app.ctx, log)).toBe(0);
  });
});

describe('Ozi Plus extras', () => {
  it('sends a friendly check-in after a while without an order, once', async () => {
    await harness.repository.shoppers.update(shopper.shopperId, {
      plan: 'plus',
      planUntil: new Date(START.getTime() + 400 * DAY),
      planStartedAt: START,
    });
    harness.setNow(new Date(START.getTime() + (harness.config.extras.checkInAfterDays + 1) * DAY));
    expect(await sendCheckIns(harness.app.ctx, log)).toBe(1);
    expect(texts.at(-1)?.body).toMatch(/Just checking you're all right/);
    expect(await sendCheckIns(harness.app.ctx, log)).toBe(0);
  });

  it('offers the job to the Shopper’s regular Runner first, when on Plus', async () => {
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      status: 'paid',
      goodsEstimatePence: 100,
      feePence: 599,
      totalEstimatePence: 749,
      deliveryAddress: '1 High Street',
      items: [],
    });
    const past = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      status: 'delivered',
      goodsEstimatePence: 100,
      feePence: 799,
      totalEstimatePence: 949,
      deliveryAddress: '1 High Street',
      items: [],
    });
    await harness.repository.orders.update(past.id, { runnerId: 'runner-good' });
    expect(await regularRunnerFor(harness.app.ctx, order, START)).toBeNull();
    await harness.repository.shoppers.update(shopper.shopperId, {
      plan: 'plus',
      planUntil: addMonths(START, 1),
    });
    expect(await regularRunnerFor(harness.app.ctx, order, START)).toBe('runner-good');
  });
});

describe('organisations', () => {
  it('give the people they look after Membership delivery, whatever the size of the shop', async () => {
    const organisation = await harness.repository.organisations.create({
      name: 'Medway Care',
      contactName: 'Sam',
      contactEmail: 'sam@example.org',
    });
    await harness.repository.shoppers.update(shopper.shopperId, {
      organisationId: organisation.id,
    });
    expect(await price(await johnsBasket())).toMatchObject({
      feePence: 799,
      itemChargesPence: 850,
      totalPence: 7485,
      deliveryPlan: 'membership',
    });
  });
});
