import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';

import { changePin } from '../lib/api';

const PIN_FIELD =
  'w-40 min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3 text-lead tracking-widest';

/**
 * Changing the PIN, knowing the current one (ruling 81): the current PIN, then the new one
 * twice, so a slip cannot become a PIN nobody knows. Wrong current PINs count towards the lock,
 * three and it waits fifteen minutes, as anywhere else; the server says so in its own words.
 * The PINs are never shown, kept or said back: the fields empty after every try.
 */
export function ChangePin({
  onDone,
  onCancel,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  const digits = (value: string): string => value.replace(/\D/g, '').slice(0, 4);
  const clear = (): void => {
    setCurrent('');
    setNext('');
    setAgain('');
  };

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (working) return;
    if (![current, next, again].every((pin) => /^\d{4}$/.test(pin))) {
      setError('Each PIN is four numbers, like 2 7 5 9.');
      return;
    }
    if (next !== again) {
      setNext('');
      setAgain('');
      setError('The new PIN and the same again were not the same. Please type the new one twice.');
      return;
    }
    setError('');
    setWorking(true);
    try {
      const result = await changePin(current, next);
      clear();
      onDone(result.message);
    } catch (failure) {
      clear();
      setError(failure instanceof Error ? failure.message : 'That did not work. Please try again.');
      first.current?.focus();
    } finally {
      setWorking(false);
    }
  }

  const errorId = `${id}-error`;
  const field = (
    name: string,
    label: string,
    value: string,
    set: (value: string) => void,
    ref?: RefObject<HTMLInputElement>,
  ): JSX.Element => (
    <div className="space-y-2">
      <label htmlFor={`${id}-${name}`} className="block font-bold">
        {label}
      </label>
      <input
        ref={ref}
        id={`${id}-${name}`}
        name={name}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={value}
        aria-describedby={error ? `${id}-hint ${errorId}` : `${id}-hint`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => set(digits(event.target.value))}
        className={PIN_FIELD}
      />
    </div>
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4 max-w-xl"
      aria-labelledby={`${id}-heading`}
    >
      <h3 id={`${id}-heading`} className="text-lead font-bold m-0">
        Change your PIN
      </h3>
      <p id={`${id}-hint`} className="m-0 text-paper/90">
        Four numbers each. The new one must not be 1234, the same number four times, or a year.
        After three wrong tries at your current PIN it locks for 15 minutes, to keep your account
        safe.
      </p>
      {field('current-pin', 'Your current PIN', current, setCurrent, first)}
      {field('new-pin', 'Your new PIN', next, setNext)}
      {field('new-pin-again', 'The new PIN again', again, setAgain)}
      {error !== '' && (
        <p
          id={errorId}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={working} className="control bg-highlight text-on-accent">
          {working ? 'One moment…' : 'Change my PIN'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="control bg-paper/10 text-paper underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
