/**
 * Split jobs (ruling 60, Anthony, 10 October 2026).
 *
 * An order over what walking and cycling carry (£60 of shopping at shop prices) that no Runner
 * with a motorbike, car or van takes within fifteen minutes is split by item into parts of no
 * more than £60, each offered as its own job to Runners on foot and by bicycle, labelled "Split
 * job — part 1 of 2", paying £5 each, shown before anyone says yes. Each part has its own till
 * total, pay-back, receipt photo and delivery; the Shopper's card is settled once, on the whole
 * order, with the parts' till totals added together. Delivery to the Shopper does not change.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sweepOffers } from '../src/services/dispatch.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-10-10T10:00:00.000Z');
const OWNER = '+447700900999';

let harness: TestHarness;
let shopper: SignedInShopper;
let items: Awaited<ReturnType<typeof seedCatalogue>>;
let texts: Array<{ to: string; body: string }>;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(START, {
    autoOffer: true,
    autoPayout: true,
    env: { ownerAlertPhone: OWNER },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}
function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}
function later(minutes: number) {
  harness.setNow(new Date(harness.now().getTime() + minutes * 60_000));
}
const ownerTexts = () => texts.filter((text) => text.to === OWNER);

/** 30 pints of milk (£37.50) and 30 loaves (£26.70): £64.20 of shopping, over £60. */
const LINES = () => [
  { catalogueItemId: items.milk, quantity: 30 },
  { catalogueItemId: items.bread, quantity: 30 },
];

async function placeLarge(): Promise<{ id: string; totalPence: number }> {
  const priced = await post('/basket/price', { lines: LINES() }, shopper.authHeader);
  const totalPence = (priced.json() as { totalPence: number }).totalPence;
  const response = await post(
    '/orders',
    {
      lines: LINES(),
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      latitude: 52.4862,
      longitude: -1.8904,
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: totalPence,
      },
    },
    shopper.authHeader,
  );
  expect(response.statusCode, response.body).toBe(201);
  return { id: (response.json() as { order: { id: string } }).order.id, totalPence };
}

async function cyclist(name: string, phone: string): Promise<SignedInRunner> {
  const runner = await signUpRunner(harness, { name, phone });
  await harness.repository.runners.update(runner.runnerId, { vehicleType: 'bicycle' });
  return runner;
}

async function offerFor(runner: SignedInRunner) {
  return (await harness.repository.offers.listByOutcome('pending')).find(
    (offer) => offer.runnerId === runner.runnerId,
  );
}

describe('splitting an order nobody who can carry it has taken', () => {
  it('waits fifteen minutes, then splits it by item into parts of no more than £60', async () => {
    const amara = await cyclist('Amara Okafor', '+447700900301');
    const order = await placeLarge();
    expect(await harness.repository.offers.listForOrder(order.id)).toHaveLength(0);

    later(14);
    await sweepOffers(harness.app.ctx);
    expect(await harness.repository.orders.listParts(order.id)).toHaveLength(0);

    later(1);
    await sweepOffers(harness.app.ctx);
    const whole = (await harness.repository.orders.findById(order.id))!;
    expect(whole.splitAt).not.toBeNull();
    const parts = await harness.repository.orders.listParts(order.id);
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => [part.splitPart, part.splitOf])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    for (const part of parts) {
      expect(part.goodsEstimatePence).toBeLessThanOrEqual(6000);
      // Only the shop prices travel with a part: item charges and delivery stay on the whole.
      expect(part.itemChargesPence).toBe(0);
      expect(part.feePence).toBe(0);
      expect(part.runnerPaymentPence).toBe(500);
      expect(part.stripePaymentIntentId).toBeNull();
    }
    expect(parts.reduce((sum, part) => sum + part.goodsEstimatePence, 0)).toBe(6420);
    const units = (name: string) =>
      parts
        .flatMap((part) => part.items)
        .filter((item) => item.name.startsWith(name))
        .reduce((sum, item) => sum + item.quantity, 0);
    expect(units('Semi skimmed milk')).toBe(30);
    expect(units('White sliced bread')).toBe(30);
    // What the Shopper pays does not change.
    expect(whole.totalEstimatePence).toBe(order.totalPence);
    // One part is offered to the cyclist straight away; the whole order to nobody.
    expect((await offerFor(amara))?.orderId).toBe(parts[0]!.id);
    // The Shopper is told it comes in two parts, and the owner is told it was split.
    expect(texts.some((text) => /coming in two parts/.test(text.body))).toBe(true);
    expect(ownerTexts()).toHaveLength(1);
    expect(ownerTexts()[0]!.body).toMatch(/split into 2 parts/);
  });

  it('is not split when a Runner with a car takes it in time', async () => {
    const driver = await signUpRunner(harness);
    const order = await placeLarge();
    const offer = (await harness.repository.offers.listForOrder(order.id))[0]!;
    expect((await post(`/jobs/${offer.id}/accept`, {}, driver.authHeader)).statusCode).toBe(200);
    later(20);
    await sweepOffers(harness.app.ctx);
    expect(await harness.repository.orders.listParts(order.id)).toHaveLength(0);
  });

  it('withdraws the whole order from a car Runner who did not answer, and never lets it be taken whole', async () => {
    const driver = await signUpRunner(harness);
    const order = await placeLarge();
    // The driver keeps not answering; at fifteen minutes it is split.
    for (let minute = 0; minute < 15; minute += 1) {
      later(1);
      await sweepOffers(harness.app.ctx);
    }
    expect(await harness.repository.orders.listParts(order.id)).toHaveLength(2);
    const old = (await harness.repository.offers.listForOrder(order.id)).at(-1)!;
    expect(old.outcome).toBe('superseded');
    const accept = await post(`/jobs/${old.id}/accept`, {}, driver.authHeader);
    expect(accept.statusCode).toBe(409);
    expect((await harness.repository.orders.findById(order.id))!.runnerId).toBeNull();
  });

  it('tells the owner again, once, when a part is not taken either', async () => {
    const order = await placeLarge();
    later(15);
    await sweepOffers(harness.app.ctx);
    expect(await harness.repository.orders.listParts(order.id)).toHaveLength(2);
    expect(ownerTexts()).toHaveLength(1);

    later(14);
    await sweepOffers(harness.app.ctx);
    expect(ownerTexts()).toHaveLength(1);
    later(1);
    await sweepOffers(harness.app.ctx);
    later(5);
    await sweepOffers(harness.app.ctx);
    expect(ownerTexts()).toHaveLength(2);
    expect(ownerTexts()[1]!.body).toMatch(/part 1 of 2 of order .* has still not been taken/);
  });
});

describe('a split job from offer to door', () => {
  it('labels each part, pays £5 each, settles the Shopper once with the parts added up', async () => {
    const amara = await cyclist('Amara Okafor', '+447700900301');
    const bilal = await cyclist('Bilal Hussain', '+447700900302');
    const order = await placeLarge();
    later(15);
    await sweepOffers(harness.app.ctx);
    const parts = await harness.repository.orders.listParts(order.id);
    const runners = [amara, bilal];

    // Before saying yes: labelled, the pay shown, and nothing about the other Runner or the
    // Shopper's number.
    for (const runner of runners) {
      const mine = await get('/jobs/mine', runner.authHeader);
      const job = (mine.json() as { offers: Array<{ job: Record<string, unknown> }> }).offers[0]!.job;
      const split = job['split'] as Record<string, unknown>;
      expect(split['label']).toMatch(/^Split job — part [12] of 2$/);
      expect(split['earnWords']).toBe('Split job — you earn £5.00');
      expect(split['rest']).toMatch(/Another Runner is delivering the rest/);
      expect(job['runnerPaymentPence']).toBe(500);
      expect(mine.body).not.toContain('+447700900001');
      expect(mine.body).not.toContain('Amara');
      expect(mine.body).not.toContain('Bilal');
    }

    const partOf = new Map<string, string>();
    for (const runner of runners) {
      const offer = (await offerFor(runner))!;
      partOf.set(runner.runnerId, offer.orderId);
      const accepted = await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json().youWillEarnPence).toBe(500);
    }
    expect((await harness.repository.orders.findById(order.id))!.status).toBe('accepted');

    // The job in hand: only its own items, and that another Runner brings the rest.
    const current = await get('/jobs/current', amara.authHeader);
    const job = current.json().job as { items: Array<{ id: string }>; split: { rest: string } };
    const amaraPart = parts.find((part) => part.id === partOf.get(amara.runnerId))!;
    expect(job.items.map((item) => item.id).sort()).toEqual(amaraPart.items.map((item) => item.id).sort());
    expect(job.split.rest).toMatch(/Another Runner/);
    expect(current.body).not.toContain('Bilal');

    // The Shopper sees two parts, each with its own arrival time; their order list shows one order.
    const mine = await get('/orders/current', shopper.authHeader);
    const split = mine.json().order.split as { of: number; words: string; parts: Array<{ eta: unknown }> };
    expect(split.of).toBe(2);
    expect(split.words).toMatch(/coming in 2 parts/);
    expect(split.parts.every((part) => part.eta !== null)).toBe(true);
    const list = await get('/orders', shopper.authHeader);
    expect((list.json() as { orders: Array<{ id: string }> }).orders.map((row) => row.id)).toEqual([order.id]);

    // Each part: its own till total and receipt photo, 10p under its estimate.
    const refunds = () => harness.payments.calls.filter((call) => call.kind === 'refund');
    for (const [index, runner] of runners.entries()) {
      const partId = partOf.get(runner.runnerId)!;
      const part = (await harness.repository.orders.findById(partId))!;
      await post(`/orders/${partId}/status`, { status: 'shopping' }, runner.authHeader);
      const receipt = await post(
        `/orders/${partId}/receipt`,
        {
          receiptTotalPence: part.goodsEstimatePence - 10,
          photo: { data: Buffer.from('receipt').toString('base64'), contentType: 'image/jpeg' },
        },
        runner.authHeader,
      );
      expect(receipt.statusCode, receipt.body).toBe(200);
      // Paid back for its own shopping, straight away.
      expect(receipt.json().reimbursement.kind).toBe('paid');
      expect(receipt.json().reimbursement.pence).toBe(part.goodsEstimatePence - 10);
      // The Shopper's card is settled once, when the last part's till total is in.
      expect(refunds()).toHaveLength(index === 0 ? 0 : 1);
    }
    const settledRefund = refunds()[0]!.input as { amountPence: number; reference: string };
    expect(settledRefund).toMatchObject({ amountPence: 20, reference: `till:${order.id}` });
    const whole = (await harness.repository.orders.findById(order.id))!;
    expect(whole.receiptTotalPence).toBe(6400);
    expect(whole.finalTotalPence).toBe(order.totalPence - 20);

    // Delivered, each paid £5; the whole order is delivered and completed when both are.
    for (const runner of runners) {
      const partId = partOf.get(runner.runnerId)!;
      await post(`/orders/${partId}/status`, { status: 'delivering' }, runner.authHeader);
      const delivered = await post(`/orders/${partId}/status`, { status: 'delivered' }, runner.authHeader);
      expect(delivered.statusCode, delivered.body).toBe(200);
      expect(delivered.json().payout.earnedPence).toBe(500);
    }
    expect((await harness.repository.orders.findById(order.id))!.status).toBe('completed');
    expect(texts.some((text) => /^.*Part 1 of 2 of your order/.test(text.body))).toBe(true);
  });

  it('changes the pay for a part with one line, dispatch.splitRunnerPayPence', async () => {
    const dispatch = harness.config.dispatch as { splitRunnerPayPence: number };
    const before = dispatch.splitRunnerPayPence;
    dispatch.splitRunnerPayPence = 600;
    try {
      const order = await placeLarge();
      later(15);
      await sweepOffers(harness.app.ctx);
      const parts = await harness.repository.orders.listParts(order.id);
      expect(parts.map((part) => part.runnerPaymentPence)).toEqual([600, 600]);
    } finally {
      dispatch.splitRunnerPayPence = before;
    }
  });
});

describe('big orders pay the Runner more (ruling 60)', () => {
  /** Ninety-six pints of milk: £120.00 at the shop's prices. */
  async function placeMilk(pints: number): Promise<string> {
    const lines = [{ catalogueItemId: items.milk, quantity: pints }];
    const priced = await post('/basket/price', { lines }, shopper.authHeader);
    const response = await post(
      '/orders',
      {
        lines,
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        latitude: 52.4862,
        longitude: -1.8904,
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: (priced.json() as { totalPence: number }).totalPence,
        },
      },
      shopper.authHeader,
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { order: { id: string } }).order.id;
  }

  it('pays £7 to the Runner who delivers £120 or more of shopping whole, shown before yes', async () => {
    const driver = await signUpRunner(harness);
    const orderId = await placeMilk(96);
    expect((await harness.repository.orders.findById(orderId))!.runnerPaymentPence).toBe(700);
    const mine = await get('/jobs/mine', driver.authHeader);
    expect(mine.json().offers[0].job.runnerPaymentPence).toBe(700);
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    await post(`/jobs/${offer.id}/accept`, {}, driver.authHeader);
    await post(`/orders/${orderId}/status`, { status: 'shopping' }, driver.authHeader);
    await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 12000, photo: { data: Buffer.from('r').toString('base64'), contentType: 'image/jpeg' } },
      driver.authHeader,
    );
    await post(`/orders/${orderId}/status`, { status: 'delivering' }, driver.authHeader);
    const delivered = await post(`/orders/${orderId}/status`, { status: 'delivered' }, driver.authHeader);
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.json().payout.earnedPence).toBe(700);
  });

  it('pays £5 just below £120', async () => {
    await signUpRunner(harness);
    const below = await placeMilk(95); // £118.75
    expect((await harness.repository.orders.findById(below))!.runnerPaymentPence).toBe(500);
  });

  it('pays split parts of a big order £5 each, not £7', async () => {
    const big = await placeMilk(96);
    later(15);
    await sweepOffers(harness.app.ctx);
    const parts = await harness.repository.orders.listParts(big);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((part) => part.runnerPaymentPence === 500)).toBe(true);
  });
});
