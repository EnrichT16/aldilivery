import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiUnavailableError, fetchMe, type Shopper } from '../lib/api';
import { clearToken, readToken, writeToken } from '../lib/session';

interface SessionValue {
  /** The signed-in Shopper, or null. */
  shopper: Shopper | null;
  /** True until the stored token has been checked, so screens do not flash "signed out". */
  restoring: boolean;
  /** Called after signing up, with what the server handed back. */
  signedUp: (token: string, shopper: Shopper) => void;
  /** Local only: there is no server-side session to end. */
  signOut: () => void;
  /** Keeps the cached Shopper in step after an edit, without another round trip. */
  replaceShopper: (shopper: Shopper) => void;
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
 * A server that cannot be reached is treated differently from a server that says no. If
 * Aldilivery is simply down we keep the token, because it is probably still good, and the
 * screens have their own plain sentence for not being able to reach us. Throwing a session
 * away because the network hiccupped would sign people out for no reason.
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
        // Down is not the same as refused. Only a refusal clears the token.
        if (!cancelled && !(error instanceof ApiUnavailableError)) clearToken();
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

  const signOut = useCallback(() => {
    clearToken();
    setShopper(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ shopper, restoring, signedUp, signOut, replaceShopper: setShopper }),
    [shopper, restoring, signedUp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession was used outside a SessionProvider.');
  return value;
}
