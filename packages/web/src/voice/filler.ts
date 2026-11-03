/**
 * What Ozi says while an answer is slow (ruling 92, 3 November 2026): nothing at first, then one
 * short, varied filler after `ozi.fillerAfterMs` (config/store.json) of silence, never the same
 * one twice in a row, and never once the reply has started to arrive. Replaces "One moment,
 * Mr. Anthony." at three seconds, which the owner heard as scripted before his name again at the
 * start of the answer.
 */

import { storeConfig } from '../config';

/** Short and plain; none uses a name, so no name is heard twice. */
export const FILLERS = ['Just checking.', 'One moment.', 'Bear with me.', 'Let me see.'] as const;

let lastFiller: string | null = null;

/** The next filler: never the one said last time. */
export function nextFiller(): string {
  const choices = FILLERS.filter((one) => one !== lastFiller);
  const chosen = choices[Math.floor(Math.random() * choices.length)] ?? FILLERS[0];
  lastFiller = chosen;
  return chosen;
}

/** For tests: as if nothing had been said yet. */
export function forgetLastFiller(): void {
  lastFiller = null;
}

/**
 * Starts the wait: says a filler if nothing has arrived after `afterMs`. `arrived()` is called
 * on the first sentence or status (or the whole reply), and `stop()` at the end, either of which
 * means no filler is said after all.
 */
export function fillerWhileWaiting(
  say: (words: string) => void,
  afterMs: number = storeConfig.ozi.fillerAfterMs,
): { arrived: () => void; stop: () => void } {
  let timer: number | null = window.setTimeout(() => {
    timer = null;
    say(nextFiller());
  }, afterMs);
  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return { arrived: stop, stop };
}
