import { describe, expect, it } from 'vitest';

import {
  asksForSecrets,
  bannedListFrom,
  containsBanned,
  outgoingProblem,
  redactSensitive,
  withoutBanned,
} from '../src/core/safety.js';
import { bannedWords } from './support.js';

const list = bannedListFrom(bannedWords);

describe('banned words', () => {
  it('finds them however they are disguised', () => {
    for (const said of ['FUCK this', 'f u c k', 'f*ck off', 'sh1t', 'fuuuuck', 'f.u.c.k']) {
      expect(containsBanned(said, list), said).toBe(true);
    }
  });

  it('leaves ordinary words alone', () => {
    for (const said of ['Scunthorpe delivery', 'class assignment', 'I passed the exam', 'Sussex']) {
      expect(containsBanned(said, list), said).toBe(false);
    }
  });

  it('takes them out of a message, or refuses to keep it', () => {
    expect(withoutBanned('where is my shit order', list)).toBe('where is my [removed] order');
    expect(withoutBanned('where is my order', list)).toBe('where is my order');
    expect(withoutBanned('you are a f u c k', list)).toBeNull();
  });
});

describe('private details', () => {
  it('removes card numbers that pass the card check, and only those', () => {
    const { text, removed } = redactSensitive(
      'My card is 4242 4242 4242 4242 and order 1234567890123',
    );
    expect(text).toBe('My card is [card number removed] and order 1234567890123');
    expect(removed).toEqual(['card number']);
  });

  it('removes passwords and codes', () => {
    expect(redactSensitive('my password is hunter22').text).toBe('my password is [removed]');
    expect(redactSensitive('the verification code: 834201').text).toBe(
      'the verification code: [removed]',
    );
    expect(redactSensitive('How do I reset my password?').removed).toEqual([]);
  });

  it('removes bank details', () => {
    const { text } = redactSensitive('sort code 12-34-56 account number 12345678');
    expect(text).not.toMatch(/12-34-56|12345678/);
  });
});

describe('outgoing messages', () => {
  it('never ask for secrets', () => {
    expect(asksForSecrets('Please send us your card number so we can refund you.')).toBe(true);
    expect(asksForSecrets('Reply with the code we texted you.')).toBe(true);
    expect(asksForSecrets('We will never ask for your password.')).toBe(false);
    expect(outgoingProblem('Could you confirm your PIN?', list)).toMatch(/never do/);
    expect(outgoingProblem('We open at nine.', list)).toBeNull();
  });
});
