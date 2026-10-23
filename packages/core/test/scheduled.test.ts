/**
 * Ordering now for a later day (ruling 78): UK days and times, when a booked order is offered,
 * when the money may be taken, how a failed payment is tried again, the words agreed to, and
 * hearing a day and time said aloud.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  SCHEDULED_DEFAULTS,
  addDays,
  bookableDays,
  checkSchedule,
  dayWords,
  nextChargeTry,
  offerAtFor,
  parseSpokenDay,
  parseSpokenSchedule,
  parseSpokenTime,
  parseStoreConfig,
  scheduleAgreementWords,
  ukDay,
  ukMoment,
} from '../src/index.js';
import { loadStoreConfig, storeConfigPath } from '../src/node.js';

const settings = SCHEDULED_DEFAULTS;
/** Friday 23 October 2026, 10:00 in London (summer time, an hour ahead of UTC). */
const NOW = new Date('2026-10-23T09:00:00.000Z');

describe('UK days and times', () => {
  it('reads the UK day, across midnight and the change of the clocks', () => {
    expect(ukDay(NOW)).toBe('2026-10-23');
    // 23:30 UTC on 23 October is 00:30 on the 24th in London (summer time).
    expect(ukDay(new Date('2026-10-23T23:30:00.000Z'))).toBe('2026-10-24');
    // The clocks go back on 25 October 2026: in November London is on UTC.
    expect(ukMoment('2026-11-01', '00:05').toISOString()).toBe('2026-11-01T00:05:00.000Z');
    expect(ukMoment('2026-10-24', '08:00').toISOString()).toBe('2026-10-24T07:00:00.000Z');
  });

  it('names days in words and counts them', () => {
    expect(dayWords('2026-10-31')).toBe('Saturday 31 October');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    const days = bookableDays(NOW, settings);
    expect(days[0]).toBe('2026-10-24');
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe('2026-11-20');
  });
});

describe('a booking', () => {
  it('is offered at the start of its window less the lead time', () => {
    // Saturday morning starts at 08:00 (07:00 UTC); 90 minutes before is 05:30 UTC.
    expect(offerAtFor('2026-10-24', 'morning', settings).toISOString()).toBe(
      '2026-10-24T05:30:00.000Z',
    );
  });

  it('is for tomorrow up to 28 days ahead', () => {
    expect(
      checkSchedule(
        { deliveryDay: '2026-10-23', window: 'morning', chargePlan: 'now' },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: false });
    expect(
      checkSchedule(
        { deliveryDay: '2026-11-21', window: 'morning', chargePlan: 'now' },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('28 days') });
    expect(
      checkSchedule(
        { deliveryDay: '2026-11-20', window: 'evening', chargePlan: 'now' },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: true, chargeAt: null });
  });

  it('takes the money on or before the day, and before a Runner is sent', () => {
    const payday = checkSchedule(
      {
        deliveryDay: '2026-11-07',
        window: 'afternoon',
        chargePlan: 'scheduled',
        chargeDay: '2026-11-01',
        chargeTime: '00:05',
      },
      NOW,
      settings,
    );
    expect(payday).toMatchObject({ ok: true });
    expect(payday.ok && payday.chargeAt?.toISOString()).toBe('2026-11-01T00:05:00.000Z');

    expect(
      checkSchedule(
        {
          deliveryDay: '2026-10-31',
          window: 'morning',
          chargePlan: 'scheduled',
          chargeDay: '2026-11-01',
          chargeTime: '00:05',
        },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('on or before') });
    // On the day itself, after the offer time (06:30 for a morning in November), is too late.
    expect(
      checkSchedule(
        {
          deliveryDay: '2026-11-07',
          window: 'morning',
          chargePlan: 'scheduled',
          chargeDay: '2026-11-07',
          chargeTime: '09:00',
        },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('before 06:30') });
    expect(
      checkSchedule(
        {
          deliveryDay: '2026-11-07',
          window: 'morning',
          chargePlan: 'scheduled',
          chargeDay: '2026-10-23',
          chargeTime: '09:00',
        },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('already gone') });
  });

  it('asks for a bank transfer by the day before', () => {
    expect(
      checkSchedule(
        { deliveryDay: '2026-10-31', window: 'morning', chargePlan: 'bank' },
        NOW,
        settings,
      ),
    ).toMatchObject({ ok: true, payByDay: '2026-10-30' });
  });
});

describe('trying a payment again', () => {
  it('tries every hour up to six tries in all', () => {
    const last = new Date('2026-11-01T00:05:00.000Z');
    expect(nextChargeTry(1, last, settings)?.toISOString()).toBe('2026-11-01T01:05:00.000Z');
    expect(nextChargeTry(5, last, settings)?.toISOString()).toBe('2026-11-01T01:05:00.000Z');
    expect(nextChargeTry(6, last, settings)).toBeNull();
    expect(
      nextChargeTry(2, last, { retryEveryMinutes: 30, maxChargeTries: 3 })?.toISOString(),
    ).toBe('2026-11-01T00:35:00.000Z');
    expect(nextChargeTry(3, last, { retryEveryMinutes: 30, maxChargeTries: 3 })).toBeNull();
  });
});

describe('the words agreed to', () => {
  it('say the day, the window, when the money is taken and the till on the day', () => {
    const words = scheduleAgreementWords(
      {
        deliveryDay: '2026-11-07',
        window: 'morning',
        chargePlan: 'scheduled',
        chargeDay: '2026-11-01',
        chargeTime: '00:05',
      },
      settings,
    );
    expect(words).toContain('Delivered on Saturday 7 November, in the morning, 8:00 to 12:00.');
    expect(words).toContain('The money is taken from your card on Sunday 1 November at 00:05.');
    expect(words).toContain('if prices have gone up, the difference is taken from your card');
    expect(words).toContain('if they have gone down, it is given back');
    expect(
      scheduleAgreementWords(
        { deliveryDay: '2026-10-31', window: 'evening', chargePlan: 'bank' },
        settings,
      ),
    ).toContain('You pay by bank transfer by Friday 30 October.');
    expect(
      scheduleAgreementWords(
        { deliveryDay: '2026-10-31', window: 'evening', chargePlan: 'now' },
        settings,
      ),
    ).toContain('The money is taken from your card now.');
  });
});

describe('hearing it said', () => {
  it('hears days', () => {
    expect(parseSpokenDay('tomorrow', NOW)).toBe('2026-10-24');
    expect(parseSpokenDay('on Saturday', NOW)).toBe('2026-10-24');
    expect(parseSpokenDay('Friday', NOW)).toBe('2026-10-30');
    expect(parseSpokenDay('next week', NOW)).toBe('2026-10-30');
    expect(parseSpokenDay('in two weeks', NOW)).toBe('2026-11-06');
    expect(parseSpokenDay('in three weeks', NOW)).toBe('2026-11-13');
    expect(parseSpokenDay('on the first', NOW)).toBe('2026-11-01');
    expect(parseSpokenDay('the 1st of November', NOW)).toBe('2026-11-01');
    expect(parseSpokenDay('November the twenty-first', NOW)).toBe('2026-11-21');
    expect(parseSpokenDay('on the 30th', NOW)).toBe('2026-10-30');
    expect(parseSpokenDay('some time', NOW)).toBeNull();
  });

  it('hears times', () => {
    expect(parseSpokenTime('at five past midnight')).toBe('00:05');
    expect(parseSpokenTime('at midnight')).toBe('00:00');
    expect(parseSpokenTime('half past eight')).toBe('08:30');
    expect(parseSpokenTime('quarter to nine in the evening')).toBe('20:45');
    expect(parseSpokenTime('at 9pm')).toBe('21:00');
    expect(parseSpokenTime('at 00:05')).toBe('00:05');
    expect(parseSpokenTime('at seven')).toBe('07:00');
    expect(parseSpokenTime('on Saturday')).toBeNull();
  });

  it('hears a whole booking in one sentence', () => {
    expect(parseSpokenSchedule('deliver it on Saturday morning', NOW)).toEqual({
      deliveryDay: '2026-10-24',
      window: 'morning',
    });
    expect(
      parseSpokenSchedule(
        'deliver it next Saturday afternoon and take the money on the first at five past midnight',
        NOW,
      ),
    ).toEqual({
      deliveryDay: '2026-10-24',
      window: 'afternoon',
      chargeDay: '2026-11-01',
      chargeTime: '00:05',
    });
    expect(parseSpokenSchedule('take the money on the first at five past midnight', NOW)).toEqual({
      chargeDay: '2026-11-01',
      chargeTime: '00:05',
    });
    expect(parseSpokenSchedule('as soon as possible', NOW)).toEqual({ asap: true });
    expect(parseSpokenSchedule('take the money now', NOW)).toEqual({ chargeNow: true });
    expect(parseSpokenSchedule('I will pay by bank transfer', NOW)).toEqual({ bank: true });
  });
});

describe('the configuration', () => {
  it('reads the booking settings from config/store.json', () => {
    const config = loadStoreConfig();
    expect(config.scheduled).toMatchObject({
      maxDaysAhead: 28,
      offerLeadMinutes: 90,
      defaultChargeTime: '00:05',
      retryEveryMinutes: 60,
      maxChargeTries: 6,
    });
    expect(config.scheduled.windows.morning).toEqual({ from: '08:00', until: '12:00' });
  });

  it('refuses a window that ends before it starts, and a time that is not a time', () => {
    expect(() =>
      parseStoreConfig({
        ...rawStore(),
        scheduled: { windows: { morning: { from: '12:00', until: '08:00' } } },
      }),
    ).toThrow(/must end after it starts/);
    expect(() =>
      parseStoreConfig({ ...rawStore(), scheduled: { defaultChargeTime: '25:00' } }),
    ).toThrow(/HH:MM/);
  });
});

function rawStore(): Record<string, unknown> {
  return JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
}
