import { useId, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Agreeing again when our terms change (Anthony, 30 October 2026). Shown to a Shop Partner or an
 * Ambassador whose agreed version is older, the next time they sign in or open their dashboard:
 * the words, a link to the terms, an "I agree" tick and a button. The words are the server's, so
 * they are the same on every screen. Until they agree, some things wait (a partner's changes, an
 * Ambassador's withdrawals); nothing a Shopper relies on stops.
 */
export function TermsChanged({
  words,
  termsName,
  termsPath,
  onAgree,
}: {
  /** "Our terms have changed. Please read and agree to keep going." */
  words: string;
  /** "Shop Partner terms" or "Ozi Ambassador terms". */
  termsName: string;
  termsPath: string;
  /** Records the agreement; rejects with the reason it did not work. */
  onAgree: () => Promise<void>;
}): JSX.Element {
  const id = useId();
  const [ticked, setTicked] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  function agree(): void {
    if (!ticked) {
      setProblem(`Please tick to agree to the ${termsName} first.`);
      return;
    }
    setProblem('');
    setBusy(true);
    onAgree()
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-3 border-2 border-highlight p-4 rounded-2xl"
    >
      <h2 id={`${id}-heading`} className="text-lead font-bold m-0">
        Our terms have changed
      </h2>
      <p className="m-0">{words}</p>
      <p className="m-0">
        <Link to={termsPath} className="underline">
          Read the {termsName}
        </Link>
      </p>
      <div className="flex items-start gap-3">
        <input
          id={`${id}-tick`}
          type="checkbox"
          checked={ticked}
          onChange={(event) => setTicked(event.target.checked)}
          className="w-8 h-8 shrink-0"
        />
        <label htmlFor={`${id}-tick`} className="m-0 font-bold">
          I have read and agree to the new {termsName}
        </label>
      </div>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={agree}
        className="control bg-highlight text-on-accent"
      >
        {busy ? 'One moment…' : 'I agree'}
      </button>
    </section>
  );
}
