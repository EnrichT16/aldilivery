/**
 * Ozi's everyday phrases, on the server (rulings 34 and 44). The files grow every day, so these
 * checks are what keep a day's additions from breaking anything: every entry well formed, no
 * price or product name written in, only known blanks, and each account answered from its own
 * collection, decided by who is signed in.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadStoreConfig, storeConfigPath } from '@aldilivery/core/node';

import {
  PHRASE_ACCOUNTS,
  fillIn,
  parsePhrases,
  phraseBook,
  phraseReply,
} from '../src/lib/phrases.js';
import { buildTestApp, signUpRunner, signUpShopper, STAFF, type TestHarness } from './helpers.js';

const config = loadStoreConfig();
const book = phraseBook();
const folder = dirname(storeConfigPath());

describe('the phrase files', () => {
  it('has at least 50 phrases for every account, and the owner has everybody’s', () => {
    for (const account of PHRASE_ACCOUNTS) {
      expect(book.collections[account].length, account).toBeGreaterThanOrEqual(50);
    }
    const others = PHRASE_ACCOUNTS.filter((a) => a !== 'owner').reduce(
      (sum, a) => sum + book.collections[a].length,
      0,
    );
    expect(book.collections.owner.length).toBeGreaterThanOrEqual(others + 50);
    expect(book.ownerAddress).toBe('Mr Anthony');
  });

  it('never writes a price or the product name in; those come from the store settings', () => {
    const files = ['ozi-phrases.json', ...PHRASE_ACCOUNTS.slice(1).map((a) => `phrases/${a}.json`)];
    for (const file of files) {
      const text = JSON.stringify(JSON.parse(readFileSync(join(folder, file), 'utf8')).phrases);
      expect(text, file).not.toMatch(/£\d|\d+p\b/);
      expect(text.toLowerCase(), file).not.toContain(config.productName.toLowerCase());
    }
  });

  it('only uses the blanks it knows how to fill', () => {
    for (const account of PHRASE_ACCOUNTS) {
      for (const phrase of book.collections[account]) {
        for (const reply of phrase.replies) {
          expect(fillIn(reply, config, book.ownerAddress), `${phrase.id}: ${reply}`).not.toMatch(
            /\{\w+\}/,
          );
        }
      }
    }
  });

  it('listens for each phrase in one place only within an account', () => {
    for (const account of PHRASE_ACCOUNTS.filter((a) => a !== 'owner')) {
      const seen = new Map<string, string>();
      for (const phrase of book.collections[account]) {
        for (const when of phrase.when) {
          expect(
            seen.get(when),
            `${account}: "${when}" is in ${seen.get(when)} and ${phrase.id}`,
          ).toBeUndefined();
          seen.set(when, phrase.id);
        }
      }
    }
  });

  it('every owner reply of his own calls him sir', () => {
    for (const phrase of book.collections.owner.filter((p) => !p.borrowed)) {
      for (const reply of phrase.replies) {
        expect(reply, phrase.id).toMatch(/\bsir\b/);
      }
    }
  });

  it('says exactly what is wrong with a bad entry', () => {
    expect(() =>
      parsePhrases({ phrases: [{ id: 'x', topic: 't', when: [], replies: ['a'] }] }),
    ).toThrow(/entry 1 \(x\) needs at least one phrase/);
    expect(() =>
      parsePhrases({
        phrases: [
          { id: 'x', topic: 't', when: ['a'], replies: ['b'] },
          { id: 'x', topic: 't', when: ['c'], replies: ['d'] },
        ],
      }),
    ).toThrow(/used twice/);
  });
});

describe('answering an everyday phrase', () => {
  it('answers the whole sentence, with the figures filled in, and takes replies in turn', () => {
    expect(phraseReply('Thank you!', 0, 'exact', 'shopper', config, book)).toBe(
      `You're welcome. ${config.motto}`,
    );
    expect(phraseReply('thanks', 1, 'exact', 'shopper', config, book)).toBe(
      'My pleasure. Is there anything else you need?',
    );
    expect(phraseReply('How much is delivery?', 0, 'exact', 'shopper', config, book)).toMatch(
      /^Delivery is one flat fee, the same every time: £\d+\.\d\d\./,
    );
  });

  it('does not answer a phrase inside a longer sentence unless asked to look within', () => {
    expect(
      phraseReply('and then she said thank you to him', 0, 'exact', 'shopper', config, book),
    ).toBeNull();
    expect(phraseReply('Ozzy, thank you so much', 0, 'within', 'shopper', config, book)).toMatch(
      /^You're welcome/,
    );
    expect(phraseReply('Ozi, thank you', 0, 'exact', 'shopper', config, book)).toMatch(
      /^You're welcome/,
    );
  });

  it('hears the product’s name, which the files only write as a blank', () => {
    expect(
      phraseReply(`what is ${config.productName}`, 0, 'exact', 'runner', config, book),
    ).not.toBeNull();
  });

  it('calls the owner by name, and opens a borrowed reply with yes sir', () => {
    expect(phraseReply('hello', 0, 'exact', 'owner', config, book)).toBe(
      'Good day, Mr Anthony. How can I help, sir?',
    );
    expect(phraseReply('how much is delivery', 0, 'exact', 'owner', config, book)).toMatch(
      /^Yes, sir\. Delivery is one flat fee/,
    );
    expect(phraseReply('how much is delivery', 1, 'exact', 'owner', config, book)).toMatch(
      /^Okay, sir\./,
    );
  });
});

describe('POST /ozi/reply', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
  });

  afterEach(async () => {
    await harness.close();
  });

  function ask(text: string, headers: Record<string, string> = {}) {
    return harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload: { text, mode: 'exact', turn: 0 },
      headers,
    });
  }

  async function staffSignIn(payload: object) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/staff/sign-in',
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    return { 'x-staff-token': response.json().token as string };
  }

  it('answers each account from its own collection, decided by who is signed in', async () => {
    expect((await ask('hello')).json().reply).toMatch(/^Hello\. What shopping/);

    const shopper = await signUpShopper(harness);
    expect((await ask('hello', shopper.authHeader)).json().reply).toMatch(/^Hello\. What shopping/);

    const runner = await signUpRunner(harness);
    expect((await ask('hello', runner.authHeader)).json().reply).toMatch(/Ready for a run/);

    expect((await ask('hello', STAFF)).json().reply).toMatch(/what's waiting/);

    const made = await harness.app.inject({
      method: 'POST',
      url: '/staff/owner',
      payload: {
        name: 'Anthony',
        username: 'anthony',
        password: 'a long password',
        passcode: '123456#',
      },
      headers: STAFF,
    });
    expect(made.statusCode, made.body).toBe(201);
    const owner = await staffSignIn({
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    expect((await ask('hello', owner)).json().reply).toBe(
      'Good day, Mr Anthony. How can I help, sir?',
    );

    for (const kind of ['family', 'investor'] as const) {
      const added = (
        await harness.app.inject({
          method: 'POST',
          url: '/staff/viewers',
          payload: { name: kind, username: kind, kind },
          headers: owner,
        })
      ).json();
      const viewer = await staffSignIn({ username: kind, password: added.password });
      const reply = (await ask('hello', viewer)).json().reply as string;
      expect(reply).toBe(phraseReply('hello', 0, 'exact', kind, harness.config, book));
      expect(reply).not.toMatch(/sir/);
    }
  });

  it('a Shopper cannot reach the owner’s collection, and a bad staff token is refused', async () => {
    const shopper = await signUpShopper(harness);
    const reply = (await ask('hello', { ...shopper.authHeader })).json().reply as string;
    expect(reply).not.toMatch(/sir/);
    expect((await ask('hello', { 'x-staff-token': 'st1.nonsense' })).statusCode).toBe(403);
  });

  it('answers null when it is not a phrase, and refuses an empty question', async () => {
    expect((await ask('bananas and milk')).json().reply).toBeNull();
    expect((await ask('')).statusCode).toBe(400);
  });
});
