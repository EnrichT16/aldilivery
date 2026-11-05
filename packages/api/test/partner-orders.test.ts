/**
 * Partners see their orders and reach their Runner; speakable IDs for everyone; Shopper notes;
 * the receipt; the audit of Runner and partner actions (ruling 97, 5 November 2026).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PartnerShop } from '../src/domain.js';
import type { CallProvider, CallWebhookEvent } from '../src/lib/livekit.js';
import type { PushMessage, PushTarget } from '../src/lib/push.js';
import { backfillPublicIds } from '../src/services/public-ids.js';
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

interface FakeLiveKit extends CallProvider {
  tokens: Array<{ roomName: string; identity: string; name: string }>;
  ended: string[];
}

function fakeLiveKit(): FakeLiveKit {
  const fake: FakeLiveKit = {
    url: 'wss://ozi-test.livekit.cloud',
    tokens: [],
    ended: [],
    async issueToken(input) {
      fake.tokens.push({ roomName: input.roomName, identity: input.identity, name: input.name });
      return `token-for-${input.identity}`;
    },
    async verifyWebhook(body, authorization) {
      if (authorization !== 'signed') throw new Error('bad signature');
      const parsed = JSON.parse(body) as Omit<CallWebhookEvent, 'at'> & { at: string };
      return { ...parsed, at: new Date(parsed.at) };
    },
    async endRoom(roomName) {
      fake.ended.push(roomName);
    },
  };
  return fake;
}

const START = new Date('2026-11-05T10:00:00.000Z');

let harness: TestHarness;
let livekit: FakeLiveKit;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let milk: string;
let pushed: Array<{ to: string; message: PushMessage }>;
let texted: Array<{ to: string; body: string }>;

beforeEach(async () => {
  made = 0;
  livekit = fakeLiveKit();
  pushed = [];
  texted = [];
  harness = await buildTestApp(START, {
    autoOffer: true,
    calls: livekit,
    sendPush: async (target: PushTarget, message: PushMessage) => {
      pushed.push({ to: target.endpoint, message });
      return 'sent';
    },
    sendText: async (to, body) => {
      texted.push({ to, body });
    },
  });
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
});

afterEach(async () => {
  await harness.close();
});

function staff(method: 'GET' | 'POST', url: string, payload?: object) {
  return harness.app.inject({ method, url, headers: STAFF, ...(payload ? { payload } : {}) });
}

async function businessSignIn(username: string, password: string) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/business/sign-in',
    payload: { username, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { 'x-business-token': response.json().token as string };
}

let made = 0;

/** A Shop Partner with one approved product in the catalogue, and a signed-in person for it. */
async function partner(
  plan: 'free' | 'plus',
  extra: Partial<PartnerShop> = {},
): Promise<{ shop: PartnerShop; item: string; headers: Record<string, string> }> {
  made += 1;
  const shop = await harness.repository.partnerShops.create({
    name: made === 1 ? 'Corner Bakery' : `Shop ${made}`,
    address: '1 High Street, Gillingham',
    telephone: '01634 000000',
    about: 'Fresh bread.',
    monthlyPence: plan === 'plus' ? 1499 : 0,
    kind: 'shop',
    plan,
    status: 'approved',
    postcode: 'ME7 1AA',
    approvedAt: harness.now(),
    ...extra,
  });
  if (plan === 'plus') {
    await harness.repository.partnerShops.update(shop.id, {
      paidUntil: new Date(START.getTime() + 30 * 24 * 3_600_000),
    });
  }
  const product = await harness.repository.partnerProducts.create({
    partnerShopId: shop.id,
    name: 'Sourdough loaf',
    pricePence: 350,
    tags: 'bread',
    expiresOn: null,
    photo: null,
    photoType: null,
  });
  const item = await harness.repository.catalogue.create({
    name: `Sourdough loaf (${shop.name})`,
    category: `From ${shop.name}`,
    estimatedPricePence: 350,
    source: 'partner_feed',
    externalRef: `partner:${product.id}`,
  });
  await harness.repository.partnerProducts.update(product.id, {
    status: 'approved',
    catalogueItemId: item.id,
  });
  const user = (
    await staff('POST', `/staff/partners/${shop.id}/users`, {
      name: 'Bola',
      username: `shop${made}`,
    })
  ).json() as { password: string };
  const headers = await businessSignIn(`shop${made}`, user.password);
  return {
    shop: (await harness.repository.partnerShops.findById(shop.id))!,
    item: item.id,
    headers,
  };
}

/** An order of milk and the partner's loaf, taken by the Runner. */
async function orderTaken(
  lines: Array<{ catalogueItemId: string; quantity: number; note?: string }>,
  note?: string,
): Promise<string> {
  const priced = await harness.app.inject({
    method: 'POST',
    url: '/basket/price',
    headers: shopper.authHeader,
    payload: {
      lines: lines.map(({ catalogueItemId, quantity }) => ({ catalogueItemId, quantity })),
    },
  });
  expect(priced.statusCode, priced.body).toBe(200);
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines,
      ...(note ? { note } : {}),
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: priced.json().totalPence,
      },
    },
  });
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = (placed.json() as { order: { id: string } }).order.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  const accepted = await harness.app.inject({
    method: 'POST',
    url: `/jobs/${offer.id}/accept`,
    headers: runner.authHeader,
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  return orderId;
}

async function runnerDevice(): Promise<void> {
  await harness.repository.pushSubscriptions.save({
    runnerId: runner.runnerId,
    endpoint: 'https://fcm.googleapis.com/fcm/send/runner-phone',
    p256dh: 'key',
    auth: 'auth',
    createdAt: harness.now(),
  });
}

const reference = (orderId: string): string => `OZ-${orderId.slice(-6).toUpperCase()}`;

/** The words of a text PDF, unescaped and joined, so a sentence wrapped over two lines still reads. */
function pdfText(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('('))
    .map((line) => line.replace(/^\((.*)\) Tj T\*$/, '$1'))
    .join(' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\s+/g, ' ');
}

describe('a partner sees its orders', () => {
  it('lists only orders with its own lines, only those lines, and the Runner by first name and ID', async () => {
    const bakery = await partner('plus');
    const other = await partner('free');
    const orderId = await orderTaken([
      { catalogueItemId: milk, quantity: 2 },
      { catalogueItemId: bakery.item, quantity: 1 },
    ]);
    const runnerRow = (await harness.repository.runners.findById(runner.runnerId))!;

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: bakery.headers,
    });
    expect(mine.statusCode, mine.body).toBe(200);
    const body = mine.json();
    expect(body.shop).toMatchObject({ name: 'Corner Bakery', paidPlan: true, callWords: null });
    expect(body.shop.publicId).toMatch(/^P-[A-HJ-NP-Z2-9]{6}$/);
    expect(body.active).toHaveLength(1);
    const [order] = body.active;
    expect(order).toMatchObject({
      id: orderId,
      reference: reference(orderId),
      status: 'accepted',
      statusWords: 'A Runner is on the way to you',
      runner: { firstName: 'Tomasz', runnerId: runnerRow.referralCode },
      runnerAtShop: false,
      canReady: true,
      canMessage: true,
      canCall: true,
    });
    // Only the bakery's line, with what the Runner pays at its counter; not the milk.
    expect(order.lines).toEqual([
      expect.objectContaining({
        name: 'Sourdough loaf (Corner Bakery)',
        quantity: 1,
        runnerPaysPence: 350,
      }),
    ]);
    // Never the Shopper's name, address or number; never the Runner's surname or phone.
    expect(mine.body).not.toContain('Margaret');
    expect(mine.body).not.toContain('Example Street');
    expect(mine.body).not.toContain('07700');
    expect(mine.body).not.toContain('+44');
    expect(body.messageKinds.map((kind: { kind: string }) => kind.kind)).toEqual([
      'ready',
      'late',
      'side_door',
      'substituted',
    ]);

    // The other shop has nothing to do with this order.
    const theirs = await harness.app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: other.headers,
    });
    expect(theirs.json().active).toEqual([]);
    expect(theirs.json().shop.callWords).toBe('Calls to your Runner come with Shop Partner Plus.');
    const peek = await harness.app.inject({
      method: 'GET',
      url: `/partner/orders/${orderId}`,
      headers: other.headers,
    });
    expect(peek.statusCode).toBe(404);
  });

  it('says "ready for pickup" once, tells the Runner in Ozi\'s words, and writes it down', async () => {
    const bakery = await partner('free');
    await runnerDevice();
    const orderId = await orderTaken([{ catalogueItemId: bakery.item, quantity: 2 }]);

    const ready = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/ready`,
      headers: bakery.headers,
    });
    expect(ready.statusCode, ready.body).toBe(200);
    const words = `Corner Bakery says your order ${reference(orderId)} is ready for pickup.`;
    expect(ready.json().told).toBe('push');
    expect(ready.json().order.readyAt).not.toBeNull();
    expect(ready.json().order.canReady).toBe(false);
    expect(pushed).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ body: words }) }),
    ]);
    expect(texted.filter((text) => text.to === '+447700900101')).toEqual([]);

    // Once per order: saying it again changes nothing and tells nobody twice.
    const again = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/ready`,
      headers: bakery.headers,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().told).toBe('already');
    expect(pushed).toHaveLength(1);

    // The Runner's job shows it, with words Ozi can say once.
    const job = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(job.json().job.readyAt).not.toBeNull();
    expect(job.json().job.shopMessages).toEqual([
      expect.objectContaining({
        kind: 'ready',
        shopName: 'Corner Bakery',
        said: 'Corner Bakery says: Ready for pickup.',
      }),
    ]);

    // Written in the audit log, with the shop as the actor by name and Partner ID.
    const entries = await harness.repository.audit.list({});
    const readyEntry = entries.find((entry) => entry.action === 'partner.order-ready');
    expect(readyEntry).toMatchObject({
      actorRole: 'partner',
      actorId: bakery.shop.id,
      target: `order=${orderId}`,
      detail: words,
    });
    expect(readyEntry!.actorName).toMatch(/^Corner Bakery \(P-[A-HJ-NP-Z2-9]{6}\)$/);
  });

  it('falls back to a text when the Runner has no device', async () => {
    const bakery = await partner('free');
    const orderId = await orderTaken([{ catalogueItemId: bakery.item, quantity: 1 }]);
    const ready = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/ready`,
      headers: bakery.headers,
    });
    expect(ready.json().told).toBe('text');
    // The Runner's own phone; the Shopper's order updates are texts of their own.
    expect(texted.filter((text) => text.to === '+447700900101')).toEqual([
      { to: '+447700900101', body: expect.stringContaining('is ready for pickup.') },
    ]);
  });

  it('sends only the set messages, while the order is under way and 15 minutes after delivery', async () => {
    const bakery = await partner('free');
    await runnerDevice();
    const orderId = await orderTaken([{ catalogueItemId: bakery.item, quantity: 1 }]);

    const freeText = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/message`,
      headers: bakery.headers,
      payload: { kind: 'Bring cash' },
    });
    expect(freeText.statusCode).toBe(400);
    expect(freeText.json().error.message).toBe('Please choose one of the set messages.');

    const late = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/message`,
      headers: bakery.headers,
      payload: { kind: 'late' },
    });
    expect(late.statusCode, late.body).toBe(200);
    expect(pushed[0]!.message.body).toBe(
      `Corner Bakery says: Running 10 minutes late. Order ${reference(orderId)}.`,
    );
    const job = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(job.json().job.shopMessages).toEqual([
      expect.objectContaining({
        kind: 'late',
        said: 'Corner Bakery says: Running 10 minutes late.',
      }),
    ]);

    // Delivered: open for 15 minutes more, then closed.
    const deliveredAt = new Date(START.getTime() + 60 * 60_000);
    await harness.repository.orders.update(orderId, { status: 'delivered', deliveredAt });
    harness.setNow(new Date(deliveredAt.getTime() + 14 * 60_000));
    const soon = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/message`,
      headers: bakery.headers,
      payload: { kind: 'substituted' },
    });
    expect(soon.statusCode, soon.body).toBe(200);
    harness.setNow(new Date(deliveredAt.getTime() + 16 * 60_000));
    const closed = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/message`,
      headers: bakery.headers,
      payload: { kind: 'side_door' },
    });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.message).toMatch(/messages to its Runner have closed/);
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: bakery.headers,
    });
    expect(listed.json().active).toEqual([]);
    expect(listed.json().recent).toEqual([
      expect.objectContaining({
        id: orderId,
        status: 'delivered',
        canMessage: false,
        canCall: false,
      }),
    ]);
  });
});

describe('a partner calls its Runner', () => {
  it('is for paid packages only, free to both sides, and the Runner is told which shop', async () => {
    const free = await partner('free');
    const freeOrder = await orderTaken([{ catalogueItemId: free.item, quantity: 1 }]);
    const refused = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${freeOrder}/calls`,
      headers: free.headers,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toBe('Calls to your Runner come with Shop Partner Plus.');
    await harness.repository.orders.update(freeOrder, { status: 'delivered', deliveredAt: START });

    const bakery = await partner('plus');
    await runnerDevice();
    const orderId = await orderTaken([{ catalogueItemId: bakery.item, quantity: 1 }]);
    const started = await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/calls`,
      headers: bakery.headers,
    });
    expect(started.statusCode, started.body).toBe(201);
    const words = `Your shop ${bakery.shop.name} is calling about order ${reference(orderId)}.`;
    expect(started.json().call).toMatchObject({ startedBy: 'partner', free: true, words });
    expect(started.json().join.token).toBe(`token-for-partner-${bakery.shop.id}`);
    expect(pushed.at(-1)!.message.body).toContain(words);

    // The Runner sees who is ringing, and answers for free.
    const ringing = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/calls/current`,
      headers: runner.authHeader,
    });
    expect(ringing.json().call).toMatchObject({ startedBy: 'partner', free: true, words });
    const callId = ringing.json().call.id as string;
    const answered = await harness.app.inject({
      method: 'POST',
      url: `/calls/${callId}/join`,
      headers: runner.authHeader,
      payload: {},
    });
    expect(answered.statusCode, answered.body).toBe(200);
    const roomName = started.json().join.roomName as string;
    const joined = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/livekit',
      headers: { 'content-type': 'application/webhook+json', authorization: 'signed' },
      payload: JSON.stringify({
        id: 'evt-1',
        event: 'participant_joined',
        roomName,
        identity: `runner-${runner.runnerId}`,
        at: new Date(START.getTime() + 5000).toISOString(),
      }),
    });
    expect(joined.statusCode).toBe(200);
    expect((await harness.repository.calls.findById(callId))!.status).toBe('live');

    // Ended by the shop: nothing is billed to anybody.
    const gatewayCallsBefore = harness.payments.calls.length;
    const ended = await harness.app.inject({
      method: 'POST',
      url: `/partner/calls/${callId}/end`,
      headers: bakery.headers,
    });
    expect(ended.statusCode, ended.body).toBe(200);
    const call = (await harness.repository.calls.findById(callId))!;
    expect(call).toMatchObject({ status: 'ended', chargePence: 0, chargeStatus: 'not_due' });
    expect(harness.payments.calls.length).toBe(gatewayCallsBefore);
    expect(
      (await harness.repository.audit.list({})).some(
        (entry) => entry.action === 'partner.call-started' && entry.actorRole === 'partner',
      ),
    ).toBe(true);
  });
});

describe('speakable IDs', () => {
  it('gives each kind its own ID once, on first read, and shows it to the person', async () => {
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    const first = me.json().shopper.publicId as string;
    expect(first).toMatch(/^S-[A-HJ-NP-Z2-9]{6}$/);
    const again = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: shopper.authHeader,
    });
    expect(again.json().shopper.publicId).toBe(first);

    const bakery = await partner('plus');
    const businessMe = await harness.app.inject({
      method: 'GET',
      url: '/business/me',
      headers: bakery.headers,
    });
    expect(businessMe.json().publicId).toMatch(/^P-[A-HJ-NP-Z2-9]{6}$/);

    // Runners keep their Runner ID.
    const runnerMe = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: runner.authHeader,
    });
    expect(runnerMe.json().runner.referralCode).toMatch(/^R[A-HJ-NP-Z2-9]{7}$/);

    // A second Shopper never shares one.
    const second = await signUpShopper(harness, { displayName: 'Dev', phone: '+447700900002' });
    const other = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: second.authHeader,
    });
    expect(other.json().shopper.publicId).not.toBe(first);
  });

  it('backfills businesses and the team in one sweep, and staff see them', async () => {
    const organisation = await harness.repository.organisations.create({
      name: 'Medway Care',
      contactName: 'Jo',
      contactEmail: 'jo@example.org',
    });
    await harness.repository.partnerShops.create({
      name: 'Quiet Shop',
      address: '',
      telephone: '',
      about: '',
      monthlyPence: 0,
      plan: 'free',
    });
    await staff('POST', '/staff/owner', {
      name: 'Anthony',
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    const made = await backfillPublicIds(harness);
    expect(made).toBe(3);
    expect((await harness.repository.organisations.findById(organisation.id))!.publicId).toMatch(
      /^G-[A-HJ-NP-Z2-9]{6}$/,
    );
    const owner = (await harness.repository.staffMembers.list())[0]!;
    expect(owner.publicId).toMatch(/^T-[A-HJ-NP-Z2-9]{6}$/);
    expect(await backfillPublicIds(harness)).toBe(0);

    const partners = await staff('GET', '/staff/partners');
    expect(partners.json().shops[0].publicId).toMatch(/^P-/);
    expect(partners.json().organisations[0].publicId).toBe(
      (await harness.repository.organisations.findById(organisation.id))!.publicId,
    );
  });
});

describe("the Shopper's notes", () => {
  it('are kept on the item and the order, shown to the Runner with numbers blanked, and bounded', async () => {
    const bakery = await partner('free');
    const orderId = await orderTaken(
      [
        { catalogueItemId: milk, quantity: 1, note: 'ripe bananas, not green' },
        { catalogueItemId: bakery.item, quantity: 1 },
      ],
      'Leave it with the neighbour at number 14, ring 07700 900123 if nobody is in',
    );
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.note).toBe(
      'Leave it with the neighbour at number 14, ring 07700 900123 if nobody is in',
    );
    expect(order.items.find((item) => item.catalogueItemId === milk)!.note).toBe(
      'ripe bananas, not green',
    );
    const job = await harness.app.inject({
      method: 'GET',
      url: '/jobs/current',
      headers: runner.authHeader,
    });
    expect(job.json().job.note).toBe(
      'Leave it with the neighbour at number 14, ring [phone number] if nobody is in',
    );
    expect(
      job.json().job.items.find((item: { name: string }) => item.name.includes('milk')).note,
    ).toBe('ripe bananas, not green');

    const tooLong = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines: [{ catalogueItemId: milk, quantity: 1, note: 'x'.repeat(121) }],
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 1,
        },
      },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.message).toMatch(/up to 120 characters/);
  });
});

describe('the receipt', () => {
  it('carries the OZ reference, the Shopper ID, the Runner by first name and ID, and each shop with its Partner ID', async () => {
    const bakery = await partner('plus');
    const orderId = await orderTaken([
      { catalogueItemId: milk, quantity: 1 },
      { catalogueItemId: bakery.item, quantity: 1 },
    ]);
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    const shopperId = me.json().shopper.publicId as string;
    const runnerRow = (await harness.repository.runners.findById(runner.runnerId))!;
    const shop = (await harness.repository.partnerShops.findById(bakery.shop.id))!;

    const receipt = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/receipt.pdf`,
      headers: shopper.authHeader,
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-disposition']).toBe(
      `attachment; filename="receipt-${reference(orderId)}.pdf"`,
    );
    const text = pdfText(receipt.body);
    expect(text).toContain(`Order ${reference(orderId)}`);
    expect(text).not.toContain(`Order ${orderId}`);
    expect(text).toContain(`Receipt for Margaret (Shopper ID ${shopperId})`);
    expect(text).toContain(`Your Runner: Tomasz (Runner ID ${runnerRow.referralCode})`);
    expect(text).toContain(`from Corner Bakery (Partner ID ${shop.publicId})`);
    expect(text).not.toContain('07700');
    expect(text).not.toContain('+44');
    expect(text).not.toContain('01634');
  });
});

describe('the audit of Runner and partner actions', () => {
  it('writes down a Runner taking a job, by first name and Runner ID, and nothing a Shopper does', async () => {
    const bakery = await partner('free');
    const orderId = await orderTaken([{ catalogueItemId: bakery.item, quantity: 1 }]);
    const runnerRow = (await harness.repository.runners.findById(runner.runnerId))!;
    const entries = await harness.repository.audit.list({});
    const took = entries.find((entry) => entry.action === 'POST /jobs/:offerId/accept');
    expect(took).toMatchObject({
      actorRole: 'runner',
      actorId: runner.runnerId,
      actorName: `Tomasz (${runnerRow.referralCode})`,
    });
    expect(took!.target).toMatch(/^offerId=/);
    // The Shopper placed the order and saved a card: neither is written down here.
    expect(entries.some((entry) => entry.action === 'POST /orders')).toBe(false);
    expect(entries.some((entry) => entry.action === 'POST /payment-methods')).toBe(false);
    // The shop's sign-in is not written down either: a sign-in is not a change to anything.
    expect(entries.some((entry) => entry.action === 'POST /business/sign-in')).toBe(false);

    // A partner's plain change through its sign-in is written down with the shop as the actor.
    await harness.app.inject({
      method: 'POST',
      url: `/partner/orders/${orderId}/message`,
      headers: bakery.headers,
      payload: { kind: 'side_door' },
    });
    const sent = (await harness.repository.audit.list({})).find(
      (entry) => entry.action === 'partner.message',
    );
    expect(sent).toMatchObject({ actorRole: 'partner', actorId: bakery.shop.id });
    expect(sent!.detail).toContain('Please come to the side door');
  });
});
