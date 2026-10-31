import { useCallback, useEffect, useState } from 'react';

import {
  decideHeldShare,
  fetchBusinessCheck,
  fetchHeldShares,
  type BusinessCheck,
  type HeldShare,
} from '../lib/api';

function when(at: string | null): string {
  return at
    ? new Date(at).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}

/**
 * "Check this business" (Anthony, 31 October 2026), for staff on the Shops page: links to the
 * Companies House search and the Food Standards Agency hygiene rating search, filled in with the
 * business's name and postcode. Links only: nothing is looked up by the service itself. With who
 * brought the business in first, and when.
 */
export function CheckThisBusiness({
  staffKey,
  shopId,
  shopName,
}: {
  staffKey: string;
  shopId: string;
  shopName: string;
}): JSX.Element {
  const [check, setCheck] = useState<BusinessCheck | null>(null);
  const [problem, setProblem] = useState('');
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={check !== null}
        onClick={() => {
          if (check) {
            setCheck(null);
            return;
          }
          fetchBusinessCheck(staffKey, shopId)
            .then(setCheck)
            .catch((failure: unknown) =>
              setProblem(failure instanceof Error ? failure.message : 'That could not be opened.'),
            );
        }}
        className="control border-paper bg-paper/10 text-paper"
      >
        Check this business<span className="visually-hidden"> {shopName}</span>
      </button>
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
      {check && (
        <section
          aria-label={`Check ${shopName}`}
          className="space-y-2 border-2 border-paper/40 rounded-2xl p-3"
        >
          <p className="m-0">
            Searches for {check.name}
            {check.postcode ? `, ${check.postcode}` : ''}. They open in a new tab.
          </p>
          <ul className="m-0 ps-6 space-y-1">
            <li>
              <a href={check.companiesHouse} target="_blank" rel="noreferrer" className="underline">
                Companies House search (opens in a new tab)
              </a>
            </li>
            <li>
              <a href={check.hygieneRating} target="_blank" rel="noreferrer" className="underline">
                Food hygiene rating search (opens in a new tab)
              </a>
            </li>
          </ul>
          <p className="m-0">
            {check.ambassadorConfirmedAt
              ? `An Ambassador's introduction was confirmed on ${when(check.ambassadorConfirmedAt)}.`
              : 'No confirmed Ambassador introduction.'}
            {check.claims.length > 0
              ? ` Claims: ${check.claims.map((claim) => `${claim.status} (${when(claim.createdAt)})`).join(', ')}.`
              : ''}
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Shares held for a check (Anthony, 31 October 2026): the order's Shopper matched the Ambassador
 * or the business owner by card, phone, device or delivery address. Release counts it; Cancel
 * keeps it at nothing, with the reason.
 */
export function HeldShares({
  staffKey,
  by,
  onNews,
}: {
  staffKey: string;
  by: string;
  onNews: (words: string) => void;
}): JSX.Element {
  const [held, setHeld] = useState<HeldShare[] | null>(null);
  const [problem, setProblem] = useState('');
  const load = useCallback(() => {
    fetchHeldShares(staffKey)
      .then((found) => setHeld(found.held))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be opened.'),
      );
  }, [staffKey]);
  useEffect(load, [load]);

  const decide = (row: HeldShare, decision: 'release' | 'cancel'): void => {
    decideHeldShare(staffKey, row.id, decision, by)
      .then((answer) => {
        onNews(answer.message);
        load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  return (
    <section aria-labelledby="held-shares-heading" className="space-y-2">
      <h3 id="held-shares-heading" className="font-bold m-0">
        Shares held for a check ({held?.length ?? 0})
      </h3>
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
      {held && held.length === 0 && <p className="m-0">None.</p>}
      {held && held.length > 0 && (
        <ul className="m-0 ps-6 space-y-3">
          {held.map((row) => (
            <li key={row.id} className="space-y-2">
              <p className="m-0">
                {row.ambassadorName}, {row.amountWords} on an order from {row.business}, held{' '}
                {when(row.heldAt)}. {row.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => decide(row, 'release')}
                  className="control bg-highlight text-on-accent"
                >
                  Release
                  <span className="visually-hidden"> the share for {row.ambassadorName}</span>
                </button>
                <button
                  type="button"
                  onClick={() => decide(row, 'cancel')}
                  className="control border-paper bg-paper/10 text-paper"
                >
                  Cancel<span className="visually-hidden"> the share for {row.ambassadorName}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
