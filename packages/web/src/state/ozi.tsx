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
import type { SpeakOutcome } from '../voice';
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

  const sayRef = useRef<(text: string) => Promise<SpeakOutcome>>(async () => 'finished');
  sayRef.current = async (text: string) => {
    // Ozi does not listen while it talks, or it would hear itself.
    talkingRef.current = true;
    setTalking(true);
    stopListening();
    setAnnounce(false);
    setSaid(text);
    const outcome = await voiceRef.current.say(text);
    if (outcome === 'not-spoken') {
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

  const ordering = useVoiceOrdering(useCallback((text: string) => sayRef.current(text), []));

  const wake = useCallback(() => {
    clearReminders();
    setPresence('listening');
    ordering.expectOrder();
    void sayRef.current("I'm listening. What would you like?");
  }, [clearReminders, setPresence, ordering]);

  /* ------------------------------------------------------------------ what Ozi hears */

  // Something on the screen is waiting for the next words, a PIN say: they go there only.
  const captureRef = useRef<((text: string) => void) | null>(null);

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
    const capture = captureRef.current;
    if (capture) {
      captureRef.current = null;
      capture(text);
      return;
    }
    setHeard(text);
    const words = text.toLowerCase();
    if (/\bmute\b|\bstop listening\b|\bbe quiet\b/.test(words)) {
      mute();
      return;
    }
    // "Add an address", "save a new address": the addresses page, with the form open.
    if (!ordering.busy() && /\b(add|save|new)\b.*\baddress\b/.test(words)) {
      navigate('/addresses?add=1');
      return;
    }
    void (async () => {
      if (await ordering.handle(text)) return;
      // Words not about an order are not answered unless they were said to Ozi: Ozi does not
      // talk back to the television.
      if (new RegExp(`\\b${assistant}\\b`, 'i').test(text)) {
        await sayRef.current(
          "I can take a shopping order for you. Say, for example, I'd like bananas and milk.",
        );
      }
    })();
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

  /* ------------------------------------------------------------------ first launch */

  // What the first launch needs, as it is when the page opens. Read through a ref so the effect
  // below runs once, on the first launch only, and never again when any of these change.
  const firstLaunch = useRef({ assistant, engine, settings, setPresence, wakeHint });

  useEffect(() => {
    const { assistant, engine, settings, setPresence, wakeHint } = firstLaunch.current;
    let cancelled = false;
    const intro =
      `Hello, I'm ${assistant}. I'm designed to speak with you, so that we can have a conversation. ` +
      `While my round green button is glowing, I'm listening. To pause me, press it, or say "${assistant}, mute". ` +
      `Press it again${wakeHint} when you want me back. ` +
      `If you would rather I didn't speak aloud, you can turn my voice off in Settings. ` +
      `And you can move my button out of the way: hold it down and drag it, or use the arrow keys.`;

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
      // A browser will not speak until the page has been touched once. If that is what
      // stopped the introduction, say it at the first touch or key press; it is on the screen,
      // announced, in the meantime. A phone with a native app has no such rule.
      if (outcome === 'not-spoken' && (await engine.readiness(settings.language)).canSpeak) {
        const onFirstTouch = (event: Event): void => {
          window.removeEventListener('click', onFirstTouch);
          window.removeEventListener('keydown', onFirstTouch);
          // A first press on Ozi's own button is the Shopper doing something with Ozi: let
          // that press do what it says, rather than replaying the introduction over it.
          const target = event.target as Element | null;
          if (target?.closest?.('[data-ozi]')) return;
          void sayRef.current(intro);
        };
        window.addEventListener('click', onFirstTouch);
        window.addEventListener('keydown', onFirstTouch);
      }
    })();

    return () => {
      cancelled = true;
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
    }),
    [presence, talking, said, announce, heard, press, mute, wake, listenFor],
  );

  return <OziContext.Provider value={value}>{children}</OziContext.Provider>;
}

export function useOzi(): OziValue {
  const value = useContext(OziContext);
  if (!value) throw new Error('useOzi must be used inside OziProvider.');
  return value;
}
