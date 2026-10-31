import { phraseFingerprint, phraseWithoutName } from '@aldilivery/core';

import { storeConfig } from '../config';
import { askOzi, businessToken, fetchKnownPhrases, type OziAsker } from '../lib/api';
import { currentAsker } from '../lib/ozi-asker';
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
/**
 * How long Ozi waits for a sentence said to it by name, which the server may answer with the
 * language model (31 October 2026): about 8 seconds, and 20 for the owner (ruling 86), whose
 * model thinks first and may look things up; after about 3 seconds he hears "One moment, Mr.
 * Anthony." "One moment" shows meanwhile; too long, and Ozi goes on as before.
 */
export const CONVERSE_WAIT_MS = 8000;
export const OWNER_CONVERSE_WAIT_MS = 20_000;

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
  /** Whoever is signed in on this device (ruling 84): the owner is known on any page. */
  as: OziAsker = currentAsker(),
  /** How long to wait for a sentence looked within; the conversation's own wait by default. */
  waitMs: number = CONVERSE_WAIT_MS,
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
    mode === 'within' ? waitMs : WAIT_MS,
    null,
  );
}

/**
 * Whether the whole sentence is one of this account's everyday phrases, known at once from the
 * fingerprints, without asking for an answer (ruling 84: the owner's and staff's answers come
 * from the conversation, so a phrase only says it was meant for Ozi). False when unsure.
 */
export async function isKnownPhrase(text: string, as: OziAsker): Promise<boolean> {
  const fingerprints = await withTimeout(knownFor(as), WAIT_MS, null);
  if (!fingerprints) return false;
  const said = phraseWithoutName(text, NAMES);
  return said !== '' && fingerprints.has(phraseFingerprint(said));
}

/**
 * The whole answer to a sentence said to Ozi (31 October 2026): the reply, and whether a decision
 * was read back and waits for a yes (the owner's desk, Rule One). Null when the server was slow.
 */
export function converse(
  text: string,
  turn: number,
  as: OziAsker,
  waitMs: number = CONVERSE_WAIT_MS,
): Promise<{ reply: string | null; awaitingYes?: boolean } | null> {
  return withTimeout(
    askOzi(text, 'within', turn, as).then(({ reply, awaitingYes }) =>
      awaitingYes ? { reply, awaitingYes } : { reply },
    ),
    waitMs,
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
  /** Shows "One moment" while a sentence said to Ozi is answered (31 October 2026). */
  think: (work: Promise<string | null>) => Promise<string | null> = (work) => work,
): void {
  const named = nameHeardIn(text);
  void (async () => {
    const reply =
      (await phraseReply(text, turn.current, 'exact', as)) ??
      (named ? await think(phraseReply(text, turn.current, 'within', as)) : null);
    if (reply) {
      turn.current += 1;
      say(reply);
    } else if (named) {
      say(notUnderstood);
    }
  })();
}
