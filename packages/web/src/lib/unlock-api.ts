/**
 * Unlocking anybody, and resetting a PIN or a password (ruling 81): the "Locked out" list on
 * Needs you now, finding someone to unlock, and the tools themselves. Kept apart from lib/api.ts
 * so it can be read in one go; it uses the same `staffRequest`.
 */

import { staffRequest } from './api';

export type LockKind = 'shopper_pin' | 'staff_codes' | 'staff_sign_in' | 'sign_in_codes';

/** One person locked out of one thing. */
export interface LockedPerson {
  key: string;
  kind: LockKind;
  account: 'shopper' | 'runner' | 'staff';
  id: string;
  name: string;
  until: string;
  words: string;
}

/** Someone found to unlock, with what they are locked out of. Never a whole phone number. */
export type UnlockPerson =
  | {
      account: 'shopper';
      id: string;
      name: string;
      phoneEnding: string;
      hasPin: boolean;
      pinLocked: boolean;
      signInCodesLocked: boolean;
    }
  | {
      account: 'runner';
      id: string;
      name: string;
      phoneEnding: string;
      signInCodesLocked: boolean;
    }
  | {
      account: 'staff';
      id: string;
      name: string;
      isOwner: boolean;
      signInLocked: boolean;
      codesLocked: boolean;
    };

/** What a tool did, in words, and whether the person was texted. */
export interface UnlockResult {
  message: string;
  told: boolean;
  /** Only a staff password reset: the temporary password, shown once. */
  password?: string;
}

export function fetchLockedOut(key: string): Promise<{ lockedOut: LockedPerson[] }> {
  return staffRequest(key, '/staff/locked-out');
}

export function findToUnlock(key: string, search: string): Promise<{ people: UnlockPerson[] }> {
  return staffRequest(key, `/staff/unlock/find?search=${encodeURIComponent(search)}`);
}

function post(key: string, path: string): Promise<UnlockResult> {
  return staffRequest(key, path, { method: 'POST', body: JSON.stringify({}) });
}

export function unlockShopperPin(key: string, id: string): Promise<UnlockResult> {
  return post(key, `/staff/shoppers/${encodeURIComponent(id)}/pin/unlock`);
}

export function resetShopperPin(key: string, id: string): Promise<UnlockResult> {
  return post(key, `/staff/shoppers/${encodeURIComponent(id)}/pin/reset`);
}

export function unlockStaff(key: string, id: string): Promise<UnlockResult> {
  return post(key, `/staff/team/${encodeURIComponent(id)}/unlock`);
}

export function resetStaffPassword(key: string, id: string): Promise<UnlockResult> {
  return post(key, `/staff/team/${encodeURIComponent(id)}/reset`);
}

export function clearSignInCodes(
  key: string,
  account: 'shopper' | 'runner',
  id: string,
): Promise<UnlockResult> {
  return post(
    key,
    `/staff/${account === 'shopper' ? 'shoppers' : 'runners'}/${encodeURIComponent(id)}/sign-in-codes/clear`,
  );
}

/** Unlocks whatever this lock is, with the tool that fits it. */
export function unlockLocked(key: string, locked: LockedPerson): Promise<UnlockResult> {
  if (locked.kind === 'shopper_pin') return unlockShopperPin(key, locked.id);
  if (locked.kind === 'sign_in_codes' && locked.account !== 'staff') {
    return clearSignInCodes(key, locked.account, locked.id);
  }
  return unlockStaff(key, locked.id);
}

/** The owner lets a staff member unlock people, or stops it. */
export function setTeamUnlocker(
  key: string,
  id: string,
  canUnlock: boolean,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}/can-unlock`, {
    method: 'POST',
    body: JSON.stringify({ canUnlock }),
  });
}

/** "Yvette" said aloud: the locks whose person is called that, first names counting. */
export function locksNamed(spoken: string, locks: readonly LockedPerson[]): LockedPerson[] {
  const said = spoken.trim().toLowerCase();
  if (said === '') return [];
  const exact = locks.filter((lock) => lock.name.toLowerCase() === said);
  if (exact.length > 0) return exact;
  return locks.filter((lock) =>
    lock.name
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part === said || said.split(/\s+/).includes(part)),
  );
}
