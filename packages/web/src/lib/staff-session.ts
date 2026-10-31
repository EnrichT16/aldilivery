/**
 * The staff sign-in kept on this device (ruling 84, 31 October 2026: Ozi must know the owner on
 * his own phone).
 *
 * Normally kept for this browser tab only (`sessionStorage`), so closing it signs out. With
 * "Remember me on this phone" ticked, a session token (`st1.`, never the staff key itself) is
 * kept in `localStorage` instead, so the phone app stays signed in after it is closed, until the
 * session ends (`admin.staffRememberDays`) or "Sign out of this phone" is pressed.
 *
 * Every read and write is wrapped: storage may be missing in a private window, and then the
 * person simply signs in again.
 */

import { storeConfig } from '../config';

export const STAFF_KEY = 'ozidelivery.staff.key';
export const STAFF_NAME = 'ozidelivery.staff.name';
/** "1" once the server has said this session is the owner's own, with his passcode. */
export const STAFF_OWNER = 'ozidelivery.staff.owner';
/** When a remembered session ends, as milliseconds since 1970. */
export const STAFF_EXPIRES = 'ozidelivery.staff.expires';
/** Told when the staff sign-in on this device changes, so Ozi knows straight away. */
export const STAFF_SESSION_EVENT = 'ozidelivery:staff-session';

export interface StaffSessionHere {
  key: string;
  name: string;
  /** The owner's own session, as the server last said. */
  owner: boolean;
  /** Kept on this phone (localStorage) rather than for this tab. */
  remembered: boolean;
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(store: Storage | null, name: string): string {
  try {
    return store?.getItem(name) ?? '';
  } catch {
    return '';
  }
}

function clear(store: Storage | null): void {
  try {
    for (const name of [STAFF_KEY, STAFF_NAME, STAFF_OWNER, STAFF_EXPIRES]) store?.removeItem(name);
  } catch {
    // Nothing more can be done.
  }
}

function told(): void {
  try {
    window.dispatchEvent(new Event(STAFF_SESSION_EVENT));
  } catch {
    // No window: nothing is listening.
  }
}

/** The staff sign-in on this device: this tab's first, then one remembered on this phone. */
export function readStaffSession(): StaffSessionHere | null {
  const tab = storage('session');
  const key = read(tab, STAFF_KEY);
  if (key !== '') {
    return {
      key,
      name: read(tab, STAFF_NAME),
      owner: read(tab, STAFF_OWNER) === '1',
      remembered: false,
    };
  }
  const phone = storage('local');
  const kept = read(phone, STAFF_KEY);
  // Only a session token is ever remembered, never the staff key.
  if (!kept.startsWith('st1.')) {
    if (kept !== '') clear(phone);
    return null;
  }
  const expires = Number(read(phone, STAFF_EXPIRES));
  if (Number.isFinite(expires) && expires > 0 && expires <= Date.now()) {
    clear(phone);
    return null;
  }
  return {
    key: kept,
    name: read(phone, STAFF_NAME),
    owner: read(phone, STAFF_OWNER) === '1',
    remembered: true,
  };
}

/**
 * Keeps a staff sign-in: on this phone when asked and it is a session token, otherwise for
 * this tab only. The other place is cleared, so there is only ever one.
 */
export function keepStaffSession(input: {
  key: string;
  name: string;
  remember: boolean;
  /** When the server says the session ends; the configured days from now if not given. */
  expiresAt?: string | Date | null;
  owner?: boolean;
}): void {
  const onPhone = input.remember && input.key.startsWith('st1.');
  const store = storage(onPhone ? 'local' : 'session');
  clear(storage(onPhone ? 'session' : 'local'));
  try {
    store?.setItem(STAFF_KEY, input.key);
    store?.setItem(STAFF_NAME, input.name);
    if (input.owner !== undefined) store?.setItem(STAFF_OWNER, input.owner ? '1' : '0');
    if (onPhone) {
      const given = input.expiresAt ? new Date(input.expiresAt).getTime() : NaN;
      const ends = Number.isFinite(given)
        ? given
        : Date.now() + storeConfig.admin.staffRememberDays * 24 * 3_600_000;
      store?.setItem(STAFF_EXPIRES, String(ends));
    }
  } catch {
    // Private browsing: they sign in again next time.
  }
  told();
}

/** What the server said about who this is, kept with the sign-in wherever it is. */
export function markStaffSession(change: { name?: string; owner: boolean }): void {
  const here = readStaffSession();
  if (!here) return;
  const store = storage(here.remembered ? 'local' : 'session');
  try {
    store?.setItem(STAFF_OWNER, change.owner ? '1' : '0');
    if (change.name) store?.setItem(STAFF_NAME, change.name);
  } catch {
    return;
  }
  if (here.owner !== change.owner) told();
}

/** Signing out: forgotten from this tab and from this phone. */
export function forgetStaffSession(): void {
  clear(storage('session'));
  clear(storage('local'));
  told();
}
