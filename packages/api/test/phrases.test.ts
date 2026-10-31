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

import { bannedList, containsBanned } from '../src/lib/banned.js';
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

  it('passes the banned-words check and Rule Nine, every phrase and the small talk list too (ruling 66)', () => {
    const banned = bannedList();
    const files = [
      'ozi-phrases.json',
      ...PHRASE_ACCOUNTS.slice(1).map((a) => `phrases/${a}.json`),
      'small-talk.json',
    ];
    const assistant = new RegExp(`\\b${config.assistantName}\\b`);
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(folder, file), 'utf8')) as {
        phrases: Array<{ id: string; when: string[]; replies: string[] }>;
      };
      expect(raw.phrases.length, file).toBeGreaterThan(0);
      for (const phrase of raw.phrases) {
        for (const text of [...phrase.when, ...phrase.replies]) {
          expect(containsBanned(text, banned), `${file} ${phrase.id}: ${text}`).toBe(false);
          // Names only through blanks (Rule Nine): {assistant}, {product}.
          expect(text, `${file} ${phrase.id}: ${text}`).not.toMatch(assistant);
        }
        for (const reply of phrase.replies) {
          // Spoken, so no bullet points, and short enough to be said in a few seconds.
          expect(reply, `${file} ${phrase.id}: ${reply}`).not.toMatch(/[•\n]|(^|\s)[-*]\s/);
          expect(reply.split(/\s+/).length, `${file} ${phrase.id}: ${reply}`).toBeLessThanOrEqual(
            45,
          );
        }
      }
    }
  });

  it('never promises what the founder has ruled out, so a day’s additions cannot either', () => {
    const files = ['ozi-phrases.json', ...PHRASE_ACCOUNTS.slice(1).map((a) => `phrases/${a}.json`)];
    const ruledOut: Array<[RegExp, string]> = [
      // Coverage in its own words: the agreed area answer is the only one.
      [/\b[A-Z][a-z]+ is covered\b|whether (you are|it is) covered/, 'a town promised'],
      [/\b(ten|\d+) miles\b/i, 'a distance promised'],
      // No supermarket or chain named, as a partner or otherwise.
      [
        new RegExp(
          `\\b(${config.store.displayName}|tesco|sainsbury'?s?|lidl|asda|morrisons|waitrose|iceland|co-?op|m&s|marks and spencer)\\b`,
          'i',
        ),
        'a supermarket named',
      ],
      // Times: usually the same day, with the order page's best guess.
      [
        /couple of hours|within (an|the|one) hour|twenty minutes|half an hour for/i,
        'a time promised',
      ],
      [/\bmark-?ups?\b/i, '"no mark-up"'],
      // The company and technology behind the assistant are never named.
      [/claude|anthropic|openai|chat ?gpt|\bgpt\b|gemini|language model/i, 'an AI maker named'],
      [/never goes down/i, 'pay that never goes down'],
    ];
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(folder, file), 'utf8')) as {
        phrases: Array<{ id: string; when: string[]; replies: string[] }>;
      };
      for (const phrase of raw.phrases) {
        for (const reply of phrase.replies) {
          for (const [pattern, what] of ruledOut) {
            expect(reply, `${file} ${phrase.id} has ${what}: ${reply}`).not.toMatch(pattern);
          }
        }
        if (file === 'phrases/owner.json') {
          for (const when of phrase.when) expect(when, phrase.id).not.toMatch(/claude|anthropic/i);
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
      /^If you pay as you go, delivery is £10\.99 for shopping up to £30\.00, £12\.99 up to £60\.00, and £14\.99 over £60\.00\. Members pay £7\.99 for shopping up to £60\.00, and £9\.99 over £60\.00; Plus and Family £6\.99 for shopping up to £60\.00, and £8\.99 over £60\.00\./,
    );
  });

  it('fills in big-order Runner pay, days ahead and the business details from the settings', () => {
    const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
    expect(
      fillIn(
        '{runnerPay} a standard delivery, {largeRunnerPay} for big orders, from {largeOrderFrom}.',
        config,
        book.ownerAddress,
      ),
    ).toBe(
      `${money(config.fees.runnerPaymentPence)} a standard delivery, ${money(config.fees.largeOrderRunnerPaymentPence)} for big orders, from ${money(config.fees.largeOrderFromPence)}.`,
    );
    expect(fillIn('Up to {daysAhead} days ahead.', config, book.ownerAddress)).toBe(
      `Up to ${config.scheduled.maxDaysAhead} days ahead.`,
    );
    expect(
      fillIn('{telephone} {companyName} {companyNumber} {icoNumber}', config, book.ownerAddress),
    ).toBe(
      `${config.contact.telephonePlaceholder} ${config.store.legalEntityName} ${config.store.companyNumber} ${config.store.icoRegistrationNumber}`,
    );
    expect(phraseReply('how much does the runner get', 0, 'exact', 'shopper', config, book)).toBe(
      `Your Runner gets ${money(config.fees.runnerPaymentPence)} a standard delivery, ${money(config.fees.largeOrderRunnerPaymentPence)} for big orders.`,
    );
    expect(phraseReply('can i choose a time', 0, 'exact', 'shopper', config, book)).toMatch(
      new RegExp(`up to ${config.scheduled.maxDaysAhead} days ahead`),
    );
  });

  it('says plainly that it is independent of every supermarket', () => {
    for (const said of [
      'are you the supermarket',
      'are you part of tesco',
      'does the supermarket endorse you',
    ]) {
      expect(phraseReply(said, 0, 'exact', 'shopper', config, book)).toBe(
        `No. ${config.productName} is an independent service. We don't have a partnership with any supermarket yet.`,
      );
    }
  });

  it('says the monthly order allowance from the settings, never written in (ruling 73)', () => {
    expect(phraseReply('How many orders can I make?', 0, 'exact', 'shopper', config, book)).toBe(
      'Membership includes 5 orders a month, Plus 8, and Family and Carer 5 each. After that, the next order has an extra £5.99 delivery charge, as does every 3rd one after it. I tell you before you say yes.',
    );
    expect(phraseReply('Does Plus include Finds It?', 0, 'exact', 'shopper', config, book)).toBe(
      'Yes, two free Finds It searches a month on Plus and Family and Carer.',
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
      /^Yes, sir\. If you pay as you go, delivery is £10\.99 for shopping up to £30\.00/,
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
    // Known by name, for the time of day, from config (ruling 84): 10am in London.
    expect((await ask('hello', owner)).json().reply).toBe(
      'Good morning, Mr. Anthony. How can I help?',
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

describe('picking a phrase up by its keywords (ruling 49)', () => {
  const tiny = {
    ownerAddress: 'Mr Anthony',
    collections: Object.fromEntries(
      PHRASE_ACCOUNTS.map((account) => [
        account,
        [
          {
            id: 'refunds',
            topic: 'money',
            when: ['how do refunds work'],
            replies: ['Refunds go back to your card.'],
          },
          {
            id: 'runner-arrive',
            topic: 'delivery',
            when: ['when will my runner arrive'],
            replies: ['Your Runner is on the way.'],
          },
          {
            id: 'substitutes',
            topic: 'shopping',
            when: ['substitutions'],
            replies: ['You choose what happens if something is missing.'],
          },
        ],
      ]),
    ) as never,
  };

  it('answers a sentence that shares enough of the meaning words, said to Ozi', () => {
    expect(
      phraseReply(
        'Ozi, could you tell me how refunds actually work please',
        0,
        'within',
        'shopper',
        config,
        tiny,
      ),
    ).toBe('Refunds go back to your card.');
    expect(
      phraseReply('Ozi, when does the runner arrive', 0, 'within', 'shopper', config, tiny),
    ).toBe('Your Runner is on the way.');
    expect(phraseReply('substitutions?', 0, 'within', 'shopper', config, tiny)).toBe(
      'You choose what happens if something is missing.',
    );
  });

  it('never guesses from one common word, and keyword matching is never used for the exact check', () => {
    expect(
      phraseReply('Ozi, the weather will be lovely', 0, 'within', 'shopper', config, tiny),
    ).toBeNull();
    expect(
      phraseReply('how do refunds actually work', 0, 'exact', 'shopper', config, tiny),
    ).toBeNull();
  });
});
