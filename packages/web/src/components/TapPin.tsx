import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';
import { yesOrNo } from '../state/voice-sign-up';

/**
 * Tapping a PIN, for somebody who cannot see the screen and does not want to say their PIN out
 * loud because people are around (Anthony, 4 October 2026).
 *
 * One number at a time, guided by Ozi, never rushed:
 * - Ozi says "Start". One tap is one, two taps two, up to nine. Pressing and holding for about
 *   a second is zero. Each tap gives a small buzz, so they know it counted.
 * - When the taps stop for two seconds, Ozi says it has the number, without saying it, and buzzes
 *   it back on the pad, stronger and slower: four long buzzes for four, one very long buzz for 0.
 * - One tap, or "yes", keeps it. Two taps, or "no", does that number again, from "Start".
 * - More than nine taps is not a number: Ozi says so, and that number is done again.
 *
 * Nothing about the digits is ever said aloud or shown. A phone whose browser cannot buzz (an
 * iPhone, on the website) still takes the taps; Ozi says it cannot buzz them back there, and the
 * phone app can.
 */

const IDLE_MS = 2000;
const ANSWER_IDLE_MS = 1200;
const HOLD_FOR_ZERO_MS = 800;
const LIGHT_BUZZ_MS = 25;
const STRONG_BUZZ_MS = 250;
const STRONG_GAP_MS = 350;
const ZERO_BUZZ_MS = 900;

const ORDINALS = ['first', 'second', 'third', 'fourth'];

type Phase = 'busy' | 'entering' | 'answering';

function buzz(pattern: number | number[]): boolean {
  try {
    return typeof navigator.vibrate === 'function' && navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** What a number feels like, buzzed back: n long buzzes, or one very long one for zero. */
export function buzzBack(digit: number): number[] {
  if (digit === 0) return [ZERO_BUZZ_MS];
  const pattern: number[] = [];
  for (let i = 0; i < digit; i += 1) {
    if (i > 0) pattern.push(STRONG_GAP_MS);
    pattern.push(STRONG_BUZZ_MS);
  }
  return pattern;
}

function lasts(pattern: number[]): number {
  return pattern.reduce((total, ms) => total + ms, 0);
}

export function TapPin({
  again = false,
  onPin,
  onCancel,
}: {
  /** The second time round when choosing a PIN: "the same PIN once more". */
  again?: boolean;
  onPin: (pin: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;
  const [phase, setPhaseState] = useState<Phase>('busy');
  const [position, setPosition] = useState(0);

  const phaseRef = useRef<Phase>('busy');
  const digits = useRef<number[]>([]);
  const taps = useRef(0);
  const zero = useRef(false);
  const timer = useRef<number | null>(null);
  const pressedAt = useRef<number | null>(null);
  const viaPointer = useRef(false);
  const stopVoice = useRef<(() => void) | null>(null);
  const finished = useRef(false);
  const canBuzz = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const live = useRef({ ozi, onPin });
  live.current = { ozi, onPin };

  const setPhase = (next: Phase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  // Declared through refs, because each step leads to the next.
  const askRef = useRef<(lead: string) => Promise<void>>(async () => {});
  const takeRef = useRef<() => Promise<void>>(async () => {});
  const answerRef = useRef<(yes: boolean) => Promise<void>>(async () => {});

  askRef.current = async (lead: string) => {
    setPhase('busy');
    taps.current = 0;
    zero.current = false;
    const which = ORDINALS[digits.current.length]!;
    await live.current.ozi.say(`${lead}Your ${which} number. Take your time. Start.`);
    if (finished.current) return;
    setPosition(digits.current.length);
    setPhase('entering');
  };

  takeRef.current = async () => {
    setPhase('busy');
    const count = taps.current;
    if (!zero.current && count > 9) {
      buzz([100, 80, 100, 80, 100]);
      await askRef.current(
        "That was more than nine taps, so it isn't a number. Let's do it again. ",
      );
      return;
    }
    const digit = zero.current ? 0 : count;
    digits.current = [...digits.current, digit];
    const which = ORDINALS[digits.current.length - 1]!;
    if (canBuzz) {
      await live.current.ozi.say(
        `I've got your ${which} number. I won't say it out loud. Rest your finger on the pad, and I'll buzz it back to you.`,
      );
      if (finished.current) return;
      const pattern = buzzBack(digit);
      buzz(pattern);
      await new Promise((resolve) => window.setTimeout(resolve, lasts(pattern) + 400));
    } else {
      await live.current.ozi.say(
        `I've got your ${which} number. I won't say it out loud. This phone's browser can't buzz it back to you; the ${assistant} phone app can.`,
      );
    }
    if (finished.current) return;
    setPhase('answering');
    taps.current = 0;
    stopVoice.current = live.current.ozi.listenFor(
      'If that was right, tap once, or say yes. If not, tap twice, or say no.',
      (heard) => {
        stopVoice.current = null;
        const answer = yesOrNo(heard);
        if (answer !== null && phaseRef.current === 'answering')
          void answerRef.current(answer === 'yes');
      },
    );
  };

  answerRef.current = async (yes: boolean) => {
    clearTimer();
    stopVoice.current?.();
    stopVoice.current = null;
    setPhase('busy');
    if (!yes) {
      digits.current = digits.current.slice(0, -1);
      await askRef.current("All right, let's do that number again. When I say start, you start. ");
      return;
    }
    if (digits.current.length < 4) {
      await askRef.current('Good. ');
      return;
    }
    finished.current = true;
    const pin = digits.current.join('');
    digits.current = [];
    await live.current.ozi.say('Good. That is all four numbers.');
    live.current.onPin(pin);
  };

  const onTap = useCallback((held: boolean) => {
    if (phaseRef.current === 'entering') {
      buzz(LIGHT_BUZZ_MS);
      if (held) zero.current = true;
      else taps.current += 1;
      clearTimer();
      timer.current = window.setTimeout(() => {
        void takeRef.current();
      }, IDLE_MS);
      return;
    }
    if (phaseRef.current === 'answering') {
      buzz(LIGHT_BUZZ_MS);
      taps.current += 1;
      clearTimer();
      timer.current = window.setTimeout(() => {
        const count = taps.current;
        taps.current = 0;
        if (count === 1) void answerRef.current(true);
        else if (count === 2) void answerRef.current(false);
      }, ANSWER_IDLE_MS);
    }
  }, []);

  // Start once, with the instructions.
  useEffect(() => {
    void askRef.current(
      again
        ? 'Now tap the same PIN once more, to be sure. '
        : "Let's tap your PIN on the big pad, one number at a time. Tap once for one, twice for two, up to nine. For zero, press and hold for a second. Each tap gives a small buzz. When you stop tapping, I'll take the number. ",
    );
    return () => {
      finished.current = true;
      clearTimer();
      stopVoice.current?.();
    };
  }, [again]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    // A long Space press is zero for a keyboard; Enter or a short Space is a tap.
    if (event.key === ' ' && !event.repeat) pressedAt.current = Date.now();
  }

  const words =
    phase === 'entering'
      ? `Tapping your ${ORDINALS[position]} number`
      : phase === 'answering'
        ? 'Tap once for yes, twice for no'
        : `${assistant} is talking`;

  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-describedby="tap-pin-hint"
        onPointerDown={() => {
          viaPointer.current = true;
          pressedAt.current = Date.now();
        }}
        onPointerUp={() => {
          const held =
            pressedAt.current !== null && Date.now() - pressedAt.current >= HOLD_FOR_ZERO_MS;
          pressedAt.current = null;
          onTap(held);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key !== ' ') return;
          const held =
            pressedAt.current !== null && Date.now() - pressedAt.current >= HOLD_FOR_ZERO_MS;
          pressedAt.current = null;
          event.preventDefault();
          // The click that a Space key-up makes is this same tap.
          viaPointer.current = true;
          onTap(held);
        }}
        onClick={() => {
          // A screen reader's double tap, or Enter: one tap. A finger was counted already.
          if (viaPointer.current) {
            viaPointer.current = false;
            return;
          }
          onTap(false);
        }}
        onContextMenu={(event) => event.preventDefault()}
        style={{ touchAction: 'none', userSelect: 'none' }}
        className="w-full min-h-[50vh] rounded-xl border-4 border-paper bg-paper/10 text-paper text-lead font-bold flex items-center justify-center"
      >
        {words}
      </button>
      <p id="tap-pin-hint" className="m-0">
        Tap once for one, up to nine taps for nine. Press and hold for zero. Nothing you tap is
        shown or said.
      </p>
      <button
        type="button"
        onClick={() => {
          finished.current = true;
          onCancel();
        }}
        className="control bg-paper/10 text-paper underline"
      >
        I&rsquo;ll type it or say it instead
      </button>
    </div>
  );
}
