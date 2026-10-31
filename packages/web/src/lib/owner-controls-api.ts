/**
 * The owner's own controls (ruling 85, 31 October 2026): every staff account with its sign-in
 * and rough place, the on and off switches, and how Ozi reaches him. The owner's alone.
 */

import { staffRequest } from './api';

export interface OwnerStaffEntry {
  id: string;
  name: string;
  role: string;
  title: string;
  isOwner: boolean;
  active: boolean;
  signedInNow: boolean;
  lastSeenAt: string | null;
  /** A town or a country, or "place not known". */
  place: string;
  device: string | null;
}

export function fetchOwnerStaff(key: string): Promise<{ staff: OwnerStaffEntry[] }> {
  return staffRequest(key, '/staff/owner/staff');
}

export function switchStaffAccount(
  key: string,
  id: string,
  on: boolean,
): Promise<{ message: string; staff: OwnerStaffEntry[] }> {
  return staffRequest(key, `/staff/owner/staff/${encodeURIComponent(id)}/switch`, {
    method: 'POST',
    body: JSON.stringify({ on }),
  });
}

export function switchAllStaffOff(
  key: string,
): Promise<{ message: string; count: number; staff: OwnerStaffEntry[] }> {
  return staffRequest(key, '/staff/owner/staff/switch-all-off', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export type AlertWay = 'call' | 'text' | 'notification' | 'none';
export type AlertKind = 'urgentSafety' | 'importantEmail' | 'otherEmail' | 'approvals' | 'money';

export interface OwnerAlerts {
  ways: Record<AlertKind, AlertWay>;
  quietFrom: string;
  quietUntil: string;
  kinds: Array<{ kind: AlertKind; label: string; way: AlertWay; fixed: boolean }>;
  choices: Array<{ way: AlertWay; label: string }>;
}

export function fetchOwnerAlerts(key: string): Promise<OwnerAlerts> {
  return staffRequest(key, '/staff/owner/alerts');
}

export function saveOwnerAlerts(
  key: string,
  changes: Partial<Record<Exclude<AlertKind, 'urgentSafety'>, AlertWay>> & {
    quietFrom?: string;
    quietUntil?: string;
  },
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/owner/alerts', {
    method: 'POST',
    body: JSON.stringify(changes),
  });
}
