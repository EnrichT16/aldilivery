/**
 * Recurring orders, which the product calls a Set.
 *
 * Rule Five: a notice goes out thirty minutes before a Set fires, and the Shopper can stop
 * it with one word. The point of the rule is that nobody is ever charged for groceries they
 * did not know were coming. So the notice is not a courtesy message sent alongside the
 * order; it is a precondition. `mayFire` refuses any Set whose notice did not go out in
 * time, and the scheduler has no other way to fire one.
 *
 * Everything here is pure. The current time is always passed in.
 */

import { SET_NOTICE_MINUTES_BEFORE } from '@aldilivery/core';

import type { SetFrequency } from '../domain.js';

export interface ScheduledSet {
  id: string;
  active: boolean;
  nextFireAt: Date;
  noticeSentAt: Date | null;
  skipRequestedForFireAt: Date | null;
}

const MINUTE_MS = 60_000;

/** The moment the notice for a given firing is due. */
export function noticeDueAt(fireAt: Date, minutesBefore: number = SET_NOTICE_MINUTES_BEFORE): Date {
  return new Date(fireAt.getTime() - minutesBefore * MINUTE_MS);
}

/** True once it is time to send the notice and the notice has not already gone. */
export function noticeIsDue(
  set: ScheduledSet,
  now: Date,
  minutesBefore: number = SET_NOTICE_MINUTES_BEFORE,
): boolean {
  if (!set.active) return false;
  if (set.noticeSentAt !== null) return false;
  if (isSkipped(set)) return false;
  return now.getTime() >= noticeDueAt(set.nextFireAt, minutesBefore).getTime();
}

/** True when the Shopper has said the skip word for the firing that is next due. */
export function isSkipped(set: ScheduledSet): boolean {
  return (
    set.skipRequestedForFireAt !== null &&
    set.skipRequestedForFireAt.getTime() === set.nextFireAt.getTime()
  );
}

export type FireRefusal =
  | 'not_active'
  | 'not_yet_due'
  | 'skipped_by_shopper'
  | 'notice_not_sent'
  | 'notice_sent_too_late';

export interface FireDecision {
  mayFire: boolean;
  refusedBecause?: FireRefusal;
}

/**
 * May this Set fire now?
 *
 * The notice check is the one that matters. It is not enough that a notice was sent; it
 * must have been sent at least the full notice period before the firing time. A notice
 * that went out five minutes beforehand does not give a Shopper thirty minutes to say the
 * skip word, so the Set does not fire and the Shopper is not charged.
 */
export function mayFire(
  set: ScheduledSet,
  now: Date,
  minutesBefore: number = SET_NOTICE_MINUTES_BEFORE,
): FireDecision {
  if (!set.active) return { mayFire: false, refusedBecause: 'not_active' };
  if (now.getTime() < set.nextFireAt.getTime()) {
    return { mayFire: false, refusedBecause: 'not_yet_due' };
  }
  if (isSkipped(set)) return { mayFire: false, refusedBecause: 'skipped_by_shopper' };
  if (set.noticeSentAt === null) return { mayFire: false, refusedBecause: 'notice_not_sent' };

  const deadline = noticeDueAt(set.nextFireAt, minutesBefore);
  if (set.noticeSentAt.getTime() > deadline.getTime()) {
    return { mayFire: false, refusedBecause: 'notice_sent_too_late' };
  }

  return { mayFire: true };
}

/**
 * Does what the Shopper replied count as the skip word?
 *
 * Generous on purpose. Case is ignored, surrounding spaces and a full stop are ignored, so
 * "Skip", "skip." and " SKIP " all stop the order. It must still be one word: anything
 * longer is a conversation, not a skip, and is not treated as one.
 */
export function isSkipInstruction(reply: string, skipWord: string): boolean {
  const cleaned = reply.trim().replace(/[.!,]+$/, '').toLowerCase();
  return cleaned === skipWord.trim().toLowerCase();
}

/** The firing after this one. */
export function nextFireAfter(current: Date, frequency: SetFrequency): Date {
  const next = new Date(current.getTime());
  switch (frequency) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'fortnightly':
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    default: {
      const exhaustive: never = frequency;
      throw new Error(`Unknown Set frequency: ${String(exhaustive)}`);
    }
  }
}

/**
 * The state a Set moves to once a firing is dealt with, whether it fired or was skipped.
 * The notice flag is cleared so the next occurrence needs its own notice.
 */
export function advanceAfterFiring(
  set: ScheduledSet,
  frequency: SetFrequency,
): Pick<ScheduledSet, 'nextFireAt' | 'noticeSentAt' | 'skipRequestedForFireAt'> {
  return {
    nextFireAt: nextFireAfter(set.nextFireAt, frequency),
    noticeSentAt: null,
    skipRequestedForFireAt: null,
  };
}

/**
 * The first firing time for a new Set: the next occurrence of the requested day and time,
 * strictly in the future.
 *
 * `dayOfWeek` is 1 for Monday through 7 for Sunday, and `timeOfDay` is "HH:MM".
 */
export function firstFireAt(from: Date, dayOfWeek: number, timeOfDay: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(timeOfDay);
  if (!match) {
    throw new TypeError(`A time of day must look like "09:30", received "${timeOfDay}".`);
  }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    throw new TypeError(`A day of week must be 1 (Monday) through 7 (Sunday), received ${dayOfWeek}.`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new TypeError(`"${timeOfDay}" is not a real time of day.`);
  }

  const candidate = new Date(from.getTime());
  candidate.setUTCHours(hours, minutes, 0, 0);

  // getUTCDay is 0 for Sunday; the product counts 1 for Monday through 7 for Sunday.
  const currentDay = candidate.getUTCDay() === 0 ? 7 : candidate.getUTCDay();
  let daysAhead = (dayOfWeek - currentDay + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= from.getTime()) {
    daysAhead = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  return candidate;
}
