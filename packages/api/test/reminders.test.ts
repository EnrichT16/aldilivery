/**
 * Reminders for everyone, and the clock (Anthony, 3 November 2026, ruling 93).
 *
 * Every kind of account sets, lists and cancels its own reminders; reminders by phone call come
 * only with a paid plan (the owner and staff always); the minute sweep sends each once, by its
 * channel, falls back from a notification to a text, holds texts and calls in quiet hours (never
 * the owner's), and moves a repeating reminder on; Ozi reads a reminder back and sets it only on
 * the yes, with or without the model; the owner's tools do the same; the call says the reminder
 * and takes 1 or 2; and the times people say come out right in UK time, GMT and BST.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { ukClockWords, ukTimeAnswer } from '@aldilivery/core';

import type { PushSubscription } from '../src/domain.js';
import type { OwnerTalkInput, OziBrain, Understanding } from '../src/lib/language-model.js';
import {
  nextOccurrence,
  resolveWhen,
  understandReminderPhrase,
  whenWords,
} from '../src/lib/reminder-time.js';
import { twilioSignature } from '../src/lib/twilio-voice.js';
import { sweepReminders } from '../src/services/reminders.js';
import {
  STAFF,
  buildTestApp,
  signUpRunner,
  signUpShopper,
  type TestAppOptions,
  type TestHarness,
} from './helpers.js';

/** Tuesday 3 November 2026, 09:00 in the UK (GMT). */
const START = new Date('2026-11-03T09:00:00.000Z');
const ORIGIN = 'https://reminders.example.test';
const TOKEN = 'twilio-auth-token-for-reminder-tests';
const OWNER_PHONE = '+447700900999';

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;
let rang: Array<{ to: string; url: string; statusCallback: string }>;
let pushed: Array<{ endpoint: string; title: string; body: string; url?: string }>;

afterEach(async () => {
  await harness?.close();
});

async function build(options: TestAppOptions = {}, at = START): Promise<TestHarness> {
  texts = [];
  rang = [];
  pushed = [];
  harness = await buildTestApp(at, {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN, ownerAlertPhone: OWNER_PHONE },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    placeCall: async (to, url, statusCallback) => {
      rang.push({ to, url, statusCallback });
    },
    sendPush: async (target, message) => {
      pushed.push({
        endpoint: target.endpoint,
        title: message.title,
        body: message.body,
        url: message.url,
      });
      return 'sent';
    },
    ...options,
  });
  return harness;
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}
function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}
function del(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'DELETE', url, headers });
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const made = await post(
    '/staff/owner',
    { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

async function staffHeaders(username = 'chidi'): Promise<Record<string, string>> {
  const made = await post(
    '/staff/team',
    { name: username, username, role: 'customer_care' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', { username, password: made.json().password });
  return { 'x-staff-token': signedIn.json().token as string };
}

async function partnerHeaders(
  plan: 'free' | 'plus',
): Promise<{ shopId: string; headers: Record<string, string> }> {
  const shop = (
    await post(
      '/staff/partners',
      { name: `Corner ${plan}`, about: 'Bread.', plan, paidMonths: plan === 'plus' ? 1 : 0 },
      STAFF,
    )
  ).json().shop as { id: string };
  const user = (
    await post(
      `/staff/partners/${shop.id}/users`,
      { name: 'Bola', username: `corner${plan}` },
      STAFF,
    )
  ).json() as { password: string };
  const signedIn = await post('/business/sign-in', {
    username: `corner${plan}`,
    password: user.password,
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { shopId: shop.id, headers: { 'x-business-token': signedIn.json().token as string } };
}

async function organisationHeaders(): Promise<Record<string, string>> {
  const created = (
    await post('/staff/organisations', { name: 'Medway Care Home', contactName: 'Jo' }, STAFF)
  ).json().organisation as { id: string };
  const user = (
    await post(
      `/staff/organisations/${created.id}/users`,
      { name: 'Jo', username: 'medwaycare', office: 'Head office' },
      STAFF,
    )
  ).json() as { password: string };
  const signedIn = await post('/business/sign-in', {
    username: 'medwaycare',
    password: user.password,
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-business-token': signedIn.json().token as string };
}

const TOMORROW_TEN = '2026-11-04T10:00:00.000Z';

function twilio(path: string, params: Record<string, string>, sign = true) {
  const signature = twilioSignature(TOKEN, `${ORIGIN}${path}`, params);
  return harness.app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(sign ? { 'x-twilio-signature': signature } : {}),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

function spoken(twiml: string): string {
  return [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ');
}

async function device(shopperId: string): Promise<PushSubscription> {
  return harness.repository.pushSubscriptions.save({
    shopperId,
    endpoint: `https://push.example.test/${shopperId}`,
    p256dh: 'key',
    auth: 'auth',
    createdAt: harness.now(),
  });
}

/* ------------------------------------------------------------------ the screen's side */

describe('reminders on the screen, for every kind of account', () => {
  it('a Shopper sets, lists and cancels their own, and sees nobody else’s', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    const tomasz = await signUpShopper(harness, { displayName: 'Tomasz', phone: '+447700900002' });

    const empty = await get('/reminders', margaret.authHeader);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json().reminders).toEqual([]);
    expect(empty.json().callAllowed).toBe(false);
    expect(empty.json().callPlanWords).toContain(`${harness.config.assistantName} Membership`);
    expect(empty.json().callPlanWords).not.toMatch(/£/);
    expect(empty.json().maxTextLength).toBe(harness.config.reminders.maxTextLength);

    const made = await post(
      '/reminders',
      {
        text: 'Call the bank on 020 7946 0000',
        dueAt: TOMORROW_TEN,
        repeat: 'none',
        channel: 'text',
      },
      margaret.authHeader,
    );
    expect(made.statusCode, made.body).toBe(201);
    // The number is never kept: blanked before the row is written.
    expect(made.json().reminder.text).toBe('Call the bank on [phone number]');
    expect(made.json().reminder.whenWords).toBe('tomorrow at 10 in the morning');
    expect(made.json().message).toBe('Reminder set for tomorrow at 10 in the morning.');

    const mine = (await get('/reminders', margaret.authHeader)).json().reminders as Array<{
      id: string;
    }>;
    expect(mine).toHaveLength(1);
    expect((await get('/reminders', tomasz.authHeader)).json().reminders).toEqual([]);
    // Somebody else's reminder cannot be cancelled or marked heard.
    expect((await del(`/reminders/${mine[0]!.id}`, tomasz.authHeader)).statusCode).toBe(404);
    expect((await post(`/reminders/${mine[0]!.id}/heard`, {}, tomasz.authHeader)).statusCode).toBe(
      404,
    );

    const cancelled = await del(`/reminders/${mine[0]!.id}`, margaret.authHeader);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().reminder.status).toBe('cancelled');
    expect((await get('/reminders', margaret.authHeader)).json().reminders).toEqual([]);
  });

  it('keeps the limits: the words, the past, a year ahead, and how many are waiting', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    const tooLong = await post(
      '/reminders',
      { text: 'a'.repeat(harness.config.reminders.maxTextLength + 1), dueAt: TOMORROW_TEN },
      margaret.authHeader,
    );
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.message).toContain('too long');

    const past = await post(
      '/reminders',
      { text: 'Too late', dueAt: '2026-11-03T08:00:00.000Z' },
      margaret.authHeader,
    );
    expect(past.statusCode).toBe(400);
    expect(past.json().error.message).toContain('already passed');
    // Half a minute ago is within the minute's grace.
    const justNow = await post(
      '/reminders',
      { text: 'Nearly now', dueAt: '2026-11-03T08:59:30.000Z' },
      margaret.authHeader,
    );
    expect(justNow.statusCode, justNow.body).toBe(201);

    const far = await post(
      '/reminders',
      { text: 'Far off', dueAt: '2027-11-04T10:00:00.000Z' },
      margaret.authHeader,
    );
    expect(far.statusCode).toBe(400);
    expect(far.json().error.message).toContain('a year ahead');

    const most = harness.config.reminders.maxPerAccount;
    for (let n = 1; n < most; n += 1) {
      const one = await post(
        '/reminders',
        {
          text: `Thing ${n}`,
          dueAt: `2026-11-${String(5 + (n % 20)).padStart(2, '0')}T10:00:00.000Z`,
        },
        margaret.authHeader,
      );
      expect(one.statusCode, one.body).toBe(201);
    }
    const oneTooMany = await post(
      '/reminders',
      { text: 'One more', dueAt: TOMORROW_TEN },
      margaret.authHeader,
    );
    expect(oneTooMany.statusCode).toBe(400);
    expect(oneTooMany.json().error.message).toContain(`${most} reminders waiting`);
  });

  it('a Runner, a Shop Partner, an organisation, staff and the owner each have their own', async () => {
    await build();
    const runner = await signUpRunner(harness);
    const made = await post(
      '/reminders',
      { text: 'Charge the bike', dueAt: TOMORROW_TEN },
      runner.authHeader,
    );
    expect(made.statusCode, made.body).toBe(201);
    expect((await get('/reminders', runner.authHeader)).json().callAllowed).toBe(false);

    const { headers: partner } = await partnerHeaders('free');
    expect(
      (await post('/reminders', { text: 'Order flour', dueAt: TOMORROW_TEN }, partner)).statusCode,
    ).toBe(201);
    expect((await get('/reminders', partner)).json().reminders).toHaveLength(1);

    const organisation = await organisationHeaders();
    expect(
      (await post('/reminders', { text: 'Check the invoice', dueAt: TOMORROW_TEN }, organisation))
        .statusCode,
    ).toBe(201);

    const staff = await staffHeaders();
    expect(
      (await post('/reminders', { text: 'Ring the supplier', dueAt: TOMORROW_TEN }, staff))
        .statusCode,
    ).toBe(201);

    const owner = await ownerHeaders();
    expect(
      (await post('/reminders', { text: 'Review the accounts', dueAt: TOMORROW_TEN }, owner))
        .statusCode,
    ).toBe(201);
    expect((await get('/reminders', owner)).json().reminders).toHaveLength(1);
    expect((await get('/reminders', staff)).json().reminders).toHaveLength(1);

    // The staff key is nobody in particular: it has no reminders.
    expect((await get('/reminders', STAFF)).statusCode).toBe(403);
    // Not signed in at all: no reminders either.
    expect((await get('/reminders')).statusCode).toBe(401);
  });

  it('the call channel: refused without a paid plan, allowed with one, and for the owner and staff', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    const refused = await post(
      '/reminders',
      { text: 'Call the bank', dueAt: TOMORROW_TEN, channel: 'call' },
      margaret.authHeader,
    );
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.message).toBe(
      `Reminders by phone call come with ${harness.config.assistantName} Membership, ${harness.config.assistantName} Plus or ${harness.config.assistantName} Family and Carer. I can remind you with a notification or a text instead.`,
    );
    expect(refused.json().error.details).toEqual({ code: 'call_needs_plan' });

    await harness.repository.shoppers.update(margaret.shopperId, {
      plan: 'membership',
      planUntil: new Date('2026-12-03T09:00:00.000Z'),
    });
    expect((await get('/reminders', margaret.authHeader)).json().callAllowed).toBe(true);
    const allowed = await post(
      '/reminders',
      { text: 'Call the bank', dueAt: TOMORROW_TEN, channel: 'call' },
      margaret.authHeader,
    );
    expect(allowed.statusCode, allowed.body).toBe(201);

    const runner = await signUpRunner(harness);
    expect(
      (
        await post(
          '/reminders',
          { text: 'Charge the bike', dueAt: TOMORROW_TEN, channel: 'call' },
          runner.authHeader,
        )
      ).statusCode,
    ).toBe(403);

    const free = await partnerHeaders('free');
    const freeRefused = await post(
      '/reminders',
      { text: 'Order flour', dueAt: TOMORROW_TEN, channel: 'call' },
      free.headers,
    );
    expect(freeRefused.statusCode).toBe(403);
    expect(freeRefused.json().error.message).toContain('Partner Plus');
    const plus = await partnerHeaders('plus');
    expect(
      (
        await post(
          '/reminders',
          { text: 'Order flour', dueAt: TOMORROW_TEN, channel: 'call' },
          plus.headers,
        )
      ).statusCode,
    ).toBe(201);

    const organisation = await organisationHeaders();
    expect(
      (
        await post(
          '/reminders',
          { text: 'Check the invoice', dueAt: TOMORROW_TEN, channel: 'call' },
          organisation,
        )
      ).statusCode,
    ).toBe(201);

    const staff = await staffHeaders();
    expect(
      (
        await post(
          '/reminders',
          { text: 'Ring the supplier', dueAt: TOMORROW_TEN, channel: 'call' },
          staff,
        )
      ).statusCode,
    ).toBe(201);
    const owner = await ownerHeaders();
    expect(
      (
        await post(
          '/reminders',
          { text: 'Review the accounts', dueAt: TOMORROW_TEN, channel: 'call' },
          owner,
        )
      ).statusCode,
    ).toBe(201);
  });
});

/* ------------------------------------------------------------------ the sweep */

describe('the minute sweep', () => {
  it('sends a notification once, however often it runs, and marks it sent', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    await device(margaret.shopperId);
    const made = await post(
      '/reminders',
      { text: 'Call the bank', dueAt: TOMORROW_TEN },
      margaret.authHeader,
    );
    const id = made.json().reminder.id as string;

    expect((await sweepReminders(harness.app.ctx)).sent).toBe(0);
    harness.setNow(new Date('2026-11-04T10:00:30.000Z'));
    const first = await sweepReminders(harness.app.ctx);
    expect(first).toMatchObject({ sent: 1, via: { notification: 1 } });
    expect(pushed).toEqual([
      {
        endpoint: `https://push.example.test/${margaret.shopperId}`,
        title: `${harness.config.assistantName} reminder`,
        body: 'Call the bank',
        url: '/settings',
      },
    ]);
    expect(texts).toEqual([]);

    expect((await sweepReminders(harness.app.ctx)).sent).toBe(0);
    expect(pushed).toHaveLength(1);
    const row = (await get('/reminders', margaret.authHeader)).json().reminders[0];
    expect(row).toMatchObject({ id, status: 'sent', sentAt: '2026-11-04T10:00:30.000Z' });

    // "I've heard it" on the screen.
    const heard = await post(`/reminders/${id}/heard`, {}, margaret.authHeader);
    expect(heard.json().reminder.status).toBe('heard');
  });

  it('falls back from a notification to a text when there is no device, and to the screen without a phone', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    await post('/reminders', { text: 'Call the bank', dueAt: TOMORROW_TEN }, margaret.authHeader);
    harness.setNow(new Date('2026-11-04T10:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).via).toMatchObject({ text: 1, notification: 0 });
    expect(texts).toEqual([
      { to: '+447700900001', body: `${harness.config.assistantName} reminder: Call the bank` },
    ]);
    await harness.close();

    // No texts at all: it is marked sent and waits on the screen.
    await build({ sendText: undefined as never });
    const tomasz = await signUpShopper(harness);
    await post('/reminders', { text: 'Call the bank', dueAt: TOMORROW_TEN }, tomasz.authHeader);
    harness.setNow(new Date('2026-11-04T10:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).via).toMatchObject({ inbox: 1 });
    expect((await get('/reminders', tomasz.authHeader)).json().reminders[0].status).toBe('sent');
  });

  it('a text reminder is texted; a call reminder rings, and the call takes 1 or 2', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    await harness.repository.shoppers.update(margaret.shopperId, {
      plan: 'plus',
      planUntil: new Date('2026-12-03T09:00:00.000Z'),
    });
    await post(
      '/reminders',
      { text: 'Take the tablets', dueAt: TOMORROW_TEN, channel: 'text' },
      margaret.authHeader,
    );
    const call = await post(
      '/reminders',
      { text: 'Call the bank about 1234 5678 9012 3456', dueAt: TOMORROW_TEN, channel: 'call' },
      margaret.authHeader,
    );
    const callId = call.json().reminder.id as string;

    harness.setNow(new Date('2026-11-04T10:00:00.000Z'));
    const report = await sweepReminders(harness.app.ctx);
    expect(report.via).toMatchObject({ text: 1, call: 1 });
    expect(texts).toEqual([
      { to: '+447700900001', body: `${harness.config.assistantName} reminder: Take the tablets` },
    ]);
    expect(rang).toEqual([
      {
        to: '+447700900001',
        url: `${ORIGIN}/api/webhooks/twilio/reminders/voice?reminder=${callId}`,
        statusCallback: `${ORIGIN}/api/webhooks/twilio/reminders/status?reminder=${callId}`,
      },
    ]);

    // Twilio asks what to say. Unsigned: refused.
    const voicePath = `/webhooks/twilio/reminders/voice?reminder=${callId}`;
    expect((await twilio(voicePath, { CallStatus: 'in-progress' }, false)).statusCode).toBe(403);
    const answered = await twilio(voicePath, { CallStatus: 'in-progress' });
    expect(answered.statusCode).toBe(200);
    const words = spoken(answered.body);
    expect(words).toContain(
      `Hello, this is ${harness.config.assistantName} with your reminder: Call the bank about [card number].`,
    );
    expect(words).toContain(
      `Press 1 if you've heard it, 2 to remind you again in ${harness.config.reminders.againMinutes} minutes.`,
    );
    expect(words).not.toMatch(/\d{4} \d{4}/);

    // Key 2: again in ten minutes, quiet hours or not.
    const keyPath = `/webhooks/twilio/reminders/key?reminder=${callId}&again=0`;
    const again = await twilio(keyPath, { Digits: '2' });
    expect(spoken(again.body)).toContain(
      `I'll remind you again in ${harness.config.reminders.againMinutes} minutes.`,
    );
    const row = await harness.repository.reminders.findById(callId);
    expect(row).toMatchObject({ status: 'scheduled', setInQuiet: true });
    expect(row!.dueAt.toISOString()).toBe('2026-11-04T10:10:00.000Z');

    // It rings again when the time comes, and key 1 marks it heard.
    harness.setNow(new Date('2026-11-04T10:10:00.000Z'));
    await sweepReminders(harness.app.ctx);
    expect(rang).toHaveLength(2);
    const heard = await twilio(keyPath, { Digits: '1' });
    expect(spoken(heard.body)).toBe('Thank you. Goodbye.');
    expect(await harness.repository.reminders.findById(callId)).toMatchObject({ status: 'heard' });

    // Silence: said again, then goodbye; the status webhook is taken quietly.
    const silent = await twilio(keyPath, { Digits: '' });
    expect(spoken(silent.body)).toMatch(/^I'll say that again\./);
    const status = await twilio(`/webhooks/twilio/reminders/status?reminder=${callId}`, {
      CallStatus: 'completed',
    });
    expect(status.statusCode).toBe(204);
  });

  it('holds a text or a call in quiet hours unless set for then, never a notification or the owner’s', async () => {
    // Quiet hours run 22:50 to 06:00 UK time. Reminders set for 22:45 that the sweep only reaches
    // at 23:30 (the server was down for a while) are inside them.
    const night = new Date('2026-11-03T23:30:00.000Z');
    await build({}, new Date('2026-11-03T20:00:00.000Z'));
    const margaret = await signUpShopper(harness);
    await device(margaret.shopperId);
    const tomasz = await signUpShopper(harness, { displayName: 'Tomasz', phone: '+447700900002' });
    const dueAt = '2026-11-03T22:45:00.000Z';
    await post('/reminders', { text: 'Text me', dueAt, channel: 'text' }, tomasz.authHeader);
    await post(
      '/reminders',
      { text: 'Notify me', dueAt, channel: 'notification' },
      margaret.authHeader,
    );
    const owner = await ownerHeaders();
    await post('/reminders', { text: 'Ring me', dueAt, channel: 'call' }, owner);
    // Set by somebody for a quiet time on purpose: not held.
    const late = await post(
      '/reminders',
      { text: 'Late tablets', dueAt: '2026-11-04T00:15:00.000Z', channel: 'text' },
      tomasz.authHeader,
    );
    expect(late.statusCode, late.body).toBe(201);
    expect((await harness.repository.reminders.findById(late.json().reminder.id))!.setInQuiet).toBe(
      true,
    );

    harness.setNow(night);
    const report = await sweepReminders(harness.app.ctx);
    expect(report).toMatchObject({ held: 1, via: { notification: 1, call: 1, held: 1 } });
    expect(pushed.map((p) => p.body)).toEqual(['Notify me']);
    expect(rang.map((r) => r.to)).toEqual([OWNER_PHONE]);
    expect(texts).toEqual([]);
    const held = (await get('/reminders', tomasz.authHeader))
      .json()
      .reminders.find((r: { text: string }) => r.text === 'Text me');
    expect(held.status).toBe('scheduled');
    expect(held.dueAt).toBe('2026-11-04T06:00:00.000Z');

    harness.setNow(new Date('2026-11-04T00:15:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).via).toMatchObject({ text: 1 });
    expect(texts.map((t) => t.body)).toEqual([
      `${harness.config.assistantName} reminder: Late tablets`,
    ]);

    harness.setNow(new Date('2026-11-04T06:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).via).toMatchObject({ text: 1 });
    expect(texts.map((t) => t.body)).toContain(`${harness.config.assistantName} reminder: Text me`);
  });

  it('a repeating reminder is sent, then moves itself on, on the UK clock across the clock change', async () => {
    await build({}, new Date('2026-03-27T09:00:00.000Z'));
    const margaret = await signUpShopper(harness);
    await device(margaret.shopperId);
    // Every day at 10 in the morning, from Saturday 28 March; the clocks go forward on the 29th.
    const made = await post(
      '/reminders',
      { text: 'Tablets', dueAt: '2026-03-28T10:00:00.000Z', repeat: 'daily' },
      margaret.authHeader,
    );
    const id = made.json().reminder.id as string;
    harness.setNow(new Date('2026-03-28T10:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).sent).toBe(1);
    let row = await harness.repository.reminders.findById(id);
    expect(row).toMatchObject({ status: 'scheduled', repeat: 'daily' });
    // Ten in the morning on the 29th is 09:00 UTC: British Summer Time.
    expect(row!.dueAt.toISOString()).toBe('2026-03-29T09:00:00.000Z');
    expect((await sweepReminders(harness.app.ctx)).sent).toBe(0);

    harness.setNow(new Date('2026-03-29T09:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).sent).toBe(1);
    row = await harness.repository.reminders.findById(id);
    expect(row!.dueAt.toISOString()).toBe('2026-03-30T09:00:00.000Z');
    expect(pushed).toHaveLength(2);

    // A sweep that runs late never sends twice for the days it missed: it moves on past now.
    harness.setNow(new Date('2026-04-02T12:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).sent).toBe(1);
    row = await harness.repository.reminders.findById(id);
    expect(row!.dueAt.toISOString()).toBe('2026-04-03T09:00:00.000Z');
  });
});

/* ------------------------------------------------------------------ Ozi */

function standIn(answer: (text: string) => Understanding | null) {
  const owner: OwnerTalkInput[] = [];
  const brain: OziBrain = {
    name: 'model',
    model: 'stand-in-everyday',
    ownerModel: 'stand-in-owner',
    async understand(input) {
      return answer(input.text);
    },
    async talkWithOwner(input) {
      owner.push(input);
      const text = input.text;
      if (/^what are my reminders/i.test(text)) {
        const list = (await input.tools.listReminders()) as { waiting: Array<{ words: string }> };
        return { reply: `You have ${list.waiting.length} waiting.`, proposal: null };
      }
      const cancel = /^cancel reminder (\S+)$/i.exec(text);
      if (cancel) {
        const checked = await input.tools.proposeAction({
          kind: 'cancel_reminder',
          reminderId: cancel[1]!,
        });
        return checked.ok
          ? {
              reply: checked.readBack,
              proposal: { action: checked.action, readBack: checked.readBack },
            }
          : { reply: checked.why, proposal: null };
      }
      const remind = /^remind me (.+?) to (.+)$/i.exec(text);
      if (remind) {
        const checked = await input.tools.proposeAction({
          kind: 'set_reminder',
          text: remind[2]!.replace(/ and ring me$/, ''),
          relative: remind[1]!,
          dueAtIso: null,
          repeat: 'none',
          channel: /ring/.test(text) ? 'call' : null,
        });
        return checked.ok
          ? {
              reply: checked.readBack,
              proposal: { action: checked.action, readBack: checked.readBack },
            }
          : { reply: checked.why, proposal: null };
      }
      return { reply: 'Yes, Mr. Anthony?', proposal: null };
    },
  };
  return { brain, owner };
}

function ask(text: string, headers: Record<string, string>, conversation = 'visit:one') {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    headers,
    payload: { text, mode: 'within', turn: 1, conversation },
  });
}

describe('Ozi sets reminders, reads them back, and sets them only on the yes', () => {
  it('without the model: "remind me tomorrow at 10 to call the bank", read back, yes, set', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    const readBack = await ask(
      'Ozi, remind me tomorrow at 10 to call the bank',
      margaret.authHeader,
    );
    expect(readBack.statusCode, readBack.body).toBe(200);
    expect(readBack.json()).toEqual({
      reply: "I'll remind you tomorrow at 10 in the morning: call the bank. Shall I set that?",
      awaitingYes: true,
    });
    expect((await get('/reminders', margaret.authHeader)).json().reminders).toEqual([]);

    const yes = await ask('yes please', margaret.authHeader);
    expect(yes.json().reply).toBe(
      "Done. I'll remind you tomorrow at 10 in the morning: call the bank.",
    );
    const mine = (await get('/reminders', margaret.authHeader)).json().reminders;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      text: 'call the bank',
      dueAt: TOMORROW_TEN,
      repeat: 'none',
      channel: 'notification',
      status: 'scheduled',
    });
    expect((await harness.repository.reminders.findById(mine[0].id))!.createdVia).toBe('voice');

    // A second yes does nothing: the question was answered.
    expect((await ask('yes', margaret.authHeader)).json().reply ?? '').not.toMatch(/^Done/);
    expect((await get('/reminders', margaret.authHeader)).json().reminders).toHaveLength(1);
  });

  it('a no leaves nothing, and other words are answered as themselves', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    await ask('remind me in 20 minutes to turn the oven off', margaret.authHeader);
    expect((await ask('no', margaret.authHeader)).json().reply).toBe(
      "All right, I haven't done it.",
    );
    expect((await get('/reminders', margaret.authHeader)).json().reminders).toEqual([]);

    const first = await ask('remind me in 20 minutes to turn the oven off', margaret.authHeader);
    expect(first.json().reply).toBe(
      "I'll remind you today at 9:20 in the morning: turn the oven off. Shall I set that?",
    );
    await ask('what time is it', margaret.authHeader);
    expect((await get('/reminders', margaret.authHeader)).json().reminders).toEqual([]);
  });

  it('asks when, when no time was said; lists; and cancels on a yes', async () => {
    await build();
    const runner = await signUpRunner(harness);
    const noTime = await ask('remind me to ring mum', runner.authHeader);
    expect(noTime.json().reply).toBe(
      'When would you like me to remind you about ring mum? For example, tomorrow at ten, or in twenty minutes.',
    );
    expect(noTime.json().awaitingYes).toBeUndefined();

    expect((await ask('what are my reminders', runner.authHeader)).json().reply).toBe(
      'You have no reminders waiting.',
    );
    await ask('remind me every monday at 9 to check the tyres', runner.authHeader);
    expect((await ask('yes', runner.authHeader)).json().reply).toBe(
      "Done. I'll remind you on Monday 9 November at 9 in the morning, and then every Monday: check the tyres.",
    );
    expect((await ask('what are my reminders', runner.authHeader)).json().reply).toBe(
      'You have one reminder: on Monday 9 November at 9 in the morning, and then every Monday: check the tyres.',
    );
    const cancel = await ask('cancel my reminder', runner.authHeader);
    expect(cancel.json()).toEqual({
      reply:
        "I'll cancel your reminder on Monday 9 November at 9 in the morning, and then every Monday: check the tyres. Shall I go ahead?",
      awaitingYes: true,
    });
    expect((await ask('yes', runner.authHeader)).json().reply).toBe(
      'Cancelled. That reminder will not come.',
    );
    expect((await ask('what are my reminders', runner.authHeader)).json().reply).toBe(
      'You have no reminders waiting.',
    );
  });

  it('a call asked for without a plan: the plan is named kindly, and a notification offered', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    const asked = await ask(
      'remind me tomorrow at 10 by phone call to call the bank',
      margaret.authHeader,
    );
    expect(asked.json().reply).toBe(
      `Reminders by phone call come with ${harness.config.assistantName} Membership, ${harness.config.assistantName} Plus or ${harness.config.assistantName} Family and Carer. I can remind you with a notification or a text instead. I'll remind you tomorrow at 10 in the morning: call the bank. Shall I set that?`,
    );
    expect(asked.json().reply).not.toMatch(/£/);
    await ask('yes', margaret.authHeader);
    expect((await get('/reminders', margaret.authHeader)).json().reminders[0]).toMatchObject({
      channel: 'notification',
    });
  });

  it('with the model: kind "reminder" with the words and when, resolved on the server', async () => {
    const { brain } = standIn((text) =>
      /dentist/.test(text)
        ? {
            kind: 'reminder',
            items: [],
            reply: null,
            reminder: {
              text: 'the dentist',
              relative: 'on Friday at 2pm',
              dueAtIso: null,
              repeat: null,
              channel: 'text',
            },
          }
        : { kind: 'question', items: [], reply: 'Happy to help.' },
    );
    await build({ brain });
    const { headers } = await partnerHeaders('plus');
    const asked = await ask("don't let me forget the dentist on Friday afternoon", headers);
    expect(asked.json()).toEqual({
      reply:
        "I'll remind you on Friday 6 November at 2 in the afternoon: the dentist. I will text you. Shall I set that?",
      awaitingYes: true,
    });
    expect((await ask('go ahead', headers)).json().reply).toMatch(/^Done\./);
    expect((await get('/reminders', headers)).json().reminders[0]).toMatchObject({
      text: 'the dentist',
      dueAt: '2026-11-06T14:00:00.000Z',
      channel: 'text',
    });
  });

  it('a visitor is asked to sign in first', async () => {
    await build();
    const asked = await ask('remind me tomorrow at 10 to call the bank', {});
    expect(asked.json().reply).toBe(
      'I can set reminders once you are signed in. Would you like to sign in?',
    );
  });

  it('says the time and the date, in UK time, to anybody', async () => {
    await build();
    const margaret = await signUpShopper(harness);
    expect((await ask('what time is it', margaret.authHeader)).json().reply).toBe(
      "It's 9 in the morning on Tuesday the third of November.",
    );
    const owner = await ownerHeaders();
    expect((await ask("Ozi, what's the date today?", owner)).json().reply).toBe(
      "It's 9 in the morning on Tuesday the third of November.",
    );
    expect(ukTimeAnswer(new Date('2026-07-01T13:42:00.000Z'))).toBe(
      "It's 2:42 in the afternoon on Wednesday the first of July.",
    );
  });
});

describe('the owner’s tools', () => {
  it('set_reminder reads back and sets only on his yes; list_reminders and cancel_reminder', async () => {
    const { brain, owner: talks } = standIn(() => null);
    await build({ brain });
    const owner = await ownerHeaders();

    const asked = await ask('remind me tomorrow at 10 to review the accounts', owner, 'owner:one');
    expect(asked.json()).toEqual({
      reply:
        "I'll remind you tomorrow at 10 in the morning: review the accounts. Shall I set that?",
      awaitingYes: true,
    });
    expect((await get('/reminders', owner)).json().reminders).toEqual([]);
    expect((await ask('no', owner, 'owner:one')).json().reply).toBe(
      "All right, I haven't done it.",
    );

    await ask('remind me tomorrow at 10 to review the accounts and ring me', owner, 'owner:one');
    const yes = await ask('yes', owner, 'owner:one');
    expect(yes.json().reply).toBe(
      "Done. I'll remind you tomorrow at 10 in the morning: review the accounts.",
    );
    const mine = (await get('/reminders', owner)).json().reminders;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ channel: 'call', text: 'review the accounts' });

    expect((await ask('what are my reminders', owner, 'owner:one')).json().reply).toBe(
      'You have 1 waiting.',
    );
    const list = (await talks.at(-1)!.tools.listReminders()) as {
      waiting: Array<{ id: string; when: string }>;
    };
    expect(list.waiting[0]).toMatchObject({
      id: mine[0].id,
      when: 'tomorrow at 10 in the morning',
      how: 'call',
    });

    const cancel = await ask(`cancel reminder ${mine[0].id}`, owner, 'owner:one');
    expect(cancel.json().reply).toBe(
      `To be sure, ${harness.config.owner.spokenName}: I will cancel your reminder, review the accounts. Shall I go ahead? Say yes, or no.`,
    );
    expect((await ask('yes', owner, 'owner:one')).json().reply).toBe(
      'Cancelled. That reminder will not come.',
    );
    expect((await get('/reminders', owner)).json().reminders).toEqual([]);

    // The owner's reminder call rings OWNER_ALERT_PHONE, in quiet hours too.
    await ask('remind me tonight at 11 to lock up and ring me', owner, 'owner:one');
    await ask('yes', owner, 'owner:one');
    harness.setNow(new Date('2026-11-03T23:00:00.000Z'));
    expect((await sweepReminders(harness.app.ctx)).via).toMatchObject({ call: 1 });
    expect(rang[0]!.to).toBe(OWNER_PHONE);
  });
});

/* ------------------------------------------------------------------ the times */

describe('the times people say, in UK time', () => {
  const gmt = new Date('2026-11-03T09:00:00.000Z'); // Tuesday 09:00 GMT
  const bst = new Date('2026-07-07T08:00:00.000Z'); // Tuesday 09:00 BST

  it.each([
    ['tomorrow at 10', gmt, '2026-11-04T10:00:00.000Z', null],
    ['tomorrow at 10', bst, '2026-07-08T09:00:00.000Z', null],
    ['in 20 minutes', gmt, '2026-11-03T09:20:00.000Z', null],
    ['in an hour', bst, '2026-07-07T09:00:00.000Z', null],
    ['every monday at 9', gmt, '2026-11-09T09:00:00.000Z', 'weekly'],
    ['every monday at 9', bst, '2026-07-13T08:00:00.000Z', 'weekly'],
    ['every day at 8', gmt, '2026-11-03T20:00:00.000Z', 'daily'],
    ['every day at 8am', gmt, '2026-11-04T08:00:00.000Z', 'daily'],
    ['tonight at 8', gmt, '2026-11-03T20:00:00.000Z', null],
    ['at 3', gmt, '2026-11-03T15:00:00.000Z', null],
    ['at half past two', gmt, '2026-11-03T14:30:00.000Z', null],
    ['at 10:30pm', gmt, '2026-11-03T22:30:00.000Z', null],
    ['at midday', gmt, '2026-11-03T12:00:00.000Z', null],
    ['tomorrow', gmt, '2026-11-04T09:00:00.000Z', null],
    ['on friday afternoon at 2', gmt, '2026-11-06T14:00:00.000Z', null],
    ['next week', gmt, '2026-11-10T09:00:00.000Z', null],
    ['every month on the first', gmt, '2026-12-03T09:00:00.000Z', 'monthly'],
  ])('"%s"', (said, now, iso, repeat) => {
    const resolved = resolveWhen(said, now);
    expect(resolved?.dueAt.toISOString()).toBe(iso);
    expect(resolved?.repeat ?? null).toBe(repeat);
  });

  it('reads a whole sentence, the time before or after the words, with how', () => {
    expect(understandReminderPhrase('remind me tomorrow at 10 to call the bank', gmt)).toEqual({
      text: 'call the bank',
      dueAt: new Date('2026-11-04T10:00:00.000Z'),
      repeat: 'none',
      channel: null,
    });
    expect(
      understandReminderPhrase('Hey Ozi, remind me to take my tablets every day at 8', gmt),
    ).toMatchObject({
      text: 'take my tablets',
      repeat: 'daily',
    });
    expect(
      understandReminderPhrase(
        'can you remind me by phone call on friday at 2pm about the dentist',
        gmt,
      ),
    ).toMatchObject({
      text: 'the dentist',
      channel: 'call',
      dueAt: new Date('2026-11-06T14:00:00.000Z'),
    });
    expect(
      understandReminderPhrase('text me a reminder to collect the parcel at 3', gmt),
    ).toMatchObject({
      channel: 'text',
    });
    expect(understandReminderPhrase('remind me to ring mum', gmt)).toEqual({
      needsTime: true,
      text: 'ring mum',
    });
    expect(understandReminderPhrase('two pints of milk', gmt)).toBeNull();
    expect(resolveWhen('whenever', gmt)).toBeNull();
  });

  it('moves a repeat on across the clock changes, and says when in words', () => {
    expect(nextOccurrence(new Date('2026-10-24T09:00:00.000Z'), 'daily').toISOString()).toBe(
      '2026-10-25T10:00:00.000Z',
    );
    expect(nextOccurrence(new Date('2026-01-31T09:00:00.000Z'), 'monthly').toISOString()).toBe(
      '2026-02-28T09:00:00.000Z',
    );
    expect(whenWords(new Date('2026-11-04T10:00:00.000Z'), 'none', gmt)).toBe(
      'tomorrow at 10 in the morning',
    );
    expect(whenWords(new Date('2026-11-09T09:00:00.000Z'), 'weekly', gmt)).toBe(
      'on Monday 9 November at 9 in the morning, and then every Monday',
    );
    expect(ukClockWords(new Date('2026-11-03T10:42:00.000Z'))).toBe('Tuesday 3 November, 10:42');
    expect(ukClockWords(new Date('2026-07-01T13:05:00.000Z'))).toBe('Wednesday 1 July, 14:05');
  });
});
