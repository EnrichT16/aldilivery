/**
 * In-app calls (docs/BUILD_PROMPT.md, Section F; rulings of 2 October 2026): who can call, the
 * price agreed first, no telephone numbers, MERGE by link, minutes from LiveKit's own signed
 * webhooks, the Shopper paying for themselves and their guests, a Runner never paying, and a
 * charge that cannot be taken waiting for the next one that can.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { CallProvider, CallWebhookEvent } from '../src/lib/livekit.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

interface FakeLiveKit extends CallProvider {
  tokens: Array<{ roomName: string; identity: string; name: string }>;
  ended: string[];
}

/** Stands in for LiveKit. A webhook body is the event itself; the header must say "signed". */
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

let harness: TestHarness;
let livekit: FakeLiveKit;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let orderId: string;

const START = new Date('2026-10-02T10:00:00.000Z');

beforeEach(async () => {
  livekit = fakeLiveKit();
  harness = await buildTestApp(START, { autoOffer: true, calls: livekit });
  const items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
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
  orderId = (placed.json() as { order: { id: string } }).order.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  await harness.app.inject({
    method: 'POST',
    url: `/jobs/${offer.id}/accept`,
    headers: runner.authHeader,
  });
});

function call(
  who: { authHeader: Record<string, string> } | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
) {
  return harness.app.inject({
    method,
    url,
    ...(who ? { headers: who.authHeader } : {}),
    ...(payload ? { payload } : {}),
  });
}

function webhook(event: string, roomName: string, identity: string | null, secondsIn: number) {
  return harness.app.inject({
    method: 'POST',
    url: '/webhooks/livekit',
    headers: { 'content-type': 'application/webhook+json', authorization: 'signed' },
    payload: JSON.stringify({
      id: `evt-${event}-${identity}-${secondsIn}`,
      event,
      roomName,
      identity,
      at: new Date(START.getTime() + secondsIn * 1000).toISOString(),
    }),
  });
}

async function shopperCalls() {
  const response = await call(shopper, 'POST', `/orders/${orderId}/calls`, {
    priceAccepted: true,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    call: { id: string; status: string };
    join: { url: string; token: string; roomName: string };
  };
}

describe('starting a call', () => {
  it('puts the price to the Shopper first, and calls nothing until they say yes', async () => {
    const refused = await call(shopper, 'POST', `/orders/${orderId}/calls`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toBe(
      'In-app calls cost 5p a minute, paid from your card when the call ends. Please say yes to that first.',
    );
    expect(livekit.tokens).toEqual([]);

    const started = await shopperCalls();
    expect(started.join.url).toBe('wss://ozi-test.livekit.cloud');
    expect(started.join.roomName).toMatch(/^call-[0-9a-f]{32}$/);
    const stored = await harness.repository.calls.findById(started.call.id);
    expect(stored?.priceStatement).toBe(
      'In-app calls cost 5p a minute, paid from your card when the call ends.',
    );
  });

  it('joins people by an identity of ours and a first name, never a phone number', async () => {
    await shopperCalls();
    const answered = await call(runner, 'POST', `/orders/${orderId}/calls`);
    expect(answered.statusCode).toBe(200);
    expect(livekit.tokens.map((t) => t.identity)).toEqual([
      `shopper-${shopper.shopperId}`,
      `runner-${runner.runnerId}`,
    ]);
    expect(livekit.tokens.map((t) => t.name)).toEqual(['Margaret', 'Tomasz']);
    expect(JSON.stringify(livekit.tokens)).not.toMatch(/\+44|07700/);
    expect(answered.body).not.toMatch(/\+44|07700/);
  });

  it('lets a Runner call, and the Shopper answers only once they have said yes to the price', async () => {
    const rung = await call(runner, 'POST', `/orders/${orderId}/calls`);
    expect(rung.statusCode).toBe(201);
    const callId = (rung.json() as { call: { id: string } }).call.id;
    const current = await call(shopper, 'GET', `/orders/${orderId}/calls/current`);
    expect(current.json().call).toMatchObject({
      id: callId,
      status: 'ringing',
      priceAccepted: false,
    });

    expect((await call(shopper, 'POST', `/calls/${callId}/join`, {})).statusCode).toBe(409);
    const answered = await call(shopper, 'POST', `/calls/${callId}/join`, { priceAccepted: true });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().call.priceAccepted).toBe(true);
  });

  it('is only for the Shopper and the Runner of the order', async () => {
    const stranger = await signUpShopper(harness, { phone: '+447700900222' });
    const refused = await call(stranger, 'POST', `/orders/${orderId}/calls`, {
      priceAccepted: true,
    });
    expect(refused.statusCode).toBe(404);
  });

  it('says plainly when calls are not switched on', async () => {
    const off = await buildTestApp(START);
    const response = await off.app.inject({ method: 'GET', url: '/health' });
    expect(response.json().callsEnabled).toBe(false);
    const someone = await signUpShopper(off);
    const refused = await off.app.inject({
      method: 'POST',
      url: '/orders/anything/calls',
      headers: someone.authHeader,
      payload: { priceAccepted: true },
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.json().error.message).toMatch(/not switched on yet/);
  });
});

describe('what a call costs, and who pays', () => {
  it('bills the Shopper 5p a minute, rounded up, and never counts the Runner', async () => {
    const { call: started, join } = await shopperCalls();
    await call(runner, 'POST', `/orders/${orderId}/calls`);
    const shopperId = `shopper-${shopper.shopperId}`;
    const runnerId = `runner-${runner.runnerId}`;
    await webhook('participant_joined', join.roomName, shopperId, 0);
    await webhook('participant_joined', join.roomName, runnerId, 5);
    expect((await harness.repository.calls.findById(started.id))?.status).toBe('live');
    await webhook('participant_left', join.roomName, runnerId, 190);
    await webhook('room_finished', join.roomName, null, 200);

    const ended = await harness.repository.calls.findById(started.id);
    // The Shopper was on for 200 seconds: 4 minutes. The Runner's minutes are not counted.
    expect(ended).toMatchObject({
      status: 'ended',
      billedMinutes: 4,
      chargePence: 20,
      chargeStatus: 'paid',
    });
    const charges = harness.payments.calls.filter((c) => c.kind === 'saved_card_charge');
    expect(charges).toHaveLength(1);
    expect(charges[0]?.input).toMatchObject({ amountPence: 20 });
  });

  it('charges nothing when the Shopper never answered', async () => {
    const rung = await call(runner, 'POST', `/orders/${orderId}/calls`);
    const { call: started } = rung.json() as { call: { id: string } };
    const roomName = (await harness.repository.calls.findById(started.id))!.roomName;
    await webhook('participant_joined', roomName, `runner-${runner.runnerId}`, 0);
    await webhook('room_finished', roomName, null, 60);
    expect(await harness.repository.calls.findById(started.id)).toMatchObject({
      chargePence: 0,
      chargeStatus: 'not_due',
    });
    expect(harness.payments.calls.some((c) => c.kind === 'saved_card_charge')).toBe(false);
  });

  it('ignores a webhook that does not carry LiveKit’s signature', async () => {
    const { join } = await shopperCalls();
    const forged = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/livekit',
      headers: { 'content-type': 'application/webhook+json', authorization: 'forged' },
      payload: JSON.stringify({
        id: 'x',
        event: 'room_finished',
        roomName: join.roomName,
        identity: null,
        at: START.toISOString(),
      }),
    });
    expect(forged.statusCode).toBe(400);
  });
});

describe('MERGE: adding somebody to the call', () => {
  it('puts the price for them to the Shopper, sends a link, and bills their minutes too', async () => {
    const { call: started, join } = await shopperCalls();
    const refused = await call(shopper, 'POST', `/calls/${started.id}/guests`, { name: 'Helen' });
    expect(refused.statusCode).toBe(400);

    const added = await call(shopper, 'POST', `/calls/${started.id}/guests`, {
      name: 'Helen',
      priceAccepted: true,
    });
    expect(added.statusCode, added.body).toBe(201);
    const { link } = added.json() as { link: string };
    expect(link).toMatch(/\/call\/join#[A-Za-z0-9_-]{20,}$/);
    const code = link.split('#')[1]!;

    const guest = await call(null, 'POST', '/calls/guest-join', { code });
    expect(guest.statusCode).toBe(200);
    expect(guest.json().name).toBe('Helen');
    const guestIdentity = livekit.tokens.at(-1)!.identity;
    expect(guestIdentity).toMatch(/^guest-/);
    expect(
      (await call(null, 'POST', '/calls/guest-join', { code: 'not-the-right-code' })).statusCode,
    ).toBe(404);

    await webhook('participant_joined', join.roomName, `shopper-${shopper.shopperId}`, 0);
    await webhook('participant_joined', join.roomName, guestIdentity, 60);
    await webhook('participant_left', join.roomName, guestIdentity, 180);
    await webhook('room_finished', join.roomName, null, 240);
    // Shopper 4 minutes, Helen 2 minutes: 6 minutes at 5p.
    expect(await harness.repository.calls.findById(started.id)).toMatchObject({
      billedMinutes: 6,
      chargePence: 30,
      chargeStatus: 'paid',
    });
  });

  it('cannot be done by a Runner', async () => {
    const { call: started } = await shopperCalls();
    const refused = await call(runner, 'POST', `/calls/${started.id}/guests`, {
      name: 'Pal',
      priceAccepted: true,
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('a card with no money', () => {
  async function finishedCallOfMinutes(minutes: number): Promise<string> {
    const { call: started, join } = await shopperCalls();
    await webhook('participant_joined', join.roomName, `shopper-${shopper.shopperId}`, 0);
    await webhook('room_finished', join.roomName, null, minutes * 60);
    return started.id;
  }

  it('leaves the charge waiting, and takes it the next time a charge succeeds', async () => {
    harness.payments.declineNextCharge = true;
    const first = await finishedCallOfMinutes(3);
    expect((await harness.repository.calls.findById(first))?.chargeStatus).toBe('outstanding');
    const balance = await call(shopper, 'GET', '/me/call-balance');
    expect(balance.json().outstandingPence).toBe(15);

    const second = await finishedCallOfMinutes(2);
    expect((await harness.repository.calls.findById(first))?.chargeStatus).toBe('paid');
    expect((await harness.repository.calls.findById(second))?.chargeStatus).toBe('paid');
    expect((await call(shopper, 'GET', '/me/call-balance')).json().outstandingPence).toBe(0);
  });

  it('stops anybody more being added once more than £10 is waiting', async () => {
    harness.payments.declineNextCharge = true;
    await finishedCallOfMinutes(201); // £10.05, outstanding
    const { call: next } = await shopperCalls();
    const refused = await call(shopper, 'POST', `/calls/${next.id}/guests`, {
      name: 'Helen',
      priceAccepted: true,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toBe(
      'There is £10.05 for earlier calls still to pay. Once that is paid, you can add people to calls again.',
    );
  });
});

describe('END CALL', () => {
  it('closes the room for everyone and bills what was used', async () => {
    const { call: started, join } = await shopperCalls();
    await webhook('participant_joined', join.roomName, `shopper-${shopper.shopperId}`, 0);
    harness.setNow(new Date(START.getTime() + 61_000));
    const ended = await call(runner, 'POST', `/calls/${started.id}/end`);
    expect(ended.statusCode).toBe(200);
    expect(livekit.ended).toEqual([join.roomName]);
    expect(ended.json().call).toMatchObject({ status: 'ended', billedMinutes: 2, chargePence: 10 });
  });
});

describe('the real LiveKit library', () => {
  it('issues a pass for one room only, and checks a webhook’s signature', async () => {
    const { AccessToken } = await import('livekit-server-sdk');
    const { createHash } = await import('node:crypto');
    const { livekitProvider } = await import('../src/lib/livekit.js');
    const real = livekitProvider({
      url: 'wss://ozi-test.livekit.cloud',
      apiKey: 'test-key',
      apiSecret: 'test-secret-that-is-long-enough-for-hs256',
    });

    const token = await real.issueToken({
      roomName: 'call-abc',
      identity: 'shopper-1',
      name: 'Margaret',
      ttlSeconds: 600,
    });
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      sub: string;
      name: string;
      video: { room: string; roomJoin: boolean };
    };
    expect(claims).toMatchObject({
      sub: 'shopper-1',
      name: 'Margaret',
      video: { room: 'call-abc', roomJoin: true },
    });

    const body = JSON.stringify({
      event: 'room_finished',
      id: 'EV_1',
      createdAt: '1790000000',
      room: { name: 'call-abc' },
    });
    const signer = new AccessToken('test-key', 'test-secret-that-is-long-enough-for-hs256');
    signer.sha256 = createHash('sha256').update(body).digest('base64');
    const event = await real.verifyWebhook(body, await signer.toJwt());
    expect(event).toMatchObject({ id: 'EV_1', event: 'room_finished', roomName: 'call-abc' });
    expect(event.at.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());

    await expect(
      real.verifyWebhook(body.replace('abc', 'xyz'), await signer.toJwt()),
    ).rejects.toThrow();
  });
});

describe('ringing the Shopper’s own phone (ruling 46)', () => {
  it('rings it through LiveKit, never shows the number, and never charges for it', async () => {
    const dialled: Array<{ roomName: string; phone: string; identity: string; name: string }> = [];
    livekit.dialPhone = async (input) => {
      dialled.push(input);
    };
    const started = await call(runner, 'POST', `/orders/${orderId}/calls`);
    const callId = (started.json() as { call: { id: string } }).call.id;
    const room = livekit.tokens[0]!.roomName;

    const rung = await call(runner, 'POST', `/calls/${callId}/phone`);
    expect(rung.statusCode, rung.body).toBe(200);
    expect(rung.body).not.toContain('7700900001');
    expect(rung.json().message).toMatch(
      /^Ringing Margaret's phone now\. Their number is never shown/,
    );
    expect(dialled).toEqual([
      {
        roomName: room,
        phone: '+447700900001',
        identity: `phone-${shopper.shopperId}`,
        name: 'Margaret',
      },
    ]);

    // The phone answers: the call is live. Five minutes later everyone hangs up.
    await webhook('participant_joined', room, `runner-${runner.runnerId}`, 0);
    await webhook('participant_joined', room, `phone-${shopper.shopperId}`, 5);
    expect((await harness.repository.calls.findById(callId))!.status).toBe('live');
    await webhook('participant_left', room, `phone-${shopper.shopperId}`, 305);
    await webhook('room_finished', room, null, 310);
    const ended = (await harness.repository.calls.findById(callId))!;
    expect(ended.billedMinutes).toBe(0);
    expect(ended.chargePence).toBe(0);
  });

  it('is only for the Runner, and says so when it is not switched on', async () => {
    const started = await call(runner, 'POST', `/orders/${orderId}/calls`);
    const callId = (started.json() as { call: { id: string } }).call.id;
    expect((await call(runner, 'POST', `/calls/${callId}/phone`)).statusCode).toBe(503);
    livekit.dialPhone = async () => undefined;
    expect((await call(shopper, 'POST', `/calls/${callId}/phone`)).statusCode).toBe(401);
  });
});
