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

/** The Runners who have a job in hand: one pair of hands and one bag. */
export async function runnersWithJobInHand(ctx: PoolContext): Promise<Set<string>> {
  const busy = new Set<string>();
  for (const status of ACTIVE_STATUSES) {
    for (const active of await ctx.repository.orders.listByStatus(status)) {
      if (active.runnerId) busy.add(active.runnerId);
    }
  }
  return busy;
}

/**
 * On shift and allowed to be offered a job: checked, the Runner agreement agreed (ruling 55), not
 * left, not the demo Runner, and not driving while their insurance is paused (ruling 14).
 */
export function mayBeOffered(runner: Runner, at: Date): boolean {
  return (
    runner.available &&
    runner.rightToWorkVerified &&
    runner.criminalRecordCheckVerified &&
    !runner.isDemo &&
    hasAgreed(runner) &&
    !runner.leftAt &&
    !drivingPaused(runner, at)
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
