import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { money } from '../lib/money';
import {
  decideRunnerDeposit,
  endStaffSos,
  fetchReferrals,
  fetchStaffSos,
  fetchWaitingDeposits,
  giveReferralReward,
  removeRunner,
  type ReferrerTally,
  type StaffSos,
  type WaitingDeposit,
} from '../lib/runner-api';

/**
 * Small parts of the admin panel for Runners (Section M; rulings 12 and 16; docs/LEGAL_REVIEW.md),
 * each kept apart from the tab it sits in:
 *
 * - ActiveSos, in Problems: every SOS still on, with where the Runner is and their own number.
 * - RemoveRunner, in Documents: ending a Runner's work with us, with the reason.
 * - WaitingDeposits, in Money owed: a cool bag deposit that waits for a written decision.
 * - ReferralRewards, in Money, the owner's alone: the private referral reward. Not announced.
 */

interface PanelProps {
  staffKey: string;
  by: string;
  onNews: (news: string) => void;
}

function useLoad<T>(load: () => Promise<T>): {
  data: T | null;
  problem: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState('');
  const [count, setCount] = useState(0);
  const reload = useCallback(() => setCount((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setProblem(failure instanceof Error ? failure.message : 'It did not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [load, count]);
  return { data, problem, reload };
}

function Problem({ text }: { text: string }): JSX.Element | null {
  if (text === '') return null;
  return (
    <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
      {text}
    </p>
  );
}

function time(at: string | null): string {
  return at
    ? new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : 'not yet';
}

export function ActiveSos({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const load = useCallback(() => fetchStaffSos(staffKey), [staffKey]);
  const list = useLoad(load);
  const [problem, setProblem] = useState('');
  const rows: StaffSos[] = list.data?.sos ?? [];
  const on = rows.filter((row) => row.on);

  // Looked at again every twenty seconds while the panel is open.
  useEffect(() => {
    const timer = window.setInterval(list.reload, 20_000);
    return () => window.clearInterval(timer);
  }, [list.reload]);

  return (
    <section aria-labelledby="sos-staff-heading" className="space-y-3 max-w-2xl">
      <h2 id="sos-staff-heading" className="text-lead font-bold">
        Runner SOS {list.data ? `(${on.length} on)` : ''}
      </h2>
      <Problem text={list.problem || problem} />
      {list.data && rows.length === 0 && <p className="m-0">No SOS in the last day.</p>}
      <ul className="list-none m-0 p-0 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`rounded-xl p-4 ${row.on ? 'border-4 border-paper' : 'border-2 border-paper/40'}`}
          >
            <p className="m-0 font-bold">
              {row.on ? 'On now' : 'Over'}: {row.runner?.name ?? 'A Runner'} (
              {row.runner?.runnerId ?? ''}), from {time(row.startedAt)}
              {row.reference ? `, order ${row.reference}` : ''}.
            </p>
            {row.runner && (
              <p className="m-0">
                Ring them:{' '}
                <a href={`tel:${row.runner.phone}`} className="underline">
                  {row.runner.phone}
                </a>
                . If you cannot reach them, call 999.
              </p>
            )}
            <p className="m-0">
              {row.mapsLink ? (
                <>
                  Last known place at {time(row.locationAt)}:{' '}
                  <a
                    href={row.mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    open it in maps
                  </a>
                  .
                </>
              ) : (
                'Their phone has not shared where they are.'
              )}
              {row.alertProblem ? ` ${row.alertProblem}` : ''}
            </p>
            {row.on && (
              <button
                type="button"
                onClick={() => {
                  setProblem('');
                  endStaffSos(staffKey, row.id, by)
                    .then((result) => {
                      onNews(result.message);
                      list.reload();
                    })
                    .catch((failure: unknown) =>
                      setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
                    );
                }}
                className="control bg-paper text-ink mt-2"
              >
                Mark as over<span className="visually-hidden">: {row.runner?.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RemoveRunner({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const runner = String(data.get('runner') ?? '').trim();
    const reason = String(data.get('reason') ?? '').trim();
    if (runner === '' || reason === '') {
      setProblem('Please give the Runner ID and the reason.');
      return;
    }
    setBusy(true);
    setProblem('');
    removeRunner(staffKey, runner, by, reason)
      .then((result) => {
        form.reset();
        onNews(result.message);
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section aria-labelledby="remove-heading" className="space-y-3 max-w-2xl">
      <h2 id="remove-heading" className="text-lead font-bold">
        Remove a Runner
      </h2>
      <p className="m-0 extra">
        For a check failed or lapsed, or serious misconduct. They are told the reason, and any cool
        bag deposit held is paid back unless money is owed after a decision.
      </p>
      <Problem text={problem} />
      <form onSubmit={submit} noValidate className="space-y-3">
        <label htmlFor="remove-runner" className="block font-bold">
          Runner ID
        </label>
        <input
          id="remove-runner"
          name="runner"
          className="w-full max-w-xs min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
        />
        <label htmlFor="remove-reason" className="block font-bold">
          Why
        </label>
        <textarea
          id="remove-reason"
          name="reason"
          rows={3}
          className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
        />
        <button
          type="submit"
          disabled={busy}
          className="control bg-paper text-ink disabled:opacity-70"
        >
          Remove this Runner
        </button>
      </form>
    </section>
  );
}

export function WaitingDeposits({ staffKey, by, onNews }: PanelProps): JSX.Element | null {
  const load = useCallback(() => fetchWaitingDeposits(staffKey), [staffKey]);
  const list = useLoad(load);
  const [problem, setProblem] = useState('');
  const rows: WaitingDeposit[] = list.data?.deposits ?? [];
  if (list.data && rows.length === 0) return null;

  function decide(event: FormEvent<HTMLFormElement>, row: WaitingDeposit): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pounds = Number(String(data.get('keep') ?? '0').replace(/[£,\s]/g, '') || '0');
    const note = String(data.get('note') ?? '').trim();
    if (!Number.isFinite(pounds) || pounds < 0) {
      setProblem('Please give the amount kept in pounds and pence, or 0.');
      return;
    }
    setProblem('');
    decideRunnerDeposit(staffKey, row.id, { by, keepPence: Math.round(pounds * 100), note })
      .then((result) => {
        onNews(result.message);
        list.reload();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  }

  return (
    <section aria-labelledby="deposits-heading" className="space-y-3 max-w-2xl">
      <h2 id="deposits-heading" className="text-lead font-bold">
        Cool bag deposits of Runners who have left
      </h2>
      <p className="m-0 extra">
        Paid back by themselves unless money is owed after a decision. Then you decide, in writing,
        within 14 days: keep no more than is owed, and say why.
      </p>
      <Problem text={list.problem || problem} />
      {rows.map((row) => (
        <form
          key={row.id}
          onSubmit={(event) => decide(event, row)}
          noValidate
          className="space-y-2 border-2 border-paper/40 rounded-xl p-4"
        >
          <p className="m-0 font-bold">
            {row.name} ({row.runnerId}): {money(row.heldPence)} held, {money(row.owedPence)} owed.
          </p>
          {row.note && <p className="m-0">{row.note}</p>}
          <label htmlFor={`keep-${row.id}`} className="block">
            Kept against what is owed, in pounds
          </label>
          <input
            id={`keep-${row.id}`}
            name="keep"
            inputMode="decimal"
            defaultValue="0"
            className="w-full max-w-xs min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          <label htmlFor={`note-${row.id}`} className="block">
            What you will tell them, in writing
          </label>
          <textarea
            id={`note-${row.id}`}
            name="note"
            rows={2}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          <button type="submit" className="control bg-paper text-ink">
            Decide and pay back the rest<span className="visually-hidden">: {row.name}</span>
          </button>
        </form>
      ))}
    </section>
  );
}

export function ReferralRewards({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const load = useCallback(() => fetchReferrals(staffKey), [staffKey]);
  const list = useLoad(load);
  const [problem, setProblem] = useState('');
  const data = list.data;
  const rows: ReferrerTally[] = data?.referrers ?? [];
  return (
    <section aria-labelledby="referral-heading" className="space-y-3 max-w-3xl">
      <h2 id="referral-heading" className="text-lead font-bold">
        Referral reward (private)
      </h2>
      {data && (
        <p className="m-0">
          {money(data.rewardPence)} when someone has referred {data.needed} people who each paid for
          an order that was not refunded. Not announced in the app. People who referred themselves,
          or share a card or an address, are not counted.
        </p>
      )}
      <Problem text={list.problem || problem} />
      {data && rows.length === 0 && <p className="m-0">Nobody has referred anybody yet.</p>}
      {rows.length > 0 && (
        <table className="w-full border-collapse">
          <caption className="text-left font-bold py-2">Who has referred people</caption>
          <thead>
            <tr>
              {['Who', 'Joined', 'Counted', 'Not counted', 'Reward'].map((cell) => (
                <th key={cell} scope="col" className="text-left border-b-2 border-paper p-2">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.referrer}>
                <th scope="row" className="text-left font-normal border-b border-paper/40 p-2">
                  {row.name} ({row.kind === 'runner' ? 'Runner' : 'Shopper'})
                </th>
                <td className="border-b border-paper/40 p-2">{row.joined}</td>
                <td className="border-b border-paper/40 p-2">
                  {row.counted}
                  {row.notYet > 0 ? `, ${row.notYet} not paid yet` : ''}
                </td>
                <td className="border-b border-paper/40 p-2">
                  {row.excluded.self} themselves, {row.excluded.sameCard} same card,{' '}
                  {row.excluded.sameAddress} same address
                </td>
                <td className="border-b border-paper/40 p-2">
                  {row.due ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProblem('');
                        giveReferralReward(staffKey, row.referrer, by)
                          .then((result) => {
                            onNews(result.message);
                            list.reload();
                          })
                          .catch((failure: unknown) =>
                            setProblem(
                              failure instanceof Error ? failure.message : 'That did not work.',
                            ),
                          );
                      }}
                      className="control bg-highlight text-ink"
                    >
                      Give the reward<span className="visually-hidden"> to {row.name}</span>
                    </button>
                  ) : (
                    `${row.rewardsGiven} given`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
