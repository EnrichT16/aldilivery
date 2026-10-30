/**
 * Which Runners are on shift and could be given a job right now, shared by the offers
 * (services/dispatch.ts) and by planning a split (services/split.ts, ruling 61).
 */

import { modeTakesPart, type SplitPartMode } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, Runner } from '../domain.js';
import { canDrive } from '../routes/runner-account.js';
import { drivingPaused } from './insurance.js';
import { hasAgreed } from './runner-agreement.js';

type PoolContext = Pick<AppContext, 'repository'>;

/** A Runner with an order in one of these has a job in hand. */
export const ACTIVE_STATUSES: readonly Order['status'][] = [
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

/** Every order in hand, by the Runner carrying it (a Runner chaining jobs may have two). */
export async function activeOrdersByRunner(ctx: PoolContext): Promise<Map<string, Order[]>> {
  const byRunner = new Map<string, Order[]>();
  for (const status of ACTIVE_STATUSES) {
    for (const active of await ctx.repository.orders.listByStatus(status)) {
      if (!active.runnerId) continue;
      const rows = byRunner.get(active.runnerId) ?? [];
      rows.push(active);
      byRunner.set(active.runnerId, rows);
    }
  }
  return byRunner;
}

/** The Runners who have a job in hand: one pair of hands and one bag. */
export async function runnersWithJobInHand(ctx: PoolContext): Promise<Set<string>> {
  return new Set((await activeOrdersByRunner(ctx)).keys());
}

/**
 * On shift and allowed to be offered a job: checked, the face photo accepted (Anthony, 30 October
 * 2026: the Runner agreement says nobody is offered a job until every check has passed), the
 * Runner agreement agreed (ruling 55), not left, not the demo Runner, and not driving while their
 * insurance is paused (ruling 14).
 */
export function mayBeOffered(runner: Runner, at: Date): boolean {
  return (
    runner.available &&
    checksPassed(runner) &&
    !runner.isDemo &&
    hasAgreed(runner) &&
    !runner.leftAt &&
    !drivingPaused(runner, at)
  );
}

/** Every check a person makes before any job: right to work, DBS, and the face photo. */
export function checksPassed(
  runner: Pick<
    Runner,
    'rightToWorkVerified' | 'criminalRecordCheckVerified' | 'facePhotoAcceptedAt'
  >,
): boolean {
  return (
    runner.rightToWorkVerified &&
    runner.criminalRecordCheckVerified &&
    runner.facePhotoAcceptedAt !== null
  );
}

/** Whether this Runner may take a split part of this kind (ruling 61), licence included. */
export function takesPart(runner: Runner, part: SplitPartMode, at: Date): boolean {
  if (!modeTakesPart(runner.vehicleType, part)) return false;
  return part === 'foot' || canDrive(runner, at);
}

/**
 * How many Runners of each kind are on shift, free and could take a part right now (ruling 61).
 * Motorbike riders are counted for planning motorbike parts; a car or van Runner may also take a
 * motorbike part when offered one, but is not counted: they were offered the whole order already.
 */
export async function freeRunnersByPartMode(
  ctx: PoolContext,
  at: Date,
): Promise<Record<SplitPartMode, number>> {
  const busy = await runnersWithJobInHand(ctx);
  const free = (await ctx.repository.runners.listAvailable()).filter(
    (runner) => !busy.has(runner.id) && mayBeOffered(runner, at),
  );
  return {
    motorbike: free.filter((runner) => runner.vehicleType === 'motorbike' && canDrive(runner, at))
      .length,
    foot: free.filter((runner) => takesPart(runner, 'foot', at)).length,
  };
}
