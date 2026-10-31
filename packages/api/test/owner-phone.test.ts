/**
 * Ozi knows the owner on his own phone (Anthony, 31 October 2026, ruling 84). The founder, who
 * is registered blind, tapped to talk and said "Hello Ozi", "Good morning Ozi", "This is the
 * owner and founder" and "Do you know my name?", and was answered as a visitor. These are his
 * words.
 *
 * - With the model on, the owner and staff go to the conversation, never to the Shopper's
 *   phrase book first, "hello" included.
 * - Without it, or when it is slow, the owner is still greeted by name for the time of day, and
 *   knows his name, from configuration.
 * - A visitor still hears the Shopper's book (no change).
 * - Staff asking for shopping hear that orders go through a Shopper account.
 * - "Remember me on this phone": a long session, which "Sign out of this phone" ends, leaving
 *   other devices signed in.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { SHOPPER_ACCOUNT_FOR_ORDERS } from '@aldilivery/core';

import type { OwnerTalkInput, OziBrain, UnderstandInput } from '../src/lib/language-model.js';
import { buildTestApp, seedCatalogue, STAFF, type TestHarness } from './helpers.js';

// 10am in London (GMT) on the day the founder found it.
const START = new Date('2026-10-31T10:00:00.000Z');

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

function standIn() {
  const heard: UnderstandInput[] = [];
  const owner: OwnerTalkInput[] = [];
  const brain: OziBrain = {
    name: 'model',
    model: 'stand-in-everyday',
    ownerModel: 'stand-in-owner',
    async understand(input) {
      heard.push(input);
      if (/milk/.test(input.text)) {
        return {
          kind: 'items',
          items: [{ name: 'milk', quantity: 1, brand: null, detail: null }],
          reply: null,
        };
      }
      return { kind: 'question', items: [], reply: 'Good morning, Grace. What can I do?' };
    },
    async talkWithOwner(input) {
      owner.push(input);
      return {
        reply: /name/i.test(input.text)
          ? 'Yes, Mr. Anthony. You are the owner and founder.'
          : 'Good morning, Mr. Anthony. How can I help?',
        proposal: null,
      };
    },
  };
  return { brain, heard, owner };
}

async function build(brain?: OziBrain) {
  harness = await buildTestApp(START, {
    ...(brain ? { brain } : {}),
    sendText: async () => undefined,
  });
  await seedCatalogue(harness.repository);
}

function ask(
  text: string,
  headers: Record<string, string> = {},
  mode: 'exact' | 'within' = 'within',
) {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    headers,
    payload: { text, mode, turn: 0, conversation: 'visit:owner-phone' },
  });
}

async function makeOwner(): Promise<void> {
  const made = await harness.app.inject({
    method: 'POST',
    url: '/staff/owner',
    headers: STAFF,
    payload: {
      name: 'Anthony',
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    },
  });
  expect(made.statusCode, made.body).toBe(201);
}

function signIn(remember?: boolean) {
  return harness.app.inject({
    method: 'POST',
    url: '/staff/sign-in',
    payload: {
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
      ...(remember === undefined ? {} : { remember }),
    },
  });
}

async function ownerHeaders(): Promise<Record<string, string>> {
  await makeOwner();
  const signedIn = await signIn(true);
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

describe("the founder's own words, with the model on", () => {
  it('"Hello Ozi" goes to his conversation, not the phrase book, whether checked or said', async () => {
    const { brain, heard, owner } = standIn();
    await build(brain);
    const headers = await ownerHeaders();
    for (const mode of ['exact', 'within'] as const) {
      const reply = (await ask('Hello Ozi', headers, mode)).json().reply as string;
      expect(reply).toBe('Good morning, Mr. Anthony. How can I help?');
      expect(reply).not.toMatch(/account|What shopping/i);
    }
    expect((await ask('Good morning Ozi', headers)).json().reply).toMatch(/^Good morning/);
    expect((await ask('Do you know my name?', headers)).json().reply).toMatch(/Mr\. Anthony/);
    expect(owner.map((turn) => turn.text)).toEqual([
      'Hello Ozi',
      'Hello Ozi',
      'Good morning Ozi',
      'Do you know my name?',
    ]);
    expect(heard).toHaveLength(0);
  });

  it('staff go to the conversation too, and asking for shopping is kindly sent to a Shopper account', async () => {
    const { brain, heard } = standIn();
    await build(brain);
    expect((await ask('hello', STAFF, 'exact')).json().reply).toBe(
      'Good morning, Grace. What can I do?',
    );
    expect(heard[0]!.who).toMatchObject({ kind: 'staff' });
    const shopping = (await ask('Ozi, I need some milk', STAFF)).json();
    expect(shopping).toEqual({ reply: SHOPPER_ACCOUNT_FOR_ORDERS });
    expect(shopping.reply).not.toMatch(/open|create/i);
  });

  it('a visitor with no sign-in still hears the Shopper introduction phrase', async () => {
    const { brain, owner } = standIn();
    await build(brain);
    expect((await ask('hello', {}, 'exact')).json().reply).toMatch(/^Hello\. What shopping/);
    expect(owner).toHaveLength(0);
  });
});

describe('without the model, or when it is slow', () => {
  it('greets the owner by name for the time of day, and knows who he is', async () => {
    await build();
    const headers = await ownerHeaders();
    expect((await ask('Hello Ozi', headers, 'exact')).json().reply).toBe(
      'Good morning, Mr. Anthony. How can I help?',
    );
    expect((await ask('Good morning Ozi', headers)).json().reply).toBe(
      'Good morning, Mr. Anthony. How can I help?',
    );
    expect((await ask('Do you know my name?', headers)).json().reply).toMatch(
      /^Yes, of course\. You're Mr\. Anthony, the owner and founder of /,
    );
    const owner = (await ask('This is the owner and founder', headers)).json().reply as string;
    expect(owner).toMatch(/^I know, Mr\. Anthony/);
    expect(owner).not.toMatch(/order|account/i);
    harness.setNow(new Date('2026-10-31T19:00:00.000Z'));
    expect((await ask('hello', headers, 'exact')).json().reply).toBe(
      'Good evening, Mr. Anthony. How can I help?',
    );
  });

  it('is the same when the model gives nothing back in time', async () => {
    const brain: OziBrain = {
      name: 'model',
      model: 'stand-in',
      async understand() {
        return null;
      },
      async talkWithOwner() {
        return null;
      },
    };
    await build(brain);
    const headers = await ownerHeaders();
    expect((await ask('Hello Ozi', headers)).json().reply).toBe(
      'Good morning, Mr. Anthony. How can I help?',
    );
  });
});

describe('Remember me on this phone', () => {
  it('lasts the configured days, and Sign out of this phone ends it without signing out other devices', async () => {
    await build();
    await makeOwner();
    const phone = await signIn(true);
    expect(phone.statusCode, phone.body).toBe(200);
    expect(phone.json().remembered).toBe(true);
    const days = harness.config.admin.staffRememberDays;
    expect(days).toBe(30);
    expect(new Date(phone.json().expiresAt as string).getTime()).toBe(
      START.getTime() + days * 24 * 3_600_000,
    );
    const computer = await signIn(false);
    expect(computer.json().remembered).toBe(false);
    const phoneHeaders = { 'x-staff-token': phone.json().token as string };
    const computerHeaders = { 'x-staff-token': computer.json().token as string };
    const me = (headers: Record<string, string>) =>
      harness.app.inject({ method: 'GET', url: '/staff/me', headers });

    // The next morning, after the phone app was closed: still signed in on the phone.
    harness.setNow(new Date(START.getTime() + 20 * 3_600_000));
    expect((await me(phoneHeaders)).json().isOwner).toBe(true);
    expect((await me(computerHeaders)).statusCode).toBe(403);

    // A fresh computer session, then Sign out of this phone, from the phone.
    const later = await signIn();
    const laterHeaders = { 'x-staff-token': later.json().token as string };
    const out = await harness.app.inject({
      method: 'POST',
      url: '/staff/sign-out-phone',
      headers: phoneHeaders,
    });
    expect(out.statusCode, out.body).toBe(200);
    expect((await me(phoneHeaders)).statusCode).toBe(403);
    expect((await me(laterHeaders)).statusCode).toBe(200);

    // And it ends: past the configured days, signing in again is needed.
    const again = await signIn(true);
    const againHeaders = { 'x-staff-token': again.json().token as string };
    harness.setNow(new Date(harness.now().getTime() + (days + 1) * 24 * 3_600_000));
    expect((await me(againHeaders)).statusCode).toBe(403);
  });
});
