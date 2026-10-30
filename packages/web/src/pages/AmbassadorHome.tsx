import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AmbassadorGuide } from '../components/ambassador/AmbassadorGuide';
import { Toolkit } from '../components/ambassador/Toolkit';
import { TermsChanged } from '../components/TermsChanged';
import {
  ambassadorBankLink,
  becomeAmbassador,
  fetchMyReferrals,
  withdrawAmbassadorEarnings,
  type MyReferrals,
  type ReferralAs,
} from '../lib/api';
import { ambassadorAs, EDUCATION_NOTE } from '../lib/ambassador';
import { money } from '../lib/money';

/**
 * The Ambassador dashboard at /ambassador/home (Anthony, 30 October 2026), in four tabs:
 *
 * - Overview: earnings pending, available and paid, withdrawing to the bank (as before), how many
 *   businesses they introduced, and their referrals.
 * - My businesses: each business's name, whether it is approved, and what it has earned them.
 * - Toolkit: flyers, the presentation, "Sign up this business now", counter cards and stickers,
 *   ready-made messages, all with their own links. For approved Ambassadors only.
 * - Guide: the pitch, the answers, how they earn, and what never to say.
 *
 * An Ambassador who opted in before applications ("documents needed") sees it too, with their
 * earnings, and is told plainly that the Toolkit and withdrawals open once they are approved.
 */

type TabKey = 'overview' | 'businesses' | 'toolkit' | 'guide';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'businesses', label: 'My businesses' },
  { key: 'toolkit', label: 'Toolkit' },
  { key: 'guide', label: 'Guide' },
];

export function AmbassadorHome(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [data, setData] = useState<MyReferrals | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const asked = params.get('tab');
  const tab: TabKey = TABS.some((one) => one.key === asked) ? (asked as TabKey) : 'overview';

  const load = useCallback(() => {
    if (!as) return;
    fetchMyReferrals(as)
      .then(setData)
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'We could not load it.'),
      );
  }, [as]);
  useEffect(load, [load]);

  if (!as) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-display font-bold m-0">Your Ambassador dashboard</h1>
        <p className="m-0">Please sign in first.</p>
        <Link to="/sign-in?next=/ambassador/home" className="control bg-highlight text-on-accent">
          Sign in
        </Link>
      </div>
    );
  }

  const ambassador = data?.ambassador;
  const approved = ambassador?.approved === true;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-display font-bold m-0">Your Ambassador dashboard</h1>
      <p role="status" className="m-0 font-bold">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}
      {ambassador && !ambassador.joined && (
        <div className="space-y-3">
          <p className="m-0">You have not applied to be an Ozi Ambassador yet.</p>
          <Link to="/ambassador" className="control bg-highlight text-on-accent">
            Find out more
          </Link>
        </div>
      )}
      {ambassador?.joined && !approved && (
        <div className="space-y-3 border-2 border-highlight rounded-2xl p-4">
          <p className="m-0 font-bold">Status: {ambassador.statusWords}.</p>
          <p className="m-0">{ambassador.applicationMessage}</p>
          {ambassador.status !== 'declined' && ambassador.status !== 'suspended' && (
            <Link to="/ambassador/apply" className="control bg-highlight text-on-accent">
              {ambassador.status === 'documents_needed'
                ? 'Send my documents'
                : 'Carry on with my application'}
            </Link>
          )}
        </div>
      )}
      {ambassador?.joined && ambassador.termsChanged && (
        <TermsChanged
          words={ambassador.termsChangedWords ?? ''}
          termsName="Ozi Ambassador terms"
          termsPath={ambassador.termsPath}
          onAgree={async () => {
            await becomeAmbassador(as, ambassador.termsVersion);
            setNews('Thank you. You have agreed to the new Ozi Ambassador terms.');
            load();
          }}
        />
      )}
      {data && ambassador?.joined && (
        <>
          <Tabs
            selected={tab}
            onSelect={(key) => {
              const next = new URLSearchParams(params);
              next.set('tab', key);
              setParams(next, { replace: true });
            }}
          />
          <div
            role="tabpanel"
            id={`ambassador-panel-${tab}`}
            aria-labelledby={`ambassador-tab-${tab}`}
            tabIndex={-1}
            className="space-y-6"
          >
            {tab === 'overview' && (
              <Overview as={as} data={data} onNews={setNews} onChanged={load} />
            )}
            {tab === 'businesses' && <Businesses data={data} />}
            {tab === 'toolkit' &&
              (approved ? (
                <Toolkit as={as} onNews={setNews} />
              ) : (
                <section aria-labelledby="toolkit-locked" className="space-y-2">
                  <h2 id="toolkit-locked" className="text-lead font-bold m-0">
                    Toolkit
                  </h2>
                  <p className="m-0">
                    The Toolkit opens once your documents are checked, you have had a short chat
                    with us, and you are approved.
                  </p>
                </section>
              ))}
            {tab === 'guide' && <AmbassadorGuide />}
          </div>
        </>
      )}
    </div>
  );
}

/** The four tabs, with the keyboard of a real tab list: arrows, Home and End. */
function Tabs({
  selected,
  onSelect,
}: {
  selected: TabKey;
  onSelect: (key: TabKey) => void;
}): JSX.Element {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = TABS.length - 1;
    const to =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const next = TABS[to];
    if (!next) return;
    onSelect(next.key);
    buttons.current[to]?.focus();
  };
  return (
    <div role="tablist" aria-label="Ambassador dashboard" className="flex flex-wrap gap-2">
      {TABS.map((one, index) => (
        <button
          key={one.key}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`ambassador-tab-${one.key}`}
          aria-selected={selected === one.key}
          aria-controls={`ambassador-panel-${one.key}`}
          tabIndex={selected === one.key ? 0 : -1}
          onClick={() => onSelect(one.key)}
          onKeyDown={(event) => move(event, index)}
          className={`control ${selected === one.key ? 'bg-highlight text-on-accent' : 'border-paper bg-paper/10 text-paper'}`}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}

function Overview({
  as,
  data,
  onNews,
  onChanged,
}: {
  as: ReferralAs;
  data: MyReferrals;
  onNews: (words: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const { ambassador, referrals } = data;
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const approved = ambassador.approved === true;

  function setUpBank(): void {
    setProblem('');
    setBusy(true);
    ambassadorBankLink(as)
      .then((link) => window.location.assign(link.url))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  function withdraw(): void {
    setProblem('');
    setBusy(true);
    withdrawAmbassadorEarnings(as)
      .then((result) => {
        onNews(result.message);
        onChanged();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  return (
    <>
      <section aria-labelledby="earnings-heading" className="space-y-3">
        <h2 id="earnings-heading" className="text-lead font-bold m-0">
          Your earnings
        </h2>
        <ul className="m-0 ps-6 space-y-1">
          <li>Pending (waiting for the refund window to pass): {money(ambassador.pendingPence)}</li>
          <li>Available: {money(ambassador.availablePence)}</li>
          <li>Paid: {money(ambassador.paidPence)}</li>
        </ul>
        {ambassador.deductions.map((line, index) => (
          <p key={`${line.at}-${index}`} className="m-0">
            {line.words}
          </p>
        ))}
        {problem !== '' && (
          <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
            {problem}
          </p>
        )}
        {!approved && (
          <p className="m-0">Withdrawals open once your Ambassador application is approved.</p>
        )}
        {approved && !ambassador.bankReady && (
          <button
            type="button"
            disabled={busy}
            onClick={setUpBank}
            className="control border-paper bg-paper/10 text-paper"
          >
            Set up my bank details with Stripe
          </button>
        )}
        {approved && ambassador.bankReady && ambassador.canWithdraw && (
          <button
            type="button"
            disabled={busy}
            onClick={withdraw}
            className="control bg-highlight text-on-accent"
          >
            Withdraw {money(ambassador.availablePence)} to my bank
          </button>
        )}
        {ambassador.withdrawals.length > 0 && (
          <>
            <h3 className="font-bold m-0">Your withdrawals</h3>
            <ul className="m-0 ps-6 space-y-1">
              {ambassador.withdrawals.map((row) => (
                <li key={row.id}>{row.words}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="introduced-heading" className="space-y-2">
        <h2 id="introduced-heading" className="text-lead font-bold m-0">
          Businesses you introduced
        </h2>
        <p className="m-0">
          {ambassador.businesses.length === 1
            ? '1 business, '
            : `${ambassador.businesses.length} businesses, `}
          {ambassador.businesses.filter((business) => business.approved).length} approved.
        </p>
        {ambassador.link && <p className="m-0 break-all">Your business link: {ambassador.link}</p>}
      </section>

      <section aria-labelledby="referrals-heading" className="space-y-2">
        <h2 id="referrals-heading" className="text-lead font-bold m-0">
          Your referrals
        </h2>
        <p className="m-0">
          {referrals.joined === 1
            ? '1 person has joined through your link'
            : `${referrals.joined} people have joined through your link`}
          , and {referrals.active} {referrals.active === 1 ? 'is' : 'are'} active.
        </p>
        <p className="m-0 break-all">Your referral link: {referrals.link}</p>
        <p className="m-0">{EDUCATION_NOTE}</p>
      </section>
    </>
  );
}

function Businesses({ data }: { data: MyReferrals }): JSX.Element {
  const businesses = data.ambassador.businesses;
  return (
    <section aria-labelledby="businesses-heading" className="space-y-3">
      <h2 id="businesses-heading" className="text-lead font-bold m-0">
        My businesses
      </h2>
      {businesses.length === 0 ? (
        <p className="m-0">None yet. The Toolkit has everything you need to introduce one.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="visually-hidden">
            The businesses you introduced, their status and what each has earned you
          </caption>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Status</th>
              <th scope="col">Earned</th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((business, index) => (
              <tr key={`${business.name}-${index}`}>
                <th scope="row" className="font-normal">
                  {business.name}
                </th>
                <td>{business.approved ? 'Approved' : 'Waiting for approval'}</td>
                <td>{money(business.earnedPence ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
