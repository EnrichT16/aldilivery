import { useEffect, useState } from 'react';

import { answerWhyStopped, askWhyStopped, type CheckoutReason } from '../lib/api';

/**
 * "Can we ask what stopped you?" (Anthony, 30 October 2026).
 *
 * When a Shopper leaves the page to pay without paying, or presses back, the Confirm page says so
 * here (`leftCheckout`). This small, optional question then appears on the page they went to, if
 * the server says it may be asked: never more than once a day for one Shopper. A tap on an answer
 * records it; "No thanks" closes it, and nothing more is kept. Nobody is ever texted or emailed
 * about a checkout they left: there is no marketing without consent.
 *
 * It is a small region with a heading, never a dialog that traps the keyboard: it is announced
 * politely, and the page underneath can be used as it is.
 */

export interface LeftCheckout {
  restaurant: boolean;
  totalPence: number;
  area: string;
}

type Listener = (left: LeftCheckout) => void;
const listeners = new Set<Listener>();

/** The Confirm page was left without paying. */
export function leftCheckout(left: LeftCheckout): void {
  for (const listener of listeners) listener(left);
}

export function WhyStopped(): JSX.Element | null {
  const [asking, setAsking] = useState<{
    left: LeftCheckout;
    question: string;
    answers: Array<{ answer: CheckoutReason; label: string }>;
  } | null>(null);
  const [thanks, setThanks] = useState('');

  useEffect(() => {
    const listener: Listener = (left) => {
      askWhyStopped()
        .then((result) => {
          if (result.ask) {
            setThanks('');
            setAsking({ left, question: result.question, answers: result.answers });
          }
        })
        .catch(() => undefined);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!asking && thanks === '') return null;

  if (!asking) {
    return (
      <p role="status" className="m-0">
        {thanks}
      </p>
    );
  }

  const choose = (answer: CheckoutReason): void => {
    const { left } = asking;
    setAsking(null);
    answerWhyStopped({ answer, ...left })
      .then((result) => setThanks(result.message))
      .catch(() => setThanks('Thank you.'));
  };

  return (
    <section
      aria-labelledby="why-stopped-heading"
      aria-live="polite"
      className="border-2 border-highlight rounded-2xl p-4 space-y-3 max-w-xl"
    >
      <h2 id="why-stopped-heading" className="text-lead font-bold m-0">
        {asking.question}
      </h2>
      <p className="m-0">You do not have to answer. One tap is all it takes.</p>
      <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
        {asking.answers.map((option) => (
          <li key={option.answer}>
            <button
              type="button"
              onClick={() => choose(option.answer)}
              className="control border-paper bg-paper/10 text-paper"
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setAsking(null)}
        className="control bg-paper/10 text-paper underline"
      >
        No thanks
      </button>
    </section>
  );
}
