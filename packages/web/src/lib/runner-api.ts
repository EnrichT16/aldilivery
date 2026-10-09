/**
 * The Runner's safety, money and leaving, and the staff side of them (Section M; rulings 12, 14
 * and 16). Kept apart from lib/api.ts so it can be read in one go; it uses the same `request`.
 */

import { request, staffRequest } from './api';

/* ------------------------------------------------------------------ SOS */

export interface Whereabouts {
  latitude: number;
  longitude: number;
  accuracyMetres?: number;
}

export interface SosState {
  id: string;
  on: boolean;
  startedAt: string;
  endedAt: string | null;
  located: boolean;
  locationAt: string | null;
  alerted: boolean;
}

export function pressSos(
  location: Whereabouts | null,
): Promise<{ sos: SosState; call999: string; message: string }> {
  return request(
    '/runners/me/sos',
    { method: 'POST', body: JSON.stringify(location ? { location } : {}) },
    'runner',
  );
}

export function sendSosLocation(location: Whereabouts): Promise<{ sos: SosState }> {
  return request(
    '/runners/me/sos/location',
    { method: 'POST', body: JSON.stringify(location) },
    'runner',
  );
}

export function fetchSos(): Promise<{ sos: SosState | null; call999: string }> {
  return request('/runners/me/sos', undefined, 'runner');
}

export function endMySos(): Promise<{ sos: SosState | null; message: string }> {
  return request('/runners/me/sos/end', { method: 'POST', body: '{}' }, 'runner');
}

/* ------------------------------------------------------------------ payouts */

export interface InstantQuote {
  availablePence: number;
  feePence: number;
  youGetPence: number;
  possible: boolean;
  words: string;
}

export interface PayoutScheduleInfo {
  schedule: 'weekly' | 'daily';
  words: string;
  controls: string;
  instant: InstantQuote;
}

export function fetchPayoutSchedule(): Promise<PayoutScheduleInfo> {
  return request('/runners/me/payout-schedule', undefined, 'runner');
}

export function choosePayoutSchedule(
  schedule: 'weekly' | 'daily',
): Promise<{ schedule: 'weekly' | 'daily'; words: string; message: string }> {
  return request(
    '/runners/me/payout-schedule',
    { method: 'POST', body: JSON.stringify({ schedule }) },
    'runner',
  );
}

export function takeInstantPayout(youGetPence: number): Promise<{ message: string }> {
  return request(
    '/runners/me/payouts/instant',
    { method: 'POST', body: JSON.stringify({ youGetPence }) },
    'runner',
  );
}

/* ------------------------------------------------------------------ leaving */

export function leaveRunning(): Promise<{ left: true; message: string }> {
  return request(
    '/runners/me/leave',
    { method: 'POST', body: JSON.stringify({ confirm: true }) },
    'runner',
  );
}

/* ------------------------------------------------------------------ staff */

export interface StaffSos extends SosState {
  runner: { name: string; runnerId: string; phone: string } | null;
  reference: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMetres: number | null;
  mapsLink: string | null;
  endedBy: string | null;
  alertProblem: string | null;
}

export function fetchStaffSos(key: string): Promise<{ sos: StaffSos[] }> {
  return staffRequest(key, '/staff/sos');
}

export function endStaffSos(key: string, id: string, by: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/sos/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    body: JSON.stringify({ by }),
  });
}

export interface ReferrerTally {
  referrer: string;
  kind: 'shopper' | 'runner';
  name: string;
  joined: number;
  counted: number;
  notYet: number;
  excluded: { self: number; sameCard: number; sameAddress: number };
  cardsChecked: boolean;
  rewardsEarned: number;
  rewardsGiven: number;
  due: boolean;
}

export function fetchReferrals(
  key: string,
): Promise<{ rewardPence: number; needed: number; referrers: ReferrerTally[] }> {
  return staffRequest(key, '/staff/referrals');
}

export function giveReferralReward(
  key: string,
  referrer: string,
  by: string,
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/referrals/reward', {
    method: 'POST',
    body: JSON.stringify({ referrer, by }),
  });
}

export function removeRunner(
  key: string,
  runner: string,
  by: string,
  reason: string,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/runners/${encodeURIComponent(runner)}/remove`, {
    method: 'POST',
    body: JSON.stringify({ by, reason }),
  });
}

export interface WaitingDeposit {
  id: string;
  name: string;
  runnerId: string;
  leftAt: string;
  heldPence: number;
  owedPence: number;
  note: string | null;
}

export function fetchWaitingDeposits(key: string): Promise<{ deposits: WaitingDeposit[] }> {
  return staffRequest(key, '/staff/runners/deposits');
}

export function decideRunnerDeposit(
  key: string,
  id: string,
  decision: { by: string; keepPence: number; note: string },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/runners/${encodeURIComponent(id)}/deposit`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

/* ------------------------------------------------------------------ maps */

export type TravelMode = 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van';

/** Whether this looks like an iPhone or iPad, whose own maps app opens Apple Maps links. */
export function isApplePhone(userAgent: string = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || /Macintosh.*Mobile/i.test(userAgent);
}

/**
 * A link that opens the phone's maps app with directions to a place, from wherever the Runner
 * is: Apple Maps on an iPhone, Google Maps everywhere else. Both are universal links, so they
 * open the app when it is there and the maps website when it is not.
 */
export function directionsLink(destination: string, mode: TravelMode, apple: boolean): string {
  const place = encodeURIComponent(destination);
  if (apple) {
    const flag = mode === 'on_foot' ? 'w' : 'd';
    return `https://maps.apple.com/?daddr=${place}&dirflg=${flag}`;
  }
  const travel = mode === 'on_foot' ? 'walking' : mode === 'bicycle' ? 'bicycling' : 'driving';
  return `https://www.google.com/maps/dir/?api=1&destination=${place}&travelmode=${travel}`;
}
