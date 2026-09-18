/**
 * Remembering who is signed in.
 *
 * The token is kept in `localStorage`, which means it survives closing the tab and does not
 * survive changing device. That is the whole of the sign-in story in this phase, and it is
 * worth being plain about why: signing back in needs a one time code sent to a phone, and
 * there is no way to send one yet. So signing up issues a session and that session is what
 * keeps a Shopper signed in. Somebody who signs up on a phone and then opens Aldilivery on
 * a laptop cannot get in, and no screen pretends otherwise.
 *
 * Every read and write is wrapped, because `localStorage` is not always there. A private
 * window, blocked site data, or a browser with storage turned off will throw on access
 * rather than return nothing, and a shop that will not load because it could not write a
 * token is a worse shop than one that forgets you.
 */

const TOKEN_KEY = 'aldilivery.session.token';

/** In-memory fallback for when storage throws. Lasts as long as the page does. */
let inMemoryToken: string | null = null;

export function readToken(): string | null {
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored !== null && stored !== '') return stored;
  } catch {
    // Storage is unavailable. Not an error worth showing anybody.
  }
  return inMemoryToken;
}

export function writeToken(token: string): void {
  inMemoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Kept in memory instead, so the session works until the page closes.
  }
}

export function clearToken(): void {
  inMemoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do. The in-memory copy is already gone, which is the part that matters.
  }
}
