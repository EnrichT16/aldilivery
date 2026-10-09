import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  confirmMyTwoStep,
  confirmTwoStep,
  fetchAuditLog,
  fetchCancellations,
  fetchPriceFreshness,
  fetchRefunds,
  fetchRunnersNow,
  fetchShopperAccount,
  fetchSignups,
  fetchStaffOrder,
  fetchStaffOrders,
  myTwoStepOff,
  newRecoveryCodes,
  searchShopperAccounts,
  shopperExportLink,
  startMyTwoStep,
  startTwoStep,
  twoStepOff,
  type AuditEntryRow,
  type ShopperAccountView,
  type StaffOrderDetail,
  type StaffTwoStep,
} from '../lib/api';
import { money } from '../lib/money';

/**
 * The admin panel's newer parts (Section Q): orders and their timelines, Runners working now,
 * the reports (signups, cancellations, refunds, price freshness), and, for the owner alone,
 * Shoppers' accounts, their data and the audit log. Also two-step codes for every staff
 * sign-in. Descriptive words carry the class `extra` (ruling 47): a screen reader always reads
 * them; they show on the screen only when "Show words on the screen" is on.
 */

const FIELD = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

function useLoad<T>(load: () => Promise<T>): {
  data: T | null;
  problem: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState('');
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(() => {
    loader
      .current()
      .then((result) => {
        setData(result);
        setProblem('');
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be loaded.'),
      );
  }, []);
  useEffect(reload, [reload]);
  return { data, problem, reload };
}

function Failure({ text }: { text: string }): JSX.Element | null {
  if (text === '') return null;
  return (
    <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
      {text}
    </p>
  );
}

function when(at: string): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A date box's value, the start of that day, as the server wants it. */
function dayStart(value: string): string | undefined {
  return value === '' ? undefined : new Date(`${value}T00:00:00`).toISOString();
}

/** The day after a date box's value, so "to" includes the whole day. */
function dayEnd(value: string): string | undefined {
  if (value === '') return undefined;
  const day = new Date(`${value}T00:00:00`);
  day.setDate(day.getDate() + 1);
  return day.toISOString();
}

function fail(set: (text: string) => void): (failure: unknown) => void {
  return (failure) => set(failure instanceof Error ? failure.message : 'That did not work.');
}

/* ----------------------------------------------------------------------------- orders */

export function Orders({ staffKey }: { staffKey: string }): JSX.Element {
  const [filters, setFilters] = useState<{
    view: 'live' | 'past' | 'all';
    status: string;
    search: string;
    from: string;
    to: string;
  }>({ view: 'live', status: '', search: '', from: '', to: '' });
  const list = useLoad(() =>
    fetchStaffOrders(staffKey, {
      view: filters.view,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { search: filters.search } : {}),
      ...(dayStart(filters.from) ? { from: dayStart(filters.from) } : {}),
      ...(dayEnd(filters.to) ? { to: dayEnd(filters.to) } : {}),
    }),
  );
  const { reload } = list;
  useEffect(reload, [filters, reload]);
  const [open, setOpen] = useState<StaffOrderDetail | null>(null);
  const [problem, setProblem] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string): string => String(data.get(name) ?? '').trim();
    const view = value('orders-view');
    setFilters({
      view: view === 'past' || view === 'all' ? view : 'live',
      status: value('orders-status'),
      search: value('orders-search'),
      from: value('orders-from'),
      to: value('orders-to'),
    });
  };

  return (
    <section aria-labelledby="orders-heading" className="space-y-4 max-w-3xl">
      <h2 id="orders-heading" className="text-lead font-bold">
        Orders
      </h2>
      <p className="m-0 extra">
        Live orders are still on their way; past orders have finished. Search by the reference, the
        Shopper&rsquo;s name, the Runner or the postcode district. Open one to hear everything that
        happened to it, in order.
      </p>
      <form onSubmit={submit} className="space-y-2" aria-label="Find orders">
        <label htmlFor="orders-view" className="block font-bold">
          Which orders
        </label>
        <select id="orders-view" name="orders-view" defaultValue="live" className={FIELD}>
          <option value="live">Live now</option>
          <option value="past">Past</option>
          <option value="all">All</option>
        </select>
        <label htmlFor="orders-status" className="block font-bold">
          Status
        </label>
        <select id="orders-status" name="orders-status" defaultValue="" className={FIELD}>
          <option value="">Any</option>
          {(list.data?.statuses ?? []).map((row) => (
            <option key={row.status} value={row.status}>
              {row.words}
            </option>
          ))}
        </select>
        <label htmlFor="orders-search" className="block font-bold">
          Search
        </label>
        <input id="orders-search" name="orders-search" type="search" className={FIELD} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block font-bold">
            From
            <input name="orders-from" type="date" className={FIELD} />
          </label>
          <label className="block font-bold">
            To
            <input name="orders-to" type="date" className={FIELD} />
          </label>
        </div>
        <button type="submit" className="control bg-highlight text-ink">
          Show orders
        </button>
      </form>
      <Failure text={list.problem || problem} />
      {list.data && (
        <p role="status" className="m-0">
          {list.data.orders.length === 0
            ? 'No orders match.'
            : `${list.data.orders.length} ${list.data.orders.length === 1 ? 'order' : 'orders'}.`}
        </p>
      )}
      <ul className="list-none m-0 p-0 space-y-3">
        {list.data?.orders.map((row) => (
          <li key={row.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <h3 className="m-0 font-bold">
              {row.reference}: {row.statusWords}
            </h3>
            <p className="m-0">
              {row.shopperName ?? 'A Shopper'}
              {row.area ? `, ${row.area}` : ''}. {row.itemCount}{' '}
              {row.itemCount === 1 ? 'item' : 'items'},{' '}
              {money(row.finalTotalPence ?? row.totalEstimatePence)}
              {row.paidBy === 'bank' ? ' by bank transfer' : ''}.
              {row.runnerName ? ` Runner: ${row.runnerName}.` : ''} Made {when(row.createdAt)}.
            </p>
            {row.cancelReason && <p className="m-0">Why cancelled: {row.cancelReason}</p>}
            <button
              type="button"
              onClick={() =>
                void fetchStaffOrder(staffKey, row.id).then(setOpen).catch(fail(setProblem))
              }
              className="control bg-paper text-ink"
            >
              Open the timeline<span className="visually-hidden"> for order {row.reference}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <section
          aria-labelledby="timeline-heading"
          className="border-2 border-highlight rounded-xl p-4 space-y-3"
        >
          <h3 id="timeline-heading" className="m-0 font-bold">
            Order {open.order.reference}, what happened
          </h3>
          <p className="m-0">
            {open.order.items.map((item) => `${item.quantity} x ${item.name}`).join(', ')}.
          </p>
          <ol className="m-0 ps-6 space-y-1">
            {open.timeline.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <time dateTime={event.at}>{when(event.at)}</time>: {event.what}
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="control bg-paper/10 text-paper underline"
          >
            Close the timeline
          </button>
        </section>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------- Runners */

export function RunnersNow({ staffKey }: { staffKey: string }): JSX.Element {
  const list = useLoad(() => fetchRunnersNow(staffKey));
  const data = list.data;
  return (
    <section aria-labelledby="runners-heading" className="space-y-4 max-w-3xl">
      <h2 id="runners-heading" className="text-lead font-bold">
        Runners
      </h2>
      <p className="m-0 extra">
        Who is working now, on shift or on a job, and what each Runner has earned for their
        deliveries.
      </p>
      <Failure text={list.problem} />
      {data && (
        <>
          <p className="m-0">
            {data.activeNow} active now: {data.onShift} on shift, {data.onAJob} on a job.
          </p>
          <table className="w-full border-collapse">
            <caption className="text-left font-bold py-2">Every Runner, active first</caption>
            <thead>
              <tr>
                {['Runner', 'Now', 'Jobs today', 'Today', 'This week', 'Altogether'].map((cell) => (
                  <th key={cell} scope="col" className="text-left border-b-2 border-paper p-2">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.runners.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="text-left font-normal border-b border-paper/40 p-2">
                    {row.name}
                  </th>
                  <td className="border-b border-paper/40 p-2">
                    {row.job ? `On order ${row.job.reference}` : row.onShift ? 'On shift' : 'Off'}
                  </td>
                  <td className="border-b border-paper/40 p-2">{row.jobsToday}</td>
                  <td className="border-b border-paper/40 p-2">{money(row.earnedTodayPence)}</td>
                  <td className="border-b border-paper/40 p-2">{money(row.earnedWeekPence)}</td>
                  <td className="border-b border-paper/40 p-2">{money(row.earnedAllTimePence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------- reports */

export function Reports({ staffKey }: { staffKey: string }): JSX.Element {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const signups = useLoad(() => fetchSignups(staffKey, period));
  const { reload } = signups;
  useEffect(reload, [period, reload]);
  const cancellations = useLoad(() => fetchCancellations(staffKey));
  const refunds = useLoad(() => fetchRefunds(staffKey));
  const prices = useLoad(() => fetchPriceFreshness(staffKey));

  return (
    <section aria-labelledby="reports-heading" className="space-y-8 max-w-3xl">
      <h2 id="reports-heading" className="text-lead font-bold">
        Reports
      </h2>

      <section aria-labelledby="signups-heading" className="space-y-3">
        <h3 id="signups-heading" className="font-bold m-0">
          Signups
        </h3>
        <label htmlFor="signups-period" className="block">
          By
        </label>
        <select
          id="signups-period"
          value={period}
          onChange={(event) =>
            setPeriod(
              event.target.value === 'day'
                ? 'day'
                : event.target.value === 'week'
                  ? 'week'
                  : 'month',
            )
          }
          className={FIELD}
        >
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
        <Failure text={signups.problem} />
        {signups.data && (
          <table className="w-full border-collapse">
            <caption className="text-left py-2 extra">
              Shoppers and Runners who signed up, newest last
            </caption>
            <thead>
              <tr>
                {['When', 'Shoppers', 'Runners'].map((cell) => (
                  <th key={cell} scope="col" className="text-left border-b-2 border-paper p-2">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signups.data.buckets.map((row) => (
                <tr key={row.from}>
                  <th scope="row" className="text-left font-normal border-b border-paper/40 p-2">
                    {row.label}
                  </th>
                  <td className="border-b border-paper/40 p-2">{row.shoppers}</td>
                  <td className="border-b border-paper/40 p-2">{row.runners}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="cancellations-heading" className="space-y-3">
        <h3 id="cancellations-heading" className="font-bold m-0">
          Cancellations, the last 30 days
        </h3>
        <Failure text={cancellations.problem} />
        {cancellations.data && (
          <>
            <p className="m-0">
              {cancellations.data.count === 0 ? 'None.' : `${cancellations.data.count} cancelled.`}
            </p>
            <ul className="m-0 ps-6">
              {cancellations.data.byReason.map((row) => (
                <li key={row.reason}>
                  {row.count}: {row.reason}
                </li>
              ))}
            </ul>
            <details>
              <summary className="control bg-paper/10 text-paper">Each cancellation</summary>
              <ul className="m-0 ps-6">
                {cancellations.data.cancellations.map((row) => (
                  <li key={row.id}>
                    {row.reference}, {when(row.at)}: {row.reason}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <section aria-labelledby="refunds-heading" className="space-y-3">
        <h3 id="refunds-heading" className="font-bold m-0">
          Refunds, the last 30 days
        </h3>
        <Failure text={refunds.problem} />
        {refunds.data && (
          <>
            <p className="m-0">
              {refunds.data.count === 0 ? 'None.' : `${refunds.data.count} went out`}
              {refunds.data.count > 0 && refunds.data.totalPence !== null
                ? `, ${money(refunds.data.totalPence)} altogether.`
                : refunds.data.count > 0
                  ? '.'
                  : ''}
            </p>
            <p className="m-0 extra">
              A refund of more than {money(refunds.data.ownerOnlyAbovePence)} is for the owner to
              give.
            </p>
            <ul className="m-0 ps-6 space-y-1">
              {refunds.data.refunds.map((row, index) => (
                <li key={`${row.at}-${index}`}>
                  {when(row.at)}, {money(row.amountPence)}: {row.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="prices-heading" className="space-y-3">
        <h3 id="prices-heading" className="font-bold m-0">
          How fresh the prices are
        </h3>
        <Failure text={prices.problem} />
        {prices.data && (
          <>
            <p className="m-0">
              Of {prices.data.catalogue.total} prices: {prices.data.catalogue.fresh} seen in the
              last week, {prices.data.catalogue.ageing} in the last month, and{' '}
              {prices.data.catalogue.stale} longer ago.
            </p>
            {prices.data.catalogue.oldest.length > 0 && (
              <details>
                <summary className="control bg-paper/10 text-paper">The oldest prices</summary>
                <ul className="m-0 ps-6">
                  {prices.data.catalogue.oldest.map((row) => (
                    <li key={row.id}>
                      {row.name}, {money(row.pricePence)}, last seen{' '}
                      {new Date(row.lastSeenAt).toLocaleDateString('en-GB')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {prices.data.shops.length > 0 && (
              <ul className="m-0 ps-6">
                {prices.data.shops.map((shop) => (
                  <li key={shop.id}>
                    {shop.name}:{' '}
                    {shop.lastUpdatedAt
                      ? `last updated ${new Date(shop.lastUpdatedAt).toLocaleDateString('en-GB')}`
                      : 'no products yet'}
                    {shop.stale ? ', not updated in the last 30 days' : ''}.
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}

/* ----------------------------------------------------------------------------- the owner's alone */

export function ShopperAccounts({ staffKey }: { staffKey: string }): JSX.Element {
  const [results, setResults] = useState<Array<{
    id: string;
    displayName: string;
    handle: string;
  }> | null>(null);
  const [open, setOpen] = useState<ShopperAccountView | null>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [problem, setProblem] = useState('');

  const search = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('shopper-search') ?? '').trim();
    setProblem('');
    searchShopperAccounts(staffKey, text)
      .then((result) => setResults(result.shoppers))
      .catch(fail(setProblem));
  };

  const account = open?.account;
  return (
    <section aria-labelledby="accounts-heading" className="space-y-4 max-w-3xl">
      <h2 id="accounts-heading" className="text-lead font-bold">
        Shopper accounts
      </h2>
      <p className="m-0">
        Only you can open a Shopper&rsquo;s account. Each one you open, and each export, is written
        in the audit log.
      </p>
      <form onSubmit={search} className="space-y-2" aria-label="Find a Shopper">
        <label htmlFor="shopper-search" className="block font-bold">
          Name, username or phone number
        </label>
        <input id="shopper-search" name="shopper-search" type="search" className={FIELD} />
        <button type="submit" className="control bg-highlight text-ink">
          Find
        </button>
      </form>
      <Failure text={problem} />
      {results && results.length === 0 && (
        <p role="status" className="m-0">
          Nobody matches.
        </p>
      )}
      <ul className="list-none m-0 p-0 space-y-2">
        {results?.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                void fetchShopperAccount(staffKey, row.id).then(setOpen).catch(fail(setProblem));
              }}
              className="control bg-paper text-ink"
            >
              Open {row.displayName}
              <span className="visually-hidden">, {row.handle}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && account && (
        <section
          aria-labelledby="account-heading"
          className="border-2 border-highlight rounded-xl p-4 space-y-3"
        >
          <h3 id="account-heading" className="m-0 font-bold">
            {account.displayName}
          </h3>
          <dl className="m-0 space-y-1">
            {(
              [
                ['Username', account.handle],
                ['Phone', account.phone],
                ['Home address', account.deliveryAddress || 'Not given'],
                ['Joined', new Date(account.createdAt).toLocaleDateString('en-GB')],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="inline font-bold">{label}: </dt>
                <dd className="inline m-0">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0">
            Cards:{' '}
            {open.cards.length === 0
              ? 'none'
              : open.cards
                  .map((card) => `${card.brand ?? 'card'} ending ${card.lastFour}`)
                  .join(', ')}
            . Saved addresses: {open.savedAddresses.length}. Regular orders:{' '}
            {open.regularOrders.length}. Complaints: {open.problems.length}.
          </p>
          <h4 className="m-0 font-bold">Orders</h4>
          {open.orders.length === 0 ? (
            <p className="m-0">None yet.</p>
          ) : (
            <ul className="m-0 ps-6">
              {open.orders.map((order) => (
                <li key={order.id}>
                  {order.reference}, {when(order.createdAt)}, {order.status},{' '}
                  {money(order.finalTotalPence ?? order.totalEstimatePence)}: {order.items}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              void shopperExportLink(staffKey, account.id)
                .then((url) =>
                  setFile({
                    url,
                    name: `shopper-${account.handle}-${new Date().toISOString().slice(0, 10)}.csv`,
                  }),
                )
                .catch(fail(setProblem))
            }
            className="control bg-highlight text-ink"
          >
            Export everything we hold about them
          </button>
          <p className="m-0 extra">
            For a subject access request: a spreadsheet file of everything held about this Shopper.
          </p>
          {file && (
            <a href={file.url} download={file.name} className="control bg-paper text-ink">
              Save the file
            </a>
          )}
        </section>
      )}
    </section>
  );
}

export function AuditLog({ staffKey }: { staffKey: string }): JSX.Element {
  const [filters, setFilters] = useState({ search: '', from: '', to: '' });
  const list = useLoad(() =>
    fetchAuditLog(staffKey, {
      ...(filters.search ? { search: filters.search } : {}),
      ...(dayStart(filters.from) ? { from: dayStart(filters.from) } : {}),
      ...(dayEnd(filters.to) ? { to: dayEnd(filters.to) } : {}),
    }),
  );
  const { reload } = list;
  useEffect(reload, [filters, reload]);
  const entries: AuditEntryRow[] = list.data?.entries ?? [];

  return (
    <section aria-labelledby="audit-heading" className="space-y-4 max-w-3xl">
      <h2 id="audit-heading" className="text-lead font-bold">
        Audit log
      </h2>
      <p className="m-0 extra">
        Everything done in the admin panel: who did it, what, to what, when, and from which internet
        address. Only you see it, and nothing in it can be changed or removed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = (name: string): string => String(data.get(name) ?? '').trim();
          setFilters({
            search: value('audit-search'),
            from: value('audit-from'),
            to: value('audit-to'),
          });
        }}
        className="space-y-2"
        aria-label="Search the audit log"
      >
        <label htmlFor="audit-search" className="block font-bold">
          Search: a name, what was done, an order or an address
        </label>
        <input id="audit-search" name="audit-search" type="search" className={FIELD} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block font-bold">
            From
            <input name="audit-from" type="date" className={FIELD} />
          </label>
          <label className="block font-bold">
            To
            <input name="audit-to" type="date" className={FIELD} />
          </label>
        </div>
        <button type="submit" className="control bg-highlight text-ink">
          Search
        </button>
      </form>
      <Failure text={list.problem} />
      {list.data && (
        <p role="status" className="m-0">
          {entries.length === 0
            ? 'Nothing matches.'
            : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first.`}
        </p>
      )}
      <ol className="list-none m-0 p-0 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="border-2 border-paper rounded-xl p-3">
            <p className="m-0">
              <time dateTime={entry.at}>{when(entry.at)}</time>: {entry.actorName}, {entry.words}
              {entry.target ? ` (${entry.target})` : ''}.
            </p>
            <p className="m-0 extra">
              From {entry.ip || 'an unknown address'}. {entry.detail}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ----------------------------------------------------------------------------- two-step codes */

/**
 * Two-step codes (Section Q): set up with an authenticator app, recovery codes given once.
 * The owner switches them off with his passcode, everyone else with their password, and only
 * until their grace period ends.
 */
export function TwoStepCodes({
  staffKey,
  state,
  owner = false,
  level = 3,
  onNews,
  onSession,
  onChanged,
}: {
  staffKey: string;
  state: StaffTwoStep | null | undefined;
  owner?: boolean;
  /** The heading's level where it sits: 2 as a tab of its own, 3 inside another part. */
  level?: 2 | 3;
  onNews: (text: string) => void;
  /** A fresh session after setting them up, which opens the person's job. */
  onSession?: (token: string) => void;
  onChanged?: () => void;
}): JSX.Element {
  const [setUp, setSetUp] = useState<{ secret: string; otpauth: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [problem, setProblem] = useState('');
  const [on, setOn] = useState(state?.on ?? false);
  const pendingToken = useRef<string | null>(null);
  const due = state ? new Date(state.dueAt) : null;
  const canSwitchOff = due !== null && Date.now() < due.getTime();
  const values = (event: FormEvent<HTMLFormElement>): ((name: string) => string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    return (name) => String(data.get(name) ?? '').trim();
  };

  const Heading = level === 2 ? 'h2' : 'h3';
  const Subheading = level === 2 ? 'h3' : 'h4';
  return (
    <section aria-labelledby="two-step-heading" className="space-y-3 max-w-2xl">
      <Heading id="two-step-heading" className="text-lead font-bold m-0">
        Two-step codes
      </Heading>
      <p className="m-0">
        {on
          ? `On. Signing in asks for the 6-digit code from your authenticator app.${state?.on && state.recoveryCodesLeft >= 0 ? ` ${state.recoveryCodesLeft} recovery ${state.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.` : ''}`
          : due
            ? `Off. They are a must from ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
            : 'Off.'}
      </p>
      <p className="m-0 extra">
        An authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator,
        shows a new 6-digit code every 30 seconds. Nobody from us will ever ask you for one.
      </p>
      <Failure text={problem} />
      {codes && (
        <div className="border-2 border-highlight rounded-xl p-4 space-y-2">
          <Subheading className="m-0 font-bold">Your recovery codes</Subheading>
          <p className="m-0">
            Write these down and keep them somewhere safe. Each one works once, in place of a code
            from the app, if you lose your phone. They are shown only now.
          </p>
          <ul className="m-0 ps-6 font-mono">
            {codes.map((code) => (
              <li key={code} aria-label={code.split('').join(' ')}>
                {code}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setCodes(null);
              if (pendingToken.current) onSession?.(pendingToken.current);
              pendingToken.current = null;
            }}
            className="control bg-highlight text-ink"
          >
            I have written them down
          </button>
        </div>
      )}
      {!on && !setUp && (
        <button
          type="button"
          onClick={() =>
            void (owner ? startTwoStep(staffKey) : startMyTwoStep(staffKey))
              .then((result) => {
                setProblem('');
                setSetUp(result);
              })
              .catch(fail(setProblem))
          }
          className="control bg-highlight text-ink"
        >
          Set up two-step codes
        </button>
      )}
      {!on && setUp && (
        <form
          onSubmit={(event) => {
            const value = values(event);
            (owner ? confirmTwoStep : confirmMyTwoStep)(staffKey, value('two-step-code'))
              .then((result) => {
                setProblem('');
                setSetUp(null);
                setOn(true);
                setCodes(result.recoveryCodes ?? null);
                pendingToken.current = result.token ?? null;
                if (!result.recoveryCodes && result.token) onSession?.(result.token);
                onNews(result.message);
                onChanged?.();
              })
              .catch(fail(setProblem));
          }}
          className="space-y-2"
          aria-label="Switch two-step codes on"
        >
          <p className="m-0 break-all">
            Add this key to your authenticator app:{' '}
            <span aria-label={setUp.secret.split('').join(' ')}>{setUp.secret}</span>
          </p>
          <a href={setUp.otpauth} className="control bg-paper text-ink">
            Open it in my authenticator app
          </a>
          <label htmlFor="two-step-code" className="block">
            The 6-digit code it shows
          </label>
          <input
            id="two-step-code"
            name="two-step-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className={FIELD}
          />
          <button type="submit" className="control bg-highlight text-ink">
            Switch two-step codes on
          </button>
        </form>
      )}
      {on && !codes && (
        <form
          onSubmit={(event) => {
            const value = values(event);
            newRecoveryCodes(staffKey, value('recovery-code'))
              .then((result) => {
                setProblem('');
                setCodes(result.recoveryCodes);
                onNews(result.message);
              })
              .catch(fail(setProblem));
          }}
          className="space-y-2"
          aria-label="New recovery codes"
        >
          <label htmlFor="recovery-code" className="block">
            A code from your app, for new recovery codes
          </label>
          <input
            id="recovery-code"
            name="recovery-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className={FIELD}
          />
          <button type="submit" className="control bg-paper text-ink">
            Make new recovery codes
          </button>
        </form>
      )}
      {on && canSwitchOff && !codes && (
        <form
          onSubmit={(event) => {
            const value = values(event);
            (owner
              ? twoStepOff(staffKey, value('two-step-off'))
              : myTwoStepOff(staffKey, value('two-step-off'))
            )
              .then((result) => {
                setProblem('');
                setOn(false);
                onNews(result.message);
                onChanged?.();
              })
              .catch(fail(setProblem));
          }}
          className="space-y-2"
          aria-label="Switch two-step codes off"
        >
          <label htmlFor="two-step-off" className="block">
            {owner ? 'Your passcode, to switch them off' : 'Your password, to switch them off'}
          </label>
          <input
            id="two-step-off"
            name="two-step-off"
            type="password"
            autoComplete={owner ? 'off' : 'current-password'}
            className={FIELD}
          />
          <button type="submit" className="control bg-paper/10 text-paper underline">
            Switch two-step codes off
          </button>
        </form>
      )}
    </section>
  );
}

/** Shown in place of everything else once the grace period is over and they are not set up. */
export function TwoStepRequired({
  staffKey,
  state,
  owner,
  onNews,
  onSession,
}: {
  staffKey: string;
  state: StaffTwoStep;
  owner: boolean;
  onNews: (text: string) => void;
  onSession: (token: string) => void;
}): JSX.Element {
  return (
    <section aria-labelledby="two-step-needed-heading" className="space-y-4 max-w-2xl">
      <h2 id="two-step-needed-heading" className="text-lead font-bold m-0">
        Please set up two-step codes
      </h2>
      <p className="m-0">
        Every admin sign-in now needs a code from an authenticator app as well as your password.
        Nothing else opens until it is set up. It takes about two minutes.
      </p>
      <TwoStepCodes
        staffKey={staffKey}
        state={state}
        owner={owner}
        onNews={onNews}
        onSession={onSession}
      />
    </section>
  );
}
