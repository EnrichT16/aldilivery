/**
 * Ozi's memory (ruling 68): everything Ozi hears and says is kept, scrubbed, on every channel;
 * people judge it in the admin panel, a better answer teaches Ozi at once, and the owner can
 * export it all for training.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OziBrain } from '../src/lib/claude-brain.js';
import { scrub, spokenIn, trainingLine } from '../src/lib/ozi-memory.js';
import { twilioSignature } from '../src/lib/twilio-voice.js';
import { sweepRetention } from '../src/services/retention.js';
import { buildTestApp, seedCatalogue, signUpShopper, STAFF, type TestHarness } from './helpers.js';

const ORIGIN = 'https://shop.example.test';
const TOKEN = 'twilio-auth-token-for-tests';
const START = new Date('2026-10-17T10:00:00.000Z');

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(START, {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN },
    sendText: async () => undefined,
  });
  await seedCatalogue(harness.repository);
});

afterEach(async () => {
  await harness.close();
});

function ask(text: string, mode: 'exact' | 'within' = 'within', extra: object = {}) {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    payload: { text, mode, turn: 0, conversation: 'visit:test', ...extra },
  });
}

async function remembered() {
  return harness.repository.memory.list({ limit: 100 });
}

describe('the scrubber', () => {
  it('blanks numbers, cards, codes, emails and postcodes but keeps the sentence', () => {
    expect(scrub('ring me on 07700 900123 please')).toBe('ring me on [number] please');
    expect(scrub('my card is 4242 4242 4242 4242')).toBe('my card is [card]');
    expect(scrub('the code is 482913')).toBe('the code is [number]');
    expect(scrub('email me at someone@example.com now')).toBe('email me at [email] now');
    expect(scrub('I live at ME7 1ER in Gillingham')).toBe('I live at [postcode] in Gillingham');
    expect(scrub('oh seven seven oh oh nine double')).toBe('[number] double');
    expect(scrub('two pints of milk and 3 bananas')).toBe('two pints of milk and 3 bananas');
  });

  it('reads the words out of TwiML', () => {
    expect(
      spokenIn('<Response><Say voice="x">Hello &amp; welcome.</Say><Hangup/></Response>'),
    ).toBe('Hello & welcome.');
  });
});

describe('what the server keeps', () => {
  it('keeps an answered phrase with what was heard, and an unanswered sentence with nothing said', async () => {
    const answered = await ask('how are you');
    expect(answered.json().reply).toMatch(/very well/);
    const unanswered = await ask('what is the capital of peru');
    expect(unanswered.json().reply).toBeNull();
    const rows = await remembered();
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => [row.heard, row.brain, row.outcome, row.channel, row.account]),
    ).toEqual([
      ['what is the capital of peru', 'none', 'unanswered', 'app', 'shopper'],
      ['how are you', 'phrases', 'answered', 'app', 'shopper'],
    ]);
    expect(rows[1]!.said).toMatch(/very well/);
    // The same visit, one code, never the id the app sent.
    expect(rows[0]!.conversationKey).toBe(rows[1]!.conversationKey);
    expect(rows[0]!.conversationKey).not.toContain('visit');
  });

  it('does not count the exact look-up the app makes before it shops', async () => {
    expect((await ask('six bananas', 'exact')).json().reply).toBeNull();
    expect(await remembered()).toHaveLength(0);
  });

  it('keeps what the app said on its own, scrubbed, and never swearing', async () => {
    const kept = await harness.app.inject({
      method: 'POST',
      url: '/ozi/heard',
      payload: {
        heard: 'six bananas for flat 4, ME7 1ER',
        said: 'How many Bananas, loose would you like?',
        brain: 'shopping',
        outcome: 'asked',
        conversation: 'visit:test',
        turn: 3,
      },
    });
    expect(kept.statusCode, kept.body).toBe(200);
    const sworn = await harness.app.inject({
      method: 'POST',
      url: '/ozi/heard',
      payload: {
        heard: 'this fucking app',
        said: "I'm here when you're ready to order.",
        brain: 'none',
        outcome: 'unanswered',
        conversation: 'visit:test',
      },
    });
    expect(sworn.statusCode).toBe(200);
    const rows = await remembered();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      heard: 'six bananas for flat 4, [postcode]',
      said: 'How many Bananas, loose would you like?',
      brain: 'shopping',
      outcome: 'asked',
      turn: 3,
      verdict: 'unrated',
    });
  });

  it('is never in the way: a store that cannot write loses the line and answers anyway', async () => {
    const broken = vi
      .spyOn(harness.repository.memory, 'remember')
      .mockRejectedValue(new Error('disk gone'));
    const answered = await ask('how are you');
    expect(answered.statusCode).toBe(200);
    expect(answered.json().reply).toMatch(/very well/);
    broken.mockRestore();
  });
});

describe('judging in the admin panel', () => {
  it('lists newest first with counts, filters by verdict and channel, and marks right', async () => {
    await ask('how are you');
    await ask('what is the capital of peru');
    const list = await harness.app.inject({ method: 'GET', url: '/staff/memory', headers: STAFF });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().counts).toEqual({ total: 2, unrated: 2, right: 0, wrong: 0 });
    expect(list.json().exchanges.map((row: { heard: string }) => row.heard)).toEqual([
      'what is the capital of peru',
      'how are you',
    ]);
    const id = list.json().exchanges[1].id as string;
    const right = await harness.app.inject({
      method: 'POST',
      url: `/staff/memory/${id}`,
      headers: STAFF,
      payload: { verdict: 'right' },
    });
    expect(right.json().message).toBe('Marked right. Thank you.');
    const unrated = await harness.app.inject({
      method: 'GET',
      url: '/staff/memory?verdict=unrated',
      headers: STAFF,
    });
    expect(unrated.json().exchanges).toHaveLength(1);
    const phone = await harness.app.inject({
      method: 'GET',
      url: '/staff/memory?channel=phone',
      headers: STAFF,
    });
    expect(phone.json().exchanges).toHaveLength(0);
  });

  it('a better answer for a wrong one teaches Ozi at once, for the next person', async () => {
    await ask('do you deliver to the moon');
    const list = await harness.app.inject({ method: 'GET', url: '/staff/memory', headers: STAFF });
    const id = list.json().exchanges[0].id as string;
    const wrong = await harness.app.inject({
      method: 'POST',
      url: `/staff/memory/${id}`,
      headers: STAFF,
      payload: { verdict: 'wrong', betterReply: 'Not yet. We deliver around Medway for now.' },
    });
    expect(wrong.statusCode, wrong.body).toBe(200);
    expect(wrong.json().message).toMatch(/now answers "do you deliver to the moon"/);
    const again = await ask('do you deliver to the moon', 'exact');
    expect(again.json().reply).toBe('Not yet. We deliver around Medway for now.');
    const row = await harness.repository.memory.findById(id);
    expect(row).toMatchObject({
      verdict: 'wrong',
      betterReply: 'Not yet. We deliver around Medway for now.',
    });
    expect(row!.ratedBy).toBeTruthy();
  });

  it('refuses a better answer with a banned word, and the export to anyone but the owner', async () => {
    await ask('do you deliver to the moon');
    const list = await harness.app.inject({ method: 'GET', url: '/staff/memory', headers: STAFF });
    const id = list.json().exchanges[0].id as string;
    const rude = await harness.app.inject({
      method: 'POST',
      url: `/staff/memory/${id}`,
      headers: STAFF,
      payload: { verdict: 'wrong', betterReply: 'no, fuck off' },
    });
    expect(rude.statusCode).toBe(400);
    const exported = await harness.app.inject({
      method: 'GET',
      url: '/staff/memory/export',
      headers: STAFF,
    });
    expect(exported.statusCode).toBe(403);
  });

  it('the owner exports one training line per exchange, with the better answer in place', async () => {
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
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/staff/sign-in',
      payload: { username: 'anthony', password: 'a long password', passcode: '123456#' },
    });
    const owner = { 'x-staff-token': signedIn.json().token as string };
    await ask('do you deliver to the moon');
    const list = await harness.app.inject({ method: 'GET', url: '/staff/memory', headers: owner });
    const id = list.json().exchanges[0].id as string;
    await harness.app.inject({
      method: 'POST',
      url: `/staff/memory/${id}`,
      headers: owner,
      payload: { verdict: 'wrong', betterReply: 'Not yet. We deliver around Medway for now.' },
    });
    const exported = await harness.app.inject({
      method: 'GET',
      url: '/staff/memory/export',
      headers: owner,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.json().count).toBe(1);
    const line = JSON.parse(exported.json().lines[0] as string);
    expect(line).toMatchObject({
      prompt: 'do you deliver to the moon',
      completion: 'Not yet. We deliver around Medway for now.',
      said: '',
      verdict: 'wrong',
      brain: 'none',
      channel: 'app',
      account: 'shopper',
    });
    expect(line).not.toHaveProperty('phone');
  });

  it('writes a training line a model can read', () => {
    const line = JSON.parse(
      trainingLine({
        id: 'x',
        at: START,
        channel: 'phone',
        account: 'shopper',
        conversationKey: 'abc',
        turn: 2,
        heard: 'how are you',
        said: 'Very well.',
        brain: 'phrases',
        outcome: 'answered',
        verdict: 'right',
        betterReply: null,
        ratedBy: 'Yvette',
        ratedAt: START,
      }),
    );
    expect(line).toEqual({
      prompt: 'how are you',
      completion: 'Very well.',
      said: 'Very well.',
      verdict: 'right',
      brain: 'phrases',
      outcome: 'answered',
      channel: 'phone',
      account: 'shopper',
      conversation: 'abc',
      turn: 2,
      at: START.toISOString(),
    });
  });
});

describe('the telephone line', () => {
  function twilio(path: string, params: Record<string, string>) {
    const signature = twilioSignature(TOKEN, `${ORIGIN}${path}`, params);
    return harness.app.inject({
      method: 'POST',
      url: path,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature,
      },
      payload: new URLSearchParams(params).toString(),
    });
  }
  const nextStep = (twiml: string): string =>
    (/action="([^"]+)"/.exec(twiml)?.[1] ?? '').replace(/&amp;/g, '&').replace(ORIGIN, '');
  const spoken = (twiml: string): string =>
    [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ');

  it('answers from the same phrase book as the app, and remembers every turn by the call, not the number', async () => {
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
    await harness.repository.shoppers.update(shopper.shopperId, {
      deliveryAddress: '1 High Street, London',
    });
    const call = { CallSid: 'CA77', From: '+447700900001', Direction: 'inbound' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    expect(spoken(hello.body)).toMatch(/What would you like/);

    const chat = await twilio(nextStep(hello.body), {
      ...call,
      SpeechResult: 'How are you today?',
    });
    expect(spoken(chat.body)).toMatch(/^I'm very well, thank you for asking.*Anything else\?/);

    const added = await twilio(nextStep(chat.body), { ...call, SpeechResult: 'two milk' });
    expect(spoken(added.body)).toMatch(/I've added 2 Semi skimmed milk/);

    const lost = await twilio(nextStep(added.body), { ...call, SpeechResult: 'a flux capacitor' });
    expect(spoken(lost.body)).toMatch(/Sorry, I couldn't find flux capacitor/);

    const rows = (await harness.repository.memory.list({ channel: 'phone', limit: 10 })).reverse();
    expect(rows.map((row) => [row.turn, row.heard, row.brain, row.outcome])).toEqual([
      [0, '', 'flow', 'asked'],
      [1, 'How are you today?', 'phrases', 'answered'],
      [2, 'two milk', 'shopping', 'added'],
      [3, 'a flux capacitor', 'shopping', 'not-found'],
    ]);
    expect(rows[0]!.said).toMatch(/^Hello Margaret/);
    expect(rows[2]!.said).toMatch(/I've added 2 Semi skimmed milk/);
    expect(new Set(rows.map((row) => row.conversationKey)).size).toBe(1);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain('7700900001');
      expect(JSON.stringify(row)).not.toContain('CA77');
    }
  });
});

describe('how long it is kept', () => {
  it('forgets unjudged exchanges after six months and judged ones after three years', async () => {
    await ask('how are you');
    await ask('what is the capital of peru');
    const [judged] = await remembered();
    await harness.repository.memory.judge(judged!.id, {
      verdict: 'right',
      betterReply: null,
      ratedBy: 'Yvette',
      ratedAt: START,
    });
    const later = (days: number): Date => new Date(START.getTime() + days * 24 * 60 * 60 * 1000);
    harness.setNow(later(181));
    expect((await sweepRetention(harness.app.ctx)).exchangesRemoved).toBe(1);
    expect(await remembered()).toHaveLength(1);
    harness.setNow(later(3 * 365 + 1));
    expect((await sweepRetention(harness.app.ctx)).exchangesRemoved).toBe(1);
    expect(await remembered()).toHaveLength(0);
  });
});

describe('Claude behind Ozi (ruling 69)', () => {
  const heardByClaude: string[] = [];
  const fakeBrain: OziBrain = {
    name: 'claude',
    model: 'stand-in',
    async understand({ text }) {
      heardByClaude.push(text);
      if (/run out of flour/i.test(text)) {
        return {
          kind: 'items',
          items: [{ name: 'milk', quantity: 2, brand: null, detail: null }],
          reply: null,
        };
      }
      if (/moon/i.test(text)) {
        return { kind: 'question', items: [], reply: 'Not yet. We stay on this planet.' };
      }
      if (/finished now/i.test(text)) return { kind: 'done', items: [], reply: null };
      return null;
    },
  };

  async function withBrain() {
    await harness.close();
    heardByClaude.length = 0;
    harness = await buildTestApp(START, {
      env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN },
      sendText: async () => undefined,
      brain: fakeBrain,
    });
    await seedCatalogue(harness.repository);
  }

  it('is asked only after the phrase book, answers a question, and keeps it for learning', async () => {
    await withBrain();
    expect((await ask('how are you')).json().reply).toMatch(/very well/);
    expect(heardByClaude).toEqual([]);
    const moon = await ask('do you deliver to the moon');
    expect(moon.json()).toMatchObject({
      reply: 'Not yet. We stay on this planet.',
      understood: { kind: 'question' },
    });
    const rows = await remembered();
    expect(rows[0]).toMatchObject({
      brain: 'claude',
      outcome: 'answered',
      heard: 'do you deliver to the moon',
    });
    expect(await harness.repository.learned.list('waiting')).toHaveLength(1);
  });

  it('hears shopping the parser cannot, and hands it back for the app to shop', async () => {
    await withBrain();
    const flour = await ask("I've run out of flour");
    expect(flour.json()).toEqual({
      reply: null,
      understood: {
        kind: 'items',
        items: [{ name: 'milk', quantity: 2, brand: null, detail: null }],
        reply: null,
      },
    });
    const rows = await remembered();
    expect(rows[0]).toMatchObject({ brain: 'claude', said: '[items: 2 milk]' });
    // Shopping is not a question for the Learning list.
    expect(await harness.repository.learned.list('waiting')).toHaveLength(0);
  });

  it('on the telephone, shops for what Claude heard and ends on a "done" it heard', async () => {
    await withBrain();
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
    await harness.repository.shoppers.update(shopper.shopperId, {
      deliveryAddress: '1 High Street, London',
    });
    const twilio = (path: string, params: Record<string, string>) =>
      harness.app.inject({
        method: 'POST',
        url: path,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': twilioSignature(TOKEN, `${ORIGIN}${path}`, params),
        },
        payload: new URLSearchParams(params).toString(),
      });
    const nextStep = (twiml: string): string =>
      (/action="([^"]+)"/.exec(twiml)?.[1] ?? '').replace(/&amp;/g, '&').replace(ORIGIN, '');
    const spoken = (twiml: string): string =>
      [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ');
    const call = { CallSid: 'CA69', From: '+447700900001', Direction: 'inbound' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    const added = await twilio(nextStep(hello.body), {
      ...call,
      SpeechResult: "I've run out of flour again",
    });
    expect(spoken(added.body)).toMatch(/I've added 2 Semi skimmed milk/);
    const done = await twilio(nextStep(added.body), { ...call, SpeechResult: "I'm finished now" });
    expect(spoken(done.body)).toMatch(/Here is your order/);
    const rows = await harness.repository.memory.list({ channel: 'phone', limit: 10 });
    expect(rows.map((row) => row.brain)).toContain('claude');
  });
});
