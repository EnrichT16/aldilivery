/**
 * Insurance reminders for Runners who drive (2 October proposals, approved in ruling 14).
 *
 * A car or motorbike needs insurance that covers delivery work, checked by a person, and its
 * last day is kept on the Runner's account (`motorInsuranceUntil`). Before it runs out the Runner
 * is reminded, `runners.insuranceReminderDays` before (30, 7 and 1 by default), by a text to their
 * own phone and on their Runner page, where the insurance row comes back in Your documents so a
 * new certificate can be photographed. Each reminder goes once for each expiry date: a new date,
 * accepted by a person, starts the reminders again.
 *
 * Once it has run out, jobs by car or motorbike are paused: none is offered (services/dispatch.ts)
 * or can be taken, and a Runner on shift by car or motorbike is taken off shift and told. Walking
 * and cycling carry on as before. Driving starts again when a person accepts a new certificate.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Runner } from '../domain.js';
import { MOTOR_MODES, canDrive } from '../routes/runner-account.js';

type InsuranceContext = Pick<AppContext, 'repository' | 'config' | 'now' | 'sendText'>;

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/** Whole days from today to the insurance's last day: 0 on the last day, below 0 once run out. */
export function insuranceDaysLeft(until: Date, at: Date): number {
  return Math.round((startOfDay(until) - startOfDay(at)) / DAY);
}

/** Whether this Runner ever drives for us, so insurance matters to them at all. */
export function drives(runner: Runner): boolean {
  return runner.travelModes.some((mode) => MOTOR_MODES.includes(mode));
}

/** Jobs by car or motorbike are paused: they are set to drive, and may not today. */
export function drivingPaused(runner: Runner, at: Date): boolean {
  return MOTOR_MODES.includes(runner.vehicleType) && !canDrive(runner, at);
}

/**
 * The reminder due now, if any: one of the configured days before, or 0 once it has run out.
 * Null when nothing is due, or it has already been sent for this expiry date.
 */
export function reminderDue(runner: Runner, at: Date, days: readonly number[]): number | null {
  if (runner.leftAt || !drives(runner) || !runner.motorInsuranceUntil) return null;
  const left = insuranceDaysLeft(runner.motorInsuranceUntil, at);
  const sameExpiry =
    runner.insuranceReminderFor !== null &&
    runner.insuranceReminderFor.getTime() === runner.motorInsuranceUntil.getTime();
  const sent = sameExpiry ? runner.insuranceReminderDays : null;
  let due: number | null;
  if (left < 0) {
    due = 0;
  } else {
    const fitting = [...days].sort((a, b) => a - b).find((day) => left <= day);
    due = fitting ?? null;
  }
  if (due === null) return null;
  if (sent !== null && sent <= due) return null;
  return due;
}

function dayWords(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function reminderText(productName: string, runner: Runner, due: number, at: Date): string {
  const until = runner.motorInsuranceUntil as Date;
  if (due === 0) {
    return `${productName}: your motor insurance ran out on ${dayWords(until)}. Jobs by car or motorbike are paused until we have checked a new certificate. You can still deliver walking or by bicycle. Send a photo of the new one from your Runner page, under More, Your documents.`;
  }
  const left = insuranceDaysLeft(until, at);
  const when =
    left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days, on ${dayWords(until)}`;
  return `${productName}: your motor insurance runs out ${when}. Please send a photo of your new certificate from your Runner page, under More, Your documents, so you can keep delivering by car or motorbike.`;
}

/** What the Runner page says about their insurance, or null when it is not worth saying. */
export function insuranceNotice(
  runner: Runner,
  at: Date,
  days: readonly number[],
): { until: Date; daysLeft: number; paused: boolean; words: string } | null {
  if (!drives(runner) || !runner.motorInsuranceUntil) return null;
  const left = insuranceDaysLeft(runner.motorInsuranceUntil, at);
  const furthest = Math.max(...days, 0);
  if (left > furthest) return null;
  const paused = left < 0;
  const words = paused
    ? 'Your motor insurance has run out. Jobs by car or motorbike are paused until we have checked a new certificate. You can still deliver walking or by bicycle.'
    : `Your motor insurance runs out ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}. Please send a photo of the new certificate under More, Your documents.`;
  return { until: runner.motorInsuranceUntil, daysLeft: left, paused, words };
}

/** Whether a new insurance certificate is wanted: soon to run out, or run out. */
export function insuranceRenewalDue(runner: Runner, at: Date, days: readonly number[]): boolean {
  return insuranceNotice(runner, at, days) !== null;
}

/**
 * Send the reminders due, and pause driving for anyone whose insurance has run out. Run by the
 * server every hour; each Runner on their own, so one failed text does not stop the rest. A
 * reminder that could not be texted is still recorded, and is on their Runner page either way.
 */
export async function sweepInsuranceReminders(
  ctx: InsuranceContext,
  log?: FastifyBaseLogger,
): Promise<number> {
  const at = ctx.now();
  const days = ctx.config.runners.insuranceReminderDays;
  let sent = 0;
  for (const runner of await ctx.repository.runners.listAll()) {
    const due = reminderDue(runner, at, days);
    if (due === null) continue;
    try {
      if (ctx.sendText) {
        await ctx.sendText(runner.phone, reminderText(ctx.config.productName, runner, due, at));
      }
    } catch (failure) {
      log?.warn(
        { err: failure, runnerId: runner.id },
        'An insurance reminder could not be texted.',
      );
    }
    await ctx.repository.runners.update(runner.id, {
      insuranceReminderFor: runner.motorInsuranceUntil,
      insuranceReminderDays: due,
      // Run out while on shift by car or motorbike: off shift, until they switch or renew.
      ...(due === 0 && runner.available && drivingPaused(runner, at) ? { available: false } : {}),
    });
    sent += 1;
  }
  return sent;
}
