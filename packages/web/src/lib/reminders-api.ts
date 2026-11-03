/**
 * Reminders for everyone (Anthony, 3 November 2026, ruling 93): one account's reminders, setting
 * one, cancelling one and "I've heard it". Kept apart from lib/api.ts so it can be read in one
 * go; it uses the same `request`.
 *
 * A Shopper and a Runner are asked with their own sign-in; a Shop Partner and an organisation with
 * their business sign-in; staff and the owner with the admin panel's. The server decides whose
 * reminders from the credentials alone.
 */

import { businessToken, request, staffRequest } from './api';

/** Which sign-in asks. */
export type RemindersAs = 'shopper' | 'runner' | 'business' | { kind: 'staff'; key: string };

export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReminderChannel = 'notification' | 'text' | 'call';

export interface ReminderRow {
  id: string;
  text: string;
  dueAt: string;
  /** "tomorrow at 10 in the morning", from the server, in UK time. */
  whenWords: string;
  repeat: ReminderRepeat;
  channel: ReminderChannel;
  status: 'scheduled' | 'sent' | 'heard' | 'cancelled';
  sentAt: string | null;
  heardAt: string | null;
}

export interface RemindersPage {
  reminders: ReminderRow[];
  /** Whether this account may have a reminder by phone call: a paid plan, or the company. */
  callAllowed: boolean;
  /** Said kindly when a call is not allowed: which plan brings it. Never a price. */
  callPlanWords: string | null;
  channels: ReminderChannel[];
  repeats: ReminderRepeat[];
  maxTextLength: number;
  maxPerAccount: number;
}

function ask<T>(as: RemindersAs, path: string, init?: RequestInit): Promise<T> {
  if (typeof as === 'object') return staffRequest<T>(as.key, path, init);
  if (as === 'business') {
    return request<T>(path, { ...init, headers: { 'x-business-token': businessToken() } });
  }
  return request<T>(path, init, as);
}

export function fetchReminders(as: RemindersAs): Promise<RemindersPage> {
  return ask(as, '/reminders');
}

export function createReminder(
  as: RemindersAs,
  input: { text: string; dueAt: string; repeat: ReminderRepeat; channel: ReminderChannel },
): Promise<{ reminder: ReminderRow; message: string }> {
  return ask(as, '/reminders', { method: 'POST', body: JSON.stringify(input) });
}

export function cancelReminder(
  as: RemindersAs,
  id: string,
): Promise<{ reminder: ReminderRow; message: string }> {
  return ask(as, `/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function markReminderHeard(as: RemindersAs, id: string): Promise<{ reminder: ReminderRow }> {
  return ask(as, `/reminders/${encodeURIComponent(id)}/heard`, { method: 'POST', body: '{}' });
}
