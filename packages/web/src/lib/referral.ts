/**
 * The invitation a person followed: `/join?ref=R4K7Q2AB`. Kept for this visit, so it is still
 * there when they reach the sign-up form a few screens later.
 */

const KEY = 'ozidelivery.referral';

export function rememberReferral(code: string | null): void {
  if (!code || !/^[A-Za-z0-9]{4,20}$/.test(code)) return;
  try {
    window.sessionStorage.setItem(KEY, code.toUpperCase());
  } catch {
    // Private browsing: the code is simply not kept.
  }
}

export function readReferral(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
