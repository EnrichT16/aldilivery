import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';
import { parsePin } from '../voice/pin';
import { TapPin } from './TapPin';

/**
 * The four-digit PIN, typed or said aloud (docs/BUILD_PROMPT.md, Section D).
 *
 * `choose` is the first time a PIN is needed: it is asked for twice, so a slip of the finger
 * or a word misheard cannot become a PIN nobody knows. `enter` is every time after that.
 *
 * Said aloud, Ozi asks for the four numbers and the next words go straight to this field and
 * nowhere else: never shown, never kept, never said back. Ozi does say what happened ("I heard
 * four numbers"), so somebody who cannot see the field knows whether it worked.
 *
 * Or tapped, for somebody who cannot see the screen and has people around (TapPin): Ozi guides
 * each number, taps count it, and the phone buzzes it back.
 *
 * Whatever the server says — a PIN too easy to guess, a wrong one, a lock — is shown here and
 * announced, in its own words.
 */
export function PinEntry({
  mode,
  purpose,
  onPin,
  onCancel,
}: {
  mode: 'choose' | 'enter';
  /** What the PIN is for, finishing "Your PIN is needed …": "to save this address". */
  purpose: string;
  /** Do the thing with this PIN. A thrown Error's message is shown. */
  onPin: (pin: string) => Promise<void>;
  onCancel?: () => void;
}): JSX.Element {
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;
  const id = useId();
  const [stage, setStageState] = useState<'first' | 'again'>('first');
  // Read through refs as well, because a PIN said aloud arrives in a callback made earlier.
  const stageRef = useRef<'first' | 'again'>('first');
  const first = useRef('');
  const setStage = (next: 'first' | 'again'): void => {
    stageRef.current = next;
    setStageState(next);
  };
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [tapping, setTapping] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const tappingRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      stopListening.current?.();
    },
    [],
  );

  const heading =
    mode === 'enter'
      ? `Your PIN is needed ${purpose}`
      : stage === 'first'
        ? `Choose a PIN ${purpose}`
        : 'Now the same PIN again';
  const hint =
    mode === 'enter'
      ? 'Four numbers. After three wrong tries it locks for 15 minutes, to keep your account safe.'
      : stage === 'first'
        ? 'Four numbers that you will remember and others will not guess. Not 1234, not the same number four times, and not a year. You will need it to save an address or change your home address.'
        : 'Type or say the same four numbers once more, to be sure.';

  async function submit(pin: string, spoken = false): Promise<void> {
    if (working) return;
    if (!/^\d{4}$/.test(pin)) {
      setError('A PIN is four numbers, like 2 7 5 9.');
      return;
    }
    setError('');
    if (mode === 'choose' && stageRef.current === 'first') {
      first.current = pin;
      setValue('');
      setStage('again');
      // Tapped: the pad asks for the same PIN again itself.
      if (tappingRef.current) return;
      input.current?.focus();
      if (spoken) sayIt();
      return;
    }
    setTapping(false);
    tappingRef.current = false;
    if (mode === 'choose' && pin !== first.current) {
      first.current = '';
      setValue('');
      setStage('first');
      setError('Those two were not the same. Please choose your PIN again.');
      return;
    }
    setWorking(true);
    try {
      await onPin(pin);
    } catch (failure) {
      setValue('');
      if (mode === 'choose') {
        first.current = '';
        setStage('first');
      }
      setError(failure instanceof Error ? failure.message : 'That did not work. Please try again.');
    } finally {
      setWorking(false);
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit(value);
  }

  function sayIt(): void {
    stopListening.current?.();
    const prompt =
      stageRef.current === 'again'
        ? 'Say the same four numbers once more.'
        : 'Say the four numbers of your PIN, one at a time. Make sure nobody nearby can hear you.';
    stopListening.current = ozi.listenFor(prompt, (heard) => {
      stopListening.current = null;
      const pin = parsePin(heard);
      if (!pin) {
        const sorry =
          "I didn't hear four numbers. Press Say my PIN to try again, or type them instead.";
        setError(sorry);
        void ozi.say(sorry);
        return;
      }
      setValue(pin);
      if (mode === 'choose' && stageRef.current === 'first') {
        // Straight on to asking for it again, which says so.
        void submit(pin, true);
        return;
      }
      void ozi.say('I heard four numbers.');
      void submit(pin, true);
    });
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (tapping) {
    return (
      <section aria-labelledby={`${id}-heading`} className="space-y-3 max-w-xl">
        <h3 id={`${id}-heading`} className="text-lead font-bold m-0">
          {heading}
        </h3>
        <TapPin
          key={stage}
          again={mode === 'choose' && stage === 'again'}
          onPin={(pin) => {
            void submit(pin);
          }}
          onCancel={() => {
            tappingRef.current = false;
            setTapping(false);
          }}
        />
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 max-w-xl" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-lead font-bold m-0">
        {heading}
      </h3>
      <label htmlFor={`${id}-pin`} className="block font-bold">
        {mode === 'choose' && stage === 'again' ? 'The same PIN again' : 'PIN'}
      </label>
      <p id={hintId} className="m-0 text-paper/90">
        {hint}
      </p>
      <input
        ref={input}
        id={`${id}-pin`}
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={value}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 4))}
        className="w-40 min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 text-lead tracking-widest"
      />
      {error !== '' && (
        <p
          id={errorId}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={working} className="control bg-highlight text-ink">
          {working
            ? 'One moment…'
            : mode === 'enter'
              ? 'Use this PIN'
              : stage === 'first'
                ? 'Next'
                : 'Choose this PIN'}
        </button>
        {ozi.presence !== 'cannot-listen' && (
          <button
            type="button"
            onClick={sayIt}
            aria-describedby={`${id}-say-hint`}
            className="control bg-paper text-ink"
          >
            Say my PIN
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            stopListening.current?.();
            setError('');
            tappingRef.current = true;
            setTapping(true);
          }}
          aria-describedby={`${id}-tap-hint`}
          className="control bg-paper text-ink"
        >
          Tap my PIN
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="control bg-paper/10 text-paper underline"
          >
            Cancel
          </button>
        )}
      </div>
      <p id={`${id}-tap-hint`} className="m-0 text-paper/80">
        People around you? Tap your PIN on the screen instead of saying it. {assistant} guides you
        one number at a time, and the phone buzzes each one back.
      </p>
      {ozi.presence !== 'cannot-listen' && (
        <p id={`${id}-say-hint`} className="m-0 text-paper/80">
          {assistant} listens for the four numbers. They are not shown or kept.
        </p>
      )}
    </form>
  );
}
