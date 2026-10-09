import { useCallback, useEffect, useState } from 'react';

import {
  fetchStaffFile,
  fetchTillCases,
  receiptPhotoPath,
  settleTillCase,
  type TillAction,
  type TillCaseRow,
} from '../lib/api';
import { money } from '../lib/money';

/** Why a till total is waiting for a person, in words. */
const REASONS: Record<string, string> = {
  'over the limit': 'the till came to a lot more than the estimate, more than is taken by itself',
  'bank transfer': 'the Shopper paid by bank transfer, so the difference is settled by hand',
  'refund failed': 'the refund to the Shopper’s card did not go through',
  'charge failed': 'the extra could not be taken from the Shopper’s card',
};

/**
 * The owner's till screen (docs/STILL_TO_DO.md item 1), on the Payments tab: till totals that
 * need a person to settle with the Shopper. Each shows the estimate, the till total, the
 * difference and the receipt photo, with the one or two things that can be done about it. The
 * Shopper is told in plain words whichever is pressed.
 */
export function TillCases({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const [data, setData] = useState<{ waiting: TillCaseRow[]; settled: TillCaseRow[] } | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    fetchTillCases(staffKey)
      .then((result) => {
        setData(result);
        setProblem('');
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That list could not be loaded.'),
      );
  }, [staffKey]);
  useEffect(reload, [reload]);

  function act(row: TillCaseRow, action: TillAction): void {
    setBusy(true);
    settleTillCase(staffKey, row.orderId, action)
      .then((result) => {
        onNews(result.message);
        reload();
      })
      .catch((failure: unknown) =>
        onNews(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  return (
    <>
      <h3 className="m-0 font-bold">Till totals to settle with the Shopper</h3>
      <p className="m-0 extra">
        Most till totals settle themselves on the Shopper’s card. These need a person: a large
        extra, a bank transfer, or a card that would not take a charge or a refund. Whatever you
        choose, the Shopper is told in plain words.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {data?.waiting.length === 0 && <p className="m-0">None waiting.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {data?.waiting.map((row) => {
          const more = row.differencePence > 0;
          const amount = money(Math.abs(row.differencePence));
          const card = row.paidBy === 'card';
          const label = `order ${row.reference}`;
          return (
            <li key={row.orderId} className="border-2 border-paper rounded-xl p-4 space-y-2">
              <p className="m-0 font-bold">
                {more ? `${amount} more to take` : `${amount} to give back`}, {row.shopperName},
                order {row.reference}
              </p>
              <p className="m-0">
                Charged at first {money(row.estimatePence)}; the till came to{' '}
                {money(row.tillTotalPence ?? 0)} with the delivery. Waiting because{' '}
                {REASONS[row.reason ?? ''] ?? row.reason ?? 'a person must look'}.
                {row.bankReference ? ` Bank reference ${row.bankReference}.` : ''}
              </p>
              <ReceiptPhoto
                staffKey={staffKey}
                orderId={row.orderId}
                has={row.hasReceiptPhoto}
                label={label}
              />
              <div className="flex flex-wrap gap-2">
                {card && more && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(row, 'charge')}
                    className="control bg-highlight text-ink disabled:opacity-70"
                  >
                    Take {amount} from the saved card
                    <span className="visually-hidden">: {label}</span>
                  </button>
                )}
                {card && !more && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(row, 'refund')}
                    className="control bg-highlight text-ink disabled:opacity-70"
                  >
                    Give {amount} back to the card
                    <span className="visually-hidden">: {label}</span>
                  </button>
                )}
                {!more && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(row, 'refunded_by_hand')}
                    className="control bg-paper text-ink disabled:opacity-70"
                  >
                    I sent it back by hand<span className="visually-hidden">: {label}</span>
                  </button>
                )}
                {more && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(row, 'collected_by_hand')}
                    className="control bg-paper text-ink disabled:opacity-70"
                  >
                    It was paid by hand<span className="visually-hidden">: {label}</span>
                  </button>
                )}
                {more && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(row, 'let_go')}
                    className="control bg-paper text-ink disabled:opacity-70"
                  >
                    Let the extra go<span className="visually-hidden">: {label}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(data?.settled.length ?? 0) > 0 && (
        <>
          <h3 className="m-0 font-bold">Till totals settled lately</h3>
          <ul className="m-0 p-0 list-none space-y-2">
            {data?.settled.map((row) => (
              <li key={row.orderId}>
                Order {row.reference}, {row.shopperName}: {money(Math.abs(row.differencePence))}{' '}
                {row.differencePence > 0 ? 'more' : 'less'}, settled by {row.settledBy ?? 'staff'}.
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * The photo of the till receipt, one press to show it (docs/STILL_TO_DO.md item 2): on the till
 * screen and beside each pay-back waiting for approval.
 */
export function ReceiptPhoto({
  staffKey,
  orderId,
  has,
  label,
}: {
  staffKey: string;
  orderId: string;
  has: boolean | undefined;
  label: string;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  if (!has) return <p className="m-0">No photo of the receipt was sent.</p>;
  if (url) return <img src={url} alt={`The till receipt for ${label}`} className="max-w-full" />;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          fetchStaffFile(staffKey, receiptPhotoPath(orderId))
            .then(setUrl)
            .catch(() => setProblem('That photo could not be opened.'));
        }}
        className="control bg-paper text-ink"
      >
        Show the receipt photo<span className="visually-hidden">: {label}</span>
      </button>
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
    </>
  );
}
