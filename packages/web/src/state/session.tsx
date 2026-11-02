import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { fetchMe, type Shopper } from '../lib/api';
import { clearToken, readToken, writeToken } from '../lib/session';
import { confirmedSignedOut, useGentleRefresh } from '../lib/session-guard';

interface SessionValue {
  /** The signed-in Shopper, or null. */
  shopper: Shopper | null;
  /** True until the stored token has been checked, so screens do not flash "signed out". */
  restoring: boolean;
  /** Called after signing up, with what the server handed back. */
  signedUp: (token: string, shopper: Shopper) => void;
  /** Called after a code checks out: keeps the token and fetches who it belongs to. */
  signedIn: (token: string) => Promise<void>;
  /** Local only: there is no server-side session to end. */
  signOut: () => void;
  /** Keeps the cached Shopper in step after an edit, without another round trip. */
  replaceShopper: (shopper: Shopper) => void;
  /**
   * Asks the server again who is signed in, after an order is placed, so the monthly order
   * count (ruling 73) and anything else the order changed stay as the server has them.
   */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Who is signed in, for the whole app.
 *
 * On opening, if there is a stored token it is checked against the server once, because a
 * token that has expired or been signed with a since-changed secret is worse than no token:
 * every screen would look signed in and every action would fail. If the check says no, the
 * token is thrown away quietly.
 *
 * A server that cannot be reached, or that fails, is treated differently from a server that
 * refuses the sign-in itself (ruling 88). Only `session_invalid`, said twice ten seconds apart,
 * clears the token: a 404, a 429, a 500 or no answer keeps it, because it is probably still
 * good, and the screens have their own plain sentence for not being able to reach us. Throwing
 * a session away because the network hiccupped would sign people out for no reason. And every
 * "me" reply may carry a fresh token, kept here, so a sign-in in use never runs out.
 */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [shopper, setShopper] = useState<Shopper | null>(null);
  const [restoring, setRestoring] = useState(readToken() !== null);

  useEffect(() => {
    if (readToken() === null) return;

    let cancelled = false;
    void (async () => {
      try {
        const me = await fetchMe();
        if (!cancelled && me.shopper) setShopper(me.shopper);
      } catch (error) {
        // Down, or failing, is not the same as refused. Only the server's own word that this
        // sign-in has ended, said twice, clears the token (ruling 88).
        if (!cancelled && (await confirmedSignedOut(error, fetchMe)) && !cancelled) clearToken();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signedUp = useCallback((token: string, next: Shopper) => {
    writeToken(token);
    setShopper(next);
    setRestoring(false);
  }, []);

  const signedIn = useCallback(async (token: string) => {
    writeToken(token);
    const me = await fetchMe();
    if (me.shopper) setShopper(me.shopper);
    setRestoring(false);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setShopper(null);
  }, []);

  const refresh = useCallback(async () => {
    if (readToken() === null) return;
    try {
      const me = await fetchMe();
      if (me.shopper) setShopper(me.shopper);
    } catch {
      // Kept as it was: the server checks the price again before anything is charged.
    }
  }, []);

  // Coming back to the screen, and once an hour while open, asks "me" again, so a sign-in in use
  // is renewed before it ends (ruling 88). Never signs anybody out.
  useGentleRefresh(shopper ? refresh : null);

  const value = useMemo<SessionValue>(
    () => ({
      shopper,
      restoring,
      signedUp,
      signedIn,
      signOut,
      replaceShopper: setShopper,
      refresh,
    }),
    [shopper, restoring, signedUp, signedIn, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The session where there is one, or null (a screen rendered without the provider). */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession was used outside a SessionProvider.');
  return value;
}
