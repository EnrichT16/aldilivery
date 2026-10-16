/**
 * The admin panel's "Needs you now" and order rescue tools (16 October 2026 review): what is
 * waiting for a person, most urgent first; cancelling an order with the money going back;
 * goodwill refunds, the owner's alone above the threshold; and giving a stuck order to another
 * Runner. Every change is gated by job and written in the audit log.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { countWords, needsYouWords } from '../src/services/needs-you.js';
import {
  STAFF,
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let items: Awaited<ReturnType<typeof seedCatalogue>>;
let texts: Array<{ to: string; body: string }>;

const NOW = new Date('2026-10-16T10:00:00.000Z');

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(NOW, {
    autoOffer: true,
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  items = await seedCatalogue(harness.repository);
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function placeOrder(
  shopper: SignedInShopper,
  milk = 2,
  payBy: 'card' | 'bank' = 'card',
): Promise<string> {
  const lines = [{ catalogueItemId: items.milk, quantity: milk }];
  // The total the Shopper agrees to is whatever the server prices the basket at today.
  const priced = await post('/basket/price', { lines }, shopper.authHeader);
  expect(priced.statusCode, priced.body).toBe(200);
  const placed = await post(
    '/orders',
    {
      lines,
      deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
      payBy,
      ...(payBy === 'card' ? { paymentMethodId: shopper.paymentMethodId } : {}),
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: priced.json().totalPence as number,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  return placed.json().order.id as string;
}

async function accepted(runner: SignedInRunner, orderId: string): Promise<void> {
  const offer = (await harness.repository.offers.listForOrder(orderId)).find(
    (row) => row.runnerId === runner.runnerId && row.outcome === 'pending',
  );
  expect(offer).toBeDefined();
  const taken = await post(`/jobs/${offer!.id}/accept`, {}, runner.authHeader);
  expect(taken.statusCode, taken.body).toBe(200);
}

async function ownerHeaders(): Promise<Record<string, string>> {
  await post('/staff/owner', {
    name: 'Anthony',
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

async function staffHeaders(role: string, username: string): Promise<Record<string, string>> {
  const made = await post('/staff/team', { name: username, username, role });
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', { username, password: made.json().password });
  return { 'x-staff-token': signedIn.json().token as string };
}

async function auditActions(): Promise<string[]> {
  const owner = await ownerHeaders();
  const log = (await get('/staff/audit', owner)).json().entries as Array<{ action: string }>;
  return log.map((entry) => entry.action);
}

describe('needs you now', () => {
  it('lists what is waiting, most urgent first, and says it in one breath', async () => {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    // A bank transfer order, waiting to be checked.
    await placeOrder(shopper, 2, 'bank');
    // An SOS, on now.
    const sos = await post('/runners/me/sos', {}, runner.authHeader);
    expect(sos.statusCode, sos.body).toBe(201);
    // A problem to decide, on an order the Runner has.
    const live = await placeOrder(shopper);
    await accepted(runner, live);
    const complaint = await post(
      `/orders/${live}/problems`,
      { summary: 'The eggs were broken', refundRequestedPence: 0 },
      shopper.authHeader,
    );
    expect(complaint.statusCode, complaint.body).toBe(201);

    const response = await get('/staff/needs-you');
    expect(response.statusCode, response.body).toBe(200);
    const cards = response.json().cards as Array<{ key: string; count: number; tab: string }>;
    expect(cards.map((card) => card.key)).toEqual(['sos', 'bank-transfers', 'problems']);
    expect(cards.map((card) => card.tab)).toEqual(['problems', 'payments', 'problems']);
    expect(response.json().splitAfterMinutes).toBe(harness.config.dispatch.splitAfterMinutes);
    expect(needsYouWords(response.json().cards)).toBe(
      'Three things need you: one SOS, one bank transfer to check, one problem to decide.',
    );

    // The overview carries the same cards, so one screen shows them.
    const overview = await get('/staff/overview');
    expect(overview.json().needsYou.map((card: { key: string }) => card.key)).toEqual([
      'sos',
      'bank-transfers',
      'problems',
    ]);
  });

  it('counts an order waiting for a Runner only past the dispatcher’s split wait', async () => {
    // Nobody on shift, so the order waits.
    const shopper = await signUpShopper(harness);
    await placeOrder(shopper);
    expect((await get('/staff/needs-you')).json().cards).toEqual([]);
    const minutes = harness.config.dispatch.splitAfterMinutes;
    harness.setNow(new Date(NOW.getTime() + (minutes + 1) * 60_000));
    const cards = (await get('/staff/needs-you')).json().cards as Array<{
      key: string;
      count: number;
      words: string;
      tab: string;
    }>;
    expect(cards).toEqual([
      expect.objectContaining({
        key: 'waiting-orders',
        count: 1,
        words: 'one order waiting for a Runner',
        tab: 'orders',
      }),
    ]);
  });

  it('gives each card only to a job that holds its tab', async () => {
    const shopper = await signUpShopper(harness);
    await placeOrder(shopper, 2, 'bank');
    // A family viewer with only the overview sees nothing that points to a tab they lack.
    const owner = await ownerHeaders();
    const viewer = await post(
      '/staff/viewers',
      { name: 'Yvette', username: 'yvette', kind: 'family' },
      owner,
    );
    expect(viewer.statusCode, viewer.body).toBe(201);
    const switched = await post(
      `/staff/viewers/${viewer.json().viewer.id}`,
      { areas: ['overview'] },
      owner,
    );
    expect(switched.statusCode, switched.body).toBe(200);
    const signedIn = await post('/staff/sign-in', {
      username: 'yvette',
      password: viewer.json().password,
    });
    const yvette = { 'x-staff-token': signedIn.json().token as string };
    expect((await get('/staff/needs-you', yvette)).json().cards).toEqual([]);
    // The founder's key holds the Payments tab, so the transfer shows.
    expect((await get('/staff/needs-you')).json().cards.map((c: { key: string }) => c.key)).toEqual(
      ['bank-transfers'],
    );
  });

  it('says it plainly', () => {
    expect(needsYouWords([])).toBe('Nothing needs you right now.');
    expect(countWords(2)).toBe('two');
    expect(countWords(13)).toBe('13');
  });
});

describe('cancelling an order', () => {
  it('refunds a card payment in full, tells the Runner and Shopper, and is written down', async () => {
    const runner = await signUpRunner(harness, { phone: '+447700900555' });
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await accepted(runner, orderId);
    const before = harness.payments.calls.filter((call) => call.kind === 'refund').length;

    const care = await staffHeaders('customer_care', 'chidi');
    const cancelled = await post(
      `/staff/orders/${orderId}/cancel`,
      { reason: 'The Shopper rang to cancel.', by: 'Somebody else' },
      care,
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().refundedPence).toBe(350 + 799);
    expect(cancelled.json().message).toMatch(/£11\.49 is going back to the card/);

    const refunds = harness.payments.calls.filter((call) => call.kind === 'refund');
    expect(refunds).toHaveLength(before + 1);
    expect(refunds.at(-1)!.input).toMatchObject({
      paymentIntentId: expect.stringMatching(/^pi_/),
      amountPence: 1149,
      reference: `cancel:${orderId}`,
    });

    const order = await harness.repository.orders.findById(orderId);
    expect(order).toMatchObject({
      status: 'cancelled',
      runnerId: runner.runnerId,
      cancelReason: 'Cancelled by chidi: The Shopper rang to cancel.',
    });
    // The Runner is told to stop, by text.
    expect(texts.find((text) => text.to === '+447700900555')?.body).toMatch(
      /has been cancelled by the office\. Please stop/,
    );
    // The cancellations and refunds reports both know of it.
    const cancellations = (await get('/staff/reports/cancellations')).json();
    expect(cancellations.count).toBe(1);
    expect(cancellations.byReason[0].reason).toBe(
      'Cancelled by chidi: The Shopper rang to cancel.',
    );
    const refundsReport = (await get('/staff/reports/refunds')).json();
    expect(refundsReport.refunds[0]).toMatchObject({
      amountPence: 1149,
      group: 'cancelled orders',
    });
    // And the audit log says who did it, as their own account, whatever name was sent.
    const owner = await ownerHeaders();
    const entry = (
      (await get('/staff/audit', owner)).json().entries as Array<Record<string, string>>
    ).find((row) => row.action === 'POST /staff/orders/:id/cancel');
    expect(entry).toMatchObject({ actorName: 'chidi', target: `id=${orderId}` });
    expect(entry!.detail).toContain('The Shopper rang to cancel.');
  });

  it('cancels a bank transfer order: nothing taken before it arrives, sent back by hand after', async () => {
    const shopper = await signUpShopper(harness);
    const unpaid = await placeOrder(shopper, 2, 'bank');
    const first = await post(`/staff/orders/${unpaid}/cancel`, {
      reason: 'Never paid.',
      by: 'Kemi',
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ refundedPence: 0, bankRefundPence: 0 });
    expect(first.json().message).toMatch(/Nothing was taken/);

    const paid = await placeOrder(shopper, 2, 'bank');
    const received = await post(`/staff/payments/${paid}/received`, {});
    expect(received.statusCode, received.body).toBe(200);
    const second = await post(`/staff/orders/${paid}/cancel`, { reason: 'Shop shut.', by: 'Kemi' });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().bankRefundPence).toBe(1149);
    expect(harness.payments.calls.filter((call) => call.kind === 'refund')).toHaveLength(0);
    // It waits on the till cases, to send back by hand, and no card is ever touched.
    const cases = (await get('/staff/till-cases')).json();
    expect(cases.waiting).toEqual([
      expect.objectContaining({ orderId: paid, differencePence: -1149, paidBy: 'bank' }),
    ]);
    const settled = await post(`/staff/till-cases/${paid}/settle`, {
      outcome: 'refunded_by_hand',
      by: 'Kemi',
    });
    expect(settled.statusCode, settled.body).toBe(200);
  });

  it('will not cancel a delivered order, and is not every job’s to do', async () => {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await accepted(runner, orderId);
    const onboarding = await staffHeaders('onboarding', 'tunde');
    expect(
      (await post(`/staff/orders/${orderId}/cancel`, { reason: 'x', by: 'Tunde' }, onboarding))
        .statusCode,
    ).toBe(403);
    await harness.repository.orders.update(orderId, { status: 'delivered', deliveredAt: NOW });
    const refused = await post(`/staff/orders/${orderId}/cancel`, {
      reason: 'Too late.',
      by: 'Kemi',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/has been delivered/);
    expect((await auditActions()).filter((action) => action.endsWith('/cancel'))).toEqual([]);
  });
});

describe('a goodwill refund', () => {
  async function deliveredOrder(
    milk: number,
  ): Promise<{ orderId: string; shopper: SignedInShopper }> {
    const runner = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper, milk);
    await accepted(runner, orderId);
    await harness.repository.orders.update(orderId, { status: 'delivered', deliveredAt: NOW });
    return { orderId, shopper };
  }

  it('refunds the stated amount, never more than the order cost, and is written down', async () => {
    const { orderId } = await deliveredOrder(2);
    const given = await post(`/staff/orders/${orderId}/goodwill`, {
      amountPence: 300,
      reason: 'Sorry it came late.',
      by: 'Kemi',
    });
    expect(given.statusCode, given.body).toBe(200);
    expect(given.json().message).toBe(
      `£3.00 is going back to the card for order ${orderId.slice(-6).toUpperCase()}.`,
    );
    expect(
      harness.payments.calls.filter((call) => call.kind === 'refund').at(-1)!.input,
    ).toMatchObject({
      amountPence: 300,
      reference: `goodwill:${orderId}`,
    });
    expect((await harness.repository.orders.findById(orderId))!.goodwillRefundedPence).toBe(300);
    // The order cost £11.49; £3.00 has gone; £8.49 is left, and no more.
    const detail = (await get(`/staff/orders/${orderId}`)).json();
    expect(detail.order.refundablePence).toBe(849);
    const tooMuch = await post(`/staff/orders/${orderId}/goodwill`, {
      amountPence: 850,
      reason: 'x',
      by: 'Kemi',
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.message).toMatch(/Up to £8\.49 can still go back/);
    expect((await auditActions()).filter((action) => action.endsWith('/goodwill'))).toHaveLength(1);
    expect(detail.timeline.map((event: { what: string }) => event.what)).toContain(
      'Founder (staff key): Gave a goodwill refund.',
    );
  });

  it('above the threshold it is the owner’s alone to give', async () => {
    const { orderId } = await deliveredOrder(24);
    const threshold = harness.config.admin.ownerOnlyRefundAbovePence;
    const refund = { amountPence: threshold + 1, reason: 'Everything went wrong.', by: 'Kemi' };
    const refused = await post(`/staff/orders/${orderId}/goodwill`, refund);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/is for the owner to give/);
    const owner = await ownerHeaders();
    const given = await post(`/staff/orders/${orderId}/goodwill`, refund, owner);
    expect(given.statusCode, given.body).toBe(200);
  });

  it('has nothing to refund on a bank transfer order', async () => {
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper, 2, 'bank');
    await post(`/staff/payments/${orderId}/received`, {});
    const refused = await post(`/staff/orders/${orderId}/goodwill`, {
      amountPence: 100,
      reason: 'x',
      by: 'Kemi',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/no card payment/);
  });
});

describe('giving a stuck order to another Runner', () => {
  it('releases the Runner who has it, tells them, and offers it to the Runner named', async () => {
    const first = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await accepted(first, orderId);
    const second = await signUpRunner(harness, { name: 'Bola Adeyemi', phone: '+447700900102' });

    const choices = (await get(`/staff/orders/${orderId}/runners`)).json().runners as Array<{
      id: string;
    }>;
    expect(choices.map((row) => row.id)).toEqual([second.runnerId]);

    const moved = await post(`/staff/orders/${orderId}/reassign`, {
      runnerId: second.runnerId,
      by: 'Kemi',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ released: 'Tomasz', offeredTo: 'Bola' });
    const order = await harness.repository.orders.findById(orderId);
    expect(order).toMatchObject({ status: 'offered', runnerId: null, acceptedAt: null });
    expect(texts.find((text) => text.to === '+447700900101')?.body).toMatch(
      /given to another Runner/,
    );
    // Bola accepts the offer made for her, as any offer.
    await accepted(second, orderId);
    expect((await harness.repository.orders.findById(orderId))!.runnerId).toBe(second.runnerId);
    expect((await auditActions()).filter((action) => action.endsWith('/reassign'))).toHaveLength(1);
  });

  it('with no Runner named, offers it again through the dispatcher', async () => {
    const first = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await accepted(first, orderId);
    await signUpRunner(harness, { name: 'Bola', phone: '+447700900102' });
    const moved = await post(`/staff/orders/${orderId}/reassign`, { by: 'Kemi' });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().offeredTo).toBe('Bola');
    const pending = (await harness.repository.offers.listForOrder(orderId)).filter(
      (offer) => offer.outcome === 'pending',
    );
    expect(pending.map((offer) => offer.runnerId)).not.toContain(first.runnerId);
  });

  it('refuses once the shopping is bought, and the same Runner', async () => {
    const first = await signUpRunner(harness);
    const shopper = await signUpShopper(harness);
    const orderId = await placeOrder(shopper);
    await accepted(first, orderId);
    const same = await post(`/staff/orders/${orderId}/reassign`, {
      runnerId: first.runnerId,
      by: 'Kemi',
    });
    expect(same.statusCode).toBe(400);
    await harness.repository.orders.update(orderId, {
      status: 'receipt_submitted',
      receiptTotalPence: 300,
    });
    const late = await post(`/staff/orders/${orderId}/reassign`, { by: 'Kemi' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toMatch(/shopping has been bought/);
  });
});
