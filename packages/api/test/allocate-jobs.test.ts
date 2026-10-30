/**
 * Sending jobs straight to a chosen Runner, outside the queue (ruling 80, Anthony, 24 October
 * 2026): only the owner and staff he lets allocate; any number of orders to any number of
 * Runners, each answered on its own; a priority offer held ten minutes for the Runner alone, who
 * may still say no; an allocated queue for a Runner sent several; the backup or the queue when
 * it comes back; carrying limits, split parts, booked orders and demo orders respected; and every
 * order sent written in the audit log and on the order's history.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import { fromShopsWords, sweepAllocations } from '../src/services/allocate.js';
import { sweepOffers } from '../src/services/dispatch.js';
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
let shopper: SignedInShopper;

// A Saturday morning, 10:00 in the UK (British Summer Time ends on 25 October).
const NOW = new Date('2026-10-24T09:00:00.000Z');

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(NOW, {
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

function get(url: string, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

/** A paid order through the real checkout. */
async function placeOrder(): Promise<string> {
  const lines = [{ catalogueItemId: items.milk, quantity: 2 }];
  const priced = await post('/basket/price', { lines }, shopper.authHeader);
  expect(priced.statusCode, priced.body).toBe(200);
  const placed = await post(
    '/orders',
    {
      lines,
      deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
      payBy: 'card',
      paymentMethodId: shopper.paymentMethodId,
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

/** A paid order made straight in the store, for when a test needs many. */
async function paidOrder(patch: Partial<Order> = {}): Promise<string> {
  const order = await harness.repository.orders.create({
    shopperId: shopper.shopperId,
    status: 'paid',
    goodsEstimatePence: 1000,
    feePence: 1099,
    totalEstimatePence: 2099,
    deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
    latitude: 52.4862,
    longitude: -1.8904,
    items: [{ name: 'Semi skimmed milk, 2 pints', quantity: 2, estimatedPricePence: 125 }],
  });
  if (Object.keys(patch).length > 0) await harness.repository.orders.update(order.id, patch);
  return order.id;
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

async function staffMember(
  role: string,
  username: string,
): Promise<{ id: string; headers: Record<string, string> }> {
  const made = await post('/staff/team', { name: username, username, role });
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', { username, password: made.json().password });
  return {
    id: made.json().member.id as string,
    headers: { 'x-staff-token': signedIn.json().token as string },
  };
}

function allocate(
  assignments: Array<{
    orderId: string;
    runnerId: string;
    backupRunnerId?: string;
    allowEarly?: boolean;
  }>,
  headers: Record<string, string> = STAFF,
) {
  return post('/staff/orders/allocate', { assignments }, headers);
}

async function pendingOffers(orderId: string) {
  return (await harness.repository.offers.listForOrder(orderId)).filter(
    (offer) => offer.outcome === 'pending',
  );
}

async function offerFor(runner: SignedInRunner, orderId: string) {
  const offer = (await pendingOffers(orderId)).find((row) => row.runnerId === runner.runnerId);
  expect(offer, `no offer of ${orderId} for the Runner`).toBeDefined();
  return offer!;
}

describe('who may send jobs straight to a Runner', () => {
  it('refuses a staff member without the permission, and the reassign route still works', async () => {
    const care = await staffMember('customer_care', 'ngozi');
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const orderId = await placeOrder();

    expect((await get('/staff/allocate', care.headers)).statusCode).toBe(403);
    const refused = await allocate([{ orderId, runnerId: tomasz.runnerId }], care.headers);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/owner, and the staff he lets allocate/);
    expect(await pendingOffers(orderId)).toHaveLength(0);

    // The older rescue tool is unchanged for anyone with the Orders tab.
    const reassigned = await post(
      `/staff/orders/${orderId}/reassign`,
      { runnerId: tomasz.runnerId, by: 'Ngozi' },
      care.headers,
    );
    expect(reassigned.statusCode, reassigned.body).toBe(200);
  });

  it('is the owner’s to give in Team, and then the staff member may', async () => {
    const owner = await ownerHeaders();
    const care = await staffMember('customer_care', 'ngozi');
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const orderId = await placeOrder();

    // Nobody but the owner gives it: not the staff key, not the staff member.
    expect(
      (await post(`/staff/team/${care.id}/allocate`, { canAllocate: true }, STAFF)).statusCode,
    ).toBe(403);
    const granted = await post(`/staff/team/${care.id}/allocate`, { canAllocate: true }, owner);
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json().member.canAllocate).toBe(true);
    expect((await get('/staff/me', care.headers)).json().canAllocate).toBe(true);

    const sent = await allocate([{ orderId, runnerId: tomasz.runnerId }], care.headers);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().results[0]).toMatchObject({ result: 'allocated', state: 'offered' });

    // And taken away again.
    await post(`/staff/team/${care.id}/allocate`, { canAllocate: false }, owner);
    expect((await get('/staff/allocate', care.headers)).statusCode).toBe(403);
  });

  it('lets the owner, who always may', async () => {
    const owner = await ownerHeaders();
    expect((await get('/staff/me', owner)).json().canAllocate).toBe(true);
    const tomasz = await signUpRunner(harness, { name: 'Tomasz Nowak', phone: '+447700900101' });
    const orderId = await placeOrder();

    const board = await get('/staff/allocate', owner);
    expect(board.statusCode, board.body).toBe(200);
    expect(board.json().orders.map((row: { id: string }) => row.id)).toContain(orderId);
    expect(board.json().runners[0]).toMatchObject({
      id: tomasz.runnerId,
      onShift: true,
      travelWords: 'by car',
      holds: 0,
    });

    const sent = await allocate([{ orderId, runnerId: tomasz.runnerId }], owner);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().message).toBe('1 order sent to Tomasz.');
    const offer = await offerFor(tomasz, orderId);
    expect(offer.allocated).toBe(true);
    // Held for him alone for ten minutes (`allocation.allocatedHoldMinutes`).
    expect(offer.expiresAt.getTime() - NOW.getTime()).toBe(10 * 60_000);
  });
});

describe('how the Runner gets it', () => {
  it('is told by text, with no customer telephone number, and sees a priority offer', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const orderId = await placeOrder();
    const order = (await harness.repository.orders.findById(orderId))!;
    expect((await allocate([{ orderId, runnerId: tomasz.runnerId }])).statusCode).toBe(200);

    const text = texts.find((row) => row.to === '+447700900101');
    expect(text?.body).toMatch(/The office has sent you job/);
    expect(text?.body).toMatch(/You get £5\.00/);
    // No supermarket is named: we have no partnership with one (Anthony, 30 October 2026).
    expect(text?.body).toMatch(/of shopping, from the shops on the list\./);
    expect(text?.body).not.toContain(`from ${harness.config.store.displayName}`);
    const shopperAccount = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(text?.body).not.toContain(shopperAccount!.phone);
    expect(text?.body).not.toContain(order.deliveryAddress);

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: tomasz.authHeader,
    });
    const [first] = mine.json().offers;
    expect(first).toMatchObject({ allocated: true, secondsLeft: 600 });
    expect(first.allocatedWords).toMatch(/You can still say no/);
    // Rule Two: the pay is the order's own, unchanged.
    expect(first.job.runnerPaymentPence).toBe(500);
  });

  it('notifies the Runner’s devices when they allowed it', async () => {
    const pushed: Array<{ body: string; url: string }> = [];
    await harness.close();
    harness = await buildTestApp(NOW, {
      sendPush: async (_target, message) => {
        pushed.push(message);
        return 'sent';
      },
    });
    items = await seedCatalogue(harness.repository);
    shopper = await signUpShopper(harness);
    const tomasz = await signUpRunner(harness, { name: 'Tomasz' });
    const saved = await post(
      '/runners/me/push-subscriptions',
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      },
      tomasz.authHeader,
    );
    expect(saved.statusCode, saved.body).toBe(201);
    const orderId = await placeOrder();
    await allocate([{ orderId, runnerId: tomasz.runnerId }]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ url: '/runner' });
    expect(pushed[0]!.body).toMatch(/^The office has sent you job/);
  });
});

describe('no limits', () => {
  it('processes 120 assignments in one go, each on its own, and writes each in the audit log', async () => {
    const owner = await ownerHeaders();
    const runners = [
      await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' }),
      await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900102' }),
      await signUpRunner(harness, { name: 'Bola', phone: '+447700900103' }),
    ];
    const orderIds: string[] = [];
    for (let index = 0; index < 120; index += 1) orderIds.push(await paidOrder());

    const sent = await allocate(
      orderIds.map((orderId, index) => ({ orderId, runnerId: runners[index % 3]!.runnerId })),
      owner,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    const body = sent.json();
    expect(body.results).toHaveLength(120);
    expect(body).toMatchObject({ allocated: 120, refused: 0 });
    expect(body.message).toMatch(
      /^120 orders sent|^40 orders sent to Tomasz, 40 sent to Ayesha, 40 sent to Bola/,
    );

    // Each Runner has the first offered now, and the other 39 waiting in the order sent.
    for (const runner of runners) {
      const mine = body.results.filter(
        (row: { runnerId: string }) => row.runnerId === runner.runnerId,
      );
      expect(mine.filter((row: { state: string }) => row.state === 'offered')).toHaveLength(1);
      expect(mine.filter((row: { state: string }) => row.state === 'queued')).toHaveLength(39);
      expect(mine.at(-1).place).toBe(39);
    }
    const log = (await get('/staff/audit?limit=500', owner)).json().entries as Array<{
      action: string;
      actorName: string;
    }>;
    const entries = log.filter((entry) => entry.action === 'order.allocated');
    expect(entries).toHaveLength(120);
    expect(entries[0]!.actorName).toBe('Anthony');
  });
});

describe('several orders to one Runner', () => {
  it('queues them, and offers the next when the one in hand is delivered', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz' });
    const first = await paidOrder();
    const second = await paidOrder();
    const third = await paidOrder();
    const sent = await allocate([
      { orderId: first, runnerId: tomasz.runnerId },
      { orderId: second, runnerId: tomasz.runnerId },
      { orderId: third, runnerId: tomasz.runnerId },
    ]);
    expect(sent.json().results.map((row: { state: string }) => row.state)).toEqual([
      'offered',
      'queued',
      'queued',
    ]);
    expect(sent.json().message).toBe(
      '3 orders sent to Tomasz. 2 wait their turn with Tomasz, in the order sent.',
    );
    expect(await pendingOffers(second)).toHaveLength(0);

    // The ordinary queue leaves them alone meanwhile, even with another Runner free.
    await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900102' });
    await sweepOffers(harness.app.ctx);
    expect(await pendingOffers(second)).toHaveLength(0);
    expect(await pendingOffers(third)).toHaveLength(0);

    const offer = await offerFor(tomasz, first);
    const taken = await post(`/jobs/${offer.id}/accept`, {}, tomasz.authHeader);
    expect(taken.statusCode, taken.body).toBe(200);
    // While the first is in hand, the second waits, sweep or no sweep.
    await sweepAllocations(harness.app.ctx);
    expect(await pendingOffers(second)).toHaveLength(0);

    await harness.repository.orders.update(first, { status: 'delivering' });
    const delivered = await post(
      `/orders/${first}/status`,
      { status: 'delivered' },
      tomasz.authHeader,
    );
    expect(delivered.statusCode, delivered.body).toBe(200);
    const next = await offerFor(tomasz, second);
    expect(next.allocated).toBe(true);
    expect(await pendingOffers(third)).toHaveLength(0);
  });
});

describe('when it comes back', () => {
  it('goes to the backup on a no, and the office hears of it on Ozi’s desk', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const ayesha = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900102' });
    const orderId = await paidOrder();
    await allocate([{ orderId, runnerId: tomasz.runnerId, backupRunnerId: ayesha.runnerId }]);

    const offer = await offerFor(tomasz, orderId);
    const no = await post(`/jobs/${offer.id}/decline`, {}, tomasz.authHeader);
    expect(no.statusCode, no.body).toBe(200);
    expect(no.json().message).toMatch(/back to the office/);

    const backupOffer = await offerFor(ayesha, orderId);
    expect(backupOffer.allocated).toBe(true);
    const matters = await harness.repository.ownerDesk.listUnsettled();
    const matter = matters.find((row) => row.kind === 'allocation_returned');
    expect(matter).toMatchObject({ options: 'acknowledge' });
    expect(matter!.summary).toMatch(/Tomasz said no to order .*It has gone to Ayesha, the backup/);

    const history = (await get(`/staff/orders/${orderId}`)).json().timeline as Array<{
      what: string;
    }>;
    const lines = history.map((row) => row.what);
    expect(lines.some((line) => /sent it to Tomasz, with Ayesha as the backup/.test(line))).toBe(
      true,
    );
    expect(lines).toContain('Tomasz said no, so it went to the backup.');
  });

  it('goes back to the queue when the time runs out and there is no backup', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const orderId = await paidOrder();
    await allocate([{ orderId, runnerId: tomasz.runnerId }]);
    const bola = await signUpRunner(harness, { name: 'Bola', phone: '+447700900103' });

    // Nine minutes in, it is still his alone.
    harness.setNow(new Date(NOW.getTime() + 9 * 60_000));
    await sweepAllocations(harness.app.ctx);
    await sweepOffers(harness.app.ctx);
    expect((await pendingOffers(orderId)).map((row) => row.runnerId)).toEqual([tomasz.runnerId]);

    harness.setNow(new Date(NOW.getTime() + 10 * 60_000 + 1000));
    await sweepAllocations(harness.app.ctx);
    const pending = await pendingOffers(orderId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ runnerId: bola.runnerId, allocated: false });
    const [allocation] = await harness.repository.allocations.listForOrder(orderId);
    expect(allocation).toMatchObject({ status: 'expired', returnedTo: 'queue' });
    const matter = (await harness.repository.ownerDesk.listUnsettled()).find(
      (row) => row.kind === 'allocation_returned',
    );
    expect(matter!.summary).toMatch(/did not answer in time.*back in the queue/);
  });
});

describe('what is refused, and why', () => {
  it('refuses a Runner who cannot carry it, with the reason, and sends the rest', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    await harness.repository.runners.update(tomasz.runnerId, { vehicleType: 'bicycle' });
    const big = await paidOrder({ goodsEstimatePence: 8000 });
    const small = await paidOrder();
    const sent = await allocate([
      { orderId: big, runnerId: tomasz.runnerId },
      { orderId: small, runnerId: tomasz.runnerId },
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
    const [refused, allocated] = sent.json().results;
    expect(refused).toMatchObject({ result: 'refused' });
    expect(refused.reason).toMatch(/^Tomasz cannot carry it: this order is £80\.00 of shopping/);
    expect(allocated).toMatchObject({ result: 'allocated' });
    expect(sent.json().message).toMatch(
      /^1 order sent to Tomasz; 1 could not be: order \w+, Tomasz cannot carry it/,
    );
    expect(await pendingOffers(big)).toHaveLength(0);
  });

  it('refuses an order already bought, a demo order and an unapproved Runner', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const waiting = await signUpRunner(harness, {
      name: 'Kemi',
      phone: '+447700900104',
      verified: false,
    });
    const bought = await paidOrder({ status: 'receipt_submitted', receiptTotalPence: 900 });
    const demo = await paidOrder({ isDemo: true });
    const fine = await paidOrder();
    const sent = await allocate([
      { orderId: bought, runnerId: tomasz.runnerId },
      { orderId: demo, runnerId: tomasz.runnerId },
      { orderId: fine, runnerId: waiting.runnerId },
    ]);
    expect(sent.json().results.map((row: { reason: string }) => row.reason)).toEqual([
      'it has been bought already',
      'it is a demo order, so no Runner is sent',
      'Kemi is not approved to take jobs',
    ]);
    expect(sent.json().message).toMatch(
      /^Nothing was sent: order \w+, it has been bought already;/,
    );
  });

  it('sends each part of a split job on its own, to a Runner of its kind', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    await harness.repository.runners.update(tomasz.runnerId, { vehicleType: 'bicycle' });
    const parent = await paidOrder({ goodsEstimatePence: 12000, splitAt: NOW });
    const part = await paidOrder({
      goodsEstimatePence: 6000,
      splitParentId: parent,
      splitPart: 1,
      splitOf: 2,
      splitMode: 'foot',
    });
    const sent = await allocate([
      { orderId: parent, runnerId: tomasz.runnerId },
      { orderId: part, runnerId: tomasz.runnerId },
    ]);
    expect(sent.json().results[0].reason).toMatch(/split into parts/);
    expect(sent.json().results[1]).toMatchObject({ result: 'allocated', state: 'offered' });
  });

  it('sends a booked order for a later day only when sent early on purpose', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const later = await paidOrder({
      deliveryDay: '2026-10-28',
      deliveryWindow: 'morning',
      offerAt: new Date('2026-10-28T06:30:00.000Z'),
    });
    const refused = await allocate([{ orderId: later, runnerId: tomasz.runnerId }]);
    expect(refused.json().results[0].reason).toMatch(
      /booked for a later day, Wednesday 28 October/,
    );
    expect(await pendingOffers(later)).toHaveLength(0);

    const early = await allocate([{ orderId: later, runnerId: tomasz.runnerId, allowEarly: true }]);
    expect(early.json().results[0]).toMatchObject({ result: 'allocated', state: 'offered' });
  });

  it('holds an order booked for later today for the Runner until its offer time', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const afternoon = await paidOrder({
      deliveryDay: '2026-10-24',
      deliveryWindow: 'afternoon',
      offerAt: new Date('2026-10-24T09:30:00.000Z'),
    });
    const board = (await get('/staff/allocate')).json();
    expect(board.orders.find((row: { id: string }) => row.id === afternoon)).toMatchObject({
      bookedLater: true,
    });
    const sent = await allocate([{ orderId: afternoon, runnerId: tomasz.runnerId }]);
    expect(sent.json().results[0]).toMatchObject({ result: 'allocated', state: 'queued' });
    expect(await pendingOffers(afternoon)).toHaveLength(0);

    harness.setNow(new Date('2026-10-24T09:30:00.000Z'));
    await sweepAllocations(harness.app.ctx);
    expect((await offerFor(tomasz, afternoon)).allocated).toBe(true);
  });

  it('takes an order back from a Runner who had accepted it, and tells them to stop', async () => {
    const tomasz = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
    const ayesha = await signUpRunner(harness, { name: 'Ayesha', phone: '+447700900102' });
    const orderId = await paidOrder();
    await allocate([{ orderId, runnerId: tomasz.runnerId }]);
    const offer = await offerFor(tomasz, orderId);
    await post(`/jobs/${offer.id}/accept`, {}, tomasz.authHeader);
    expect((await harness.repository.allocations.listForOrder(orderId))[0]!.status).toBe(
      'accepted',
    );

    const again = await allocate([{ orderId, runnerId: tomasz.runnerId }]);
    expect(again.json().results[0].reason).toBe('Tomasz has it already');

    const moved = await allocate([{ orderId, runnerId: ayesha.runnerId }]);
    expect(moved.json().results[0]).toMatchObject({ result: 'allocated', state: 'offered' });
    expect(
      texts.find((row) => row.to === '+447700900101' && /given to another Runner/.test(row.body)),
    ).toBeDefined();
    expect((await harness.repository.orders.findById(orderId))!.runnerId).toBeNull();
  });
});

describe('where a job comes from, in words (30 October 2026)', () => {
  it('names the Shop Partners when there are any, and otherwise the shops on the list', () => {
    expect(fromShopsWords([])).toBe('the shops on the list');
    expect(fromShopsWords(['Mama Africa Foods'])).toBe('Mama Africa Foods');
    expect(fromShopsWords(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
