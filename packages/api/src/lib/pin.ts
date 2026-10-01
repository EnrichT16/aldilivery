/**
 * The Shopper's four-digit PIN (docs/BUILD_PROMPT.md, Section D).
 *
 * It guards saving an address and changing the registered home address. It can be typed or
 * spoken, so it is four digits and nothing else. Obvious PINs are refused: the same digit four
 * times, a run up or down, and four-digit years — a birth year or the year it is.
 *
 * Only a hash is kept: scrypt over the PIN with a salt of its own and the server's secret. Four
 * digits are only ten thousand possibilities, so the real protection is the lockout, enforced
 * on the server: three wrong tries in a row, and the PIN cannot be tried again for a while.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Wrong tries in a row before the PIN locks. */
export const PIN_ATTEMPTS = 3;
/** How long a locked PIN stays locked. */
export const PIN_LOCK_MINUTES = 15;

/** Why a PIN cannot be used, in words for the Shopper, or null when it is fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'A PIN is four numbers, like 2 7 5 9.';
  const digits = pin.split('').map(Number);
  if (digits.every((digit) => digit === digits[0])) {
    return 'That PIN is the same number four times, which is easy to guess. Please choose another.';
  }
  const steps = digits.slice(1).map((digit, i) => digit - (digits[i] as number));
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) {
    return 'That PIN is a run of numbers, which is easy to guess. Please choose another.';
  }
  const asNumber = Number(pin);
  if (asNumber >= 1900 && asNumber <= 2099) {
    return 'That PIN looks like a year, which is easy to guess. Please choose another.';
  }
  return null;
}

export function hashPin(pin: string, secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(`${pin}:${secret}`, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function pinMatches(pin: string, stored: string, secret: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(`${pin}:${secret}`, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
