/**
 * Small talk and general statements are not shopping (ruling 66): the small talk list, the
 * heuristic that tells a sentence to a person from a product, and the quiet spell after Ozi's
 * one gentle line.
 */

import { describe, expect, it } from 'vitest';

import { storeConfig } from '../src/config';
import {
  findSmallTalk,
  looksLikeChatter,
  parseSmallTalk,
  quietSpell,
  smallTalk,
  smallTalkReply,
} from '../src/voice/small-talk';

describe('the small talk list', () => {
  it('is well formed, with no name written in', () => {
    expect(smallTalk.phrases.length).toBeGreaterThanOrEqual(20);
    expect(smallTalk.quietSeconds).toBe(20);
    const text = JSON.stringify(smallTalk.phrases);
    expect(text).not.toContain(storeConfig.productName);
    expect(text).not.toMatch(new RegExp(`\\b${storeConfig.assistantName}\\b`));
    expect(text).not.toMatch(/£\d|\d+p\b/);
    // Every reply is short enough to be said in a few seconds.
    for (const phrase of smallTalk.phrases) {
      for (const reply of phrase.replies) expect(reply.split(' ').length).toBeLessThanOrEqual(30);
    }
  });

  it('listens for each phrase in one place only', () => {
    const seen = new Map<string, string>();
    for (const phrase of smallTalk.phrases) {
      for (const when of phrase.when) {
        expect(
          seen.get(when),
          `"${when}" is in ${seen.get(when)} and ${phrase.id}`,
        ).toBeUndefined();
        seen.set(when, phrase.id);
      }
    }
  });

  it('says exactly what is wrong with a bad file', () => {
    expect(() => parseSmallTalk({ nudge: 'x', quietSeconds: 20, phrases: 'no' })).toThrow(
      /must have a "phrases" list/,
    );
    expect(() =>
      parseSmallTalk({
        nudge: 'x',
        quietSeconds: 20,
        phrases: [{ id: 'a', when: ['hi'], replies: [] }],
      }),
    ).toThrow(/entry 1 \(a\) needs replies/);
    expect(() => parseSmallTalk({ nudge: '', quietSeconds: 20, phrases: [] })).toThrow(/nudge/);
  });

  it('finds the whole sentence, or a phrase inside a short one, and fills in the name', () => {
    expect(findSmallTalk('How are you doing?')?.id).toBe('how-are-you');
    expect(findSmallTalk('Ozi, how are you doing today, love?')?.id).toBe('how-are-you');
    expect(findSmallTalk("I'm tired")?.id).toBe('tired');
    expect(findSmallTalk('where are you')?.id).toBe('where-are-you');
    expect(findSmallTalk('thank you')?.id).toBe('thanks');
    expect(findSmallTalk("what's the weather like today")?.id).toBe('weather');
    const who = findSmallTalk('who are you');
    expect(smallTalkReply(who!, 0)).toContain(storeConfig.assistantName);
    expect(smallTalkReply(who!, 0)).not.toContain('{assistant}');
    // Replies are taken in turn.
    const hello = findSmallTalk('hello')!;
    expect(smallTalkReply(hello, 0)).not.toBe(smallTalkReply(hello, 1));
    expect(smallTalkReply(hello, 2)).toBe(smallTalkReply(hello, 0));
  });

  it('never takes shopping for small talk', () => {
    // A grocery word, a quantity, or a long sentence with a greeting inside it.
    expect(findSmallTalk('hi, two milks please')).toBeNull();
    expect(findSmallTalk('hello, I would like some bread')).toBeNull();
    expect(findSmallTalk('white bread')).toBeNull();
    expect(findSmallTalk('six eggs')).toBeNull();
    expect(findSmallTalk('bananas')).toBeNull();
    expect(
      findSmallTalk('hello there I was wondering whether you could possibly get me a few things'),
    ).toBeNull();
  });
});

describe('telling chatter from a product', () => {
  it('hears a sentence said to a person', () => {
    for (const said of [
      'how are you doing',
      'where are you',
      'what are you doing',
      "I'm tired",
      "what's the weather",
      'I was just saying to Margaret that the bus was late again',
      'can you hear me',
      'pass me the remote',
      'put the kettle on love',
      'did you see the match last night',
    ]) {
      expect(looksLikeChatter(said), said).toBe(true);
    }
  });

  it('never hears a product, a quantity or a household word as chatter', () => {
    for (const said of [
      'bananas',
      'two pints of milk',
      'have you got any bread',
      'can I have six eggs',
      'I need toilet roll and washing up liquid',
      'a dozen eggs',
      '500g of mince',
      'something nice',
      'the usual',
      'quinoa',
      'I fancy some crisps',
      'is there any cheese',
    ]) {
      expect(looksLikeChatter(said), said).toBe(false);
    }
  });
});

describe('the quiet spell after the gentle line', () => {
  it('keeps quiet for twenty seconds, then speaks again', () => {
    let clock = 1_000_000;
    const spell = quietSpell(20, () => clock);
    expect(spell.quiet()).toBe(false);
    spell.start();
    expect(spell.quiet()).toBe(true);
    clock += 19_999;
    expect(spell.quiet()).toBe(true);
    clock += 1;
    expect(spell.quiet()).toBe(false);
    spell.start();
    spell.clear();
    expect(spell.quiet()).toBe(false);
  });
});
