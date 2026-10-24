/**
 * Sending jobs straight to a chosen Runner, outside the queue (ruling 80): the admin panel's
 * "Allocate jobs" view and Ozi's voice commands for it, and a Runner allowing notifications for a
 * job the office sends. Kept apart from lib/api.ts so it can be read in one go; it uses the same
 * `request`.
 */

import { request, staffRequest } from './api';

/** An order waiting or offered, numbered as the view shows it and as Ozi says it. */
export interface AllocatableOrder {
  number: number;
  id: string;
  reference: string;
  status: string;
  statusWords: string;
  itemCount: number;
  goodsEstimatePence: number;
  area: string | null;
  waitingSince: string;
  /** "Saturday 24 October, in the afternoon, 12:00 to 17:00", for a booked order. */
  booked: string | null;
  /** Booked for later today: held for the Runner until its offer time unless sent early. */
  bookedLater: boolean;
  offerAt: string | null;
  largeWords: string | null;
  split: string | null;
  sentTo: { runnerId: string; runnerName: string | null; status: string; by: string } | null;
}

/** An approved Runner, with how many jobs they hold and how they travel. */
export interface AllocatableRunner {
  id: string;
  name: string;
  firstName: string;
  onShift: boolean;
  travel: string;
  travelWords: string;
  jobsInHand: number;
  offersOpen: number;
  queued: number;
  holds: number;
}

/** Something the office sent lately, and what became of it. */
export interface RecentAllocation {
  id: string;
  orderId: string;
  reference: string | null;
  runnerName: string;
  backupName: string | null;
  by: string;
  at: string;
  status: string;
  words: string;
}

export interface AllocateBoard {
  holdMinutes: number;
  orders: AllocatableOrder[];
  runners: AllocatableRunner[];
  recent: RecentAllocation[];
}

export interface Assignment {
  orderId: string;
  runnerId: string;
  backupRunnerId?: string;
  allowEarly?: boolean;
}

export interface AssignmentResult {
  orderId: string;
  reference: string | null;
  runnerId: string;
  runnerName: string | null;
  result: 'allocated' | 'refused';
  state?: 'offered' | 'queued';
  place?: number;
  reason?: string;
}

export interface AllocateOutcome {
  allocated: number;
  refused: number;
  results: AssignmentResult[];
  /** The results in one breath: "4 orders sent to Tomasz; 1 could not be: …". */
  message: string;
}

export function fetchAllocateBoard(key: string): Promise<AllocateBoard> {
  return staffRequest(key, '/staff/allocate');
}

export function allocateJobs(key: string, assignments: Assignment[]): Promise<AllocateOutcome> {
  return staffRequest(key, '/staff/orders/allocate', {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });
}

/** The owner lets a staff member send jobs straight to Runners, or stops it (ruling 80). */
export function setTeamAllocator(
  key: string,
  id: string,
  canAllocate: boolean,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ canAllocate }),
  });
}

/** "Tell me when the office sends me a job": this device, for the Runner signed in. */
export function saveRunnerPushSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ message: string }> {
  return request(
    '/runners/me/push-subscriptions',
    { method: 'POST', body: JSON.stringify(subscription) },
    'runner',
  );
}

export function removeRunnerPushSubscription(endpoint: string): Promise<{ message: string }> {
  return request(
    '/runners/me/push-subscriptions',
    { method: 'DELETE', body: JSON.stringify({ endpoint }) },
    'runner',
  );
}

/** A Runner named in what was said: a whole first name, or the start of a full name. */
export function runnerNamed(
  said: string,
  runners: readonly AllocatableRunner[],
): AllocatableRunner | null {
  const name = said.trim().toLowerCase();
  if (name === '') return null;
  return (
    runners.find((runner) => runner.firstName.toLowerCase() === name) ??
    runners.find((runner) => runner.name.toLowerCase() === name) ??
    runners.find((runner) => runner.name.toLowerCase().startsWith(name)) ??
    null
  );
}
