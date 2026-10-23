/**
 * Ozi rings the owner in the app first, then his mobile (ruling 79, Anthony, 23 October 2026).
 * Acted out with a fake clock, stand-ins for notifications and for placing calls, and requests
 * signed the way Twilio signs them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { PushMessage, PushTarget } from '../src/lib/push.js';
import { twilioSignature, type PlaceCallOptions } from '../src/lib/twilio-voice.js';
import { askOwner, fallBackToPhone, sweepOwnerDesk } from '../src/services/owner-desk.js';
import { STAFF, buildTestApp, type TestAppOptions, type TestHarness } from './helpers.js';

const ORIGIN = 'https://desk.example.test';
const TOKEN = 'twilio-auth-token-for-app-ring-tests';
const OWNER_PHONE = '+447700900999';
/** Friday 23 October 2026, 11:00 in the UK. */
const START = new Date('2026-10-23T10:00:00.000Z');
const DEVICE = 'https://fcm.googleapis.com/fcm/send/owner-phone';

interface Rang {
  to: string;
  url: string;
  statusCallback: string;
  options: PlaceCallOptions | undefined;
}

let harness: TestHarness;
let rang: Rang[];
let pushes: Array<{ target: PushTarget; message: PushMessage }>;

async function build(options: TestAppOptions = {}): Promise<TestHarness> {
  rang = [];
  pushes = [];
  harness = await buildTestApp(START, {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN, ownerAlertPhone: OWNER_PHONE },
    sendText: async () => undefined,
    sendPush: async (target, message) => {
      pushes.push({ target, message });
      return 'sent';
    },
    placeCall: async (to, url, statusCallback, callOptions) => {
      rang.push({ to, url, statusCallback, options: callOptions });
    },
    ...options,
  });
  return harness;
}

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string>) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}

/** The owner's own account, signed in with the passcode. */
async function owner(): Promise<{ 'x-staff-token': string }> {
  const made = await post(
    '/staff/owner',
    { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
  const signed = await post(
    '/staff/sign-in',
    { username: 'anthony', password: 'a long password', passcode: '123456#' },
    {},
  );
  expect(signed.statusCode, signed.body).toBe(200);
  return { 'x-staff-token': signed.json().token as string };
}

/** "Let Ozi ring me in the app", on his phone. */
async function allowOnDevice(headers: Record<string, string>) {
  const saved = await post(
    '/staff/push-subscriptions',
    { endpoint: DEVICE, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } },
    headers,
  );
  expect(saved.statusCode, saved.body).toBe(201);
}

function later(ms: number): void {
  harness.setNow(new Date(harness.now().getTime() + ms));
}

function seconds(count: number): number {
  return count * 1000;
}

async function aMatter(summary = 'A Shopper wrote about order OZ-AAAAAA: lovely Runner.') {
  return (await askOwner(harness.app.ctx, {
    kind: 'shopper_feedback',
    subjectId: `feedback-${Math.random()}`,
    summary,
    options: 'acknowledge',
  }))!;
}

function twilio(path: string, params: Record<string, string>) {
  return harness.app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': twilioSignature(TOKEN, `${ORIGIN}${path}`, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

function pathOf(url: string): string {
  return url.replace(/&amp;/g, '&').replace(ORIGIN, '');
}

describe('in the app first, then the phone', () => {
  it('rings his devices first; unanswered after 30 seconds, the same attempt rings his phone', async () => {
    await build();
    const headers = await owner();
    await allowOnDevice(headers);
    await aMatter();

    const first = await sweepOwnerDesk(harness.app.ctx);
    expect(first).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ status: 'app_ringing', attempt: 1, cascade: 1 }),
      }),
    );
    expect(rang).toHaveLength(0);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.target.endpoint).toBe(DEVICE);
    expect(pushes[0]!.message).toEqual(
      expect.objectContaining({ title: 'Ozi is calling, Mr. Anthony', url: '/staff' }),
    );
    // Never a word of what the matter is, on a notification.
    expect(JSON.stringify(pushes[0]!.message)).not.toMatch(/lovely Runner/);

    // Still ringing in the app: no phone yet, and no second attempt on top of it.
    later(seconds(20));
    expect(await fallBackToPhone(harness.app.ctx)).toEqual([]);
    expect(await sweepOwnerDesk(harness.app.ctx)).toEqual({ called: false, reason: 'ringing' });

    // Thirty seconds: the phone, for the same attempt.
    later(seconds(10));
    const phoned = await fallBackToPhone(harness.app.ctx);
    expect(phoned).toEqual([
      expect.objectContaining({
        id: (first as { call: { id: string } }).call.id,
        status: 'placed',
      }),
    ]);
    expect(rang).toHaveLength(1);
    expect(rang[0]!.to).toBe(OWNER_PHONE);
    expect(rang[0]!.options).toEqual({ machineDetection: true });

    // Not answered on the phone either: the next attempt, two minutes later, rings the app first.
    const status = await twilio(pathOf(rang[0]!.statusCallback), {
      CallSid: 'CA-owner',
      CallStatus: 'no-answer',
    });
    expect(status.statusCode).toBe(204);
    later(seconds(60));
    expect(await sweepOwnerDesk(harness.app.ctx)).toEqual({ called: false, reason: 'waiting' });
    later(seconds(60));
    expect(await sweepOwnerDesk(harness.app.ctx)).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ status: 'app_ringing', attempt: 2 }),
      }),
    );
    expect(pushes).toHaveLength(2);
  });

  it('answered in the app: Ozi greets him with the same words, and the phone never rings', async () => {
    await build({ sendPush: undefined });
    const headers = await owner();
    // The admin panel open: it asks whether Ozi is ringing.
    expect((await get('/staff/desk/ring', headers)).json()).toEqual({ ring: null });
    await aMatter();
    const swept = await sweepOwnerDesk(harness.app.ctx);
    expect(swept).toEqual(
      expect.objectContaining({ call: expect.objectContaining({ status: 'app_ringing' }) }),
    );

    const ringing = (await get('/staff/desk/ring', headers)).json();
    expect(ringing.ring).toEqual(
      expect.objectContaining({ test: false, words: 'Ozi is calling, Mr. Anthony.' }),
    );
    const answered = await post(`/staff/desk/ring/${ringing.ring.id}/answer`, {}, headers);
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json()).toEqual(
      expect.objectContaining({
        opening: 'Hello, Mr. Anthony. This is Ozi. One thing needs you.',
        farewell: "That's everything. Goodbye, Mr. Anthony.",
      }),
    );
    expect(answered.json().matters[0].spoken).toBe(
      'A Shopper wrote about order OZ-AAAAAA: lovely Runner. Say heard it, or later, or press 1 or 3.',
    );

    later(seconds(90));
    expect(await fallBackToPhone(harness.app.ctx)).toEqual([]);
    expect(rang).toHaveLength(0);
    const [call] = await harness.repository.ownerDesk.latestCalls(1);
    expect(call).toEqual(expect.objectContaining({ status: 'answered', answeredVia: 'app' }));
    // Answered a second time, from another device: already answered.
    expect((await post(`/staff/desk/ring/${call!.id}/answer`, {}, headers)).statusCode).toBe(409);
  });

  it('his choices in the app do what the keypad does, recorded as decided in the app', async () => {
    await build();
    const headers = await owner();
    await allowOnDevice(headers);
    const shop = await harness.repository.partnerShops.create({
      name: 'Corner Bakery',
      address: '12 High Street',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'shop',
      status: 'pending',
      source: 'self',
    });
    const matter = (await askOwner(harness.app.ctx, {
      kind: 'partner_shop',
      subjectId: shop.id,
      summary: 'A new shop, Corner Bakery, has joined and is waiting for approval.',
      options: 'decide',
    }))!;
    const later60 = await aMatter('Something to hear later.');
    await sweepOwnerDesk(harness.app.ctx);
    const ring = (await get('/staff/desk/ring', headers)).json().ring;
    const answered = (await post(`/staff/desk/ring/${ring.id}/answer`, {}, headers)).json();
    expect(answered.opening).toBe('Hello, Mr. Anthony. This is Ozi. Two things need you.');
    expect(answered.matters[0].spoken).toMatch(
      /^The first\. A new shop, Corner Bakery.*Say approve, decline or later, or press 1, 2 or 3\.$/,
    );
    expect(answered.matters[1].spoken).toMatch(/^The second, and last\./);

    // Only the owner answers Ozi's call: the founder's staff key cannot decide "in the app".
    expect(
      (await post(`/staff/desk/${matter.id}`, { choice: 'approve', via: 'app' }, STAFF)).statusCode,
    ).toBe(403);

    expect((await post(`/staff/desk/${matter.id}/read`, {}, headers)).statusCode).toBe(200);
    const approved = await post(
      `/staff/desk/${matter.id}`,
      { choice: 'approve', via: 'app' },
      headers,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().message).toBe('Approved.');
    expect((await harness.repository.partnerShops.findById(shop.id))?.status).toBe('approved');
    const decided = await harness.repository.ownerDesk.findMatter(matter.id);
    expect(decided).toEqual(
      expect.objectContaining({ status: 'decided', decidedVia: 'app', decidedBy: 'Mr. Anthony' }),
    );
    const audit = await harness.repository.audit.list({ search: 'owner-desk.decided' });
    expect(audit[0]?.detail).toMatch(/^Approved on Ozi's call in the app: A new shop/);

    // "Later" in the app: back in an hour, exactly as on the phone.
    const put = await post(`/staff/desk/${later60.id}`, { choice: 'later', via: 'app' }, headers);
    expect(put.json().message).toBe('Left for later. I will ask you again in an hour.');
    expect((await harness.repository.ownerDesk.findMatter(later60.id))?.laterUntil).toEqual(
      new Date(harness.now().getTime() + 60 * 60_000),
    );
    expect((await post(`/staff/desk/ring/${ring.id}/end`, {}, headers)).statusCode).toBe(200);
  });

  it('no device and the panel not open: straight to the phone, as before', async () => {
    await build();
    const headers = await owner();
    // The panel was open, but closed more than a few seconds ago.
    await get('/staff/desk/ring', headers);
    later(seconds(60));
    await aMatter();
    const swept = await sweepOwnerDesk(harness.app.ctx);
    expect(swept).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ status: 'placed', appRingUntil: null }),
      }),
    );
    expect(rang).toHaveLength(1);
    expect(pushes).toHaveLength(0);
  });

  it('"Not now" ends that attempt without the phone; Ozi tries again as for an unanswered call', async () => {
    await build();
    const headers = await owner();
    await allowOnDevice(headers);
    await aMatter();
    await sweepOwnerDesk(harness.app.ctx);
    const ring = (await get('/staff/desk/ring', headers)).json().ring;
    const declined = await post(`/staff/desk/ring/${ring.id}/not-now`, {}, headers);
    expect(declined.json().message).toBe('All right, Mr. Anthony. Ozi will try again later.');
    later(seconds(60));
    expect(await fallBackToPhone(harness.app.ctx)).toEqual([]);
    expect(rang).toHaveLength(0);
    later(seconds(60));
    expect(await sweepOwnerDesk(harness.app.ctx)).toEqual(
      expect.objectContaining({ call: expect.objectContaining({ attempt: 2 }) }),
    );
  });

  it('only the owner registers a device, and only a browser push service address', async () => {
    await build();
    expect(
      (
        await post(
          '/staff/push-subscriptions',
          { endpoint: DEVICE, keys: { p256dh: 'a', auth: 'b' } },
          STAFF,
        )
      ).statusCode,
    ).toBe(403);
    const headers = await owner();
    expect(
      (
        await post(
          '/staff/push-subscriptions',
          { endpoint: 'https://example.test/hook', keys: { p256dh: 'a', auth: 'b' } },
          headers,
        )
      ).statusCode,
    ).toBe(400);
    await allowOnDevice(headers);
    const reach = (await get('/staff/desk/reach', headers)).json();
    expect(reach).toEqual({ notificationsOn: true, devices: 1, phone: true, appRingSeconds: 30 });
    expect(JSON.stringify(reach)).not.toContain('7700');
    const removed = await harness.app.inject({
      method: 'DELETE',
      url: '/staff/push-subscriptions',
      headers,
      payload: { endpoint: DEVICE },
    });
    expect(removed.statusCode).toBe(200);
    expect((await get('/staff/desk/reach', headers)).json().devices).toBe(0);
  });
});

describe("Test Ozi's call, in My settings", () => {
  it('rings in the app, then the phone, says it is a test, and never counts in the rounds', async () => {
    await build();
    const headers = await owner();
    await allowOnDevice(headers);
    const tested = await post('/staff/desk/test-call', {}, headers);
    expect(tested.statusCode, tested.body).toBe(200);
    expect(tested.json().message).toBe(
      'Ozi is ringing you in the app now. If you do not answer within 30 seconds, Ozi rings your phone.',
    );
    expect(pushes[0]!.message.body).toMatch(/A test call/);
    expect((await get('/staff/desk/ring', headers)).json().ring).toEqual(
      expect.objectContaining({ test: true }),
    );

    later(seconds(30));
    expect(await fallBackToPhone(harness.app.ctx)).toHaveLength(1);
    expect(rang).toHaveLength(1);
    const hello = await twilio(pathOf(rang[0]!.url), { CallSid: 'CA-test', AnsweredBy: 'human' });
    expect(hello.body).toMatch(/This is a test call\. Ringing your phone works\./);

    // A real matter now is rung about as the first attempt of the first round.
    await aMatter();
    expect(await sweepOwnerDesk(harness.app.ctx)).toEqual(
      expect.objectContaining({ call: expect.objectContaining({ attempt: 1, cascade: 1 }) }),
    );
  });

  it('answered in the app, the test says so and nothing is read', async () => {
    await build();
    const headers = await owner();
    await post('/staff/desk/test-call', {}, headers);
    const ring = (await get('/staff/desk/ring', headers)).json().ring;
    const answered = (await post(`/staff/desk/ring/${ring.id}/answer`, {}, headers)).json();
    expect(answered).toEqual({
      opening:
        'Hello, Mr. Anthony. This is Ozi. This is a test call. Ringing you in the app works.',
      matters: [],
      farewell: 'Goodbye, Mr. Anthony.',
      test: true,
    });
    later(seconds(60));
    await fallBackToPhone(harness.app.ctx);
    expect(rang).toHaveLength(0);
  });
});

describe('the health check says whether the owner can be rung, never the number', () => {
  async function health(options: TestAppOptions): Promise<Record<string, unknown>> {
    harness = await buildTestApp(START, options);
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('7700');
    expect(response.body).not.toContain('900999');
    const body = response.json() as Record<string, unknown>;
    await harness.close();
    return body;
  }

  it('ownerPhoneSet and ownerDeskCanRing', async () => {
    const placeCall = async () => undefined;
    const all = await health({
      env: { ownerAlertPhone: OWNER_PHONE, primaryOrigin: ORIGIN },
      placeCall,
    });
    expect(all).toEqual(expect.objectContaining({ ownerPhoneSet: true, ownerDeskCanRing: true }));
    const noTwilio = await health({ env: { ownerAlertPhone: OWNER_PHONE, primaryOrigin: ORIGIN } });
    expect(noTwilio).toEqual(
      expect.objectContaining({ ownerPhoneSet: true, ownerDeskCanRing: false }),
    );
    const noOrigin = await health({ env: { ownerAlertPhone: OWNER_PHONE }, placeCall });
    expect(noOrigin).toEqual(
      expect.objectContaining({ ownerPhoneSet: true, ownerDeskCanRing: false }),
    );
    const notUk = await health({
      env: { ownerAlertPhone: '+12025550123', primaryOrigin: ORIGIN },
      placeCall,
    });
    expect(notUk).toEqual(
      expect.objectContaining({ ownerPhoneSet: false, ownerDeskCanRing: false }),
    );
    const none = await health({ env: { primaryOrigin: ORIGIN }, placeCall });
    expect(none).toEqual(
      expect.objectContaining({ ownerPhoneSet: false, ownerDeskCanRing: false }),
    );
    // afterEach closes the last harness again; give it one to close.
    harness = await buildTestApp(START);
  });
});
