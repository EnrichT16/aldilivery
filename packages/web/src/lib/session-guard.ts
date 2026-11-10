/**
 * Never signed out while using the app (ruling 88, 2 November 2026, Anthony: no Runner, Shopper,
 * staff, organisation or owner is ever signed out while using the app).
 *
 * A Runner was signed out on his phone within minutes. His page forgot its token on any refusal
 * whose words mentioned signing in, and the server's everyday 401 does: so one passing refusal,
 * of any kind, ended his shift. From now on only the server's own word that the sign-in itself
 * has ended (`session_invalid`, on a 401) may make a screen forget a token, and even that is
 * believed only when it is said twice in a row, in case of a brief clock or deploy hiccup. A 403,
 * a 404, a 429, a 500 or no answer at all never signs anybody out: the screen shows its plain
 * problem sentence and tries again.
 *
 * The one rule, kept here and nowhere else (10 November 2026, ruling 100). The Runner's page asks
 * every five seconds, so "twice in a row" was only five seconds apart, and a server restarting
 * for a release could say it twice in that time. Now a token is forgotten only when:
 *   1. the server says `session_invalid`;
 *   2. it says so again at least twenty seconds later (`STRIKE_GAP.ms`); and
 *   3. one direct question, "me", asked there and then, is refused with `session_invalid` too.
 * A good answer anywhere along the way starts again from nothing. The Shopper's, the staff's and
 * the business screens use the same wait through `confirmedSignedOut`, whose second look is that
 * direct question.
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
 * How far apart two refusals must be before the second is believed: longer than a server takes
 * to restart for a release. Settable, so a test need not wait twenty real seconds.
 */
export const STRIKE_GAP = { ms: 20_000 };

/**
 * How long to wait before asking again: the same gap, under the name the single-question screens
 * have always used. Settable, so a test need not wait.
 */
export const secondLook = { ms: STRIKE_GAP.ms };

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
 * Runner's. `shouldSignOut` is true only when a `session_invalid` comes at least twenty seconds
 * after the first one, with nothing good in between, and the direct question `confirm` (the
 * page's own "me") is refused with `session_invalid` as well. Any other outcome, success
 * included, starts the count again; a `confirm` that gets no answer at all keeps the sign-in and
 * is asked again on the next refusal.
 */
export class SignOutGuard {
  /** When the first refusal of this run was heard; null when there is none. */
  private firstStrikeAt: number | null = null;
  private confirming = false;

  async shouldSignOut(error: unknown, confirm: () => Promise<unknown>): Promise<boolean> {
    if (!isSessionInvalid(error)) {
      this.firstStrikeAt = null;
      return false;
    }
    const now = Date.now();
    if (this.firstStrikeAt === null) {
      this.firstStrikeAt = now;
      return false;
    }
    // Too soon after the first: a restart can say it twice in a few seconds.
    if (now - this.firstStrikeAt < STRIKE_GAP.ms) return false;
    // One direct question at a time.
    if (this.confirming) return false;
    this.confirming = true;
    try {
      await confirm();
      // The sign-in is fine after all.
      this.firstStrikeAt = null;
      return false;
    } catch (answer) {
      return isSessionInvalid(answer);
    } finally {
      this.confirming = false;
    }
  }

  /** A good answer: the sign-in is fine. */
  reset(): void {
    this.firstStrikeAt = null;
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
