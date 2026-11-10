import { ASKS_THE_TIME, phraseFingerprint, phraseWithoutName } from '@aldilivery/core';

import { storeConfig } from '../config';
import {
  askOzi,
  askOziStream,
  businessToken,
  fetchKnownPhrases,
  StreamUnavailableError,
  type OziAsker,
  type OziStreamHandlers,
} from '../lib/api';
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
 * model thinks first and may look things up. "One moment" shows meanwhile, and after
 * `ozi.fillerAfterMs` of silence a short filler is said (ruling 92); too long, and Ozi goes on
 * as before. The reply itself arrives a sentence at a time and is spoken as it comes.
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

/** One turn's answer: the reply, whether a yes is awaited, and what is still to be said. */
export interface Conversed {
  reply: string | null;
  awaitingYes?: boolean;
  /**
   * The part of the reply not yet spoken (ruling 92): the whole reply when it came in one piece,
   * what followed the last streamed sentence otherwise, or '' when every sentence was heard.
   */
  unsaid: string;
}

/**
 * The whole answer to a sentence said to Ozi (31 October 2026): the reply, and whether a decision
 * was read back and waits for a yes (the owner's desk, Rule One). Null when the server was slow.
 *
 * With `handlers` (ruling 92) the reply is streamed and each sentence handed over as it arrives,
 * so it can be spoken at once; if the stream cannot be had, or the browser cannot read one, the
 * plain request is made instead and the whole reply comes back as `unsaid`.
 */
export function converse(
  text: string,
  turn: number,
  as: OziAsker,
  waitMs: number = CONVERSE_WAIT_MS,
  handlers?: OziStreamHandlers,
): Promise<Conversed | null> {
  const plain = (): Promise<Conversed> =>
    askOzi(text, 'within', turn, as).then(({ reply, awaitingYes }) => ({
      reply,
      ...(awaitingYes ? { awaitingYes: true } : {}),
      unsaid: reply ?? '',
    }));
  const streamed = (): Promise<Conversed> => {
    if (!handlers) return plain();
    let began = false;
    const watched: OziStreamHandlers = {
      onSentence: (sentence) => {
        began = true;
        handlers.onSentence(sentence);
      },
      onStatus: (status) => {
        began = true;
        handlers.onStatus(status);
      },
    };
    return askOziStream(text, turn, as, watched).then(
      ({ reply, awaitingYes, unsaid }) => ({
        reply,
        ...(awaitingYes ? { awaitingYes: true } : {}),
        unsaid,
      }),
      // No stream could be started: ask the plain way, once. A refusal, or a stream cut off
      // part way, is the answer there is.
      (failure: unknown) =>
        !began && failure instanceof StreamUnavailableError ? plain() : Promise.reject(failure),
    );
  };
  return withTimeout(streamed(), waitMs, null);
}

/**
 * For a page with its own voice commands, when what was said was none of them: an everyday
 * phrase for this account if it is one, otherwise `notUnderstood`, but only if Ozi was called
 * by name, so Ozi does not talk back to the television.
 */
/**
 * The real conversation (ruling 99, 10 November 2026), set by Ozi itself: a page with its own
 * voice commands hands what it does not know to it first, and falls back to the everyday phrases
 * only when it cannot answer. `open` is whether the conversation is under way, so Ozi's name
 * need not be said again.
 */
export interface TalkFirst {
  open: () => boolean;
  talk: (text: string) => Promise<boolean>;
}
let talkFirst: TalkFirst | null = null;
export function setTalkFirst(hook: TalkFirst | null): void {
  talkFirst = hook;
}

/** "Remind me…", "my reminders", "cancel my reminder": words for the server's reminders (ruling 93). */
export const ASKS_REMINDER =
  /\b(?:remind me|set (?:me )?(?:a|an|up a) reminder|reminder (?:for|to|that|about)|my reminders|(?:list|read|show) (?:my |the )?reminders|(?:cancel|delete|remove|forget) (?:my |the |that |all (?:my |the )?)?reminders?)\b/i;

export function everydayOr(
  text: string,
  turn: { current: number },
  as: OziAsker,
  say: (words: string) => void,
  notUnderstood: string,
  /** Shows "One moment" while a sentence said to Ozi is answered (31 October 2026). */
  think: (work: Promise<string | null>) => Promise<string | null> = (work) => work,
  /**
   * Asks a question and takes the next words as its answer (ruling 93): a reminder read back
   * waits for the yes this way. Without it, the read-back is said and the yes is the next turn.
   */
  listenFor?: (question: string, then: (answer: string) => void) => void,
): void {
  const named = nameHeardIn(text);
  // The conversation first (ruling 99): said to Ozi, or while the conversation is open.
  const hook = talkFirst;
  if (hook && (named || hook.open())) {
    void think(hook.talk(text).then((answered) => (answered ? 'answered' : null))).then(
      (answered) => {
        if (!answered) everydayOlder(text, turn, as, say, notUnderstood, think, listenFor, named);
      },
    );
    return;
  }
  everydayOlder(text, turn, as, say, notUnderstood, think, listenFor, named);
}

/** The everyday phrases, as before the conversation: what answers when the model cannot. */
function everydayOlder(
  text: string,
  turn: { current: number },
  as: OziAsker,
  say: (words: string) => void,
  notUnderstood: string,
  think: (work: Promise<string | null>) => Promise<string | null>,
  listenFor: ((question: string, then: (answer: string) => void) => void) | undefined,
  named: boolean,
): void {
  // A reminder, the time or the date (ruling 93): the server reads a reminder back and sets it
  // only on the yes, which goes straight back to it.
  if (ASKS_REMINDER.test(text) || ASKS_THE_TIME.test(phraseWithoutName(text, NAMES))) {
    void (async () => {
      const answer = await converse(text, turn.current, as);
      turn.current += 1;
      if (!answer?.reply) {
        say("Sorry, I couldn't do that just now. Please say it again in a moment.");
        return;
      }
      if (answer.awaitingYes && listenFor) {
        listenFor(answer.reply, (yes) => {
          void converse(yes, turn.current, as).then((outcome) => {
            turn.current += 1;
            if (outcome?.reply) say(outcome.reply);
          });
        });
        return;
      }
      say(answer.reply);
    })();
    return;
  }
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
