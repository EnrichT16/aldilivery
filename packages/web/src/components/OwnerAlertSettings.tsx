import { useEffect, useState, type FormEvent } from 'react';

import {
  fetchOwnerAlerts,
  saveOwnerAlerts,
  type AlertKind,
  type AlertWay,
  type OwnerAlerts,
} from '../lib/owner-controls-api';

const WAY_SHORT: Record<AlertWay, string> = {
  call: 'Call me',
  text: 'Text me',
  notification: 'A notification',
  none: 'Nothing, I will ask',
};

/**
 * How Ozi reaches the owner (ruling 85), in My settings: for each kind of matter, a call, a
 * text, a notification or nothing, as a group of radio buttons each, and his quiet hours. The
 * same settings he changes by voice. Urgent safety always calls, and is shown but not changed.
 * Shown only to the owner; if the settings cannot be read, nothing is shown.
 */
export function OwnerAlertSettings({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element | null {
  const [alerts, setAlerts] = useState<OwnerAlerts | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    fetchOwnerAlerts(staffKey)
      .then((result) => setAlerts(Array.isArray(result.kinds) ? result : null))
      .catch(() => setAlerts(null));
  };
  useEffect(load, [staffKey]);

  if (!alerts) return null;
  const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const changes: Parameters<typeof saveOwnerAlerts>[1] = {};
    for (const row of alerts.kinds) {
      if (row.fixed) continue;
      const chosen = data.get(`alert-${row.kind}`);
      if (typeof chosen === 'string' && chosen !== alerts.ways[row.kind]) {
        changes[row.kind as Exclude<AlertKind, 'urgentSafety'>] = chosen as AlertWay;
      }
    }
    const from = String(data.get('quiet-from') ?? '');
    const until = String(data.get('quiet-until') ?? '');
    if (from && from !== alerts.quietFrom) changes.quietFrom = from;
    if (until && until !== alerts.quietUntil) changes.quietUntil = until;
    if (Object.keys(changes).length === 0) {
      onNews('Nothing changed.');
      return;
    }
    setProblem('');
    setBusy(true);
    saveOwnerAlerts(staffKey, changes)
      .then((result) => {
        onNews(result.message);
        load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="owner-alerts-heading" className="space-y-4">
      <h3 id="owner-alerts-heading" className="text-lead font-bold m-0">
        How Ozi reaches me
      </h3>
      <p className="m-0">
        For each kind of thing, choose a call, a text, a notification on your devices, or nothing,
        so it only waits on the Needs you now page until you ask. Urgent safety always rings you,
        even in quiet hours. You can also tell Ozi by voice.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <form onSubmit={save} className="space-y-4">
        {alerts.kinds.map((row) =>
          row.fixed ? (
            <p key={row.kind} className="m-0">
              <strong>Urgent safety</strong>: always a call, even in quiet hours.
            </p>
          ) : (
            <fieldset key={row.kind} className="border-2 border-paper rounded-2xl p-4 space-y-2">
              <legend className="font-bold px-1">
                {row.label.charAt(0).toUpperCase() + row.label.slice(1)}
              </legend>
              <div className="flex flex-wrap gap-3">
                {alerts.choices.map((choice) => (
                  <label key={choice.way} className="control flex items-center gap-2">
                    <input
                      type="radio"
                      name={`alert-${row.kind}`}
                      value={choice.way}
                      defaultChecked={row.way === choice.way}
                    />
                    {WAY_SHORT[choice.way]}
                  </label>
                ))}
              </div>
            </fieldset>
          ),
        )}
        <fieldset className="border-2 border-paper rounded-2xl p-4 space-y-2">
          <legend className="font-bold px-1">Quiet hours, UK time</legend>
          <label htmlFor="quiet-from" className="block">
            Quiet from
          </label>
          <input
            id="quiet-from"
            name="quiet-from"
            type="time"
            defaultValue={alerts.quietFrom}
            className={field}
          />
          <label htmlFor="quiet-until" className="block">
            Quiet until
          </label>
          <input
            id="quiet-until"
            name="quiet-until"
            type="time"
            defaultValue={alerts.quietUntil}
            className={field}
          />
        </fieldset>
        <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
          Save how Ozi reaches me
        </button>
      </form>
    </section>
  );
}
