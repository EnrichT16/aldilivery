import { useState, type FormEvent } from 'react';

import { FEEDBACK_THEMES, type FeedbackTheme } from '@aldilivery/core';

import { sendOrderFeedback } from '../lib/api';
import { money } from '../lib/money';

const SCORES = [
  { value: 5, label: 'Very good' },
  { value: 4, label: 'Good' },
  { value: 3, label: 'All right' },
  { value: 2, label: 'Not good' },
  { value: 1, label: 'Poor' },
];

/**
 * How did it go? (docs/BUILD_PROMPT.md, Section O.) After a delivery, the Shopper can give a
 * score, tick what applies, or say a few words, or any one of them. Anything at all earns the
 * delivery credit, the same for praise as for a complaint, once per order. Shops only ever see
 * how often each thing comes up, never who said what.
 */
export function OrderFeedback({
  orderId,
  given,
  creditPence,
}: {
  orderId: string;
  given: boolean;
  creditPence: number;
}): JSX.Element {
  const [rating, setRating] = useState<number | null>(null);
  const [themes, setThemes] = useState<FeedbackTheme[]>([]);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(given ? 'Thank you, you have told us how it went.' : '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (rating === null && themes.length === 0 && message.trim() === '') {
      setProblem('Please choose a score, tick something, or say a few words.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const result = await sendOrderFeedback(orderId, {
        ...(rating !== null ? { rating } : {}),
        themes,
        message: message.trim(),
      });
      setSent(result.message);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="feedback-heading" className="space-y-3 max-w-xl">
      <h2 id="feedback-heading" className="text-lead font-bold">
        How did it go?
      </h2>
      <p role="status" className="m-0">
        {sent}
      </p>
      {sent === '' && (
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <p className="m-0 extra">
            {creditPence > 0
              ? `Tell us anything, good or bad, and ${money(creditPence)} comes off your next delivery. `
              : ''}
            Shops only ever see how often things come up, never who said what.
          </p>
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="font-bold">Your score</legend>
            {SCORES.map((score) => (
              <label key={score.value} className="flex items-center gap-3 min-h-control">
                <input
                  type="radio"
                  name="feedback-score"
                  checked={rating === score.value}
                  onChange={() => setRating(score.value)}
                  className="w-6 h-6"
                />
                {score.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="font-bold">Anything that applies</legend>
            {(Object.keys(FEEDBACK_THEMES) as FeedbackTheme[]).map((theme) => (
              <label key={theme} className="flex items-center gap-3 min-h-control">
                <input
                  type="checkbox"
                  checked={themes.includes(theme)}
                  onChange={(event) =>
                    setThemes((was) =>
                      event.target.checked ? [...was, theme] : was.filter((one) => one !== theme),
                    )
                  }
                  className="w-6 h-6"
                />
                {FEEDBACK_THEMES[theme]}
              </label>
            ))}
          </fieldset>
          <label htmlFor="feedback-words" className="block font-bold">
            In your own words
          </label>
          <textarea
            id="feedback-words"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={2000}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          {problem !== '' && (
            <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
              {problem}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            Send my feedback
          </button>
        </form>
      )}
    </section>
  );
}
