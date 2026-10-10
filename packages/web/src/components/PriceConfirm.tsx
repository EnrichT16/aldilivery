import { useState } from 'react';

/**
 * Asks before any money is taken (Rule One): the first press says the price and what it is
 * for, and only the second press, "Yes, …", takes it. Ozi reads the question out too.
 */
export function PriceConfirm({
  start,
  question,
  yes,
  busy,
  onYes,
  onAsk,
}: {
  /** The first button: "Get Ozi Plus". */
  start: string;
  /** "£10.00 will be taken from your saved card now, and each month until you cancel. Is that all right?" */
  question: string;
  /** The button that takes the money: "Yes, join Ozi Membership for £10.00 a month". */
  yes: string;
  busy: boolean;
  onYes: () => void;
  /** Told when the question is put, so Ozi can say it. */
  onAsk?: (question: string) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => {
          setAsking(true);
          onAsk?.(question);
        }}
        className="control w-full bg-highlight text-ink text-lead"
      >
        {start}
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="m-0 font-bold">{question}</p>
      <button
        type="button"
        disabled={busy}
        onClick={onYes}
        className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
      >
        {yes}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="control bg-paper/10 text-paper underline"
      >
        Not now
      </button>
    </div>
  );
}
