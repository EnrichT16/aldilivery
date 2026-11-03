import { useEffect, useState } from 'react';

import { ukClockWords, ukTimeAnswer } from '@aldilivery/core';

import { useOzi } from '../state/ozi';

/**
 * The clock on every signed-in dashboard (Anthony, 3 November 2026, ruling 93): the day, the date
 * and the time in UK time, in words ("Tuesday 3 November, 10:42"), moving on each minute.
 *
 * It is a button: a screen reader reads it when it is focused, and pressing it has Ozi say the
 * time and the date aloud, the same words as "what time is it". It is never announced on its own
 * (`aria-live="off"`), so a minute passing says nothing over whatever somebody is doing.
 */
export function LiveClock({ className = '' }: { className?: string }): JSX.Element {
  const ozi = useOzi();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    // The first tick lands on the next whole minute, then one every minute after it.
    const first = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, []);

  const words = ukClockWords(now);
  return (
    <button
      type="button"
      aria-live="off"
      onClick={() => void ozi.say(ukTimeAnswer(new Date()))}
      className={`control !px-3 bg-transparent text-paper whitespace-nowrap ${className}`}
    >
      <time dateTime={now.toISOString()}>{words}</time>
      <span className="visually-hidden">, UK time. Press to hear the time and the date.</span>
    </button>
  );
}
