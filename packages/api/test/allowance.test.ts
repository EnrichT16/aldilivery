/**
 * The monthly order allowance (ruling 73, Anthony, 20 October 2026): Membership includes 5
 * orders a calendar month (UK time), Plus 8, Family and Carer 5 for each person, the people an
 * organisation looks after 5; past it, the next order carries an extra £5.99 delivery charge,
 * then two orders without it, then the extra again. Pay as you go has no allowance. The Shopper
 * is told before the one yes; the extra is its own line, is in the total, is not shop goods, and
 * never changes the Runner's pay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import { countsTowardsAllowance, ukMonth } from '../src/services/plans.js';
import { buildTestApp, signUpShopper, type SignedInShopper, type TestHarness } from './helpers.js';

const NOW = new Date('2026-10-20T10:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;

beforeEach(async () => {
  harness = await buildTestApp(NOW);
  shopper = await signUpShopper(harness);
  // Out of the free month, so the plan set below is what decides.
  await harness.repository.shoppers.update(shopper.shopperId, { freeMonthUntil: null });
});

afterEach(async () => {
  await harness.close();
});

async function onPlan(
  who: SignedInShopper,
  plan: 'membership' | 'plus' | 'family',
  extra: object = {},
): Promise<void> {
  await harness.repository.shoppers.update(who.shopperId, {
    plan,
    planUntil: new Date('2026-11-20T10:00:00.000Z'),
    ...extra,
  });
}

/** Orders already placed, at a given time (this month, by default), with a given status. */
async function pastOrders(
  who: SignedInShopper,
  count: number,
  options: { at?: Date; status?: Order['status']; extra?: object } = {},
): Promise<void> {
  harness.setNow(options.at ?? new Date('2026-10-05T10:00:00.000Z'));
  for (let index = 0; index < count; index += 1) {
    const order = await harness.repository.orders.create({
      shopperId: who.shopperId,
      status: options.status ?? 'delivered',
      goodsEstimatePence: 500,
      feePence: 799,
      totalEstimatePence: 1349,
      deliveryAddress: '1 High Street',
      items: [],
      ...options.extra,
    });
    expect(order.status).toBe(options.status ?? 'delivered');
  }
  harness.setNow(NOW);
}

/** Ten things at £2.50 each: £25 of shopping, £5 of item charges. */
async function tenThings(): Promise<Array<{ catalogueItemId: string; quantity: number }>> {
  const lines = [];
  for (let index = 0; index < 10; index += 1) {
    const item = await harness.repository.catalogue.create({
      name: `Thing ${index + 1}`,
      category: 'Everyday',
      estimatedPricePence: 250,
      source: 'community',
    });
    lines.push({ catalogueItemId: item.id, quantity: 1 });
  }
  return lines;
}

async function price(lines: object[], who: SignedInShopper = shopper) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/basket/price',
    headers: who.authHeader,
    payload: { lines },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

function send(lines: object[], agreedTotalPence: number, who: SignedInShopper = shopper) {
  return harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: who.authHeader,
    payload: {
      lines,
      deliveryAddress: '1 High Street',
      paymentMethodId: who.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        statement: 'Send my order and pay.',
        agreedTotalPence,
      },
    },
  });
}

describe('a Member past the allowance', () => {
  it('tells the 6th order of £25 its extra £5.99 before the yes: £25 + £5 + £7.99 + £5.99 = £43.98', async () => {
    await onPlan(shopper, 'membership');
    await pastOrders(shopper, 5);
    const lines = await tenThings();

    const priced = await price(lines);
    expect(priced).toMatchObject({
      goodsEstimatePence: 2500,
      itemChargesPence: 500,
      feePence: 799,
      allowanceExtraPence: 599,
      totalPence: 4398,
      allowancePlan: 'membership',
      orderNumberThisMonth: 6,
      ordersIncluded: 5,
      allowanceWords:
        'This is your 6th order this month. Your plan includes 5, so this one has an extra £5.99 delivery charge.',
      inWords: expect.objectContaining({ allowanceExtra: '£5.99', total: '£43.98' }),
    });
    expect(priced.explanation).toContain(
      'This is your 6th order this month. Your plan includes 5, so this one has an extra £5.99 delivery charge.',
    );

    // The price agreed without the extra is refused, and nothing is charged.
    const refused = await send(lines, 2500 + 500 + 799);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(
      /It is now £43\.98\. This is your 6th order this month\..*Nothing has been charged\./,
    );
    expect(harness.payments.calls.filter((call) => call.kind === 'payment_intent')).toHaveLength(0);

    const placed = await send(lines, 4398);
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json().order as Order;
    expect(order).toMatchObject({
      feePence: 799,
      allowanceExtraPence: 599,
      totalEstimatePence: 4398,
      // Rule Two: the Runner's pay is unchanged; the extra goes to the business.
      runnerPaymentPence: 500,
    });
    const intents = harness.payments.calls.filter((call) => call.kind === 'payment_intent');
    expect(intents[0]!.input).toMatchObject({ amountPence: 4398 });

    // The 7th and 8th have no extra; the 9th has it again.
    const seventh = await price(lines);
    expect(seventh).toMatchObject({
      orderNumberThisMonth: 7,
      allowanceExtraPence: 0,
      totalPence: 3799,
    });
    expect(seventh.allowanceWords).toBe(
      'This is your 7th order this month. Your plan includes 5, and this one has no extra delivery charge.',
    );
    await pastOrders(shopper, 2);
    expect(await price(lines)).toMatchObject({ orderNumberThisMonth: 9, allowanceExtraPence: 599 });
  });

  it('keeps the extra when the till comes in, as delivery is kept, and shows it on the receipt', async () => {
    await onPlan(shopper, 'membership');
    await pastOrders(shopper, 5);
    const lines = await tenThings();
    const placed = await send(lines, 4398);
    const orderId = (placed.json().order as Order).id;

    const runnerResponse = await harness.app.inject({
      method: 'POST',
      url: '/runners',
      payload: { name: 'Ayesha', phone: '+447700900199', adult: true, homePostcode: 'ME7 1AA' },
    });
    const runner = runnerResponse.json() as { runner: { id: string }; token: string };
    await harness.repository.orders.update(orderId, {
      runnerId: runner.runner.id,
      status: 'shopping',
    });
    const till = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/receipt`,
      headers: { authorization: `Bearer ${runner.token}` },
      payload: { receiptTotalPence: 2400 },
    });
    expect(till.statusCode, till.body).toBe(200);
    // Only the shopping moves at the till: £24 + £5 + £7.99 + £5.99.
    expect(till.json().order).toMatchObject({
      receiptTotalPence: 2400,
      finalTotalPence: 2400 + 500 + 799 + 599,
    });

    const receipt = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/receipt.pdf`,
      headers: shopper.authHeader,
    });
    expect(receipt.statusCode).toBe(200);
    // The PDF writes the pound sign in its own encoding, so the figures are read after it.
    expect(receipt.body).toMatch(/Delivery: .?7\.99/);
    expect(receipt.body).toMatch(/Extra delivery charge: .?5\.99/);
  });

  it('gives a heads-up on the last order the plan includes, with no charge', async () => {
    await onPlan(shopper, 'membership');
    await pastOrders(shopper, 4);
    const priced = await price(await tenThings());
    expect(priced).toMatchObject({
      orderNumberThisMonth: 5,
      allowanceExtraPence: 0,
      totalPence: 3799,
    });
    expect(priced.allowanceWords).toMatch(
      /^This is your 5th order this month, the last one your plan includes\./,
    );
  });
});

describe('what counts towards the allowance', () => {
  it('counts the Shopper’s own placed orders this calendar month, UK time, and nothing else', async () => {
    await onPlan(shopper, 'membership');
    // 23:30 on 30 September in the UK (22:30 UTC): last month. 00:30 on 1 October: this month.
    await pastOrders(shopper, 1, { at: new Date('2026-09-30T22:30:00.000Z') });
    await pastOrders(shopper, 1, { at: new Date('2026-09-30T23:30:00.000Z') });
    // Cancelled, refunded, never paid: not counted.
    await pastOrders(shopper, 1, { status: 'cancelled' });
    await pastOrders(shopper, 1, { status: 'refunded' });
    await pastOrders(shopper, 1, { status: 'draft' });
    // A basket kept whole counts once, by its first order; a split part is not an order.
    await pastOrders(shopper, 1, { extra: { basketPart: 1, basketOf: 2 } });
    await pastOrders(shopper, 1, { extra: { basketPart: 2, basketOf: 2 } });
    await pastOrders(shopper, 1, { extra: { splitParentId: 'whole', splitPart: 1, splitOf: 2 } });
    // Somebody else's orders are theirs.
    const other = await signUpShopper(harness, { displayName: 'Bob', phone: '+447700900333' });
    await pastOrders(other, 4);

    expect(ukMonth(new Date('2026-09-30T23:30:00.000Z'))).toBe('2026-10');
    expect(ukMonth(new Date('2026-09-30T22:30:00.000Z'))).toBe('2026-09');
    const me = (
      await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader })
    ).json().shopper;
    expect(me).toMatchObject({ allowancePlan: 'membership', ordersThisMonth: 2 });
    expect(await price(await tenThings())).toMatchObject({
      orderNumberThisMonth: 3,
      allowanceExtraPence: 0,
    });
  });

  it('never counts a restaurant order: it has its own fee and no allowance (30 October 2026)', async () => {
    await onPlan(shopper, 'membership');
    // Five restaurant orders this month, delivered and paid for, and four grocery orders.
    await pastOrders(shopper, 5, {
      extra: { restaurantShopId: 'mama-joy', restaurantDiscountPercent: 20 },
    });
    await pastOrders(shopper, 4);
    const me = (
      await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader })
    ).json().shopper;
    expect(me).toMatchObject({ allowancePlan: 'membership', ordersThisMonth: 4 });
    // The next grocery order is the 5th, still inside Membership's 5: no extra charge.
    expect(await price(await tenThings())).toMatchObject({
      orderNumberThisMonth: 5,
      allowanceExtraPence: 0,
    });
    expect(
      countsTowardsAllowance({
        ...(await harness.repository.orders.listForShopper(shopper.shopperId))[0]!,
        restaurantShopId: 'mama-joy',
      }),
    ).toBe(false);
  });

  it('starts again at the start of the next month', async () => {
    await onPlan(shopper, 'membership');
    await pastOrders(shopper, 5, { at: new Date('2026-09-15T10:00:00.000Z') });
    expect(await price(await tenThings())).toMatchObject({
      orderNumberThisMonth: 1,
      allowanceExtraPence: 0,
      allowanceWords: null,
    });
  });
});

describe('every plan', () => {
  it('gives Plus 8 orders, the 9th with the extra', async () => {
    await onPlan(shopper, 'plus');
    await pastOrders(shopper, 8);
    expect(await price(await tenThings())).toMatchObject({
      allowancePlan: 'plus',
      orderNumberThisMonth: 9,
      feePence: 699,
      allowanceExtraPence: 599,
      totalPence: 2500 + 500 + 699 + 599,
    });
  });

  it('counts Family and Carer for each person: 5 each', async () => {
    await onPlan(shopper, 'family');
    const member = await signUpShopper(harness, { displayName: 'Dad', phone: '+447700900444' });
    await onPlan(member, 'family', { familyOwnerId: shopper.shopperId });
    // The payer's own five orders do not use up anybody else's.
    await pastOrders(shopper, 5);
    expect(await price(await tenThings(), member)).toMatchObject({
      allowancePlan: 'family',
      orderNumberThisMonth: 1,
      allowanceExtraPence: 0,
    });
    const payer = await price(await tenThings());
    expect(payer).toMatchObject({ orderNumberThisMonth: 6, allowanceExtraPence: 599 });
    expect(payer.allowanceWords).toBe(
      'This is your 6th order this month. Your plan includes 5 for each person, so this one has an extra £5.99 delivery charge.',
    );
  });

  it('gives the people an organisation looks after Membership’s 5', async () => {
    const organisation = await harness.repository.organisations.create({
      name: 'Medway Care',
      contactName: 'Sam',
      contactEmail: 'sam@example.org',
    });
    await harness.repository.shoppers.update(shopper.shopperId, {
      organisationId: organisation.id,
    });
    await pastOrders(shopper, 5);
    expect(await price(await tenThings())).toMatchObject({
      deliveryPlan: 'membership',
      allowancePlan: 'membership',
      allowanceExtraPence: 599,
    });
  });

  it('never charges the extra on pay as you go, or in the free month, however many orders', async () => {
    await pastOrders(shopper, 20);
    expect(await price(await tenThings())).toMatchObject({
      allowancePlan: 'payg',
      feePence: 1099,
      allowanceExtraPence: 0,
      allowanceWords: null,
      totalPence: 2500 + 500 + 1099,
    });
    await harness.repository.shoppers.update(shopper.shopperId, {
      freeMonthUntil: new Date('2026-11-01T10:00:00.000Z'),
    });
    expect(await price(await tenThings())).toMatchObject({
      allowancePlan: 'payg',
      allowanceExtraPence: 0,
    });
  });
});
