/**
 * Ozi's everyday phrases (ruling 34). The file grows every day, so these checks are what keep
 * a day's additions from breaking anything: every entry well formed, no price written in, and
 * nothing that would swallow an order.
 */

import { describe, expect, it } from 'vitest';

import rawPhrases from '@ozi-phrases';

import { storeConfig } from '../src/config';
import { PHRASES, fillIn, parsePhrases, phraseReply } from '../src/voice/phrases';

describe('the phrase file', () => {
  it('is well formed: unique ids, phrases to listen for, and replies', () => {
    expect(PHRASES.length).toBeGreaterThan(20);
  });

  it('never writes a price or the product name in; those come from the store settings', () => {
    const text = JSON.stringify((rawPhrases as { phrases: unknown }).phrases);
    expect(text).not.toMatch(/£\d|\d+p\b/);
    expect(text).not.toContain(storeConfig.productName);
  });

  it('only uses the blanks it knows how to fill', () => {
    for (const phrase of PHRASES) {
      for (const reply of phrase.replies) {
        expect(fillIn(reply), `${phrase.id}: ${reply}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('listens for each phrase in one place only, so the answer is never a toss-up', () => {
    const seen = new Map<string, string>();
    for (const phrase of PHRASES) {
      for (const when of phrase.when) {
        expect(
          seen.get(when),
          `"${when}" is in ${seen.get(when)} and ${phrase.id}`,
        ).toBeUndefined();
        seen.set(when, phrase.id);
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
  it('answers the whole sentence, with the figures filled in', () => {
    expect(phraseReply('Thank you!', 0, 'exact')).toBe(`You're welcome. ${storeConfig.motto}`);
    expect(phraseReply('How much is delivery?', 0, 'exact')).toMatch(
      /^Delivery is one flat fee, the same every time: £\d+\.\d\d\./,
    );
  });

  it('takes replies in turn', () => {
    expect(phraseReply('thanks', 1, 'exact')).toBe('My pleasure. Is there anything else you need?');
  });

  it('does not answer a phrase inside a longer sentence unless Ozi was called', () => {
    expect(phraseReply('and then she said thank you to him', 0, 'exact')).toBeNull();
    expect(phraseReply('Ozzy, thank you so much', 0, 'within')).toMatch(/^You're welcome/);
  });

  it('treats "Ozi, thank you" as a phrase, never as something to order', () => {
    expect(phraseReply('Ozi, thank you', 0, 'exact')).toMatch(/^You're welcome/);
  });
});
