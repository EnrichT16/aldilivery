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

import { useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { inPairs, pairsAloud } from '../lib/phone-aloud';
import { fetchMyOrder, fetchMyOrders } from '../lib/api';
import { addNamedItems, currentOffers, listInWords } from '../lib/extras';
import { nameHeardIn, onlyName } from '../voice/name';
import { phraseReply } from '../voice/phrases';
import { answerShoppingQuestion, orderWhere } from '../voice/shopping-questions';
import { useBasket } from './basket';
import type { SpeakOutcome } from '../voice';
import { useSession } from './session';
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
  /** This phone or browser cannot listen; Ozi can still speak. */
  | 'cannot-listen';

/** The motto (Anthony, 4 October 2026): "Send me, I will help." */
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
}

const OziContext = createContext<OziValue | null>(null);

export function OziProvider({ children }: { children: ReactNode }): JSX.Element {
  const voice = useVoice();
  const { engine, settings } = voice;
  const navigate = useNavigate();
  const assistant = storeConfig.assistantName;

  const [presence, setPresenceState] = useState<Presence>('starting');
  const [talking, setTalking] = useState(false);
  const [said, setSaid] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [heard, setHeard] = useState('');
  const [waitingForTouch, setWaitingForTouch] = useState(false);

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
  const listenRef = useRef<() => void>(() => {});
  const heardRef = useRef<(text: string) => void>(() => {});

  const stopListening = useCallback(() => {
    if (listeningNow.current) {
      listeningNow.current = false;
      engine.stopListening();
    }
  }, [engine]);

  listenRef.current = () => {
    if (presenceRef.current !== 'listening' || talkingRef.current || listeningNow.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    listeningNow.current = true;
    engine.startListening({
      language: voiceRef.current.settings.language,
      onText: (text, isFinal) => {
        retryDelay.current = 250;
        if (isFinal && text.trim() !== '') heardRef.current(text.trim());
      },
      onError: (error) => {
        if (error.kind === 'not-allowed' || error.kind === 'unavailable') {
          setPresence('cannot-listen');
          void sayRef.current(error.message);
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
        // Keep listening for as long as Ozi is meant to be.
        window.setTimeout(() => {
          listenRef.current();
        }, retryDelay.current);
      },
    });
  };

  /* ------------------------------------------------------------------ speaking */

  // The last thing Ozi said, for "say that again".
  const lastSaid = useRef('');
  // Said while the browser would not let Ozi speak yet: said again at the first touch.
  const unheard = useRef<string | null>(null);
  const touched = useRef(false);

  const sayRef = useRef<(text: string) => Promise<SpeakOutcome>>(async () => 'finished');
  sayRef.current = async (text: string) => {
    lastSaid.current = text;
    // Ozi does not listen while it talks, or it would hear itself.
    talkingRef.current = true;
    setTalking(true);
    stopListening();
    setAnnounce(false);
    setSaid(text);
    const outcome = await voiceRef.current.say(text);
    if (outcome === 'not-spoken') {
      // A browser will not let a page make a sound until it has been touched once. Keep what
      // was meant to be heard, and say it at the first touch.
      if (!touched.current && !voiceRef.current.settings.muted) {
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

  const offerAccountRef = useRef<() => void>(() => {});
  const ordering = useVoiceOrdering(
    useCallback((text: string) => sayRef.current(text), []),
    useCallback(() => offerAccountRef.current(), []),
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
    // Questions about the shopping: the basket, the total, taking something out, the order.
    if (!ordering.busy()) {
      const b = basketRef.current;
      const answer = answerShoppingQuestion(text, {
        lines: b.lines,
        goodsPence: b.pricing.goodsPence,
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
        navigate('/sign-in');
        void sayRef.current(
          "Here's signing in. Put in the mobile number of the account, and we'll text a code to it.",
        );
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

  // No account yet: ask, and set one up by talking on a yes; on a no, offer the phone.
  offerAccountRef.current = () => {
    captureRef.current = (answer) => {
      if (isYes(answer) || CREATE_ACCOUNT.test(answer.toLowerCase())) {
        navigate('/sign-up?talk=1');
      } else {
        sayPhoneNumber('All right. You can also ring us, and a person will take your order. ');
      }
    };
    void sayRef.current(
      'To order, you need an account first. Would you like to open one now, just by talking with me? Just say yes or no.',
    );
  };

  const press = useCallback(() => {
    if (talkingRef.current) {
      voiceRef.current.interrupt();
      return;
    }
    if (presenceRef.current === 'listening') {
      mute();
    } else if (presenceRef.current === 'muted') {
      wake();
    } else {
      void sayRef.current(
        "I can't listen on this phone or browser yet, but I can still talk to you. Chrome, Edge or Safari can listen.",
      );
    }
  }, [mute, wake]);

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

  const setVoiceOnRef = useRef(setVoiceOn);
  setVoiceOnRef.current = setVoiceOn;

  useEffect(() => {
    if (settings.muted || !wakeWhenOn.current) return;
    wakeWhenOn.current = false;
    clearReminders();
    if (presenceRef.current === 'muted') setPresence('listening');
    void sayRef.current(`I'm talking out loud again. ${MOTTO}`);
  }, [settings.muted, clearReminders, setPresence]);

  /* ------------------------------------------------------------------ first launch */

  // What the first launch needs, as it is when the page opens. Read through a ref so the effect
  // below runs once, on the first launch only, and never again when any of these change.
  const { shopper, signOut } = useSession();
  const basket = useBasket();
  const basketRef = useRef(basket);
  basketRef.current = basket;
  const accountRef = useRef({ shopper, signOut });
  accountRef.current = { shopper, signOut };
  const firstLaunch = useRef({
    assistant,
    engine,
    settings,
    setPresence,
    wakeHint,
    signedIn: shopper !== null,
  });

  useEffect(() => {
    const { assistant, engine, settings, setPresence, wakeHint } = firstLaunch.current;
    let cancelled = false;
    // Anthony's words, 4 October 2026: who Ozi is, the motto, how to turn talking off and back
    // on, by the switch or by voice, and that it will say anything again.
    const intro =
      `Hello, I'm ${assistant}, your shopping assistant. ${MOTTO} ` +
      `Tell me what shopping you need, and a Runner will bring it to your door. ` +
      `If you'd rather I didn't talk out loud, turn off the switch at the bottom of the screen, or just say "turn off talking". ` +
      `To turn me back on, use the same switch, or Settings, or say "Hey ${assistant}, turn on". ` +
      `If you miss anything I say, just say "repeat". ` +
      `While my round green button glows, I'm listening. Press it to pause me, and again${wakeHint} to bring me back.`;

    void (async () => {
      const ready = await engine.readiness(settings.language);
      if (cancelled) return;
      setPresence(ready.canListen ? 'listening' : 'cannot-listen');
      if (settings.introHeard) {
        listenRef.current();
        return;
      }
      const outcome = await sayRef.current(intro);
      if (cancelled) return;
      voiceRef.current.update({ introHeard: true });
      // Somebody new: offer to open an account straight away, by talking.
      if (outcome !== 'not-spoken' && !firstLaunch.current.signedIn) offerAccountRef.current();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
        if (
          outcome !== 'not-spoken' &&
          pending.startsWith('Hello') &&
          !firstLaunch.current.signedIn
        ) {
          offerAccountRef.current();
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
    ],
  );

  return <OziContext.Provider value={value}>{children}</OziContext.Provider>;
}

export function useOzi(): OziValue {
  const value = useContext(OziContext);
  if (!value) throw new Error('useOzi must be used inside OziProvider.');
  return value;
}
