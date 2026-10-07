import { phraseFingerprint, phraseWithoutName } from '@aldilivery/core';

import { storeConfig } from '../config';
import { askOzi, businessToken, fetchKnownPhrases, type OziAsker } from '../lib/api';
import { nameHeardIn } from './name';

/**
 * Ozi's everyday phrases (rulings 34 and 44): what Ozi says to "thank you", "who are you",
 * "how much is delivery" and thousands more. The collections are kept on the server, one for
 * each kind of account, and never sent to the app (Anthony, 7 October 2026: nobody should be
 * able to read them, himself included). The app sends what was heard and gets one reply back.
 *
 * Only used when nothing about an order or the basket was meant, and only when the whole
 * sentence is one of the phrases, or Ozi was called by name. So a television saying "thank you"
 * mid-sentence is not answered.
 */

/** How long Ozi waits for the server before going on without an everyday reply. */
const WAIT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

const NAMES = {
  product: storeConfig.productName,
  assistant: storeConfig.assistantName,
  heardAs: storeConfig.assistantHeardAs,
};

/** The fingerprints for each account, fetched once a visit. */
const known = new Map<string, Promise<Set<string> | null>>();

function knownFor(as: OziAsker): Promise<Set<string> | null> {
  const key =
    as.kind === 'staff'
      ? `staff:${as.key}`
      : as.kind === 'business'
        ? `business:${businessToken()}`
        : as.kind;
  let found = known.get(key);
  if (!found) {
    found = fetchKnownPhrases(as)
      .then(({ fingerprints }) => {
        // No list (an older server): ask the server every time, as before.
        if (!Array.isArray(fingerprints)) throw new Error('no fingerprints');
        return new Set(fingerprints);
      })
      .catch(() => {
        known.delete(key);
        return null;
      });
    known.set(key, found);
  }
  return found;
}

/** Forgets the fingerprints, after a sign-in or a sign-out. For tests too. */
export function forgetKnownPhrases(): void {
  known.clear();
}

/**
 * A reply, if the words are an everyday phrase for whoever is signed in. `exact`: the whole
 * sentence, apart from Ozi's name, is one of them; the app knows at once, from fingerprints,
 * when it cannot be, and does not ask the server at all (ruling 49), so an order is never kept
 * waiting. `within`: one of them, or enough of its keywords, is in a sentence said to Ozi by
 * name. Null when it is not a phrase, or the server is slow or cannot be reached, so a phrase
 * can never stand in the way of an order.
 */
export async function phraseReply(
  text: string,
  turn: number,
  mode: 'exact' | 'within',
  as: OziAsker = { kind: 'shopper' },
): Promise<string | null> {
  if (mode === 'exact') {
    const fingerprints = await withTimeout(knownFor(as), WAIT_MS, null);
    if (fingerprints) {
      const said = phraseWithoutName(text, NAMES);
      if (said === '' || !fingerprints.has(phraseFingerprint(said))) return null;
    }
  }
  return withTimeout(
    askOzi(text, mode, turn, as).then(({ reply }) => reply),
    WAIT_MS,
    null,
  );
}

/**
 * For a page with its own voice commands, when what was said was none of them: an everyday
 * phrase for this account if it is one, otherwise `notUnderstood`, but only if Ozi was called
 * by name, so Ozi does not talk back to the television.
 */
export function everydayOr(
  text: string,
  turn: { current: number },
  as: OziAsker,
  say: (words: string) => void,
  notUnderstood: string,
): void {
  const named = nameHeardIn(text);
  void (async () => {
    const reply =
      (await phraseReply(text, turn.current, 'exact', as)) ??
      (named ? await phraseReply(text, turn.current, 'within', as) : null);
    if (reply) {
      turn.current += 1;
      say(reply);
    } else if (named) {
      say(notUnderstood);
    }
  })();
}
