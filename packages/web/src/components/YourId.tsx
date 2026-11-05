import { idReadOut, spellId } from '@aldilivery/core';

import { useOzi } from '../state/ozi';

/**
 * A person's own speakable ID (ruling 97, 5 November 2026): "Your Shopper ID: S-7K4M2X", shown
 * with its characters spaced so a screen reader and a tired eye both read it one by one, and a
 * button for Ozi to read it out, spelt in groups. Nothing here is ever said unasked.
 */
export function YourId({
  words,
  id,
  heading = true,
}: {
  /** "Shopper ID", "Partner ID", "Organisation ID", "Staff ID" or "Runner ID". */
  words: string;
  /** The ID, or null while the server has not given one yet. */
  id: string | null | undefined;
  /** Shown as its own section with a heading, or as one line inside another section. */
  heading?: boolean;
}): JSX.Element | null {
  const ozi = useOzi();
  if (!id) return null;
  const line = (
    <p className="m-0">
      Your {words}:{' '}
      <span className="font-bold" aria-label={spellId(id)}>
        {id.split('').join(' ')}
      </span>
      . Quote it when you speak to us.
    </p>
  );
  const button = (
    <button
      type="button"
      onClick={() => void ozi.say(idReadOut(words, id))}
      className="control border-paper bg-paper/10 text-paper"
    >
      Read my {words} out
    </button>
  );
  if (!heading) {
    return (
      <div className="space-y-2">
        {line}
        {button}
      </div>
    );
  }
  const slug = words.toLowerCase().replace(/[^a-z]+/g, '-');
  return (
    <section aria-labelledby={`${slug}-heading`} className="space-y-3 max-w-xl">
      <h2 id={`${slug}-heading`} className="text-lead font-bold m-0">
        Your {words}
      </h2>
      {line}
      {button}
    </section>
  );
}
