/**
 * The company inbox and staff calls (ruling 77, Anthony, 23 October 2026): the company messages
 * any account and the account replies; every staff message needs a code unless the owner or an
 * authoriser sends it; a code is used once, by the person it was issued to, within two hours; a
 * day's call code lasts until midnight, UK time; the desk's yes sends a held message; texts never
 * carry what a message says; every staff call is logged and recorded when storage is set up; and
 * recordings go after 90 days. Acted out with a fake clock and stand-ins for LiveKit and storage.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CallRecorder } from '../src/lib/call-recording.js';
import { presignedUrl, recordingStorageFrom } from '../src/lib/call-recording.js';
import type { CallProvider, CallWebhookEvent } from '../src/lib/livekit.js';
import type { PushMessage } from '../src/lib/push.js';
import { sweepOwnerDesk } from '../src/services/owner-desk.js';
import { sweepRetention } from '../src/services/retention.js';
import {
  STAFF,
  buildTestApp,
  signUpRunner,
  signUpShopper,
  testEnv,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

/** Friday 23 October 2026, 11:00 in the UK (British Summer Time, an hour ahead of UTC). */
const START = new Date('2026-10-23T10:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface FakeLiveKit extends CallProvider {
  tokens: Array<{ roomName: string; identity: string }>;
  dialled: Array<{ roomName: string; phone: string; identity: string }>;
  ended: string[];
}

function fakeLiveKit(): FakeLiveKit {
  const fake: FakeLiveKit = {
    url: 'wss://ozi-test.livekit.cloud',
    tokens: [],
    dialled: [],
    ended: [],
    async issueToken(input) {
      fake.tokens.push({ roomName: input.roomName, identity: input.identity });
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
    async dialPhone(input) {
      fake.dialled.push({ roomName: input.roomName, phone: input.phone, identity: input.identity });
    },
  };
  return fake;
}

interface FakeRecorder extends CallRecorder {
  started: Array<{ roomName: string; key: string }>;
  stopped: string[];
  removed: string[];
}

function fakeRecorder(): FakeRecorder {
  const fake: FakeRecorder = {
    started: [],
    stopped: [],
    removed: [],
    async start(input) {
      fake.started.push(input);
      return { egressId: `EG_${fake.started.length}` };
    },
    async stop(egressId) {
      fake.stopped.push(egressId);
    },
    playbackUrl(key, seconds) {
      return `https://recordings.test/${key}?expires=${seconds}&signature=x`;
    },
    async remove(key) {
      fake.removed.push(key);
    },
  };
  return fake;
}

let harness: TestHarness;
let livekit: FakeLiveKit;
let recorder: FakeRecorder;
let texts: Array<{ to: string; body: string }>;
let pushes: PushMessage[];
let shopper: SignedInShopper;
let runner: SignedInRunner;

async function build(options: { recorder?: boolean; push?: boolean } = {}): Promise<void> {
  livekit = fakeLiveKit();
  recorder = fakeRecorder();
  texts = [];
  pushes = [];
  harness = await buildTestApp(START, {
    calls: livekit,
    ...(options.recorder === false ? {} : { recorder }),
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    ...(options.push
      ? {
          sendPush: async (_target, message) => {
            pushes.push(message);
            return 'sent' as const;
          },
        }
      : {}),
  });
  shopper = await signUpShopper(harness, { phone: '+447700900001' });
  runner = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900101' });
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

async function signIn(payload: object): Promise<{ 'x-staff-token': string }> {
  const response = await post('/staff/sign-in', payload, {});
  expect(response.statusCode, response.body).toBe(200);
  return { 'x-staff-token': response.json().token as string };
}

/** The owner's own account, signed in with the passcode. */
async function owner(): Promise<{ 'x-staff-token': string }> {
  const made = await post(
    '/staff/owner',
    { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
  return signIn({ username: 'anthony', password: 'a long password', passcode: '123456#' });
}

/** A staff member, signed in. */
async function member(
  name: string,
  username: string,
  role = 'customer_care',
): Promise<{ id: string; headers: { 'x-staff-token': string } }> {
  const added = await post('/staff/team', { name, username, role }, STAFF);
  expect(added.statusCode, added.body).toBe(201);
  const body = added.json() as { member: { id: string }; password: string };
  return { id: body.member.id, headers: await signIn({ username, password: body.password }) };
}

async function issue(
  by: Record<string, string>,
  staffId: string,
  kind: 'message' | 'call',
): Promise<string> {
  const issued = await post('/staff/contact/codes', { staffId, kind }, by);
  expect(issued.statusCode, issued.body).toBe(201);
  return issued.json().code as string;
}

function toRunner(text: string, code?: string) {
  return {
    accountKind: 'runner',
    accountId: runner.runnerId,
    text,
    ...(code === undefined ? {} : { code }),
  };
}

function livekitEvent(event: string, roomName: string, identity: string | null, at: Date) {
  return harness.app.inject({
    method: 'POST',
    url: '/webhooks/livekit',
    headers: { 'content-type': 'application/webhook+json', authorization: 'signed' },
    payload: JSON.stringify({ id: `evt-${event}-${at.getTime()}`, event, roomName, identity, at }),
  });
}

describe('messages between the company and an account', () => {
  beforeEach(() => build());

  it('the owner messages a Runner, who reads it, replies, and the reply reaches the panel and the desk', async () => {
    const anthony = await owner();
    const sent = await post(
      '/staff/messages/send',
      toRunner('Can you work on Saturday morning?'),
      anthony,
    );
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().message).toMatchObject({
      authorisedBy: 'self',
      authorisedByName: 'Anthony',
    });

    // The Runner has no notifications, so a text to their own number says only that there is one.
    expect(texts).toEqual([
      {
        to: '+447700900101',
        body: `You have a new message from ${harness.config.productName}. Open the app to read it.`,
      },
    ]);
    expect(texts[0]!.body).not.toContain('Saturday');

    const unread = await get('/inbox/unread', runner.authHeader);
    expect(unread.json()).toMatchObject({ unread: 1, call: null });
    const inbox = (await get('/inbox', runner.authHeader)).json();
    expect(inbox.messages).toEqual([
      expect.objectContaining({
        from: 'company',
        fromName: `Anthony, ${harness.config.productName}`,
        text: 'Can you work on Saturday morning?',
      }),
    ]);
    // What authorised it is never shown to the account.
    expect(JSON.stringify(inbox)).not.toContain('authorised');

    await post('/inbox/read', {}, runner.authHeader);
    expect((await get('/inbox/unread', runner.authHeader)).json().unread).toBe(0);

    const replied = await post(
      '/inbox/reply',
      { text: 'Yes, from nine until one.' },
      runner.authHeader,
    );
    expect(replied.statusCode, replied.body).toBe(201);

    const threads = (await get('/staff/messages', anthony)).json();
    expect(threads.unread).toBe(1);
    expect(threads.threads[0]).toMatchObject({
      accountWord: 'Runner',
      accountName: 'Tomasz',
      unread: 1,
      lastFromAccount: true,
    });
    const thread = (await get(`/staff/messages/${threads.threads[0].id}`, anthony)).json();
    expect(thread.messages.map((row: { text: string }) => row.text)).toEqual([
      'Can you work on Saturday morning?',
      'Yes, from nine until one.',
    ]);
    expect((await get('/staff/messages', anthony)).json().unread).toBe(0);

    // The reply is on Ozi's desk, to hear.
    const desk = (await get('/staff/desk', anthony)).json();
    expect(desk.matters).toEqual([
      expect.objectContaining({
        kind: 'account_message',
        options: 'acknowledge',
        summary: `Runner Tomasz replied to a message from ${harness.config.productName}: Yes, from nine until one.`,
      }),
    ]);
  });

  it('a Shop Partner has its own inbox, through its own sign-in', async () => {
    const anthony = await owner();
    const shop = (
      await post(
        '/staff/partners',
        { name: 'Corner Bakery', about: 'Bread.', plan: 'plus', paidMonths: 1 },
        STAFF,
      )
    ).json().shop as { id: string };
    const user = (
      await post(
        `/staff/partners/${shop.id}/users`,
        { name: 'Bola', username: 'cornerbakery' },
        STAFF,
      )
    ).json() as {
      password: string;
    };
    const business = await post(
      '/business/sign-in',
      { username: 'cornerbakery', password: user.password },
      {},
    );
    const headers = { 'x-business-token': business.json().token as string };

    const sent = await post(
      '/staff/messages/send',
      { accountKind: 'partner', accountId: shop.id, text: 'Your new prices are live.' },
      anthony,
    );
    expect(sent.statusCode, sent.body).toBe(201);
    expect((await get('/inbox/unread', headers)).json().unread).toBe(1);
    const replied = await post('/inbox/reply', { text: 'Thank you.' }, headers);
    expect(replied.json().message).toMatchObject({ from: 'you', fromName: 'Bola' });
    // A Shopper's inbox is not the shop's.
    expect((await get('/inbox', shopper.authHeader)).json().messages).toEqual([]);
  });

  it('a Shopper with notifications is told by notification, never with the message', async () => {
    await harness.close();
    await build({ push: true });
    await post(
      '/push-subscriptions',
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      },
      shopper.authHeader,
    );
    const anthony = await owner();
    const sent = await post(
      '/staff/messages/send',
      {
        accountKind: 'shopper',
        accountId: shopper.shopperId,
        text: 'Your refund of four pounds is on its way.',
      },
      anthony,
    );
    expect(sent.json().notifiedBy).toBe('push');
    expect(pushes).toHaveLength(1);
    expect(JSON.stringify(pushes)).not.toContain('refund');
    expect(texts).toEqual([]);
  });

  it('goes with the account when it is removed', async () => {
    const anthony = await owner();
    await post(
      '/staff/messages/send',
      { accountKind: 'shopper', accountId: shopper.shopperId, text: 'Hello.' },
      anthony,
    );
    await harness.repository.retention.eraseShopper(shopper.shopperId, START);
    expect(
      await harness.repository.companyContact.findThread('shopper', shopper.shopperId),
    ).toBeNull();
  });
});

describe('message codes', () => {
  beforeEach(() => build());

  it('a staff member cannot send without a code; nothing is sent', async () => {
    await owner();
    const chidi = await member('Chidi', 'chidi');
    const refused = await post('/staff/messages/send', toRunner('Hello.'), chidi.headers);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('code_needed');
    const wrong = await post('/staff/messages/send', toRunner('Hello.', '000000'), chidi.headers);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('code_wrong');
    expect((await get('/inbox', runner.authHeader)).json().messages).toEqual([]);
    expect(texts).toEqual([]);
  });

  it('a code is used once, only by the person it was issued to, and runs out after two hours', async () => {
    const anthony = await owner();
    const chidi = await member('Chidi', 'chidi');
    const ngozi = await member('Ngozi', 'ngozi', 'finance');
    const code = await issue(anthony, chidi.id, 'message');
    expect(code).toMatch(/^\d{6}$/);

    // Not for anybody else.
    expect(
      (await post('/staff/messages/send', toRunner('Hello.', code), ngozi.headers)).statusCode,
    ).toBe(403);
    const sent = await post('/staff/messages/send', toRunner('Hello.', code), chidi.headers);
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().message).toMatchObject({
      authorisedBy: 'code',
      authorisedByName: 'Anthony',
      senderName: 'Chidi',
    });
    // Once only.
    expect(
      (await post('/staff/messages/send', toRunner('Again.', code), chidi.headers)).statusCode,
    ).toBe(403);

    const later = await issue(anthony, chidi.id, 'message');
    harness.setNow(new Date(START.getTime() + 121 * MINUTE));
    expect(
      (await post('/staff/messages/send', toRunner('Late.', later), chidi.headers)).statusCode,
    ).toBe(403);

    // The code is kept only as a hash, and never written down in the audit log.
    const codes = await harness.repository.companyContact.listCodesFor(chidi.id, 'message');
    expect(codes.every((row) => row.codeHash !== code && !row.codeHash.includes(code))).toBe(true);
    const audit = await harness.repository.audit.list({});
    expect(JSON.stringify(audit)).not.toContain(code);
    expect(JSON.stringify(audit)).not.toContain(later);
  });

  it('only the owner and those he lets authorise issue codes, and they need none themselves', async () => {
    const anthony = await owner();
    const chidi = await member('Chidi', 'chidi');
    const ngozi = await member('Ngozi', 'ngozi', 'operations_manager');
    expect(
      (await post('/staff/contact/codes', { staffId: chidi.id, kind: 'message' }, ngozi.headers))
        .statusCode,
    ).toBe(403);
    // Only the owner gives the right to authorise.
    expect(
      (await post(`/staff/team/${ngozi.id}/authorise`, { canAuthorise: true }, STAFF)).statusCode,
    ).toBe(403);
    const granted = await post(
      `/staff/team/${ngozi.id}/authorise`,
      { canAuthorise: true },
      anthony,
    );
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json().member.canAuthorise).toBe(true);

    const own = await post('/staff/messages/send', toRunner('From Ngozi.'), ngozi.headers);
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json().message.authorisedBy).toBe('self');
    const code = await issue(ngozi.headers, chidi.id, 'message');
    const sent = await post('/staff/messages/send', toRunner('From Chidi.', code), chidi.headers);
    expect(sent.json().message.authorisedByName).toBe('Ngozi');
    expect((await get('/staff/contact/me', ngozi.headers)).json()).toMatchObject({
      authoriser: true,
      callCodeActive: true,
    });
  });

  it('asking for a code puts it on the desk, and the owner’s yes sends the held message', async () => {
    const anthony = await owner();
    const chidi = await member('Chidi', 'chidi');
    const asked = await post(
      '/staff/messages/ask',
      toRunner('Please bring your cool bag tomorrow, thank you.'),
      chidi.headers,
    );
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json().message.status).toBe('held');
    // Held: the Runner sees nothing yet, and no text has gone.
    expect((await get('/inbox', runner.authHeader)).json().messages).toEqual([]);
    expect(texts).toEqual([]);

    const desk = (await get('/staff/desk', anthony)).json();
    const matter = desk.matters.find((row: { kind: string }) => row.kind === 'message_approval');
    expect(matter).toMatchObject({
      options: 'decide',
      summary:
        'Staff member Chidi asks to send a message to Runner Tomasz: Please bring your cool bag tomorrow, thank you.',
    });
    // The person who asked cannot approve it.
    expect(
      (await post(`/staff/desk/${matter.id}`, { choice: 'approve' }, chidi.headers)).statusCode,
    ).toBe(403);
    const approved = await post(`/staff/desk/${matter.id}`, { choice: 'approve' }, anthony);
    expect(approved.statusCode, approved.body).toBe(200);

    expect((await get('/inbox', runner.authHeader)).json().messages).toEqual([
      expect.objectContaining({ text: 'Please bring your cool bag tomorrow, thank you.' }),
    ]);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.body).not.toContain('cool bag');
    const log = (await get('/staff/contact/log', anthony)).json();
    expect(log.entries[0]).toMatchObject({
      kind: 'message',
      staffName: 'Chidi',
      recipientWord: 'Runner',
      recipientName: 'Tomasz',
      status: 'sent',
      authorisedBy: 'desk',
    });
  });

  it('the desk on the phone keypad approves a held message the same way', async () => {
    await owner();
    const chidi = await member('Chidi', 'chidi');
    await post('/staff/messages/ask', toRunner('Shift swap?'), chidi.headers);
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    const { decideMatter } = await import('../src/services/owner-desk.js');
    await decideMatter(harness.app.ctx, matter!, 'approve', 'phone', 'Mr. Anthony');
    const [message] = await harness.repository.companyContact.listStaffMessages(5);
    expect(message).toMatchObject({
      status: 'sent',
      authorisedBy: 'desk',
      authorisedByName: 'Mr. Anthony, by phone',
    });
    // Nothing left to ring about.
    expect((await sweepOwnerDesk(harness.app.ctx)).called).toBe(false);
  });
});

describe('calling an account', () => {
  beforeEach(() => build());

  it('needs the day’s call code, entered once and good until midnight UK time', async () => {
    // The evening, so the staff sessions (twelve hours) last past midnight.
    harness.setNow(new Date('2026-10-23T19:00:00.000Z'));
    const anthony = await owner();
    const chidi = await member('Chidi', 'chidi');
    const call = { accountKind: 'runner', accountId: runner.runnerId };
    const refused = await post('/staff/calls', call, chidi.headers);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('call_code_needed');

    const code = await issue(anthony, chidi.id, 'call');
    const entered = await post('/staff/contact/call-code', { code }, chidi.headers);
    expect(entered.statusCode, entered.body).toBe(200);
    // Midnight at the end of Friday 23 October, UK time (23:00 UTC in summer time).
    expect(entered.json().callCodeUntil).toBe('2026-10-23T23:00:00.000Z');

    const first = await post('/staff/calls', call, chidi.headers);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().call).toMatchObject({ authorisedBy: 'code', authorisedByName: 'Anthony' });
    await post(`/staff/calls/${first.json().call.id}/end`, {}, chidi.headers);

    harness.setNow(new Date('2026-10-23T22:59:00.000Z'));
    expect((await post('/staff/calls', call, chidi.headers)).statusCode).toBe(201);
    harness.setNow(new Date('2026-10-23T23:00:30.000Z'));
    expect((await post('/staff/calls', call, chidi.headers)).statusCode).toBe(403);
    // The owner needs none.
    expect((await post('/staff/calls', call, anthony)).statusCode).toBe(201);
  });

  it('rings in the app, logs who called whom, records, and both sides are told it is recorded', async () => {
    const anthony = await owner();
    const started = await post(
      '/staff/calls',
      { accountKind: 'runner', accountId: runner.runnerId },
      anthony,
    );
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json().notice).toBe('This call is recorded.');
    const callId = started.json().call.id as string;
    const roomName = started.json().join.roomName as string;
    // Nobody's number is in anything the staff screen gets.
    expect(started.body).not.toContain('+4477009');

    const ringing = (await get('/inbox/call', runner.authHeader)).json();
    expect(ringing.call).toMatchObject({
      id: callId,
      status: 'ringing',
      notice: 'This call is recorded.',
    });
    const answer = await post(`/inbox/call/${callId}/answer`, {}, runner.authHeader);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json().notice).toBe('This call is recorded.');
    expect(recorder.started).toHaveLength(1);

    harness.setNow(new Date(START.getTime() + 95_000));
    await livekitEvent('room_finished', roomName, null, harness.now());
    const log = (await get('/staff/contact/log', anthony)).json();
    expect(log.entries[0]).toMatchObject({
      kind: 'call',
      staffName: 'Anthony',
      recipientWord: 'Runner',
      recipientName: 'Tomasz',
      answered: true,
      durationSeconds: 95,
      status: 'ended',
      recording: { status: 'saved', playable: true },
    });
    const played = await get(`/staff/calls/${callId}/recording`, anthony);
    expect(played.statusCode, played.body).toBe(200);
    expect(played.json().expiresInSeconds).toBe(300);
  });

  it('falls back to ringing their phone from the company number, never showing it', async () => {
    const anthony = await owner();
    const started = await post(
      '/staff/calls',
      { accountKind: 'shopper', accountId: shopper.shopperId },
      anthony,
    );
    const callId = started.json().call.id as string;
    expect(started.json().phoneAvailable).toBe(true);
    const rung = await post(`/staff/calls/${callId}/phone`, {}, anthony);
    expect(rung.statusCode, rung.body).toBe(200);
    expect(rung.body).not.toContain('+447700900001');
    expect(livekit.dialled).toEqual([
      expect.objectContaining({
        phone: '+447700900001',
        identity: `phone-shopper-${shopper.shopperId}`,
      }),
    ]);
    // The phone answering counts as answered.
    await livekitEvent(
      'participant_joined',
      started.json().join.roomName,
      `phone-shopper-${shopper.shopperId}`,
      harness.now(),
    );
    expect((await get(`/staff/calls/${callId}`, anthony)).json().call).toMatchObject({
      status: 'live',
      phoneRung: true,
    });
  });

  it('without recording storage the call still works and the log says so', async () => {
    await harness.close();
    await build({ recorder: false });
    const anthony = await owner();
    const started = await post(
      '/staff/calls',
      { accountKind: 'runner', accountId: runner.runnerId },
      anthony,
    );
    expect(started.statusCode).toBe(201);
    await post(`/inbox/call/${started.json().call.id}/answer`, {}, runner.authHeader);
    await post(`/staff/calls/${started.json().call.id}/end`, {}, anthony);
    const [entry] = (await get('/staff/contact/log', anthony)).json().entries;
    expect(entry.recording).toEqual({
      status: 'not_recorded',
      note: 'not recorded: recording storage not set up',
      playable: false,
    });
    expect((await get('/staff/contact/me', anthony)).json()).toMatchObject({ recordingOn: false });
  });

  it('only the owner and authorisers play recordings; others see only their own entries', async () => {
    const anthony = await owner();
    const chidi = await member('Chidi', 'chidi');
    const code = await issue(anthony, chidi.id, 'call');
    const started = await post(
      '/staff/calls',
      { accountKind: 'runner', accountId: runner.runnerId, code },
      chidi.headers,
    );
    expect(started.statusCode, started.body).toBe(201);
    const callId = started.json().call.id as string;
    await post(`/inbox/call/${callId}/answer`, {}, runner.authHeader);
    await post(`/staff/calls/${callId}/end`, {}, chidi.headers);
    expect((await get(`/staff/calls/${callId}/recording`, chidi.headers)).statusCode).toBe(403);
    await post('/staff/messages/send', toRunner('From the owner.'), anthony);
    const own = (await get('/staff/contact/log', chidi.headers)).json();
    expect(own.everyone).toBe(false);
    expect(own.entries.map((row: { kind: string }) => row.kind)).toEqual(['call']);
    expect((await get('/staff/contact/log', anthony)).json().entries).toHaveLength(2);
  });

  it('the retention sweep deletes recordings after 90 days', async () => {
    const anthony = await owner();
    const started = await post(
      '/staff/calls',
      { accountKind: 'runner', accountId: runner.runnerId },
      anthony,
    );
    const callId = started.json().call.id as string;
    await post(`/inbox/call/${callId}/answer`, {}, runner.authHeader);
    await post(`/staff/calls/${callId}/end`, {}, anthony);
    harness.setNow(new Date(START.getTime() + 89 * DAY));
    expect((await sweepRetention(harness.app.ctx)).callRecordingsRemoved).toBe(0);
    harness.setNow(new Date(START.getTime() + 91 * DAY));
    expect((await sweepRetention(harness.app.ctx)).callRecordingsRemoved).toBe(1);
    expect(recorder.removed).toEqual([recorder.started[0]!.key]);
    const call = await harness.repository.companyContact.findCall(callId);
    expect(call).toMatchObject({ recordingStatus: 'deleted', recordingKey: null });
    // The call itself stays in the log.
    expect(await harness.repository.companyContact.listCalls(10)).toHaveLength(1);
  });
});

describe('the recording storage', () => {
  it('is off unless all five settings are real', () => {
    expect(recordingStorageFrom(testEnv)).toBeNull();
    expect(
      recordingStorageFrom({
        ...testEnv,
        recordingS3Endpoint: 'lon1.digitaloceanspaces.com',
        recordingS3Bucket: 'ozi-calls',
        recordingS3Key: 'DO00EXAMPLE',
        recordingS3Secret: 'secret',
        recordingS3Region: 'lon1',
      }),
    ).toMatchObject({ endpoint: 'https://lon1.digitaloceanspaces.com', bucket: 'ozi-calls' });
  });

  it('signs a link exactly as the storage expects (the published example)', () => {
    const url = presignedUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400,
      at: new Date('2013-05-24T00:00:00.000Z'),
    });
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(url).not.toContain('wJalrXUtnFEMI');
  });
});
