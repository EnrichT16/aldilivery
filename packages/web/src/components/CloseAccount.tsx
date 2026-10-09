import { useState } from 'react';

import { storeConfig } from '../config';
import { closeAccount, keepAccount } from '../lib/api';
import { useSession } from '../state/session';

/** "Thursday 16 October", in the UK. */
function dayWords(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}

/**
 * Closing an account (docs/LEGAL_REVIEW.md; the privacy page, "How long we keep it"). Two
 * presses, so it is never done by accident; then it waits the days in configuration in case of
 * a change of mind, and is removed automatically afterwards, apart from the order and money
 * records the law makes us keep. Ozi does the same when asked to "close my account".
 */
export function CloseAccount(): JSX.Element | null {
  const { shopper, replaceShopper } = useSession();
  const [asking, setAsking] = useState(false);
  const [news, setNews] = useState('');
  const [busy, setBusy] = useState(false);
  const days = storeConfig.accountDeletion.recycleBinDays;
  if (!shopper) return null;
  const closingOn = shopper.deletionScheduledFor ?? null;

  async function run(action: 'close' | 'keep'): Promise<void> {
    if (!shopper) return;
    setBusy(true);
    try {
      if (action === 'close') {
        const result = await closeAccount();
        replaceShopper({ ...shopper, deletionScheduledFor: result.deletionScheduledFor });
        setNews(result.message);
      } else {
        const result = await keepAccount();
        replaceShopper({ ...shopper, deletionScheduledFor: null });
        setNews(result.message);
      }
      setAsking(false);
    } catch (failure) {
      setNews(failure instanceof Error ? failure.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="close-account" aria-labelledby="close-heading" className="space-y-3 max-w-xl">
      <h2 id="close-heading" className="text-lead font-bold">
        Close my account
      </h2>
      <p role="status" className="m-0">
        {news}
      </p>
      {closingOn ? (
        <>
          <p className="m-0">
            Your account closes on {dayWords(closingOn)}. Until then, you can keep it and nothing is
            lost.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('keep')}
            className="control bg-highlight text-ink disabled:opacity-70"
          >
            Keep my account
          </button>
        </>
      ) : (
        <>
          <p className="m-0 extra">
            It waits {days} days in case you change your mind, then your name, number, addresses,
            cards and settings are removed. Records of your orders and payments are kept for seven
            years, as tax law requires, without your address.
          </p>
          {!asking ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="control bg-paper text-ink"
            >
              Close my account
            </button>
          ) : (
            <>
              <p className="m-0" id="close-confirm-hint">
                Are you sure? Your account will close in {days} days. Any regular orders stop now.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  aria-describedby="close-confirm-hint"
                  onClick={() => void run('close')}
                  className="control bg-highlight text-ink disabled:opacity-70"
                >
                  Yes, close my account
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  className="control bg-paper text-ink"
                >
                  No, keep it
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
