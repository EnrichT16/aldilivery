import { describe, expect, it } from 'vitest';

import { keywords, matchScore, normalise, shorten } from '../src/core/text.js';

describe('normalise', () => {
  it('tidies case, punctuation, accents and contractions', () => {
    expect(normalise("  What's   your CAFÉ's  opening-time?! ")).toBe(
      'what is your cafes opening time',
    );
    expect(normalise('I can’t log in')).toBe('i can not log in');
  });
});

describe('keywords', () => {
  it('keeps meaning words only, rooted', () => {
    expect(keywords('What are your delivery times?')).toEqual(['deliver', 'time']);
    expect(keywords('Do you deliver on Sundays')).toEqual(['deliver', 'sunday']);
  });
});

describe('matchScore', () => {
  it('is 1 for the same words, however written', () => {
    expect(matchScore('what are your opening hours', 'What are your opening hours?')).toBe(1);
  });

  it('finds a taught question inside a longer message', () => {
    expect(
      matchScore(
        'Hi there, what are your opening hours on bank holidays please',
        'what are your opening hours',
      ),
    ).toBe(0.95);
  });

  it('matches on shared meaning words', () => {
    expect(
      matchScore('could you tell me your opening hours', 'when are you open, what hours'),
    ).toBeGreaterThan(0);
    expect(
      matchScore('do you deliver on sundays', 'what are your sunday delivery times'),
    ).toBeGreaterThanOrEqual(0.6);
  });

  it('never matches on one common word alone', () => {
    expect(matchScore('my delivery was damaged', 'what are your delivery times')).toBe(0);
  });
});

describe('shorten', () => {
  it('cuts at a word and says so', () => {
    expect(shorten('one two three four five six', 14)).toBe('one two three...');
    expect(shorten('short')).toBe('short');
  });
});
