/**
 * Rule Five: a notice is sent thirty minutes before any recurring Set order fires, with a
 * one word skip.
 *
 * The rule is not "we try to send a notice". It is that the notice is a precondition of the
 * order. So the tests that matter most here are the ones where a Set does NOT fire.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SET_NOTICE_MINUTES_BEFORE } from '@aldilivery/core';

import {
  advanceAfterFiring,
  firstFireAt,
  isSkipInstruction,
  mayFire,
  nextFireAfter,
  noticeDueAt,
  noticeIsDue,
  type ScheduledSet,
} from '../src/services/sets.js';
import { buildTestApp, seedCatalogue, signUpShopper, type SignedInShopper, type TestHarness } from './helpers.js';

const FIRE_AT = new Date('2026-09-16T09:00:00.000Z');

function scheduledSet(overrides: Partial<ScheduledSet> = {}): ScheduledSet {
  return {
    id: 'set_1',
    active: true,
    nextFireAt: FIRE_AT,
    noticeSentAt: null,
    skipRequestedForFireAt: null,
    ...overrides,
  };
}

describe('Rule Five: the thirty minute notice', () => {
  it('is due exactly thirty minutes before the order fires', () => {
    expect(noticeDueAt(FIRE_AT).toISOString()).toBe('2026-09-16T08:30:00.000Z');
    expect(SET_NOTICE_MINUTES_BEFORE).toBe(30);
  });

  it('is not due thirty one minutes beforehand', () => {
    expect(noticeIsDue(scheduledSet(), new Date('2026-09-16T08:29:00.000Z'))).toBe(false);
  });

  it('is due at the thirty minute mark', () => {
    expect(noticeIsDue(scheduledSet(), new Date('2026-09-16T08:30:00.000Z'))).toBe(true);
  });

  it('is not sent twice', () => {
    const alreadySent = scheduledSet({ noticeSentAt: new Date('2026-09-16T08:30:00.000Z') });
    expect(noticeIsDue(alreadySent, new Date('2026-09-16T08:45:00.000Z'))).toBe(false);
  });
});

describe('Rule Five: a Set may not fire without its notice', () => {
  it('refuses to fire when no notice was sent', () => {
    const decision = mayFire(scheduledSet(), FIRE_AT);
    expect(decision.mayFire).toBe(false);
    expect(decision.refusedBecause).toBe('notice_not_sent');
  });

  it('refuses to fire when the notice went out late, even by one minute', () => {
    const lateNotice = scheduledSet({ noticeSentAt: new Date('2026-09-16T08:31:00.000Z') });
    const decision = mayFire(lateNotice, FIRE_AT);
    expect(decision.mayFire).toBe(false);
    expect(decision.refusedBecause).toBe('notice_sent_too_late');
  });

  it('fires when the notice went out a full thirty minutes beforehand', () => {
    const onTime = scheduledSet({ noticeSentAt: new Date('2026-09-16T08:30:00.000Z') });
    expect(mayFire(onTime, FIRE_AT).mayFire).toBe(true);
  });

  it('fires when the notice went out earlier still', () => {
    const early = scheduledSet({ noticeSentAt: new Date('2026-09-16T07:00:00.000Z') });
    expect(mayFire(early, FIRE_AT).mayFire).toBe(true);
  });

  it('does not fire before its time', () => {
    const onTime = scheduledSet({ noticeSentAt: new Date('2026-09-16T08:30:00.000Z') });
    expect(mayFire(onTime, new Date('2026-09-16T08:59:00.000Z')).refusedBecause).toBe('not_yet_due');
  });

  it('does not fire when it has been paused', () => {
    const paused = scheduledSet({ active: false, noticeSentAt: new Date('2026-09-16T08:00:00.000Z') });
    expect(mayFire(paused, FIRE_AT).refusedBecause).toBe('not_active');
  });
});

describe('Rule Five: the one word skip', () => {
  it('accepts the word on its own', () => {
    expect(isSkipInstruction('skip', 'skip')).toBe(true);
  });

  it('does not mind capitals, spaces or a full stop', () => {
    expect(isSkipInstruction('  SKIP.  ', 'skip')).toBe(true);
    expect(isSkipInstruction('Skip', 'skip')).toBe(true);
  });

  it('does not treat a sentence as a skip', () => {
    expect(isSkipInstruction('please skip this week', 'skip')).toBe(false);
    expect(isSkipInstruction('do not skip', 'skip')).toBe(false);
  });

  it('stops the order from firing', () => {
    const skipped = scheduledSet({
      noticeSentAt: new Date('2026-09-16T08:30:00.000Z'),
      skipRequestedForFireAt: FIRE_AT,
    });
    expect(mayFire(skipped, FIRE_AT).refusedBecause).toBe('skipped_by_shopper');
  });

  it('stops only the next one, not the arrangement itself', () => {
    const skipped = scheduledSet({ skipRequestedForFireAt: FIRE_AT });
    const advanced = advanceAfterFiring(skipped, 'weekly');
    expect(advanced.skipRequestedForFireAt).toBeNull();
    expect(advanced.nextFireAt.toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });
});

describe('the schedule', () => {
  it('moves on by a week, a fortnight or a month', () => {
    expect(nextFireAfter(FIRE_AT, 'weekly').toISOString()).toBe('2026-09-23T09:00:00.000Z');
    expect(nextFireAfter(FIRE_AT, 'fortnightly').toISOString()).toBe('2026-09-30T09:00:00.000Z');
    expect(nextFireAfter(FIRE_AT, 'monthly').toISOString()).toBe('2026-10-16T09:00:00.000Z');
  });

  it('clears the notice when it moves on, so the next one needs its own notice', () => {
    const fired = scheduledSet({ noticeSentAt: new Date('2026-09-16T08:30:00.000Z') });
    expect(advanceAfterFiring(fired, 'weekly').noticeSentAt).toBeNull();
  });

  it('puts the first firing in the future, never in the past', () => {
    // Wednesday 9 September 2026, 09:00 UTC. Asking for Wednesday at 09:00 means next week.
    const from = new Date('2026-09-09T09:00:00.000Z');
    expect(firstFireAt(from, 3, '09:00').toISOString()).toBe('2026-09-16T09:00:00.000Z');
    // Asking for later the same day means today.
    expect(firstFireAt(from, 3, '17:00').toISOString()).toBe('2026-09-09T17:00:00.000Z');
  });

  it('refuses a time that is not a real time', () => {
    expect(() => firstFireAt(new Date(), 1, '25:00')).toThrow(TypeError);
    expect(() => firstFireAt(new Date(), 1, 'nine')).toThrow(TypeError);
    expect(() => firstFireAt(new Date(), 9, '09:00')).toThrow(TypeError);
  });
});

describe('the Set routes, end to end', () => {
  let harness: TestHarness;
  let shopper: SignedInShopper;
  let items: Awaited<ReturnType<typeof seedCatalogue>>;

  beforeEach(async () => {
    harness = await buildTestApp(new Date('2026-09-09T09:00:00.000Z'));
    items = await seedCatalogue(harness.repository);
    shopper = await signUpShopper(harness);
  });

  async function createWeeklySet() {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/sets',
      headers: shopper.authHeader,
      payload: {
        name: 'The usual',
        deliveryAddress: '12 Example Street',
        frequency: 'weekly',
        dayOfWeek: 3,
        timeOfDay: '09:00',
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { set: { id: string; nextFireAt: string } }).set;
  }

  it('promises the notice and the skip word when the Set is created', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/sets',
      headers: shopper.authHeader,
      payload: {
        name: 'The usual',
        deliveryAddress: '12 Example Street',
        frequency: 'weekly',
        dayOfWeek: 3,
        timeOfDay: '09:00',
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      },
    });
    expect((response.json() as { promise: string }).promise).toContain('30 minutes before');
    expect((response.json() as { promise: string }).promise).toContain('skip');
  });

  it('does not fire a Set whose notice has not gone out', async () => {
    await createWeeklySet();

    // Jump straight to the firing time without running the notice hook.
    harness.setNow(new Date('2026-09-16T09:00:00.000Z'));
    const run = await harness.app.inject({ method: 'POST', url: '/sets/run' });

    const body = run.json() as { fired: unknown[]; refused: Array<{ because: string }> };
    expect(body.fired).toHaveLength(0);
    expect(body.refused[0]?.because).toBe('notice_not_sent');
  });

  it('fires only after the notice has gone out thirty minutes beforehand', async () => {
    await createWeeklySet();

    harness.setNow(new Date('2026-09-16T08:30:00.000Z'));
    const notices = await harness.app.inject({ method: 'POST', url: '/sets/notices/run' });
    const noticeBody = notices.json() as {
      sent: number;
      notices: Array<{ message: string; skipWord: string }>;
    };
    expect(noticeBody.sent).toBe(1);
    expect(noticeBody.notices[0]?.message).toContain('30 minutes');
    expect(noticeBody.notices[0]?.message).toContain('skip');

    harness.setNow(new Date('2026-09-16T09:00:00.000Z'));
    const run = await harness.app.inject({ method: 'POST', url: '/sets/run' });
    expect((run.json() as { fired: unknown[] }).fired).toHaveLength(1);
  });

  it('does not fire a Set the Shopper skipped, and charges nothing', async () => {
    const created = await createWeeklySet();

    harness.setNow(new Date('2026-09-16T08:30:00.000Z'));
    await harness.app.inject({ method: 'POST', url: '/sets/notices/run' });

    const skip = await harness.app.inject({
      method: 'POST',
      url: `/sets/${created.id}/skip`,
      headers: shopper.authHeader,
      payload: { reply: 'skip' },
    });
    expect(skip.statusCode).toBe(200);

    harness.setNow(new Date('2026-09-16T09:00:00.000Z'));
    const run = await harness.app.inject({ method: 'POST', url: '/sets/run' });
    expect((run.json() as { fired: unknown[] }).fired).toHaveLength(0);
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('produces only a draft order when it does fire, so Rule One still applies', async () => {
    await createWeeklySet();

    harness.setNow(new Date('2026-09-16T08:30:00.000Z'));
    await harness.app.inject({ method: 'POST', url: '/sets/notices/run' });
    harness.setNow(new Date('2026-09-16T09:00:00.000Z'));
    await harness.app.inject({ method: 'POST', url: '/sets/run' });

    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe('draft');
    expect(orders[0]?.spokenConfirmationAt).toBeNull();
    expect(harness.payments.calls).toHaveLength(0);
  });

  it('refuses a reply that is not the skip word', async () => {
    const created = await createWeeklySet();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/sets/${created.id}/skip`,
      headers: shopper.authHeader,
      payload: { reply: 'not this week please' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('will not put an age restricted item into a Set either', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/sets',
      headers: shopper.authHeader,
      payload: {
        name: 'The usual',
        deliveryAddress: '12 Example Street',
        frequency: 'weekly',
        dayOfWeek: 3,
        timeOfDay: '09:00',
        lines: [{ catalogueItemId: items.wine, quantity: 1 }],
      },
    });
    expect(response.statusCode).toBe(422);
  });
});
