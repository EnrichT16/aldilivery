/**
 * Ozi answering faster (ruling 49): the app knows from one-way fingerprints when something said
 * cannot be an everyday phrase, and does not wait for the server; and a slow server never holds
 * up an order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { phraseFingerprint } from '@aldilivery/core';

import { forgetKnownPhrases, phraseReply } from '../src/voice/phrases';

let asked: string[];

beforeEach(() => {
  asked = [];
  forgetKnownPhrases();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      asked.push(path);
      const body =
        path === '/ozi/known'
          ? { fingerprints: [phraseFingerprint('thank you')] }
          : { reply: "You're welcome." };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => Promise.resolve(body),
      } as unknown as Response;
    }),
  );
});

describe('answering faster', () => {
  it('does not ask the server when the words cannot be a phrase', async () => {
    expect(await phraseReply('two bananas and some milk', 0, 'exact')).toBeNull();
    expect(asked).toEqual(['/ozi/known']);
  });

  it('asks the server when they might be, and fetches the fingerprints once', async () => {
    expect(await phraseReply('Ozi, thank you!', 0, 'exact')).toBe("You're welcome.");
    expect(await phraseReply('three apples', 0, 'exact')).toBeNull();
    expect(asked).toEqual(['/ozi/known', '/ozi/reply']);
  });

  it('always asks for a sentence said to Ozi by name, for keyword matching', async () => {
    expect(await phraseReply('Ozi, how do refunds work for me', 0, 'within')).toBe(
      "You're welcome.",
    );
    expect(asked).toEqual(['/ozi/reply']);
  });
});
