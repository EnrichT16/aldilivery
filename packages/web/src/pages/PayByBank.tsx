import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { fetchPayByBank, type PayByBank as Details } from '../lib/api';

/**
 * "Pay us by bank" (ruling 78): the business account and a reference of the account's own, for
 * a one-off transfer or a standing order set up in their own banking app. For Shoppers, Shop
 * Partners and organisations, who pay us; never linked for Runners, who do not, and the server
 * refuses a Runner too. Nothing here is ever set up for them: they do it themselves, if they wish.
 */
export function PayByBank({
  as,
  back,
}: {
  as: 'shopper' | 'business';
  back: { to: string; label: string };
}): JSX.Element {
  const [details, setDetails] = useState<Details | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchPayByBank(as)
      .then((found) => {
        if (!cancelled) setDetails(found);
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setProblem(
            failure instanceof Error ? failure.message : 'We could not show the bank details.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [as]);

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-display font-bold m-0">Pay us by bank</h1>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {details === null && problem === '' && (
        <p role="status" className="m-0">
          Finding our bank details.
        </p>
      )}
      {details && !details.enabled && <p className="m-0">{details.message}</p>}
      {details?.enabled && (
        <>
          <p className="m-0">
            You can pay {storeConfig.productName} straight from your own bank: for one order, or
            with a standing order for a monthly fee. Use these details and your own reference, so we
            know the money is from you.
          </p>
          <dl className="m-0 space-y-3 text-lead">
            <div>
              <dt className="font-bold">Account name</dt>
              <dd className="m-0">{details.accountName}</dd>
            </div>
            <div>
              <dt className="font-bold">Sort code</dt>
              <dd className="m-0">{details.sortCode}</dd>
            </div>
            <div>
              <dt className="font-bold">Account number</dt>
              <dd className="m-0">{details.accountNumber}</dd>
            </div>
            <div>
              <dt className="font-bold">Your reference</dt>
              <dd className="m-0">{details.reference}</dd>
            </div>
          </dl>
          <h2 className="text-lead font-bold m-0">Setting it up</h2>
          <ul className="m-0 space-y-2">
            <li>Open your own banking app, or ring your bank.</li>
            <li>
              Choose to pay someone new, or to set up a standing order, and type in the account
              name, sort code and account number above.
            </li>
            <li>Put your reference exactly as it is shown, so we can match your payment.</li>
            <li>
              For an order booked for a later day, use the order&rsquo;s own reference instead,
              shown when you booked it, and pay by the day before.
            </li>
          </ul>
          <p className="m-0">
            We never ask for your bank password or a code, by phone, text or email. If anyone does,
            it is not us.
          </p>
        </>
      )}
      <Link to={back.to} className="control border-paper bg-paper/10 text-paper">
        {back.label}
      </Link>
    </div>
  );
}
