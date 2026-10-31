/**
 * Ozi knows the owner on his own phone (ruling 84): the words Ozi says, without the model, to
 * somebody it already knows. The founder's own words are the cases.
 */

import { describe, expect, it } from 'vitest';

import { knownGreeting, knownSpeakerReply, ukPartOfDay } from '../src/known-speaker.js';

const names = {
  product: 'The Product',
  assistant: 'Ozi',
  heardAs: ['Ozzy', 'Ozzie'],
  spokenName: 'Mr. Anthony',
};
const owner = { kind: 'owner', firstName: null } as const;
const staff = { kind: 'staff', firstName: 'Grace' } as const;
// 10am in London on 31 October 2026 (GMT, after the clocks went back).
const MORNING = new Date('2026-10-31T10:00:00.000Z');

describe('the time of day in the UK', () => {
  it('is morning, afternoon or evening by the clock in London, summer time included', () => {
    expect(ukPartOfDay(MORNING)).toBe('morning');
    expect(ukPartOfDay(new Date('2026-10-31T13:30:00.000Z'))).toBe('afternoon');
    expect(ukPartOfDay(new Date('2026-10-31T19:00:00.000Z'))).toBe('evening');
    // 11:30 UTC in July is 12:30 in London: afternoon.
    expect(ukPartOfDay(new Date('2026-07-01T11:30:00.000Z'))).toBe('afternoon');
  });
});

describe('what Ozi says to the owner without the model', () => {
  it('greets him by name for the time of day, never with an account offer', () => {
    for (const said of ['Hello Ozi', 'Good morning Ozi', 'hi', 'Hey Ozzy', 'Ozi']) {
      const reply = knownSpeakerReply(said, owner, names, MORNING);
      expect(reply).toBe('Good morning, Mr. Anthony. How can I help?');
      expect(reply).not.toMatch(/account|order/i);
    }
    expect(knownGreeting(owner, names, new Date('2026-10-31T19:00:00.000Z'))).toBe(
      'Good evening, Mr. Anthony. How can I help?',
    );
  });

  it('knows his name, and knows it is him', () => {
    expect(knownSpeakerReply('Do you know my name?', owner, names, MORNING)).toMatch(
      /Mr\. Anthony, the owner and founder of The Product/,
    );
    expect(knownSpeakerReply('This is the owner and founder', owner, names, MORNING)).toMatch(
      /^I know, Mr\. Anthony/,
    );
  });

  it('greets staff by first name, and leaves anything else to the conversation', () => {
    expect(knownSpeakerReply('good afternoon', staff, names, MORNING)).toBe(
      'Good morning, Grace. How can I help?',
    );
    expect(knownSpeakerReply('what needs me today', owner, names, MORNING)).toBeNull();
  });
});
