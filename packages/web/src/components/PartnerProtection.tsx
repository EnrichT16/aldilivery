import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  answerPartnerPromise,
  confirmPartnerAmbassador,
  fetchPartnerProtection,
  refusePartnerAmbassador,
  reportPartnerAmbassador,
  resendPartnerAmbassadorCode,
  type PartnerProtection as View,
} from '../lib/api';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

function longDate(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * On the partner dashboard (Anthony, 31 October 2026): the payment warning, kept on the page, and
 * the three-line breakdown of what is free and what is paid; confirming, with the code texted to
 * the business's own mobile, that an Ambassador signed it up; "Were you promised anything that
 * isn't in your agreement?" once, about a week in; and "Report an Ambassador".
 */
export function PartnerProtection(): JSX.Element | null {
  const [view, setView] = useState<View | null>(null);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [promised, setPromised] = useState<'yes' | 'no' | ''>('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchPartnerProtection()
      .then(setView)
      .catch(() => setView(null));
  }, []);

  useEffect(load, [load]);

  const act = async (work: () => Promise<{ message: string }>): Promise<void> => {
    setBusy(true);
    setProblem('');
    try {
      const result = await work();
      setNews(result.message);
      load();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!view) return null;

  const confirm = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    void act(() => confirmPartnerAmbassador(code));
  };
  const report = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void act(async () => {
      const result = await reportPartnerAmbassador({
        who: String(data.get('who') ?? ''),
        note: String(data.get('note') ?? ''),
      });
      form.reset();
      return result;
    });
  };
  const answer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (promised === '') {
      setProblem('Please answer Yes or No.');
      return;
    }
    const note = String(new FormData(event.currentTarget).get('promise-note') ?? '');
    void act(() => answerPartnerPromise(promised, note));
  };

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="free-joining-dashboard"
        className="space-y-3 border-4 border-highlight rounded-2xl p-4"
      >
        <h2 id="free-joining-dashboard" className="text-lead font-bold m-0">
          Joining is free
        </h2>
        <p className="m-0">{view.freeJoiningWords}</p>
        <h3 className="font-bold m-0">What you pay</h3>
        <ul className="m-0 ps-6 space-y-1">
          <li>{view.costLines.joining}</li>
          <li>{view.costLines.preferred}</li>
          <li>{view.costLines.extras}</li>
        </ul>
      </section>

      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}

      {view.ambassador?.waiting && (
        <form
          aria-labelledby="confirm-ambassador-heading"
          onSubmit={confirm}
          className="space-y-3 border-2 border-highlight rounded-2xl p-4"
        >
          <h2 id="confirm-ambassador-heading" className="text-lead font-bold m-0">
            Did {view.ambassador.firstName} sign up your business?
          </h2>
          <p className="m-0">
            {view.ambassador.firstName}, an Ambassador, says they signed up your business. If that
            is right, type the code we texted to your business mobile. Do it yourself, here, on your
            own phone or computer. Never give the code to anybody.
          </p>
          <label htmlFor="ambassador-code" className="block font-bold">
            The code from the text
          </label>
          <input
            id="ambassador-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${field} max-w-xs text-lead tracking-widest`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(resendPartnerAmbassadorCode)}
              className="control border-paper bg-paper/10 text-paper"
            >
              Send me a new code
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(refusePartnerAmbassador)}
              className="control border-paper bg-paper/10 text-paper"
            >
              This person did not sign us up
            </button>
          </div>
        </form>
      )}
      {view.ambassador?.confirmed && view.ambassador.confirmedAt && (
        <p className="m-0">
          Introduced by {view.ambassador.firstName}, an Ambassador. You confirmed it on{' '}
          {longDate(view.ambassador.confirmedAt)}.
        </p>
      )}

      {view.promise && (
        <form
          aria-labelledby="promise-heading"
          onSubmit={answer}
          className="space-y-3 border-2 border-highlight rounded-2xl p-4"
        >
          <h2 id="promise-heading" className="text-lead font-bold m-0">
            A quick question
          </h2>
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="font-bold mb-2">{view.promise.question}</legend>
            <div className="flex flex-wrap gap-4">
              {(['yes', 'no'] as const).map((choice) => (
                <label key={choice} className="flex items-center gap-2 min-h-control">
                  <input
                    type="radio"
                    name="promised"
                    value={choice}
                    checked={promised === choice}
                    onChange={() => setPromised(choice)}
                    className="w-6 h-6"
                  />
                  {choice === 'yes' ? 'Yes' : 'No'}
                </label>
              ))}
            </div>
          </fieldset>
          {promised === 'yes' && (
            <div className="space-y-2">
              <label htmlFor="promise-note" className="block font-bold">
                What were you promised?
              </label>
              <textarea id="promise-note" name="promise-note" rows={3} className={field} />
            </div>
          )}
          <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
            Send my answer
          </button>
        </form>
      )}

      <section aria-labelledby="report-ambassador-heading" className="space-y-3">
        <h2 id="report-ambassador-heading" className="text-lead font-bold m-0">
          Report an Ambassador
        </h2>
        <p className="m-0">
          If an Ambassador asked you for money, promised something that is not in your agreement, or
          asked for bank or card details, tell us. The founder looks at every report.
        </p>
        <form onSubmit={report} className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="report-who" className="block font-bold">
              Their first name or code (if you know it)
            </label>
            <input id="report-who" name="who" autoComplete="off" className={field} />
          </div>
          <div className="space-y-2">
            <label htmlFor="report-note" className="block font-bold">
              What happened
            </label>
            <textarea id="report-note" name="note" rows={3} required className={field} />
          </div>
          <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
            Send the report
          </button>
        </form>
      </section>
    </div>
  );
}
