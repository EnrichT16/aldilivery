/**
 * Baskets over £150 (ruling 61, Anthony, 10 October 2026).
 *
 * One order carries at most £150 of shopping at shop prices. Over it, the Shopper is told
 * plainly before paying and chooses: take something out, or keep everything as linked orders,
 * the first filled up to £150, then the next. Each order after the first costs £13.50 delivery
 * whatever the plan, taken only when its Runner collects it; a Runner who is not used is never
 * charged for. A tiny extra (under £5) is texted to the owner and can be carried by the first
 * Runner with one press in the admin panel.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setBankSettings } from '../src/lib/bank.js';
import { collectExtraDelivery, releaseExtraDelivery } from '../src/services/basket-orders.js';
import type { Order } from '../src/domain.js';
import {
  buildTestApp,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const OWNER = '+447700900999';

let harness: TestHarness;
let shopper: SignedInShopper;
let texts: Array<{ to: string; body: string }>;
const products = new Map<number, string>();

beforeEach(async () => {
  texts = [];
  products.clear();
  harness = await buildTestApp(new Date('2026-10-10T10:00:00.000Z'), {
    autoOffer: true,
    env: { ownerAlertPhone: OWNER },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  setBankSettings(null);
  await harness.close();
});

/** A product at this shop price, made once. */
async function product(pence: number): Promise<string> {
  const known = products.get(pence);
  if (known) return known;
  const made = await harness.repository.catalogue.create({
    name: `Product at ${pence}p`,
    category: 'Cupboard',
    estimatedPricePence: pence,
    source: 'community',
  });
  products.set(pence, made.id);
  return made.id;
}

type Line = { catalogueItemId: string; quantity: number };

async function price(lines: Line[]) {
  return harness.app.inject({ method: 'POST', url: '/basket/price', payload: { lines }, headers: shopper.authHeader });
}

async function send(lines: Line[], options: { keepEverything?: boolean; payBy?: 'card' | 'bank' } = {}) {
  const priced = (await price(lines)).json() as { totalPence?: number };
  return harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines,
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      latitude: 52.4862,
      longitude: -1.8904,
      ...(options.payBy === 'bank' ? { payBy: 'bank' } : { paymentMethodId: shopper.paymentMethodId }),
      ...(options.keepEverything ? { keepEverything: true } : {}),
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: priced.totalPence ?? 0,
      },
    },
  });
}

const ownerTexts = () => texts.filter((text) => text.to === OWNER);

/** £148: thirty-seven at £4. */
const BASKET_148 = async (): Promise<Line[]> => [{ catalogueItemId: await product(400), quantity: 37 }];
/** £153: three at £50 and two at £1.50. */
const BASKET_153 = async (): Promise<Line[]> => [
  { catalogueItemId: await product(5000), quantity: 3 },
  { catalogueItemId: await product(150), quantity: 2 },
];
/** £172: three at £50 and eleven at £2. */
const BASKET_172 = async (): Promise<Line[]> => [
  { catalogueItemId: await product(5000), quantity: 3 },
  { catalogueItemId: await product(200), quantity: 11 },
];
/** £151.50: three at £50 and one at £1.50, a tiny extra. */
const BASKET_151_50 = async (): Promise<Line[]> => [
  { catalogueItemId: await product(5000), quantity: 3 },
  { catalogueItemId: await product(150), quantity: 1 },
];

describe('a basket over £150', () => {
  it('keeps £148 as one order, as before', async () => {
    const priced = (await price(await BASKET_148())).json();
    expect(priced.overOneRunner).toBeUndefined();
    const placed = await send(await BASKET_148());
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.json().order.basketGroupId).toBeNull();
    expect(placed.json().orders).toBeUndefined();
  });

  it('gives £153 the choice, plainly, and charges nothing without it', async () => {
    const priced = (await price(await BASKET_153())).json();
    expect(priced.overOneRunner).toBe(true);
    expect(priced.choice).toBe(
      'Your shopping is over £150, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50 delivery.',
    );
    // Nothing hidden: each order, its Runner and its delivery.
    expect(priced.parts.map((part: { runner: string; goodsPence: number; feePence: number }) => [part.runner, part.goodsPence, part.feePence])).toEqual([
      ['Runner 1', 15000, 1350],
      ['Runner 2', 300, 1350],
    ]);
    expect(priced.explanation.join(' ')).toContain('taken only when this Runner collects it');

    const refused = await send(await BASKET_153());
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/^Your shopping is over £150.*Nothing has been charged\.$/);
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('makes £172 kept two orders, £13.50 + £13.50 on pay as you go, the second taken only when its Runner collects', async () => {
    const placed = await send(await BASKET_172(), { keepEverything: true });
    expect(placed.statusCode, placed.body).toBe(201);
    const orders = placed.json().orders as Order[];
    expect(orders.map((order) => [order.goodsEstimatePence, order.feePence, order.basketPart, order.basketOf])).toEqual([
      [15000, 1350, 1, 2],
      [2200, 1350, 2, 2],
    ]);
    expect(orders.every((order) => order.basketGroupId === orders[0]!.id)).toBe(true);
    // Runner pay follows the usual rule: £7 for £150 delivered whole, £5 for £22.
    expect(orders.map((order) => order.runnerPaymentPence)).toEqual([700, 500]);
    expect(orders[1]!.extraDeliveryStatus).toBe('pending');

    // One payment, without the second Runner's £13.50.
    const intents = harness.payments.calls.filter((call) => call.kind === 'payment_intent');
    expect(intents).toHaveLength(1);
    const whole = orders[0]!.totalEstimatePence + orders[1]!.totalEstimatePence;
    expect((intents[0]!.input as { amountPence: number }).amountPence).toBe(whole - 1350);
    expect(placed.json().message).toContain('taken only when that Runner collects it');

    // The second order's Runner collects it: now the £13.50 is taken.
    const walker = await signUpRunner(harness, { name: 'Ade', phone: '+447700900501' });
    await harness.repository.runners.update(walker.runnerId, { vehicleType: 'on_foot' });
    await harness.app.inject({ method: 'POST', url: `/jobs/${orders[1]!.id}/offer`, headers: STAFF });
    const offer = (await harness.repository.offers.listForOrder(orders[1]!.id)).find(
      (row) => row.runnerId === walker.runnerId && row.outcome === 'pending',
    )!;
    const accepted = await harness.app.inject({ method: 'POST', url: `/jobs/${offer.id}/accept`, headers: walker.authHeader });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const charges = harness.payments.calls.filter((call) => call.kind === 'saved_card_charge');
    expect(charges).toHaveLength(1);
    expect(charges[0]!.input).toMatchObject({ amountPence: 1350, reference: `extra-runner:${orders[1]!.id}` });
    expect((await harness.repository.orders.findById(orders[1]!.id))!.extraDeliveryStatus).toBe('charged');
  });

  it('never takes the extra £13.50 for a Runner not used, and gives it back if it was taken', async () => {
    const orders = (await send(await BASKET_172(), { keepEverything: true })).json().orders as Order[];
    const log = harness.app.log;
    // Not yet collected: nothing is ever taken.
    await releaseExtraDelivery(harness.app.ctx, orders[1]!, log);
    expect((await harness.repository.orders.findById(orders[1]!.id))!.extraDeliveryStatus).toBe('waived');
    expect(harness.payments.calls.filter((call) => call.kind === 'saved_card_charge')).toHaveLength(0);

    // Taken on collection, then not used after all: refunded to the card.
    await harness.repository.orders.update(orders[1]!.id, { extraDeliveryStatus: 'pending' });
    await collectExtraDelivery(harness.app.ctx, orders[1]!, log);
    await releaseExtraDelivery(harness.app.ctx, orders[1]!, log);
    expect((await harness.repository.orders.findById(orders[1]!.id))!.extraDeliveryStatus).toBe('refunded');
    const refunds = harness.payments.calls.filter((call) => call.kind === 'refund');
    expect(refunds.at(-1)!.input).toMatchObject({ amountPence: 1350, reference: `extra-runner-unused:${orders[1]!.id}` });
  });

  it('tells the owner about a tiny extra (£151.50 kept), and merges it with one press, the £13.50 not taken', async () => {
    const placed = await send(await BASKET_151_50(), { keepEverything: true });
    expect(placed.statusCode, placed.body).toBe(201);
    const [first, extra] = placed.json().orders as Order[];
    expect(extra!.goodsEstimatePence).toBe(150);
    expect(ownerTexts().some((text) => /only £1\.50 of shopping.*Carry with the first Runner/.test(text.body))).toBe(true);

    const listed = await harness.app.inject({ method: 'GET', url: '/staff/tiny-extras', headers: STAFF });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tinyExtras).toEqual([
      expect.objectContaining({ orderId: extra!.id, firstOrderId: first!.id, goodsPence: 150, extraDeliveryPence: 1350 }),
    ]);

    const merged = await harness.app.inject({
      method: 'POST',
      url: `/staff/tiny-extras/${extra!.id}/carry-with-first`,
      headers: STAFF,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    const after = (await harness.repository.orders.findById(first!.id))!;
    expect(after.goodsEstimatePence).toBe(15150);
    expect(after.totalEstimatePence).toBe(first!.totalEstimatePence + 150 + extra!.itemChargesPence);
    expect(after.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(4);
    expect(after.basketOf).toBe(1);
    const gone = (await harness.repository.orders.findById(extra!.id))!;
    expect(gone.status).toBe('cancelled');
    expect(gone.extraDeliveryStatus).toBe('waived');
    expect(harness.payments.calls.filter((call) => call.kind === 'saved_card_charge')).toHaveLength(0);
    expect((await harness.app.inject({ method: 'GET', url: '/staff/tiny-extras', headers: STAFF })).json().tinyExtras).toEqual([]);
  });

  it('by bank transfer: one transfer with the extra included, given back as Unused Runner fee credit if not used', async () => {
    setBankSettings({
      enabled: true,
      accountName: 'Example Shop Ltd',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      referencePrefix: 'OZI',
      payWithinHours: 24,
    });
    const placed = await send(await BASKET_151_50(), { keepEverything: true, payBy: 'bank' });
    expect(placed.statusCode, placed.body).toBe(201);
    const [first, extra] = placed.json().orders as Order[];
    expect(placed.json().bank.amountPence).toBe(first!.totalEstimatePence + extra!.totalEstimatePence);
    expect(extra!.extraDeliveryStatus).toBe('transfer');
    // Staff see one transfer for the basket, and mark it received once.
    const waiting = (await harness.app.inject({ method: 'GET', url: '/staff/payments', headers: STAFF })).json().waiting;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ amountPence: placed.json().bank.amountPence, orders: 2 });
    await harness.app.inject({ method: 'POST', url: `/staff/payments/${first!.id}/received`, headers: STAFF });
    expect((await harness.repository.orders.findById(extra!.id))!.status).not.toBe('confirmed');

    await harness.app.inject({ method: 'POST', url: `/staff/tiny-extras/${extra!.id}/carry-with-first`, headers: STAFF });
    expect((await harness.repository.orders.findById(extra!.id))!.extraDeliveryStatus).toBe('credited');
    const me = (await harness.repository.shoppers.findById(shopper.shopperId))!;
    expect(me.creditPence).toBe(1350);
    expect(me.unusedRunnerFeeCreditPence).toBe(1350);
    const account = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    expect(JSON.stringify(account.json())).toContain('"unusedRunnerFeeCreditPence":1350');
  });

  it('refuses a basket over £450', async () => {
    const response = await send([{ catalogueItemId: await product(5000), quantity: 10 }], { keepEverything: true });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('basket_too_large');
  });
});
