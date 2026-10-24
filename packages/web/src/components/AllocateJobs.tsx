import { useCallback, useEffect, useRef, useState } from 'react';

import {
  allocateJobs,
  fetchAllocateBoard,
  type AllocateBoard,
  type AllocateOutcome,
  type Assignment,
} from '../lib/allocate-api';
import { money } from '../lib/money';

const FIELD = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
/** How often the view looks again, so a job that came back is told to whoever sent it. */
const LOOK_AGAIN_MS = 20_000;

function clock(at: string): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function jobsWords(count: number): string {
  return count === 0 ? 'holds no jobs' : `holds ${count} ${count === 1 ? 'job' : 'jobs'}`;
}

/**
 * "Allocate jobs" (ruling 80): the orders waiting or offered, each with a checkbox, and the
 * approved Runners, on shift first, each with the jobs they hold and how they travel. Choose
 * orders, choose a Runner, press "Send to Runner"; repeat for other Runners; or send one order on
 * its own with its "Send to" picker. Every control is a real form control with its own words, so
 * it works by keyboard, with a screen reader, and by voice through Ozi. The results are read
 * back in the status line: "4 orders sent to Tomasz; 1 could not be: …".
 */
export function AllocateJobs({
  staffKey,
  onNews = () => undefined,
}: {
  staffKey: string;
  onNews?: (news: string) => void;
}): JSX.Element {
  const [board, setBoard] = useState<AllocateBoard | null>(null);
  const [problem, setProblem] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runnerId, setRunnerId] = useState('');
  const [backupId, setBackupId] = useState('');
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AllocateOutcome | null>(null);
  const [single, setSingle] = useState<Record<string, string>>({});
  // What each recent sending was last seen as, so a job that came back is said once.
  const seen = useRef<Map<string, string> | null>(null);
  const tell = useRef(onNews);
  tell.current = onNews;

  const load = useCallback(() => {
    fetchAllocateBoard(staffKey)
      .then((next) => {
        setProblem('');
        setBoard(next);
        const before = seen.current;
        seen.current = new Map(next.recent.map((row) => [row.id, row.status]));
        if (!before) return;
        const back = next.recent.filter(
          (row) =>
            (row.status === 'declined' || row.status === 'expired') &&
            before.get(row.id) !== row.status,
        );
        if (back.length > 0) {
          tell.current(back.map((row) => `Order ${row.reference ?? ''}: ${row.words}`).join(' '));
        }
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be loaded.'),
      );
  }, [staffKey]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, LOOK_AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const send = (assignments: Assignment[]): void => {
    if (assignments.length === 0) return;
    setBusy(true);
    setProblem('');
    allocateJobs(staffKey, assignments)
      .then((result) => {
        setOutcome(result);
        onNews(result.message);
        setSelected(new Set());
        load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  };

  const orders = board?.orders ?? [];
  const runners = board?.runners ?? [];
  const allChosen = orders.length > 0 && orders.every((order) => selected.has(order.id));
  const chosenRunner = runners.find((runner) => runner.id === runnerId) ?? null;

  const toggle = (id: string, on: boolean): void =>
    setSelected((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const sendChosen = (): void => {
    if (selected.size === 0) return setProblem('Please choose at least one order.');
    if (!chosenRunner) return setProblem('Please choose the Runner to send them to.');
    send(
      orders
        .filter((order) => selected.has(order.id))
        .map((order) => ({
          orderId: order.id,
          runnerId: chosenRunner.id,
          ...(backupId && backupId !== chosenRunner.id ? { backupRunnerId: backupId } : {}),
          ...(early ? { allowEarly: true } : {}),
        })),
    );
  };

  return (
    <section aria-labelledby="allocate-heading" className="space-y-4 max-w-3xl">
      <h2 id="allocate-heading" className="text-lead font-bold">
        Allocate jobs
      </h2>
      <p className="m-0 extra">
        Send any order straight to a Runner you choose, outside the queue. The Runner still says yes
        or no: it reaches them at once, held for them alone for {board?.holdMinutes ?? 10} minutes.
        A Runner sent several gets them one after another, in the order you sent them. If they say
        no or the time runs out, it goes to the backup you chose, or back to the queue, and you are
        told.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <p role="status" aria-live="polite" className="m-0 min-h-control">
        {outcome?.message ?? ''}
      </p>
      {outcome && outcome.refused > 0 && (
        <ul aria-label="Orders that could not be sent" className="m-0 ps-6 space-y-1">
          {outcome.results
            .filter((row) => row.result === 'refused')
            .map((row) => (
              <li key={`${row.orderId}-${row.runnerId}`}>
                Order {row.reference ?? row.orderId}: {row.reason}
              </li>
            ))}
        </ul>
      )}

      {board && orders.length === 0 && (
        <p className="m-0">No orders are waiting or offered right now.</p>
      )}

      {orders.length > 0 && (
        <fieldset className="space-y-3 border-2 border-paper rounded-2xl p-4">
          <legend className="font-bold px-2">
            {orders.length} {orders.length === 1 ? 'order' : 'orders'} waiting or offered, oldest
            first
          </legend>
          <button
            type="button"
            aria-pressed={allChosen}
            onClick={() =>
              setSelected(allChosen ? new Set() : new Set(orders.map((order) => order.id)))
            }
            className="control border-paper bg-paper/10 text-paper"
          >
            {allChosen ? 'Clear the selection' : `Select all ${orders.length}`}
          </button>
          <p className="m-0" aria-live="polite">
            {selected.size} chosen.
          </p>
          <ul className="list-none m-0 p-0 space-y-3">
            {orders.map((order) => {
              const pick = single[order.id] ?? '';
              return (
                <li key={order.id} className="border-2 border-paper/60 rounded-2xl p-3 space-y-2">
                  <label className="flex items-start gap-3 min-h-control cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={(event) => toggle(order.id, event.target.checked)}
                      className="mt-1 h-6 w-6 shrink-0"
                    />
                    <span>
                      <span className="font-bold">
                        {order.number}. Order {order.reference}
                      </span>
                      : {order.statusWords}. {order.itemCount}{' '}
                      {order.itemCount === 1 ? 'item' : 'items'}, about{' '}
                      {money(order.goodsEstimatePence)} of shopping
                      {order.area ? `, ${order.area}` : ''}. Waiting since{' '}
                      {clock(order.waitingSince)}.
                      {order.booked ? ` Booked for ${order.booked}.` : ''}
                      {order.bookedLater && order.offerAt
                        ? ` Held for its time, ${clock(order.offerAt)}, unless sent early.`
                        : ''}
                      {order.split ? ` ${order.split}.` : ''}
                      {order.largeWords ? ` ${order.largeWords}` : ''}
                      {order.sentTo
                        ? ` Sent to ${order.sentTo.runnerName ?? 'a Runner'} by ${order.sentTo.by}${order.sentTo.status === 'queued' ? ', waiting its turn' : ', offered now'}.`
                        : ''}
                    </span>
                  </label>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    aria-label={`Send order ${order.reference} on its own`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!pick)
                        return setProblem(`Please choose who gets order ${order.reference}.`);
                      send([
                        {
                          orderId: order.id,
                          runnerId: pick,
                          ...(early ? { allowEarly: true } : {}),
                        },
                      ]);
                    }}
                  >
                    <label className="block grow">
                      Send order {order.reference} to
                      <select
                        value={pick}
                        onChange={(event) =>
                          setSingle((was) => ({ ...was, [order.id]: event.target.value }))
                        }
                        className={FIELD}
                      >
                        <option value="">Choose a Runner</option>
                        {runners.map((runner) => (
                          <option key={runner.id} value={runner.id}>
                            {runner.name}, {runner.onShift ? 'on shift' : 'off shift'},{' '}
                            {runner.travelWords}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="control border-paper bg-paper/10 text-paper"
                    >
                      Send<span className="visually-hidden"> order {order.reference}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {runners.length > 0 && orders.length > 0 && (
        <fieldset className="space-y-2 border-2 border-paper rounded-2xl p-4">
          <legend className="font-bold px-2">Send the chosen orders to</legend>
          {runners.map((runner) => (
            <label key={runner.id} className="flex items-start gap-3 min-h-control cursor-pointer">
              <input
                type="radio"
                name="allocate-runner"
                value={runner.id}
                checked={runnerId === runner.id}
                onChange={() => setRunnerId(runner.id)}
                className="mt-1 h-6 w-6 shrink-0"
              />
              <span>
                {runner.name}, {runner.onShift ? 'on shift' : 'off shift'}, {runner.travelWords},{' '}
                {jobsWords(runner.holds)}.
              </span>
            </label>
          ))}
          <label className="block">
            Backup Runner, if they say no (optional)
            <select
              value={backupId}
              onChange={(event) => setBackupId(event.target.value)}
              className={FIELD}
            >
              <option value="">No backup: back to the queue</option>
              {runners
                .filter((runner) => runner.id !== runnerId)
                .map((runner) => (
                  <option key={runner.id} value={runner.id}>
                    {runner.name}, {runner.travelWords}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-start gap-3 min-h-control cursor-pointer">
            <input
              type="checkbox"
              checked={early}
              onChange={(event) => setEarly(event.target.checked)}
              className="mt-1 h-6 w-6 shrink-0"
            />
            <span>Send booked orders now, before their time</span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={sendChosen}
            className="control bg-highlight text-on-accent"
          >
            Send to Runner
            {chosenRunner ? (
              <span className="visually-hidden">
                : {selected.size} {selected.size === 1 ? 'order' : 'orders'} to{' '}
                {chosenRunner.firstName}
              </span>
            ) : null}
          </button>
        </fieldset>
      )}
      {board && runners.length === 0 && <p className="m-0">No Runner is approved yet.</p>}

      {board && board.recent.length > 0 && (
        <section aria-labelledby="allocate-recent-heading" className="space-y-2">
          <h3 id="allocate-recent-heading" className="m-0 font-bold">
            Sent lately
          </h3>
          <ul className="m-0 ps-6 space-y-1">
            {board.recent.map((row) => (
              <li key={row.id}>
                <time dateTime={row.at}>{clock(row.at)}</time>: order {row.reference ?? ''}, sent by{' '}
                {row.by}. {row.words}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
