/**
 * Ozi learning, with a person in charge (ruling 49): what Ozi could not answer is kept for staff
 * to approve an answer for, and goes live as soon as it is approved; swearing and anything that
 * looks personal is never kept.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { containsBanned, fitToKeep } from '../src/lib/banned.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function ask(text: string, mode: 'exact' | 'within' = 'within') {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    payload: { text, mode, turn: 0 },
  });
}

describe('banned words', () => {
  it('are caught however they are written', () => {
    for (const said of [
      'what the fuck',
      'What The FUCK',
      'what the f u c k',
      'what the f*ck',
      'what the f.u.c.k',
      'fuuuuck this',
      'sh1t',
      'you motherfucker',
      'motherfucking app',
    ]) {
      expect(containsBanned(said), said).toBe(true);
    }
  });

  it('leave ordinary words alone', () => {
    for (const said of [
      'what time does the shop close',
      'as soon as possible',
      'a class of children',
      'scunthorpe delivery',
      'pass me the bread',
      'i have a hoe in the garden',
    ]) {
      expect(containsBanned(said), said).toBe(false);
    }
  });

  it('nothing personal is kept: numbers, emails, postcodes', () => {
    expect(fitToKeep('my number is 07700 900123')).toBe(false);
    expect(fitToKeep('my card is 4242 4242')).toBe(false);
    expect(fitToKeep('email me at ada at example dot com')).toBe(false);
    expect(fitToKeep('i live at ls1 1aa')).toBe(false);
    expect(fitToKeep('do you sell birthday candles')).toBe(true);
    expect(fitToKeep('hello')).toBe(false);
  });
});

describe('the learning list', () => {
  it('keeps what Ozi could not answer, once with a count, and never a swear word', async () => {
    expect(
      (await ask('Ozi, do you deliver birthday candles to hospitals')).json().reply,
    ).toBeNull();
    await ask('Ozi, do you deliver birthday candles to hospitals');
    const sworn = await ask('Ozi, what the f u c k is this');
    expect(sworn.json().reply).toBe("I'm here to help with your shopping. Let's keep it kind.");
    // An order-shaped exact check is never kept: only things said to Ozi and not understood.
    await ask('two bananas', 'exact');

    await new Promise((resolve) => setTimeout(resolve, 10));
    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/learning',
      headers: STAFF,
    });
    expect(list.statusCode).toBe(200);
    const waiting = list.json().waiting as Array<{
      text: string;
      timesHeard: number;
      account: string;
    }>;
    expect(waiting).toEqual([
      expect.objectContaining({
        text: 'do you deliver birthday candles to hospitals',
        timesHeard: 2,
        account: 'shopper',
      }),
    ]);
  });

  it('goes live as soon as staff approve an answer, for that Ozi and the owner’s', async () => {
    await ask('Ozi, do you deliver birthday candles to hospitals');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [row] = (
      await harness.app.inject({ method: 'GET', url: '/staff/learning', headers: STAFF })
    ).json().waiting as Array<{ id: string }>;

    const refused = await harness.app.inject({
      method: 'POST',
      url: `/staff/learning/${row!.id}`,
      headers: STAFF,
      payload: { approve: true, reply: 'Oh shit, yes.' },
    });
    expect(refused.statusCode).toBe(400);

    const approved = await harness.app.inject({
      method: 'POST',
      url: `/staff/learning/${row!.id}`,
      headers: STAFF,
      payload: { approve: true, reply: 'Yes. Your Runner can take them to a hospital ward.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await ask('do you deliver birthday candles to hospitals', 'exact')).json().reply).toBe(
      'Yes. Your Runner can take them to a hospital ward.',
    );
    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/learning',
      headers: STAFF,
    });
    expect(list.json().waiting).toEqual([]);
  });

  it('is only for staff whose job includes it', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/staff/learning' })).statusCode).toBe(
      403,
    );
  });
});

describe('fingerprints for the app', () => {
  it('lets the app know at once what is not a phrase, without the phrases themselves', async () => {
    const known = await harness.app.inject({ method: 'GET', url: '/ozi/known' });
    const { fingerprints } = known.json() as { fingerprints: string[] };
    expect(fingerprints.length).toBeGreaterThan(50);
    expect(fingerprints.every((f) => /^[0-9a-f]{8}$/.test(f))).toBe(true);
    expect(known.body).not.toMatch(/thank you/);
  });
});
