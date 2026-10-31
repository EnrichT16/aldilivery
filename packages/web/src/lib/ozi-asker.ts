/**
 * Who is talking to Ozi on this device (ruling 84, 31 October 2026): one answer, used by every
 * request to Ozi, so the server knows the owner wherever he taps to talk, the shop's home page
 * included. The server still decides from the credentials alone; this only chooses which
 * credentials go with the words.
 *
 * A staff sign-in (this tab's, or one remembered on this phone) first, then a shop or an
 * organisation, then a Runner, and otherwise a Shopper (signed in or not).
 */

import { storeConfig } from '../config';
import { businessToken, type OziAsker } from './api';
import { readRunnerToken } from './session';
import { readStaffSession } from './staff-session';

export function currentAsker(): OziAsker {
  const staff = readStaffSession();
  if (staff) return { kind: 'staff', key: staff.key };
  if (businessToken() !== '') return { kind: 'business' };
  if (readRunnerToken() !== null) return { kind: 'runner' };
  return { kind: 'shopper' };
}

/** Somebody Ozi knows on this device: the owner, or staff by first name. Null for anybody else. */
export function knownHere(): { kind: 'owner' | 'staff'; firstName: string | null } | null {
  const staff = readStaffSession();
  if (!staff) return null;
  if (staff.owner) return { kind: 'owner', firstName: null };
  const first = staff.name.trim().split(/\s+/)[0] ?? '';
  return { kind: 'staff', firstName: first === '' ? null : first };
}

/** The names Ozi's own words use for somebody it knows, all from configuration. */
export const KNOWN_NAMES = {
  product: storeConfig.productName,
  assistant: storeConfig.assistantName,
  heardAs: storeConfig.assistantHeardAs,
  spokenName: storeConfig.owner.spokenName,
};
