/**
 * Closing an account, and keeping only what the privacy page says for as long as it says
 * (docs/LEGAL_REVIEW.md: deleting closed accounts and the retention jobs).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sweepRetention } from '../src/services/retention.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const DAY = 24 * 3600 * 1000;
const START = new Date('2026-10-09T10:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;
let milk: string;

beforeEach(async () => {
  harness = await buildTestApp(START);
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function later(days: number): Date {
  return new Date(START.getTime() + days * DAY);
}

async function placeOrder(): Promise<string> {
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
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
  });
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json().order.id as string;
}

async function closeAccount() {
  const closed = await harness.app.inject({
    method: 'POST',
    url: '/account/delete',
    headers: shopper.authHeader,
  });
  expect(closed.statusCode).toBe(200);
  return closed.json() as { message: string };
}

describe('closing an account', () => {
  it('waits seven days, then removes the person and keeps the money records', async () => {
    const orderId = await placeOrder();
    await harness.repository.orders.update(orderId, { status: 'completed' });
    expect((await closeAccount()).message).toContain('7 days');

    harness.setNow(later(6));
    expect((await sweepRetention(harness.app.ctx)).accountsRemoved).toBe(0);
    expect((await harness.repository.shoppers.findById(shopper.shopperId))?.displayName).toBe(
      'Margaret',
    );

    harness.setNow(later(7));
    expect((await sweepRetention(harness.app.ctx)).accountsRemoved).toBe(1);
    const gone = (await harness.repository.shoppers.findById(shopper.shopperId))!;
    expect(gone.displayName).toBe('Closed account');
    expect(gone.phone).not.toBe('+447700900001');
    expect(gone.doorstepProtocol).toBe('');
    expect(gone.erasedAt).toEqual(later(7));
    expect(await harness.repository.shoppers.findByPhone('+447700900001')).toBeNull();
    expect(await harness.repository.paymentMethods.listForShopper(shopper.shopperId)).toEqual([]);

    // The order and its money stay, as the privacy page says, without the address.
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.totalEstimatePence).toBe(250 + 100 + 799);
    expect(order.deliveryAddress).toBe('');
    expect(order.doorstepProtocolSnapshot).toBe('');
    expect(order.confirmationStatement).toBe('Send my order and pay.');

    // Done once: the next sweep finds nothing more to do.
    expect((await sweepRetention(harness.app.ctx)).accountsRemoved).toBe(0);
  });

  it('can be changed back within the seven days, and then nothing is removed', async () => {
    await closeAccount();
    const restored = await harness.app.inject({
      method: 'POST',
      url: '/account/restore',
      headers: shopper.authHeader,
    });
    expect(restored.json().restored).toBe(true);
    harness.setNow(later(30));
    expect((await sweepRetention(harness.app.ctx)).accountsRemoved).toBe(0);
  });

  it('waits for an order still on its way to be finished first', async () => {
    await placeOrder();
    await closeAccount();
    harness.setNow(later(8));
    expect(await sweepRetention(harness.app.ctx)).toMatchObject({
      accountsRemoved: 0,
      accountsWaiting: 1,
    });
  });
});

describe('the retention periods on the privacy page', () => {
  it('removes problem evidence two years after the problem was decided', async () => {
    const orderId = await placeOrder();
    const report = await harness.repository.problems.create({
      orderId,
      reportedBy: 'shopper',
      reporterId: shopper.shopperId,
      summary: 'The eggs were broken.',
      refundRequestedPence: 0,
      status: 'decided',
      decideBy: START,
      decision: 'no_fault',
      refundPence: 0,
      refundReference: null,
      decisionNote: 'Sorry.',
      decidedBy: 'Staff',
      decidedAt: START,
      createdAt: START,
    });
    await harness.repository.problemEvidence.create({
      reportId: report.id,
      addedBy: 'shopper',
      kind: 'photo',
      data: Buffer.from('photo'),
      contentType: 'image/jpeg',
      text: null,
      createdAt: START,
    });
    harness.setNow(later(700));
    expect((await sweepRetention(harness.app.ctx)).problemEvidenceRemoved).toBe(0);
    harness.setNow(later(731));
    expect((await sweepRetention(harness.app.ctx)).problemEvidenceRemoved).toBe(1);
    expect(await harness.repository.problemEvidence.listForReport(report.id)).toEqual([]);
  });

  it('removes sign-in codes after a year and the usage figures after three', async () => {
    await harness.repository.oneTimeCodes.create({
      phone: '+447700900001',
      codeHash: 'hash',
      expiresAt: START,
      createdAt: START,
    });
    await harness.repository.analytics.record({
      at: START,
      kind: 'search',
      shopperKey: null,
      runnerKey: null,
      shop: null,
      area: 'ME7',
      toArea: null,
      ageBand: null,
      viaOrganisation: false,
      itemCount: 0,
      goodsPence: 0,
      categories: '',
      query: 'milk',
      travelMode: null,
    });
    harness.setNow(later(366));
    expect(await sweepRetention(harness.app.ctx)).toMatchObject({
      signInCodesRemoved: 1,
      analyticsRemoved: 0,
    });
    harness.setNow(later(3 * 365 + 1));
    expect((await sweepRetention(harness.app.ctx)).analyticsRemoved).toBe(1);
  });

  it('makes orders anonymous after seven years, keeping the money, and removes the receipt photo', async () => {
    const orderId = await placeOrder();
    await harness.repository.receiptPhotos.save({
      orderId,
      data: Buffer.from('receipt'),
      contentType: 'image/jpeg',
      createdAt: START,
    });
    harness.setNow(later(6 * 365));
    expect((await sweepRetention(harness.app.ctx)).ordersAnonymised).toBe(0);
    harness.setNow(later(7 * 365 + 3));
    expect(await sweepRetention(harness.app.ctx)).toMatchObject({
      ordersAnonymised: 1,
      receiptPhotosRemoved: 1,
    });
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.deliveryAddress).toBe('');
    expect(order.totalEstimatePence).toBe(250 + 100 + 799);
    expect(order.anonymisedAt).not.toBeNull();
  });
});
