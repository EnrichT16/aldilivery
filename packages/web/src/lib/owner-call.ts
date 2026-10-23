/**
 * Ozi ringing the owner in the app (ruling 79): the admin panel asks every few seconds whether
 * Ozi is ringing, answers, says "Not now", and keeps the owner's devices for notifications
 * against his staff account. Each choice goes to the same place the "Needs you now" page's
 * buttons go, marked as made on Ozi's call in the app.
 */

import { staffRequest } from './api';

export type DeskChoice = 'approve' | 'decline' | 'acknowledge' | 'later';

export interface OziRing {
  id: string;
  test: boolean;
  until: string | null;
  /** "Ozi is calling, Mr. Anthony." */
  words: string;
}

export interface CallMatter {
  id: string;
  summary: string;
  options: 'decide' | 'acknowledge';
  /** "Say approve, decline or later, or press 1, 2 or 3." */
  prompt: string;
  /** What Ozi says for this one: "The first. …" and the prompt. */
  spoken: string;
}

export interface AnsweredCall {
  /** "Hello, Mr. Anthony. This is Ozi. Two things need you." */
  opening: string;
  matters: CallMatter[];
  /** "That's everything. Goodbye, Mr. Anthony." */
  farewell: string;
  test: boolean;
}

export interface OwnerReach {
  notificationsOn: boolean;
  devices: number;
  phone: boolean;
  appRingSeconds: number;
}

export function fetchOziRing(key: string): Promise<{ ring: OziRing | null }> {
  return staffRequest(key, '/staff/desk/ring');
}

export function answerOziCall(key: string, id: string): Promise<AnsweredCall> {
  return staffRequest(key, `/staff/desk/ring/${encodeURIComponent(id)}/answer`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function notNowOziCall(key: string, id: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/desk/ring/${encodeURIComponent(id)}/not-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function endOziCall(key: string, id: string): Promise<{ ended: boolean }> {
  return staffRequest(key, `/staff/desk/ring/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function markMatterRead(key: string, id: string): Promise<{ read: boolean }> {
  return staffRequest(key, `/staff/desk/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** The same decision as the keypad's, made on Ozi's call in the app. */
export function decideInApp(
  key: string,
  id: string,
  choice: DeskChoice,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/desk/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ choice, via: 'app' }),
  });
}

export function testOziCall(
  key: string,
): Promise<{ message: string; inApp: boolean; phone: boolean }> {
  return staffRequest(key, '/staff/desk/test-call', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function fetchOwnerReach(key: string): Promise<OwnerReach> {
  return staffRequest(key, '/staff/desk/reach');
}

export function saveOwnerDevice(
  key: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

/**
 * What the owner said, as a choice on this matter: "yes" or "approve", "no" or "decline",
 * "later", "heard it", or the keys' own numbers. Null when it was none of them.
 */
export function heardChoice(text: string, options: CallMatter['options']): DeskChoice | null {
  const said = text.toLowerCase();
  if (/\b(later|not now|three|3)\b/.test(said)) return 'later';
  if (options === 'decide') {
    if (/\b(decline|declined|no|reject|refuse|two|2)\b/.test(said)) return 'decline';
    if (/\b(approve|approved|yes|yeah|accept|one|1)\b/.test(said)) return 'approve';
    return null;
  }
  if (/\b(heard|yes|yeah|ok|okay|approve|got it|thank you|thanks|one|1)\b/.test(said)) {
    return 'acknowledge';
  }
  return null;
}

/** The key pressed, as a choice on this matter: 1, 2 or 3, exactly as on the telephone. */
export function keyChoice(key: string, options: CallMatter['options']): DeskChoice | null {
  if (key === '1') return options === 'decide' ? 'approve' : 'acknowledge';
  if (key === '2' && options === 'decide') return 'decline';
  if (key === '3') return 'later';
  return null;
}
