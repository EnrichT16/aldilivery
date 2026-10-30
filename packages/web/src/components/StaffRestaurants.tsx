import { useCallback, useEffect, useRef, useState } from 'react';

import { storeConfig } from '../config';
import {
  fetchCheckoutInsights,
  fetchStaffRestaurants,
  type CheckoutInsights,
  type InsightRow,
  type StaffRestaurantSort,
  type StaffRestaurants,
} from '../lib/api';

/**
 * Two staff pages (Anthony, 30 October 2026).
 *
 * - The restaurant partners, under Shops and organisations: each one's agreed discount for Ozi,
 *   whether it is a Preferred Partner, and its orders in the last 30 days, in a table that sorts
 *   by any column, so the founder sees who gives a discount and who does not.
 * - Checkout insights, for the founder and the operations manager: for 7, 30 or 90 days,
 *   checkouts viewed, paid and left, with the share that paid, by total, restaurant or groceries,
 *   area, the no-Runner warning, new or returning, and what people said stopped them.
 *
 * Both are plain tables with headings, captions and words, for a screen reader first.
 */

function useLoad<T>(
  load: () => Promise<T>,
  asked: string,
): {
  data: T | null;
  problem: string;
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
  // Loaded again whenever what it is asked for changes.
  useEffect(() => {
    if (asked !== '') reload();
  }, [reload, asked]);
  return { data, problem };
}

function Failure({ text }: { text: string }): JSX.Element | null {
  if (text === '') return null;
  return (
    <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
      {text}
    </p>
  );
}

const COLUMNS: Array<{ key: StaffRestaurantSort; label: string }> = [
  { key: 'name', label: 'Restaurant' },
  { key: 'discount', label: 'Agreed discount' },
  { key: 'markup', label: 'Mark-up' },
  { key: 'preferred', label: 'Preferred Partner' },
  { key: 'orders', label: 'Orders, last 30 days' },
];

/** The restaurant partners, sortable by any column. */
export function RestaurantPartners({ staffKey }: { staffKey: string }): JSX.Element {
  const [sort, setSort] = useState<StaffRestaurantSort>('discount');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const { data, problem } = useLoad<StaffRestaurants>(
    () => fetchStaffRestaurants(staffKey, sort, order),
    `${sort}:${order}`,
  );
  const name = storeConfig.assistantName;

  function sortBy(key: StaffRestaurantSort): void {
    if (key === sort) {
      setOrder((now) => (now === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder(key === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <section aria-labelledby="restaurant-partners-heading" className="space-y-3 max-w-3xl">
      <h3 id="restaurant-partners-heading" className="text-lead font-bold m-0">
        Restaurant partners
      </h3>
      <Failure text={problem} />
      {data && (
        <p className="m-0">
          {data.withDiscount} give {name} a discount and {data.withoutDiscount} do not.{' '}
          {data.preferred} {data.preferred === 1 ? 'is a' : 'are'} {name} Preferred Partner
          {data.preferred === 1 ? '' : 's'}, with a discount of {data.preferredDiscountPercent}% or
          more. Restaurants pay no commission.
        </p>
      )}
      {data && data.restaurants.length === 0 && <p className="m-0">No restaurants yet.</p>}
      {data && data.restaurants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="text-left font-bold pb-2">
              Restaurants, sorted by {COLUMNS.find((column) => column.key === sort)?.label}
              {order === 'asc' ? ', lowest first' : ', highest first'}
            </caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      column.key === sort ? (order === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className="text-left p-1"
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(column.key)}
                      className="control bg-paper/10 text-paper underline"
                    >
                      {column.label}
                      <span className="visually-hidden">, sort by this</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.restaurants.map((row) => (
                <tr key={row.id} className="border-t-2 border-paper/40">
                  <th scope="row" className="text-left font-normal p-2">
                    {row.name}
                    {row.area ? `, ${row.area}` : ''}
                    {row.listed ? '' : ' (not listed)'}
                  </th>
                  <td className="p-2">
                    {row.discountPercent === 0 ? 'None' : `${row.discountPercent}%`}
                  </td>
                  <td className="p-2">
                    {(row.markupPercent ?? 0) === 0 ? 'None' : `${row.markupPercent}%`}
                  </td>
                  <td className="p-2">{row.preferredPartner ? 'Yes' : 'No'}</td>
                  <td className="p-2">{row.ordersLast30Days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function percentWords(row: InsightRow): string {
  return row.paidPercent === null ? 'none viewed' : `${row.paidPercent}% paid`;
}

/** One breakdown as a table: viewed, paid, left, and the share that paid. */
function InsightTable({
  id,
  caption,
  rows,
}: {
  id: string;
  caption: string;
  rows: InsightRow[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table aria-labelledby={`${id}-caption`} className="w-full border-collapse">
        <caption id={`${id}-caption`} className="text-left text-lead font-bold pb-2">
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-left p-2">
              Which
            </th>
            <th scope="col" className="text-left p-2">
              Viewed
            </th>
            <th scope="col" className="text-left p-2">
              Paid
            </th>
            <th scope="col" className="text-left p-2">
              Left without paying
            </th>
            <th scope="col" className="text-left p-2">
              Share that paid
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t-2 border-paper/40">
              <th scope="row" className="text-left font-normal p-2">
                {row.label}
              </th>
              <td className="p-2">{row.viewed}</td>
              <td className="p-2">{row.paid}</td>
              <td className="p-2">{row.abandoned}</td>
              <td className="p-2">{percentWords(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Checkout insights page: why people do not pay. */
export function CheckoutInsightsPage({ staffKey }: { staffKey: string }): JSX.Element {
  const periods = storeConfig.checkoutInsights.periodsDays;
  const [days, setDays] = useState<number>(periods[1] ?? periods[0] ?? 30);
  const { data, problem } = useLoad<CheckoutInsights>(
    () => fetchCheckoutInsights(staffKey, days),
    String(days),
  );

  return (
    <section aria-labelledby="insights-heading" className="space-y-6 max-w-3xl">
      <h2 id="insights-heading" className="text-lead font-bold">
        Checkout insights
      </h2>
      <p className="m-0">
        How many people reach the page to pay, how many pay, and what stopped the rest. No card
        details, names or addresses are kept, and nobody is contacted about a checkout they left.
      </p>
      <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0">
        <legend className="px-2 font-bold">Period</legend>
        <div className="flex flex-wrap gap-2">
          {periods.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => setDays(period)}
              className="control border-paper bg-paper/10 text-paper aria-pressed:bg-paper aria-pressed:text-ink"
            >
              Last {period} days
            </button>
          ))}
        </div>
      </fieldset>
      <Failure text={problem} />
      {data && (
        <>
          <p role="status" className="m-0 text-lead font-bold">
            {data.summary}
          </p>
          <dl className="grid grid-cols-2 gap-3 m-0">
            {(
              [
                ['Checkouts viewed', String(data.viewed)],
                ['Paid', String(data.paid)],
                ['Left without paying', String(data.abandoned)],
                [
                  'Share that paid',
                  data.paidPercent === null ? 'None yet' : `${data.paidPercent}%`,
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="border-2 border-paper/40 rounded-2xl p-3">
                <dt className="m-0">{label}</dt>
                <dd className="m-0 text-lead font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <InsightTable id="insights-total" caption="By the total shown" rows={data.byTotal} />
          <InsightTable id="insights-kind" caption="Restaurant or groceries" rows={data.byKind} />
          <InsightTable id="insights-area" caption="By area" rows={data.byArea} />
          <InsightTable
            id="insights-warning"
            caption="With or without the no-Runner warning"
            rows={data.byWarning}
          />
          <InsightTable id="insights-shopper" caption="New or returning" rows={data.byShopper} />
          <InsightTable id="insights-channel" caption="How they ordered" rows={data.byChannel} />
          <section aria-labelledby="insights-reasons-heading" className="space-y-2">
            <h3 id="insights-reasons-heading" className="text-lead font-bold m-0">
              What stopped them, in their own taps
            </h3>
            <ul className="m-0 ps-6 space-y-1">
              {data.reasons.map((reason) => (
                <li key={reason.answer}>
                  {reason.label}: {reason.count}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
