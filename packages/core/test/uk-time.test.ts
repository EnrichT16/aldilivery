/**
 * UK time in words, and the reminders settings (Anthony, 3 November 2026, ruling 93): the clock
 * on every dashboard and what Ozi says to "what time is it", right in GMT and in BST wherever the
 * server runs; and config/store.json's `reminders`, every figure read from it.
 */

import { describe, expect, it } from 'vitest';

import { parseStoreConfig, StoreConfigError } from '../src/config.js';
import { loadStoreConfig } from '../src/node.js';
import {
  ASKS_THE_TIME,
  clockSpoken,
  ukClockWords,
  ukDateKey,
  ukStartOfDay,
  ukTimeAnswer,
  ukTimeSpoken,
  ukWallTimeToDate,
  ukWhenWords,
} from '../src/uk-time.js';

describe('the clock, in UK time', () => {
  it('says the day, the date and the time in words, GMT and BST alike', () => {
    expect(ukClockWords(new Date('2026-11-03T10:42:00.000Z'))).toBe('Tuesday 3 November, 10:42');
    expect(ukClockWords(new Date('2026-07-01T13:05:00.000Z'))).toBe('Wednesday 1 July, 14:05');
    expect(ukClockWords(new Date('2026-12-31T23:59:00.000Z'))).toBe('Thursday 31 December, 23:59');
    expect(ukClockWords(new Date('2027-01-01T00:00:00.000Z'))).toBe('Friday 1 January, 00:00');
  });

  it('speaks a time as a person would', () => {
    expect(clockSpoken(10, 0)).toBe('10 in the morning');
    expect(clockSpoken(14, 30)).toBe('half past 2 in the afternoon');
    expect(clockSpoken(19, 15)).toBe('quarter past 7 in the evening');
    expect(clockSpoken(7, 45)).toBe('7:45 in the morning');
    expect(clockSpoken(12, 0)).toBe('midday');
    expect(clockSpoken(0, 0)).toBe('midnight');
    expect(clockSpoken(0, 20)).toBe('12:20 in the morning');
    expect(ukTimeSpoken(new Date('2026-07-01T13:05:00.000Z'))).toBe('2:05 in the afternoon');
  });

  it('answers "what time is it" with the time and the date', () => {
    expect(ukTimeAnswer(new Date('2026-11-03T09:00:00.000Z'))).toBe(
      "It's 9 in the morning on Tuesday the third of November.",
    );
    expect(ukTimeAnswer(new Date('2026-07-22T15:30:00.000Z'))).toBe(
      "It's half past 4 in the afternoon on Wednesday the twenty-second of July.",
    );
    for (const said of [
      'what time is it',
      "what's the time",
      'whats the date today',
      'what day is it',
      'have you got the time',
      'tell me the date',
      'what is the date',
    ]) {
      expect(ASKS_THE_TIME.test(said), said).toBe(true);
    }
    for (const said of ['what time does the shop open', 'two pints of milk', 'the time is up']) {
      expect(ASKS_THE_TIME.test(said), said).toBe(false);
    }
  });

  it('turns a UK wall-clock time into the moment, across the clock changes', () => {
    expect(ukWallTimeToDate(2026, 11, 4, 10, 0).toISOString()).toBe('2026-11-04T10:00:00.000Z');
    expect(ukWallTimeToDate(2026, 7, 2, 10, 0).toISOString()).toBe('2026-07-02T09:00:00.000Z');
    // The clocks go forward at 01:00 UTC on 29 March 2026: ten in the morning is 09:00 UTC.
    expect(ukWallTimeToDate(2026, 3, 29, 10, 0).toISOString()).toBe('2026-03-29T09:00:00.000Z');
    // And back on 25 October 2026.
    expect(ukWallTimeToDate(2026, 10, 25, 10, 0).toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(ukDateKey(new Date('2026-07-01T23:30:00.000Z'))).toBe('2026-07-02');
    expect(ukStartOfDay(new Date('2026-07-01T23:30:00.000Z'), 1).toISOString()).toBe(
      '2026-07-02T23:00:00.000Z',
    );
  });

  it('says when a moment is, relative to now', () => {
    const now = new Date('2026-11-03T09:00:00.000Z');
    expect(ukWhenWords(new Date('2026-11-03T15:00:00.000Z'), now)).toBe(
      'today at 3 in the afternoon',
    );
    expect(ukWhenWords(new Date('2026-11-04T10:00:00.000Z'), now)).toBe(
      'tomorrow at 10 in the morning',
    );
    expect(ukWhenWords(new Date('2026-11-09T09:00:00.000Z'), now)).toBe(
      'on Monday 9 November at 9 in the morning',
    );
  });
});

describe('the reminders settings (config/store.json)', () => {
  const config = loadStoreConfig();

  it('are read from the file, every figure', () => {
    expect(config.reminders).toEqual({
      maxPerAccount: 50,
      maxTextLength: 200,
      pastGraceMinutes: 1,
      maxDaysAhead: 365,
      againMinutes: 10,
      quietFrom: '22:50',
      quietUntil: '06:00',
    });
  });

  it('take the owner’s desk quiet hours when none of their own are given, and refuse a bad time', () => {
    const raw = JSON.parse(JSON.stringify(loadStoreConfig())) as Record<string, unknown>;
    delete raw['reminders'];
    const parsed = parseStoreConfig(raw);
    expect(parsed.reminders.quietFrom).toBe(parsed.ownerDesk.quietFrom);
    expect(parsed.reminders.quietUntil).toBe(parsed.ownerDesk.quietUntil);
    expect(parsed.reminders.maxPerAccount).toBe(50);

    expect(() => parseStoreConfig({ ...raw, reminders: { quietFrom: '25:00' } })).toThrow(
      StoreConfigError,
    );
    expect(() => parseStoreConfig({ ...raw, reminders: { maxPerAccount: 0 } })).toThrow(
      StoreConfigError,
    );
  });
});
