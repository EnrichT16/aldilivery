/**
 * Never signed out while using the app (ruling 88, 2 November 2026, Anthony: no Runner, Shopper,
 * staff, organisation or owner is ever signed out while using the app).
 *
 * A Runner was signed out on his phone within minutes. His page forgot its token on any refusal
 * whose words mentioned signing in, and the server's everyday 401 does: so one passing refusal,
 * of any kind, ended his shift. From now on only the server's own word that the sign-in itself
 * has ended (`session_invalid`, on a 401) may make a screen forget a token, and even that is
 * believed only when it is said twice in a row, ten seconds apart, in case of a brief clock or
 * deploy hiccup. A 403, a 404, a 429, a 500 or no answer at all never signs anybody out: the
 * screen shows its plain problem sentence and tries again.
 */

import { useEffect, useRef } from 'react';

import { ApiError } from './api';

/** The server's own word that this sign-in has ended, and nothing else. */
export function isSessionInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.details?.['code'] === 'session_invalid'
  );
}

/**
 * How long to wait before asking again. Settable, so a test need not wait ten real seconds.
 */
export const secondLook = { ms: 10_000 };

/**
 * Whether a refusal really is the end of the sign-in: only when it is `session_invalid`, and the
 * server says the same again after a pause. Anything else, a passing failure included, is false.
 */
export async function confirmedSignedOut(
  first: unknown,
  again: () => Promise<unknown>,
): Promise<boolean> {
  if (!isSessionInvalid(first)) return false;
  await new Promise((resolve) => {
    window.setTimeout(resolve, secondLook.ms);
  });
  try {
    await again();
    return false;
  } catch (second) {
    return isSessionInvalid(second);
  }
}

/**
 * Counts refusals of the sign-in on a page that asks the server over and over, such as the
 * Runner's. `shouldSignOut` is true only on the second `session_invalid` in a row; any other
 * outcome, success included, starts the count again.
 */
export class SignOutGuard {
  private strikes = 0;

  shouldSignOut(error: unknown): boolean {
    if (!isSessionInvalid(error)) {
      this.strikes = 0;
      return false;
    }
    this.strikes += 1;
    return this.strikes >= 2;
  }

  /** A good answer: the sign-in is fine. */
  reset(): void {
    this.strikes = 0;
  }
}

/** How often, at most, a screen asks "me" again just to keep its sign-in fresh. */
export const GENTLE_REFRESH_MS = 60 * 60_000;

/**
 * Asks the server "me" again when the screen comes back into view, and at most once an hour
 * while it stays open, so a sign-in in use renews itself before it ends. `ask` must never
 * throw into the page: failures are its own to swallow.
 */
export function useGentleRefresh(ask: (() => Promise<void>) | null): void {
  const lastAsked = useRef(Date.now());
  useEffect(() => {
    if (!ask) return undefined;
    const due = (): void => {
      if (Date.now() - lastAsked.current < GENTLE_REFRESH_MS) return;
      lastAsked.current = Date.now();
      void ask();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') due();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(due, GENTLE_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [ask]);
}
