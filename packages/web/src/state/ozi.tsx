import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { inPairs, pairsAloud } from '../lib/phone-aloud';
import {
  cancelPlan,
  closeAccount,
  fetchMyOrder,
  fetchMyOrders,
  fetchWeeklyShops,
  isUkMobileNumber,
  skipWeeklyShop,
  listPaymentMethods,
  requestSignInCode,
  verifySignInCode,
  type Shopper,
} from '../lib/api';
import { addNamedItems, currentOffers, listInWords } from '../lib/extras';
import { CLOSE_QUESTION, leaveRunning } from '../lib/runner-api';
import {
  ALLOW_LINE,
  currentBrowser,
  deniedMessage,
  serviceOffMessage,
  tapToTalkLabel,
  unsupportedMessage,
  type BrowserFacts,
} from '../voice/microphone-help';
import { nameHeardIn, onlyName } from '../voice/name';
import { phraseReply } from '../voice/phrases';
import { answerShoppingQuestion, orderWhere } from '../voice/shopping-questions';
import { useBasket } from './basket';
import type { SpeakOutcome } from '../voice';
import { useSession } from './session';
import { spokenDigits } from './voice-sign-up';
import { useVoiceOrdering } from './voice-order';
import { useVoice } from './voice';

/**
 * Ozi, present on every screen: introducing itself, listening, muted, and reminding.
 *
 * Asked for by Anthony on 1 Oct 2026 (docs/BUILD_PROMPT.md, rulings):
 * - On the very first launch Ozi speaks, loud and clear, with no notification: it introduces
 *   itself, says how to pause it, how to bring it back, how to turn its voice off in Settings,
 *   and that its button can be moved.
 * - A big round green button glows while Ozi is listening. Pressing it, or saying "Ozi, mute",
 *   mutes Ozi; pressing it again brings Ozi back.
 * - While muted, Ozi gives a gentle reminder after two minutes, again three minutes later, and
 *   every three minutes after that, so nobody thinks Ozi is listening when it is not.
 *
 * Muted means not listening at all. "Hey Ozi" can only wake a muted Ozi with an engine that
 * hears the wake word on the device and nothing else (`wakeWordOnDevice`). The browser
 * stand-in cannot, so with it the button brings Ozi back, and Ozi says so.
 *
 * What Ozi hears goes to the voice ordering conversation (`voice-order.ts`).
 */

export type Presence =
  /** Working out whether Ozi can listen here. */
  | 'starting'
  | 'listening'
  | 'muted'
  /**
   * Ozi is ready to listen, and waiting for a tap to start (ruling 62): the first listening of
   * a visit must come from a tap, or a browser refuses the microphone without asking.
   */
  | 'needs-tap'
  /** This phone or browser cannot listen; Ozi can still speak. */
  | 'cannot-listen';

/** A note about the microphone, shown in its own place on the page, never over anything. */
export interface MicNote {
  kind: 'denied' | 'service-off' | 'unsupported';
  text: string;
}

/** Our telephone number from config, or null while it is still a placeholder. */
function ourTelephone(): string | null {
  const { contact } = storeConfig;
  return contact.telephoneIsPlaceholder ? null : contact.telephonePlaceholder;
}

/** The motto (Anthony, 4 October 2026; changed 10 October 2026, ruling 60): "Send me, I will deliver." */
const MOTTO = storeConfig.motto;

/** "Turn off", "turn off talking", "turn the talking switch off", "stop talking". */
const TURN_OFF =
  /\b(turn|switch)\s+(yourself\s+|your\s+voice\s+|the\s+voice\s+|the\s+button\s+|the\s+switch\s+|it\s+|talking\s+|speaking\s+|(the\s+)?talking\s+switch\s+)?off\b|\b(turn|switch)\s+off\s+(the\s+)?(talking|speaking|voice|read aloud)\b|\bstop talking\b/;

/** "Hey Ozi, turn on", "turn talking back on", "speak aloud", "talk out loud". */
const TURN_ON =
  /\b(turn|switch)\s+(yourself\s+|your\s+voice\s+|the\s+voice\s+|talking\s+|speaking\s+|it\s+)?(back\s+)?on\b|\b(turn|switch)\s+on\s+(the\s+)?(talking|speaking|voice)\b|\b(speak|talk|read)\s+(out\s+)?(loud|aloud)\b/;

/** "Create my account", "open an account", "start opening an account", "sign me up". */
const CREATE_ACCOUNT =
  /\b(create|make|open|opening|set up|start)\s+((my|an|a|a new)\s+)?account\b|\bstart\s+(opening|creating)\b|\bsign me up\b|\bsign up\b|\bregister me\b/;

/** "Sign in", "log in", "I've got an account", "existing account" (ruling 47). */
const SIGN_IN =
  /\b(sign|log)\s*(me\s+)?in(to)?\b|\bexisting account\b|\b(i'?ve|i have|i already have)\s+(got\s+)?an account\b/;

/** "What are the door words?", "the safe word", "who's coming to the door?" (T6). */
const DOOR_WORD =
  /\b(door|safe|secret)\s*words?\b|\bwho('?s| is) (coming|at the door|knocking)\b|\bwhat will (my|the) runner say\b/;

/** "Close my Runner account", "stop being a Runner" (ruling 60). */
const CLOSE_RUNNER_ACCOUNT =
  /\b(close|delete|cancel|remove|end)\s+(my\s+)?runner\s+account\b|\bstop\s+being\s+a\s+runner\b/;

/** "Close my account", "delete my account". */
const CLOSE_ACCOUNT = /\b(close|delete|cancel|remove)\s+(my|this)\s+account\b/;
/** "Cancel my membership", "stop my plan", "end my subscription" (ruling 58). */
const CANCEL_PLAN =
  /\b(cancel|stop|end)\b.{0,12}\b(membership|plan|subscription|plus|family and carer)\b/i;

/** The one word that stops the next regular order (Rule Five), said on its own. */
const SKIP_WORD = storeConfig.recurringOrders.skipWord;

/** "Sign me out", "log out". */
const SIGN_OUT = /\b(sign|log)\s+(me\s+)?out\b/;

/** "Change account", "switch my account", "use a different account". */
const CHANGE_ACCOUNT =
  /\b(change|switch)\s+(my\s+|the\s+)?account\b|\b(different|another)\s+account\b/;

/** "Repeat", "say that again", "come again", "pardon", "I beg your pardon". */
const REPEAT =
  /\b(repeat(?!\s+(my|the|that|last)\b)|say (that|it) again|come again|pardon|what did you say|didn'?t (hear|catch)|once more|one more time)\b/;

/** "Same as last time", "order the same again", "my usual": the last order's shopping again. */
const REORDER =
  /\bsame as (last|the last) (time|week|order)\b|\b(order|get|do)\s+(it|that|the same|my shopping|the same shopping)\s+again\b|\bmy usual\b|\brepeat\s+(my|the|that|last)\s+(last\s+)?(order|shop|shopping)\b|\border again\b/;

/** "What can I cook?", "show me the recipes". */
const RECIPES =
  /\brecipes?\b|\bwhat (can|could|shall|should) i (cook|make)\b|\bsomething to cook\b/;

/** "Ozi Finds It", "I can't find it anywhere", "something hard to find". */
const FIND_IT =
  /\bfinds? it\b|\bhard to find\b|\bcan'?t find (it|that|one|them)? ?anywhere\b|\blook in other shops\b|\btrack (it|something|one) down\b/;

/** "A gift card", "gift voucher". */
const GIFT_CARD = /\bgift ?(cards?|vouchers?)\b/;

/** "Ozi Plus", "membership", "the family plan". Not "milk plus bread". */
const PLUS = /\b(ozi|ozzy|ozzie|osi|ozie) plus\b|\bmembership\b|\bfamily plan\b/;

/** "Any offers?", "special offers", "deals". */
const OFFERS =
  /\b(any|special|the|what)\s+(offers?|deals?|discounts?)\b|\boffers? (today|this week|on)\b/;

/** "My weekly shop", "the same day every week". */
const WEEKLY = /\bweekly shop\b|\b(same day|shop) every week\b|\bbook (a|my) (regular|weekly)\b/;

/** "I need a gift", "a present for my wife". */
const GIFTS = /\b(gift|gifts|present|presents)\b(?!\s+(bag|card))/;

/** "What's your phone number?", "can I ring you", "the number to call". */
const PHONE =
  /\b(phone|telephone)\s+number\b|\bnumber\s+to\s+(call|ring)\b|\b(call|ring|phone)\s+(you|the number|someone|a person)\b/;

/** Answers to "Hey Ozi" on its own, taken in turn. */
const HERE = [
  "I'm here. How can I help?",
  "Yes, I'm listening. What would you like?",
  "I'm here. What can I get for you?",
];

/** Different ways of saying it again, taken in turn, so a repeat never sounds like a recording. */
const REPEAT_OPENINGS = [
  'Of course. I said: ',
  'Sure, here it is again. ',
  "No problem, I'll say that again. ",
  'Okay, once more. ',
];

function isYes(text: string): boolean {
  return (
    /\b(yes|yeah|yep|please|ok|okay|sure|repeat|again|pardon)\b/i.test(text) &&
    !/\bno\b/i.test(text)
  );
}

/** When the gentle reminders come while Ozi is muted. Exported for the tests. */
export const FIRST_REMINDER_MS = 2 * 60 * 1000;
export const LATER_REMINDER_MS = 3 * 60 * 1000;

interface OziValue {
  presence: Presence;
  /** Ozi is saying something right now. */
  talking: boolean;
  /** The last thing Ozi said, always shown on the screen. */
  said: string;
  /** Whether the screen should announce `said`: when it was not spoken aloud. */
  announce: boolean;
  /** The last thing Ozi heard. */
  heard: string;
  /** Say something as Ozi: shown, spoken unless muted, announced when not spoken. */
  say: (text: string) => Promise<SpeakOutcome>;
  /** Press of the button: mute when listening, listen when muted, stop when talking. */
  press: () => void;
  mute: () => void;
  wake: () => void;
  /**
   * Hand the next thing Ozi hears to `handler` instead of answering it, after saying
   * `prompt`: for a PIN said aloud. What is heard this way is never shown or kept. Returns a
   * function that cancels it.
   */
  listenFor: (prompt: string, handler: (text: string) => void) => () => void;
  /** Ozi's voice and listening are on: the switch at the bottom of the screen. */
  voiceOn: boolean;
  /** The switch: off is silent and not listening, with the words still on the screen. */
  setVoiceOn: (on: boolean) => void;
  /**
   * The browser would not let Ozi speak before the page was touched: the first touch anywhere
   * will start the introduction. The page says so in big letters meanwhile.
   */
  waitingForTouch: boolean;
  /**
   * A page's own spoken commands, such as the admin panel's "read me the complaints". Tried
   * before anything about shopping; returns true when it has dealt with what was said. Pass
   * null to stop. Only one page at a time.
   */
  setPageCommands: (handler: ((text: string) => boolean) | null) => void;
  /** "Would you like to create an account, or sign in?" (ruling 47), after `lead` if given. */
  offerAccount: (lead?: string) => void;
  /**
   * The tap that starts listening (ruling 62). Asks for the microphone in the same moment, so
   * the browser shows its own "Allow microphone?" question. Call it straight from a click.
   */
  tapToTalk: () => void;
  /** What went wrong with the microphone, and what to tap, until closed. */
  micNote: MicNote | null;
  dismissMicNote: () => void;
  /**
   * What Ozi is saying is already shown in its own place on the page (the tap button, or a
   * microphone note), so the words beside Ozi's button stay out of the way of the form.
   */
  captionOff: boolean;
  /** The browser in hand: an iPhone, Android, or inside another app. */
  browser: BrowserFacts;
}

const OziContext = createContext<OziValue | null>(null);

export function OziProvider({ children }: { children: ReactNode }): JSX.Element {
  const voice = useVoice();
  const { engine, settings } = voice;
  const navigate = useNavigate();
  const location = useLocation();
  const assistant = storeConfig.assistantName;

  const [presence, setPresenceState] = useState<Presence>('starting');
  const [talking, setTalking] = useState(false);
  const [said, setSaid] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [heard, setHeard] = useState('');
  const [waitingForTouch, setWaitingForTouch] = useState(false);
  const [micNote, setMicNote] = useState<MicNote | null>(null);
  const [captionOff, setCaptionOff] = useState(false);
  const browser = useMemo(() => currentBrowser(), []);
  // Whether listening may start without a tap: false until the microphone has been allowed
  // once this visit, when the engine says the first listening needs one (ruling 62).
  const micReady = useRef(true);
  // Why Ozi cannot listen: no recognition at all, or the microphone refused after a tap.
  const cannotReason = useRef<MicNote | null>(null);

  const presenceRef = useRef<Presence>('starting');
  const talkingRef = useRef(false);
  const listeningNow = useRef(false);
  const reminderTimer = useRef<number | null>(null);
  // How long to wait before listening again after a failure, growing so a lost connection is
  // not retried four times a second for ever. Back to normal after a clean turn.
  const retryDelay = useRef(250);
  const remindersGiven = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const setPresence = useCallback((next: Presence) => {
    presenceRef.current = next;
    setPresenceState(next);
  }, []);

  const wakeHint = engine.wakeWordOnDevice ? `, or say "Hey ${assistant}"` : '';

  /* ------------------------------------------------------------------ listening */

  // Declared before use through a ref, because listening and speaking call each other.
  const listenRef = useRef<(fromTap?: boolean) => void>(() => {});
  const tapLine = `${tapToTalkLabel(assistant)}. ${ALLOW_LINE}`;
  const heardRef = useRef<(text: string) => void>(() => {});

  const stopListening = useCallback(() => {
    if (listeningNow.current) {
      listeningNow.current = false;
      engine.stopListening();
    }
  }, [engine]);

  /** A microphone note: said by Ozi, and shown in its own place on the page. */
  const showNote = (note: MicNote): void => {
    cannotReason.current = note;
    setMicNote(note);
    void sayRef.current(note.text, true);
  };

  /**
   * Ozi wants to listen, but the microphone has not been allowed yet this visit: show the big
   * "Tap to talk" button, and say what will happen, once, if the page can make a sound yet.
   */
  const askForTap = (): void => {
    setPresence('needs-tap');
    const canBeHeard = touched.current || soundWorks.current;
    if (canBeHeard && !talkingRef.current && lastSaid.current !== tapLine) {
      void sayRef.current(tapLine, true);
    }
  };

  listenRef.current = (fromTap = false) => {
    const state = presenceRef.current;
    if (listeningNow.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!fromTap) {
      if (talkingRef.current) return;
      if (state === 'needs-tap') {
        askForTap();
        return;
      }
      if (state !== 'listening') return;
    }
    if (!fromTap && !micReady.current) {
      askForTap();
      return;
    }
    if (fromTap) setPresence('listening');
    listeningNow.current = true;
    let refused = false;
    engine.startListening({
      language: voiceRef.current.settings.language,
      onText: (text, isFinal) => {
        retryDelay.current = 250;
        micReady.current = true;
        if (isFinal && text.trim() !== '') heardRef.current(text.trim());
      },
      onError: (error) => {
        if (error.kind === 'not-allowed' || error.kind === 'service-not-allowed') {
          refused = true;
          micReady.current = false;
          if (!fromTap) {
            // Started by itself and refused: a browser that wants a tap. Wait for one,
            // quietly, rather than calling it an error (ruling 62).
            askForTap();
            return;
          }
          setPresence('cannot-listen');
          const telephone = ourTelephone();
          showNote(
            error.kind === 'not-allowed'
              ? { kind: 'denied', text: deniedMessage(browser, telephone) }
              : { kind: 'service-off', text: serviceOffMessage(browser, telephone) },
          );
        } else if (error.kind === 'unavailable') {
          refused = true;
          setPresence('cannot-listen');
          showNote({ kind: 'unsupported', text: unsupportedMessage(browser) });
        } else if (error.kind === 'network' || error.kind === 'other') {
          // Say it once, then keep trying quietly, more slowly each time, up to a minute.
          if (retryDelay.current === 250) void sayRef.current(error.message);
          retryDelay.current = Math.min(
            retryDelay.current === 250 ? 5000 : retryDelay.current * 2,
            60_000,
          );
        }
      },
      onEnd: () => {
        listeningNow.current = false;
        // Listening ran without being refused: the microphone is allowed for this visit, and
        // Ozi can listen again by itself from now on, where the browser lets it.
        if (!refused) micReady.current = true;
        // Keep listening for as long as Ozi is meant to be.
        window.setTimeout(() => {
          listenRef.current();
        }, retryDelay.current);
      },
    });
  };

  /**
   * The tap (ruling 62). Everything up to `startListening` happens in this same moment, with
   * nothing awaited, so the browser counts the microphone request as the person's own tap.
   */
  const tapToTalk = useCallback(() => {
    touched.current = true;
    setWaitingForTouch(false);
    setMicNote(null);
    if (talkingRef.current) {
      // Ozi stops talking at once, so it does not hear itself.
      voiceRef.current.interrupt();
      talkingRef.current = false;
      setTalking(false);
    }
    if (reminderTimer.current !== null) window.clearTimeout(reminderTimer.current);
    reminderTimer.current = null;
    remindersGiven.current = 0;
    listenRef.current(true);
  }, []);

  /* ------------------------------------------------------------------ speaking */

  // The last thing Ozi said, for "say that again".
  const lastSaid = useRef('');
  // Said while the browser would not let Ozi speak yet: said again at the first touch.
  const unheard = useRef<string | null>(null);
  const touched = useRef(false);
  // Something Ozi said has been heard aloud this visit, so the page can make a sound.
  const soundWorks = useRef(false);

  const sayRef = useRef<(text: string, inline?: boolean) => Promise<SpeakOutcome>>(
    async () => 'finished',
  );
  sayRef.current = async (text: string, inline = false) => {
    lastSaid.current = text;
    // Words shown in their own place on the page are not shown again beside Ozi's button.
    setCaptionOff(inline);
    // Ozi does not listen while it talks, or it would hear itself.
    talkingRef.current = true;
    setTalking(true);
    stopListening();
    setAnnounce(false);
    setSaid(text);
    const outcome = await voiceRef.current.say(text);
    if (outcome === 'finished') soundWorks.current = true;
    if (outcome === 'not-spoken') {
      // A browser will not let a page make a sound until it has been touched once. Keep what
      // was meant to be heard, and say it at the first touch.
      if (!touched.current && !voiceRef.current.settings.muted && !inline) {
        unheard.current = text;
        setWaitingForTouch(true);
      }
      // Not heard aloud: show the words again, announced, so a screen reader reads them.
      setAnnounce(true);
      setSaid('');
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      setSaid(text);
    }
    talkingRef.current = false;
    setTalking(false);
    listenRef.current();
    return outcome;
  };

  /* ------------------------------------------------------------------ muting */

  const clearReminders = useCallback(() => {
    if (reminderTimer.current !== null) window.clearTimeout(reminderTimer.current);
    reminderTimer.current = null;
    remindersGiven.current = 0;
  }, []);

  const scheduleReminder = useCallback(() => {
    const wait = remindersGiven.current === 0 ? FIRST_REMINDER_MS : LATER_REMINDER_MS;
    reminderTimer.current = window.setTimeout(() => {
      if (presenceRef.current !== 'muted') return;
      remindersGiven.current += 1;
      if (document.visibilityState !== 'hidden') {
        void sayRef.current(
          remindersGiven.current === 1
            ? `Just a gentle reminder: I'm still here, but I'm muted, and I'm not listening. When you want me, press my button${wakeHint}.`
            : `I'm still here, resting and not listening. Press my button whenever you need me${wakeHint}.`,
        );
      }
      scheduleReminder();
    }, wait);
  }, [wakeHint]);

  const mute = useCallback(() => {
    setPresence('muted');
    stopListening();
    clearReminders();
    void sayRef.current(
      `I'm muted now, and not listening. I'll stay that way until you press my button${wakeHint}.`,
    );
    scheduleReminder();
  }, [setPresence, stopListening, clearReminders, scheduleReminder, wakeHint]);

  /**
   * The switch, or "turn off talking": Ozi stops talking out loud. It still listens, so "Hey
   * Ozi, turn on" brings it back, and its words are still on the screen and read by a screen
   * reader. To stop it listening too, press its round button.
   */
  const turnOff = useCallback(async (sayFirst: boolean) => {
    if (sayFirst) {
      await sayRef.current(
        `Okay, I'm turning off talking now. I'll still listen, and my words will stay on the screen. To turn me back on, use the switch at the bottom of the screen, or in Settings, or just say: "Hey ${storeConfig.assistantName}, turn on".`,
      );
    }
    voiceRef.current.update({ muted: true });
  }, []);

  // Turning back on waits for the setting to be saved, so the first words are spoken aloud.
  const wakeWhenOn = useRef(false);

  const offerAccountRef = useRef<(lead?: string) => void>(() => {});
  const ordering = useVoiceOrdering(
    useCallback((text: string) => sayRef.current(text), []),
    useCallback(() => offerAccountRef.current('To order, you need an account first. '), []),
  );

  const wake = useCallback(() => {
    clearReminders();
    setPresence('listening');
    ordering.expectOrder();
    void sayRef.current("I'm listening. What would you like?");
  }, [clearReminders, setPresence, ordering]);

  /* ------------------------------------------------------------------ what Ozi hears */

  // Something on the screen is waiting for the next words, a PIN say: they go there only.
  const captureRef = useRef<((text: string) => void) | null>(null);
  const pageCommandsRef = useRef<((text: string) => boolean) | null>(null);
  const setPageCommands = useCallback((handler: ((text: string) => boolean) | null) => {
    pageCommandsRef.current = handler;
  }, []);

  const listenFor = useCallback(
    (prompt: string, handler: (text: string) => void) => {
      captureRef.current = handler;
      if (presenceRef.current === 'muted') {
        clearReminders();
        setPresence('listening');
      }
      // Ozi listens again as soon as it has finished saying the prompt.
      void sayRef.current(prompt);
      return () => {
        if (captureRef.current === handler) captureRef.current = null;
      };
    },
    [clearReminders, setPresence],
  );

  heardRef.current = (text: string) => {
    const words = text.toLowerCase();
    // "Turn off" works even in the middle of a question, so nobody is stuck with a talking app.
    if (TURN_OFF.test(words)) {
      setHeard(text);
      void turnOff(true);
      return;
    }
    if (TURN_ON.test(words) && voiceRef.current.settings.muted) {
      setHeard(text);
      setVoiceOnRef.current(true);
      return;
    }
    // "Say that again": the last thing Ozi said, put a different way each time. A question
    // that was waiting for an answer is still waiting afterwards.
    if (REPEAT.test(words) && lastSaid.current !== '') {
      setHeard(text);
      sayAgain();
      return;
    }
    // "Hey Ozi" on its own: Ozi answers, and if it had asked something, asks it again, with
    // the question still open (Anthony, 6 October 2026).
    if (onlyName(text)) {
      setHeard(text);
      const pending = captureRef.current ? lastSaid.current : '';
      if (pending) {
        void sayRef.current(`I'm here. ${pending}`).then(() => {
          lastSaid.current = pending;
        });
      } else {
        ordering.expectOrder();
        void sayRef.current(HERE[hereCount.current++ % HERE.length]!);
      }
      return;
    }
    const capture = captureRef.current;
    if (capture) {
      captureRef.current = null;
      capture(text);
      return;
    }
    setHeard(text);
    // The page's own commands come before anything about shopping.
    if (pageCommandsRef.current?.(text)) return;
    // "Finish my account": what is still missing, and where to put it (ruling 47).
    if (/\bfinish\s+(setting\s+up\s+)?my\s+account\b/.test(words) && accountRef.current.shopper) {
      void welcomeRef.current(accountRef.current.shopper, '');
      return;
    }
    // "Sign in": by voice, with the phone number and a code (ruling 47).
    if (!ordering.busy() && SIGN_IN.test(words) && !accountRef.current.shopper) {
      voiceSignIn();
      return;
    }
    // "Create my account": set one up by talking, on the sign-up page.
    if (!ordering.busy() && CREATE_ACCOUNT.test(words)) {
      navigate('/sign-up?talk=1');
      return;
    }
    // A shared phone: change who is signed in, by voice (Anthony, 4 October 2026).
    if (!ordering.busy() && CHANGE_ACCOUNT.test(words)) {
      changeAccount();
      return;
    }
    if (!ordering.busy() && SIGN_OUT.test(words)) {
      const { shopper: current, signOut: out } = accountRef.current;
      out();
      void sayRef.current(
        current
          ? `You're signed out, ${current.displayName}. To sign in again, or open a new account, just tell me.`
          : 'Nobody is signed in on this phone. To open an account, say open an account.',
      );
      return;
    }
    // "What are the door words?": the Runner's first name and the two words (T6).
    if (!ordering.busy() && DOOR_WORD.test(words) && accountRef.current.shopper) {
      void fetchMyOrder()
        .then(({ order }) =>
          sayRef.current(
            order?.doorWordSentence ??
              (order
                ? "Your door words come as soon as a Runner has your order. I'll tell you then."
                : "You haven't got an order on its way just now, so there are no door words yet."),
          ),
        )
        .catch(() => sayRef.current("I couldn't check just now. Please ask me again in a moment."));
      return;
    }
    // "Skip", on its own, after a regular order's notice (Rule Five).
    if (
      !ordering.busy() &&
      accountRef.current.shopper &&
      words.trim().replace(/[.!,]+$/, '') === SKIP_WORD
    ) {
      void fetchWeeklyShops()
        .then(async ({ sets }) => {
          const waiting = sets.find(
            (set) =>
              set.active && set.noticeSentAt && set.skipRequestedForFireAt !== set.nextFireAt,
          );
          if (!waiting) {
            await sayRef.current(
              "There's no regular order waiting to go just now, so there's nothing to skip.",
            );
            return;
          }
          const result = await skipWeeklyShop(waiting.id);
          await sayRef.current(result.message);
        })
        .catch(() =>
          sayRef.current("I couldn't stop it just now. Please press Skip on the weekly shop page."),
        );
      return;
    }
    // "Cancel my membership": one yes, as easy as joining; nothing more is taken (ruling 58).
    if (!ordering.busy() && CANCEL_PLAN.test(words) && accountRef.current.shopper) {
      listenFor(
        'Do you want to cancel your plan? Nothing more will be taken, and you keep it until the end of the month you have paid for. Say yes to cancel it, or no to keep it.',
        (answer) => {
          if (!/\b(yes|yeah|yep|cancel it|please)\b/i.test(answer) || /\bno\b/i.test(answer)) {
            void sayRef.current('All right. Your plan stays as it is.');
            return;
          }
          void cancelPlan()
            .then((result) => sayRef.current(result.message))
            .catch(() =>
              sayRef.current(
                "I couldn't cancel it just now. Please press Cancel my plan in Settings.",
              ),
            );
        },
      );
      return;
    }
    // "Close my Runner account" on the Runner's pages (ruling 60): asked once more, then closed,
    // refused while a job is in hand.
    if (
      !ordering.busy() &&
      CLOSE_RUNNER_ACCOUNT.test(words) &&
      window.location.pathname.startsWith('/runner')
    ) {
      listenFor(CLOSE_QUESTION, (answer) => {
        if (!/\b(yes|yeah|yep|close it|please)\b/i.test(answer) || /\bno\b/i.test(answer)) {
          void sayRef.current('All right. Your Runner account stays open.');
          return;
        }
        void leaveRunning()
          .then((result) => sayRef.current(result.message))
          .catch((failure: unknown) =>
            sayRef.current(
              failure instanceof Error
                ? failure.message
                : "I couldn't close it just now. Please press Close my Runner account on your Runner page.",
            ),
          );
      });
      return;
    }
    // "Close my account": asked once more, then closed, with the days to change your mind.
    if (!ordering.busy() && CLOSE_ACCOUNT.test(words) && accountRef.current.shopper) {
      const days = storeConfig.accountDeletion.recycleBinDays;
      listenFor(
        `Do you want to close your account? It closes in ${days} days, and you can change your mind until then. Say yes to close it, or no to keep it.`,
        (answer) => {
          if (!/\b(yes|yeah|yep|close it|please)\b/i.test(answer) || /\bno\b/i.test(answer)) {
            void sayRef.current('All right. Your account stays as it is.');
            return;
          }
          void closeAccount()
            .then((result) => {
              navigate('/settings#close-account');
              return sayRef.current(
                `${result.message} To keep it, press Keep my account in Settings.`,
              );
            })
            .catch(() =>
              sayRef.current("I couldn't close it just now. Please try again in Settings."),
            );
        },
      );
      return;
    }
    // Questions about the shopping: the basket, the total, taking something out, the order.
    if (!ordering.busy()) {
      const b = basketRef.current;
      const answer = answerShoppingQuestion(text, {
        lines: b.lines,
        // The shopping as it is said: with its item charges in (ruling 58).
        goodsPence: b.pricing.goodsPence + b.pricing.itemChargesPence,
        feePence: b.pricing.feePence,
        totalPence: b.pricing.totalPence,
      });
      if (answer?.kind === 'say') {
        void sayRef.current(answer.text);
        return;
      }
      if (answer?.kind === 'remove') {
        b.remove(answer.itemId);
        void sayRef.current(answer.text);
        return;
      }
      if (answer?.kind === 'order-status') {
        if (!accountRef.current.shopper) {
          void sayRef.current(
            "You're not signed in, so I can't see an order. To sign in, say sign in.",
          );
          return;
        }
        void fetchMyOrder()
          .then(({ order }) => sayRef.current(orderWhere(order)))
          .catch(() =>
            sayRef.current(
              "I couldn't check your order just now. Please ask me again in a moment.",
            ),
          );
        return;
      }
    }
    if (!ordering.busy() && PHONE.test(words)) {
      sayPhoneNumber();
      return;
    }
    if (/\bmute\b|\bstop listening\b|\bbe quiet\b/.test(words)) {
      mute();
      return;
    }
    // "Add an address", "save a new address": the addresses page, with the form open.
    if (!ordering.busy() && /\b(add|save|new)\b.*\baddress\b/.test(words)) {
      navigate('/addresses?add=1');
      return;
    }
    // Ozi Recipes and Little Gifts (Anthony, 6 October 2026).
    if (!ordering.busy() && RECIPES.test(words)) {
      navigate('/recipes');
      void sayRef.current(
        'Here are the recipes. Each one tells you what you need, and I can read it out and put everything in your basket.',
      );
      return;
    }
    if (!ordering.busy() && GIFT_CARD.test(words)) {
      navigate('/gift-cards');
      void sayRef.current(
        'Here are gift cards. You can buy one for someone, or type in a code you were given.',
      );
      return;
    }
    if (!ordering.busy() && FIND_IT.test(words)) {
      navigate('/find-it');
      void sayRef.current(
        `${storeConfig.assistantName} Finds It: tell me what you're looking for, and a person will look in up to ${storeConfig.extras.findItShops} shops for you. What is it?`,
      );
      return;
    }
    if (!ordering.busy() && PLUS.test(words)) {
      navigate('/plus');
      void sayRef.current(
        `${storeConfig.assistantName} Plus includes Recipes and Finds It, for you or your whole family. It never renews by itself.`,
      );
      return;
    }
    if (!ordering.busy() && OFFERS.test(words)) {
      navigate('/offers');
      const count = currentOffers().length;
      void sayRef.current(
        count === 0
          ? 'There are no offers just now. When local shops have one, I will tell you.'
          : `There ${count === 1 ? 'is one offer' : `are ${count} offers`} today. They're on the screen now.`,
      );
      return;
    }
    if (!ordering.busy() && WEEKLY.test(words)) {
      navigate('/weekly-shop');
      void sayRef.current(
        "Let's set up your weekly shop. Choose a day, and on that day I'll remind you and put your usual in the basket.",
      );
      return;
    }
    if (!ordering.busy() && GIFTS.test(words)) {
      navigate('/gifts');
      void sayRef.current(
        'Here are the little gifts: a card, flowers, chocolates and more, brought with your shopping. Which would you like?',
      );
      return;
    }
    // The weekly shop again: "same as last time" puts the last order back in the basket.
    if (!ordering.busy() && REORDER.test(words)) {
      orderAgain();
      return;
    }
    void (async () => {
      // Runners hear the Runner collection on their own pages; everywhere else, the Shopper's.
      const as = window.location.pathname.startsWith('/runner')
        ? ({ kind: 'runner' } as const)
        : ({ kind: 'shopper' } as const);
      // An everyday phrase, the whole sentence: "thank you", "who are you", "how much is
      // delivery". Asked before an order is looked for, so "Ozi, thank you" is never ordered.
      if (!ordering.busy()) {
        const everyday = await phraseReply(text, phraseTurn.current, 'exact', as);
        if (everyday) {
          phraseTurn.current += 1;
          await sayRef.current(everyday);
          return;
        }
      }
      if (await ordering.handle(text)) return;
      // Words not about an order are not answered unless they were said to Ozi: Ozi does not
      // talk back to the television.
      if (nameHeardIn(text)) {
        const everyday = await phraseReply(text, phraseTurn.current, 'within', as);
        phraseTurn.current += 1;
        await sayRef.current(
          everyday ??
            "I can take a shopping order for you. Say, for example, I'd like bananas and milk.",
        );
      }
    })();
  };

  const orderAgain = (): void => {
    if (!accountRef.current.shopper) {
      void sayRef.current(
        "You're not signed in, so I can't see your last order. To sign in, say sign in.",
      );
      return;
    }
    void (async () => {
      try {
        const { orders } = await fetchMyOrders();
        const last = orders.find((order) => order.items.length > 0);
        if (!last) {
          await sayRef.current("There's no earlier order to copy yet. What would you like?");
          return;
        }
        const { added, missing } = await addNamedItems(
          last.items.map((item) => ({ item: item.name, quantity: item.quantity })),
          basketRef.current,
        );
        if (added.length === 0) {
          await sayRef.current(
            "I couldn't find those things in the shop today. What would you like?",
          );
          return;
        }
        listenFor(
          `I've put the same shopping as last time in your basket: ${listInWords(added)}.` +
            (missing.length > 0 ? ` I couldn't find ${listInWords(missing)}.` : '') +
            ' Shall we look at your basket?',
          (heard) => {
            if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
            else void sayRef.current('All right. Anything else?');
          },
        );
      } catch {
        await sayRef.current(
          "I couldn't find your last order just now. Please ask me again in a moment.",
        );
      }
    })();
  };

  const repeats = useRef(0);
  const hereCount = useRef(0);
  const phraseTurn = useRef(0);
  const sayAgain = (): void => {
    const what = lastSaid.current;
    const opening = REPEAT_OPENINGS[repeats.current % REPEAT_OPENINGS.length]!;
    repeats.current += 1;
    if (captureRef.current) {
      // Keep the question open: just say it again.
      void sayRef.current(`${opening}${what}`).then(() => {
        lastSaid.current = what;
      });
      return;
    }
    void (async () => {
      await sayRef.current(`${opening}${what}`);
      lastSaid.current = what;
      captureRef.current = (answer) => {
        if (REPEAT.test(answer.toLowerCase()) || /\b(no|nope|not really)\b/i.test(answer)) {
          sayAgain();
        } else {
          void sayRef.current('Good.').then(() => {
            lastSaid.current = what;
          });
        }
      };
      await sayRef.current('Did you hear that? Say yes or no.');
      lastSaid.current = what;
    })();
  };

  const changeAccount = (): void => {
    const { shopper: current, signOut: out } = accountRef.current;
    if (current) out();
    captureRef.current = (answer) => {
      const said = answer.toLowerCase();
      if (/\b(new|open|create|make)\b/.test(said)) {
        navigate('/sign-up?talk=1');
      } else if (/\b(sign|log)\s*in\b|\b(another|existing|other)\b/.test(said)) {
        voiceSignIn();
      } else {
        void sayRef.current('All right. Nobody is signed in now. Just tell me when you need me.');
      }
    };
    void sayRef.current(
      `${current ? `I've signed out ${current.displayName}. ` : ''}Would you like to sign in to another account, or open a new one? Say sign in, or new account.`,
    );
  };

  /** The telephone number, in twos, twice, then a third time if asked. */
  const sayPhoneNumber = (lead = ''): void => {
    const { telephonePlaceholder, telephoneIsPlaceholder } = storeConfig.contact;
    const aloud = pairsAloud(telephonePlaceholder);
    const notYet = telephoneIsPlaceholder
      ? " This number isn't connected yet; it will be soon."
      : '';
    void (async () => {
      captureRef.current = (answer) => {
        if (isYes(answer)) {
          void sayRef.current(`Of course. The number is: ${aloud}.${notYet}`);
        } else {
          void sayRef.current('All right.');
        }
      };
      await sayRef.current(
        `${lead}Our phone number is: ${aloud}. I'll say it again: ${aloud}. It's on the screen too, as ${inPairs(telephonePlaceholder)}.${notYet} If you'd like me to say it again, just say yes please, or repeat.`,
      );
    })();
  };

  /**
   * Nobody signed in: "Would you like to create an account, or sign in?" (Anthony, 7 October
   * 2026, ruling 47). Create goes to opening one by talking; sign in is done by voice; no
   * offers the phone. Anything else is answered as if no question had been asked.
   */
  offerAccountRef.current = (lead = '') => {
    captureRef.current = (answer) => {
      const said = answer.toLowerCase();
      if (SIGN_IN.test(said) || /\b(existing|already)\b/.test(said)) {
        voiceSignIn();
      } else if (isYes(answer) || CREATE_ACCOUNT.test(said) || /\b(create|new|open)\b/.test(said)) {
        navigate('/sign-up?talk=1');
      } else if (/\brunner\b/.test(said)) {
        navigate('/runner');
      } else if (/\b(shop|partner|business)\b/.test(said)) {
        navigate('/business');
      } else if (/\borganisation\b/.test(said)) {
        navigate('/organisations');
      } else if (/^\s*(no|nope|no thanks?|no thank you|not now)\W*$/.test(said)) {
        sayPhoneNumber('All right. You can also ring us, and your order is taken on the phone. ');
      } else {
        heardRef.current(answer);
      }
    };
    void sayRef.current(
      `${lead}Would you like to create an account, or sign in? Just say create account, or sign in.`,
    );
  };

  /** What is still missing from an account before it can order (ruling 47). */
  const setupGaps = async (shopper: Shopper): Promise<Array<'card' | 'address'>> => {
    const gaps: Array<'card' | 'address'> = [];
    try {
      const { paymentMethods } = await listPaymentMethods();
      if (paymentMethods.length === 0) gaps.push('card');
    } catch {
      // Cannot tell just now: say nothing rather than something wrong.
    }
    if (shopper.deliveryAddress.trim() === '') gaps.push('address');
    return gaps;
  };

  /** Welcome back, or: this account is not fully set up yet; finish it now? */
  const welcome = async (shopper: Shopper, lead: string): Promise<void> => {
    const first = shopper.displayName.trim().split(/\s+/)[0] ?? shopper.displayName;
    const gaps = await setupGaps(shopper);
    if (gaps.length === 0) {
      await sayRef.current(`${lead}Welcome back, ${first}. What shopping would you like today?`);
      return;
    }
    const missing = listInWords(
      gaps.map((gap) => (gap === 'card' ? 'your card details' : 'your home address')),
    );
    captureRef.current = (answer) => {
      if (isYes(answer)) {
        if (gaps[0] === 'card') {
          navigate('/card');
          void sayRef.current(
            "Here's where your card goes. It is kept by our payment company, never by us. Someone you trust can type it in for you.",
          );
        } else {
          navigate('/addresses?add=1');
          void sayRef.current("Here's where your home address goes. What is it?");
        }
      } else {
        void sayRef.current(
          "All right. You can finish it any time: just say finish my account. Or ring us, and we'll take your order on the phone.",
        );
      }
    };
    await sayRef.current(
      `${lead}Welcome back, ${first}. Your account isn't fully set up yet: ${missing} ${gaps.length === 1 ? 'is' : 'are'} missing. Would you like to finish it now? Say yes or no.`,
    );
  };
  const welcomeRef = useRef(welcome);
  welcomeRef.current = welcome;

  /**
   * Signing in by voice (ruling 47): the phone number, read back in twos; a code by text to a
   * mobile or by a phone call to a landline; the code said aloud; then where the account was
   * left off. The code is never shown or kept.
   */
  const voiceSignIn = (): void => {
    const askNumber = (prompt: string, tries: number): void => {
      listenFor(prompt, (heardNumber) => {
        const digits = spokenDigits(heardNumber);
        if (digits.replace(/^\+?44/, '0').length < 10) {
          if (tries >= 2) {
            void sayRef.current(
              "I didn't catch the number, so let's stop there. Say sign in to try again, or ring us.",
            );
            return;
          }
          askNumber(
            "Sorry, I didn't catch all of that. Please say the phone number slowly.",
            tries + 1,
          );
          return;
        }
        listenFor(`I heard ${pairsAloud(digits)}. Is that right?`, (answer) => {
          if (!isYes(answer)) {
            askNumber('All right. Please say the phone number again.', tries + 1);
            return;
          }
          void sendCode(digits);
        });
      });
    };
    const sendCode = async (digits: string): Promise<void> => {
      const channel = isUkMobileNumber(digits) ? 'text' : 'call';
      try {
        await requestSignInCode(digits, { channel });
      } catch (failure) {
        await sayRef.current(
          failure instanceof Error ? failure.message : "I couldn't send a code just now.",
        );
        return;
      }
      const askCode = (prompt: string, tries: number): void => {
        listenFor(prompt, (heardCode) => {
          const code = spokenDigits(heardCode);
          void (async () => {
            try {
              const result = await verifySignInCode(digits, code);
              if (result.registrationRequired) {
                captureRef.current = (answer) => {
                  if (isYes(answer)) navigate('/sign-up?talk=1');
                  else void sayRef.current('All right. Just tell me when you need me.');
                };
                await sayRef.current(
                  "There's no account on that number yet. Would you like to create one now? Say yes or no.",
                );
                return;
              }
              // Welcomed as soon as they are signed in, and told what is left to set up.
              try {
                window.sessionStorage.removeItem('ozidelivery.welcomed');
              } catch {
                // Not kept: they are welcomed anyway, once.
              }
              navigate('/shop');
              await accountRef.current.signedIn(result.token);
            } catch (failure) {
              if (tries >= 2) {
                await sayRef.current(
                  failure instanceof Error ? failure.message : 'That code did not work.',
                );
                return;
              }
              askCode("That code didn't work. Please say the six numbers again.", tries + 1);
            }
          })();
        });
      };
      askCode(
        channel === 'text'
          ? "I've sent a code by text to that number. When it arrives, say the six numbers."
          : "I'm ringing that number now, and a voice will read out a code. Then say the six numbers to me.",
        0,
      );
    };
    askNumber("Let's sign you in. What's the phone number on your account?", 0);
  };

  const press = useCallback(() => {
    // Waiting for a tap, the round button is that tap too (ruling 62).
    if (presenceRef.current === 'needs-tap') {
      tapToTalk();
      return;
    }
    if (talkingRef.current) {
      voiceRef.current.interrupt();
      return;
    }
    if (presenceRef.current === 'listening') {
      mute();
    } else if (presenceRef.current === 'muted') {
      wake();
    } else if (cannotReason.current && cannotReason.current.kind !== 'unsupported') {
      // Refused before: perhaps allowed in the browser since. Ask again, from this tap.
      tapToTalk();
    } else {
      showNoteRef.current({ kind: 'unsupported', text: unsupportedMessage(browser) });
    }
  }, [mute, wake, tapToTalk, browser]);

  const setVoiceOn = useCallback(
    (on: boolean) => {
      if (!on) {
        void turnOff(false);
        return;
      }
      wakeWhenOn.current = true;
      voiceRef.current.update({ muted: false });
    },
    [turnOff],
  );

  const showNoteRef = useRef(showNote);
  showNoteRef.current = showNote;

  const setVoiceOnRef = useRef(setVoiceOn);
  setVoiceOnRef.current = setVoiceOn;

  useEffect(() => {
    if (settings.muted || !wakeWhenOn.current) return;
    wakeWhenOn.current = false;
    clearReminders();
    if (presenceRef.current === 'muted') setPresence('listening');
    void sayRef.current(`I'm talking out loud again. ${MOTTO}`);
  }, [settings.muted, clearReminders, setPresence]);

  /**
   * After the introduction (ruling 47): does this person need extra help? A yes shows the
   * descriptive words on the screen as well, for somebody partially sighted, and says how to
   * make things bigger. Then, if nobody is signed in, create an account or sign in.
   */
  const askAboutHelpRef = useRef<() => void>(() => {});
  askAboutHelpRef.current = () => {
    const next = (): void => {
      if (!accountRef.current.shopper) offerAccountRef.current();
    };
    captureRef.current = (answer) => {
      if (isYes(answer)) {
        voiceRef.current.update({ showText: true });
        void sayRef
          .current(
            "All right. I'll describe everything as we go, and I've put the words on the screen too. Pinch the screen open with two fingers to make them bigger. You can change this in Settings, under Show words on the screen.",
          )
          .then(next);
      } else {
        next();
      }
    };
    void sayRef.current(
      'Do you need any extra help? For example, are you blind or partially sighted? Say yes or no.',
    );
  };

  /* ------------------------------------------------------------------ first launch */

  // What the first launch needs, as it is when the page opens. Read through a ref so the effect
  // below runs once, on the first launch only, and never again when any of these change.
  const { shopper, signOut, signedIn, restoring } = useSession();
  const basket = useBasket();
  const basketRef = useRef(basket);
  basketRef.current = basket;
  const accountRef = useRef({ shopper, signOut, signedIn });
  accountRef.current = { shopper, signOut, signedIn };
  const firstLaunch = useRef({
    assistant,
    engine,
    settings,
    setPresence,
    wakeHint,
    browser,
    signedIn: shopper !== null,
  });

  useEffect(() => {
    const { assistant, engine, settings, setPresence, wakeHint, browser } = firstLaunch.current;
    let cancelled = false;
    // Anthony's words, 4 October 2026: who Ozi is, the motto, how to turn talking off and back
    // on, by the switch or by voice, and that it will say anything again.
    const intro =
      `Hello, I'm ${assistant}, your shopping assistant. ${MOTTO} ` +
      `Tell me what shopping you need, and a Runner will bring it to your door. ` +
      `If you'd rather I didn't talk out loud, turn off the switch at the bottom of the screen, or just say "turn off talking". ` +
      `To turn me back on, use the same switch, or Settings, or say "Hey ${assistant}, turn on". ` +
      `If you miss anything I say, just say "repeat". ` +
      `To make anything bigger, pinch the screen open with two fingers. ` +
      `While my round green button glows, I'm listening. Press it to pause me, and again${wakeHint} to bring me back.`;

    void (async () => {
      const ready = await engine.readiness(settings.language);
      // The first listening of a visit waits for a tap, unless the microphone is already
      // allowed here (ruling 62). Ozi still speaks first.
      const needsTap = ready.canListen ? ((await engine.firstListenNeedsTap?.()) ?? false) : false;
      if (cancelled) return;
      micReady.current = !needsTap;
      if (!ready.canListen) {
        cannotReason.current = { kind: 'unsupported', text: unsupportedMessage(browser) };
      }
      setPresence(ready.canListen ? (needsTap ? 'needs-tap' : 'listening') : 'cannot-listen');
      if (settings.introHeard) {
        listenRef.current();
        return;
      }
      const outcome = await sayRef.current(intro);
      if (cancelled) return;
      voiceRef.current.update({ introHeard: true });
      if (outcome !== 'not-spoken') askAboutHelpRef.current();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Somebody signed in, once a visit (ruling 47): straight into the shop, welcomed by name, and
  // told if their account still needs finishing.
  useEffect(() => {
    if (restoring || !shopper || !settings.introHeard) return;
    try {
      if (window.sessionStorage.getItem('ozidelivery.welcomed') === shopper.id) return;
      window.sessionStorage.setItem('ozidelivery.welcomed', shopper.id);
    } catch {
      return;
    }
    if (location.pathname === '/' || location.pathname === '/join')
      navigate('/shop', { replace: true });
    void welcomeRef.current(shopper, '');
  }, [restoring, shopper, settings.introHeard, location.pathname, navigate]);

  // A browser will not let a page speak until it has been touched once. Whatever Ozi meant to
  // say before then is on the screen, announced to a screen reader, and said aloud at the first
  // touch or key press anywhere. A phone app has no such rule, and speaks straight away.
  useEffect(() => {
    const onFirstTouch = (event: Event): void => {
      touched.current = true;
      window.removeEventListener('click', onFirstTouch);
      window.removeEventListener('keydown', onFirstTouch);
      setWaitingForTouch(false);
      const pending = unheard.current;
      unheard.current = null;
      // A first press on Ozi's own button is somebody doing something with Ozi: let that press
      // do what it says, rather than replaying words over it.
      const target = event.target as Element | null;
      if (!pending || target?.closest?.('[data-ozi]')) return;
      void sayRef.current(pending).then((outcome) => {
        if (outcome !== 'not-spoken' && pending.startsWith('Hello')) {
          askAboutHelpRef.current();
        }
      });
    };
    window.addEventListener('click', onFirstTouch);
    window.addEventListener('keydown', onFirstTouch);
    return () => {
      window.removeEventListener('click', onFirstTouch);
      window.removeEventListener('keydown', onFirstTouch);
    };
  }, []);

  // Stop listening while the page is hidden, and pick up again when it comes back.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') stopListening();
      else listenRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearReminders();
      stopListening();
    };
  }, [stopListening, clearReminders]);

  const value = useMemo<OziValue>(
    () => ({
      presence,
      talking,
      said,
      announce,
      heard,
      say: (text: string) => sayRef.current(text),
      press,
      mute,
      wake,
      listenFor,
      voiceOn: !settings.muted,
      setVoiceOn,
      waitingForTouch,
      setPageCommands,
      offerAccount: (lead?: string) => offerAccountRef.current(lead),
      tapToTalk,
      micNote,
      dismissMicNote: () => setMicNote(null),
      captionOff,
      browser,
    }),
    [
      presence,
      talking,
      said,
      announce,
      heard,
      press,
      mute,
      wake,
      listenFor,
      settings.muted,
      setVoiceOn,
      waitingForTouch,
      setPageCommands,
      tapToTalk,
      micNote,
      captionOff,
      browser,
    ],
  );

  return <OziContext.Provider value={value}>{children}</OziContext.Provider>;
}

export function useOzi(): OziValue {
  const value = useContext(OziContext);
  if (!value) throw new Error('useOzi must be used inside OziProvider.');
  return value;
}
