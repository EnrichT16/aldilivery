import { useCallback, useEffect, useState } from 'react';

import { money } from '../lib/money';
import {
  choosePayoutSchedule,
  fetchPayoutSchedule,
  takeInstantPayout,
  type PayoutScheduleInfo,
} from '../lib/runner-api';

/**
 * When a Runner's money reaches their bank (ruling 16), on their Money tab: weekly by default, or
 * daily, or an instant payout now at Stripe's fee, which is shown before anything is sent.
 *
 * It says plainly what the choice controls: their pay and the money for the shopping still
 * reach their own Stripe account straight away; this is only how often Stripe sends it on.
 */
export function PayoutChoice({ onNews }: { onNews: (news: string) => void }): JSX.Element | null {
  const [info, setInfo] = useState<PayoutScheduleInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [askingInstant, setAskingInstant] = useState(false);

  const load = useCallback(() => {
    fetchPayoutSchedule()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  if (!info) return null;

  async function run(action: () => Promise<{ message: string }>): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await action();
      onNews(result.message);
      setAskingInstant(false);
      load();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
      load();
    } finally {
      setBusy(false);
    }
  }

  const { instant } = info;
  return (
    <section aria-labelledby="schedule-heading" className="space-y-3">
      <h2 id="schedule-heading" className="text-lead font-bold">
        When your money reaches your bank
      </h2>
      <p className="m-0">{info.words}</p>
      <p className="m-0 extra">{info.controls}</p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="font-bold">How often</legend>
        {(
          [
            ['weekly', 'Once a week, on a Friday'],
            ['daily', 'Every day'],
          ] as const
        ).map(([value, label]) => (
          <div key={value} className="flex items-center gap-3 min-h-control">
            <input
              type="radio"
              id={`schedule-${value}`}
              name="schedule"
              checked={info.schedule === value}
              disabled={busy}
              onChange={() => {
                void run(() => choosePayoutSchedule(value));
              }}
              className="h-6 w-6"
            />
            <label htmlFor={`schedule-${value}`}>{label}</label>
          </div>
        ))}
      </fieldset>

      <h3 className="font-bold m-0">Need it now?</h3>
      <p className="m-0">{instant.words}</p>
      {instant.possible &&
        (askingInstant ? (
          <div role="alert" className="space-y-3 border-2 border-highlight rounded-xl p-4">
            <p className="m-0">
              Send {money(instant.youGetPence)} to your debit card now? Stripe&rsquo;s fee of{' '}
              {money(instant.feePence)} is taken from the {money(instant.availablePence)}.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(() => takeInstantPayout(instant.youGetPence));
              }}
              className="control w-full bg-highlight text-ink disabled:opacity-70"
            >
              Yes, send {money(instant.youGetPence)} now
            </button>
            <button
              type="button"
              onClick={() => setAskingInstant(false)}
              className="control bg-paper/10 text-paper underline"
            >
              No, wait for my usual payout
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAskingInstant(true)}
            className="control bg-paper text-ink"
          >
            Get {money(instant.youGetPence)} now, for a {money(instant.feePence)} fee
          </button>
        ))}
    </section>
  );
}
