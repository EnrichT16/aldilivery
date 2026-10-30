import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  ambassadorBankLink,
  becomeAmbassador,
  businessToken,
  fetchMyReferrals,
  markReferralNewsHeard,
  withdrawAmbassadorEarnings,
  type MyReferrals,
  type ReferralAs,
} from '../lib/api';
import { money } from '../lib/money';
import { readRunnerToken } from '../lib/session';
import { TermsChanged } from './TermsChanged';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * Referral links for everybody, and Ozi Ambassadors (Anthony, 30 October 2026), on each
 * dashboard: a Shopper's Settings, a Runner's More page, a shop's and an organisation's
 * dashboard.
 *
 * "Your referral link": the person's own link with a share button (the phone's share sheet, or
 * copied where there is none), how many joined through it and how many are active, their
 * progress towards the next reward level, the levels, and any voucher earned. Never who joined.
 *
 * "Introduce a business": what being an Ozi Ambassador means and pays, the rates from
 * config/store.json, and a "Become an Ozi Ambassador" button with the terms to agree to first.
 * Once they have agreed, their Ambassador link, the businesses they introduced and whether each
 * is approved, and their money in three parts (ruled 30 October 2026): pending (waiting for the
 * refund window to pass), available and paid, with any refund taken off as its own line. Never a
 * shop's orders. Available money of at least the minimum can be withdrawn to their bank, set up
 * on Stripe's own form.
 */

async function share(link: string, text: string, onNews: (words: string) => void): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: storeConfig.productName, text, url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    onNews('Your link is copied. You can paste it into a message.');
  } catch {
    // They closed the share sheet: nothing to say.
  }
}

/** The education note (Anthony, 30 October 2026): never a condition, and never blocks anything. */
export const AMBASSADOR_EDUCATION =
  'Businesses only earn when there are Runners (drivers) to deliver and Shoppers to order. Introduce Runners and Shoppers too, with your referral link, and the businesses you bring will earn more, and so will you.';

export function ReferralCard({
  as,
  onNews,
}: {
  as: ReferralAs;
  onNews: (words: string) => void;
}): JSX.Element | null {
  const [data, setData] = useState<MyReferrals | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [withdrawProblem, setWithdrawProblem] = useState('');

  const load = useCallback(() => {
    fetchMyReferrals(as)
      .then(setData)
      .catch(() => {
        // No link today: the card simply is not shown.
      });
  }, [as]);

  useEffect(load, [load]);

  if (!data) return null;
  const { referrals, ambassador } = data;
  const product = storeConfig.productName;

  function join(): void {
    if (!agreed) {
      setProblem('Please tick to agree to the Ozi Ambassador terms first.');
      return;
    }
    setProblem('');
    setBusy(true);
    becomeAmbassador(as, ambassador.termsVersion)
      .then((result) => {
        onNews(result.message);
        load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  /** Stripe's own form for their bank details: they never pass through us. */
  function setUpBank(): void {
    setWithdrawProblem('');
    setBusy(true);
    ambassadorBankLink(as)
      .then((link) => {
        window.location.assign(link.url);
      })
      .catch((failure: unknown) =>
        setWithdrawProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  function withdraw(): void {
    setWithdrawProblem('');
    setBusy(true);
    withdrawAmbassadorEarnings(as)
      .then((result) => {
        onNews(result.message);
        load();
      })
      .catch((failure: unknown) =>
        setWithdrawProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="space-y-8 max-w-xl">
      <section aria-labelledby="referral-heading" className="space-y-3">
        <h2 id="referral-heading" className="text-lead font-bold m-0">
          Your referral link
        </h2>
        <p className="m-0 extra">
          Share it with anyone: friends and family who could shop with us, drivers who could be
          Runners, and local shops. Whoever joins through it is counted for you.
        </p>
        <p className="m-0 break-all">{referrals.link}</p>
        <button
          type="button"
          onClick={() => {
            void share(
              referrals.link,
              `Join me on ${product}, shopping brought to your door: ${referrals.link}`,
              onNews,
            );
          }}
          className="control bg-highlight text-on-accent"
        >
          Share my referral link
        </button>
        <p className="m-0 font-bold">
          {referrals.joined === 1
            ? '1 person has joined through your link'
            : `${referrals.joined} people have joined through your link`}
          , and {referrals.active} {referrals.active === 1 ? 'is' : 'are'} active.
        </p>
        <p className="m-0">{referrals.progress}</p>
        {referrals.earned.map((one) => (
          <p key={one.id} className="m-0 border-2 border-paper rounded-2xl p-4 font-bold">
            {one.words}
            {one.given ? ' It has been sent.' : ''}
          </p>
        ))}
        <h3 className="font-bold m-0">Reward levels</h3>
        <ul className="m-0 ps-6 space-y-1">
          {referrals.levels.map((level) => (
            <li key={level.activeReferrals}>
              {level.activeReferrals} active referrals: a {level.label}
              {level.reached ? ' (reached)' : ''}
            </li>
          ))}
        </ul>
        <p className="m-0 extra">
          Active means a Shopper has had an order delivered, a Runner is approved and has made a
          delivery, a shop is approved and has had an order, or an organisation has someone linked.
          A level counts when at least {referrals.minimumActivePercent}% of the people who joined
          through your link are active.
        </p>
      </section>

      <section aria-labelledby="ambassador-heading" className="space-y-3">
        <h2 id="ambassador-heading" className="text-lead font-bold m-0">
          Introduce a business
        </h2>
        <p className="m-0">
          As an Ozi Ambassador, you act as an independent marketer for {product}, introducing local
          shops, cafés and restaurants. The more businesses you introduce, the more you earn.
        </p>
        <ul className="m-0 ps-6 space-y-1">
          <li>
            {ambassador.profitShareWords} of our profit on every order from a business you
            introduce, for {ambassador.months} months from when we approve it.
          </li>
          <li>
            {ambassador.branchShareWords} on another branch of the same business that joins through
            your link.
          </li>
          <li>A one-off {ambassador.planShareWords} of its first Partner Plus payment.</li>
          <li>
            What you earn on an order waits {ambassador.holdDays} days after delivery, in case of a
            refund, then you can be paid it.
          </li>
          <li>
            Paid once {ambassador.payoutMinimumWords} is available: monthly, or when you ask to
            withdraw it to your bank.
          </li>
        </ul>
        <p className="m-0">{AMBASSADOR_EDUCATION}</p>
        <p className="m-0">
          <Link to={ambassador.termsPath} className="underline">
            Read the Ozi Ambassador terms
          </Link>
        </p>

        {!ambassador.joined && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <input
                id="ambassador-terms"
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                className="w-8 h-8 shrink-0"
              />
              <label htmlFor="ambassador-terms" className="m-0 font-bold">
                I have read and agree to the Ozi Ambassador terms
              </label>
            </div>
            {problem !== '' && (
              <p
                role="alert"
                className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl"
              >
                {problem}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={join}
              className="control bg-highlight text-on-accent"
            >
              {busy ? 'One moment…' : 'Become an Ozi Ambassador'}
            </button>
          </div>
        )}

        {ambassador.joined && ambassador.termsChanged && (
          <TermsChanged
            words={ambassador.termsChangedWords ?? ''}
            termsName="Ozi Ambassador terms"
            termsPath={ambassador.termsPath}
            onAgree={async () => {
              await becomeAmbassador(as, ambassador.termsVersion);
              onNews('Thank you. You have agreed to the new Ozi Ambassador terms.');
              load();
            }}
          />
        )}

        {ambassador.joined && ambassador.link && (
          <div className="space-y-3">
            <p className="m-0">Your Introduce a business link:</p>
            <p className="m-0 break-all">{ambassador.link}</p>
            <button
              type="button"
              onClick={() => {
                const link = ambassador.link ?? '';
                void share(link, `Join ${product} as a partner business: ${link}`, onNews);
              }}
              className="control bg-highlight text-on-accent"
            >
              Share my Introduce a business link
            </button>
            <h3 className="font-bold m-0">Businesses you introduced</h3>
            {ambassador.businesses.length === 0 ? (
              <p className="m-0">None yet.</p>
            ) : (
              <ul className="m-0 ps-6 space-y-1">
                {ambassador.businesses.map((business, index) => (
                  <li key={`${business.name}-${index}`}>
                    {business.name}: {business.approved ? 'approved' : 'waiting for approval'}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="font-bold m-0">Your Ambassador earnings</h3>
            <ul className="m-0 ps-6 space-y-1">
              <li>
                Pending (waiting for the refund window to pass): {money(ambassador.pendingPence)}
              </li>
              <li>Available: {money(ambassador.availablePence)}</li>
              <li>Paid: {money(ambassador.paidPence)}</li>
            </ul>
            {ambassador.deductions.map((line, index) => (
              <p key={`${line.at}-${index}`} className="m-0">
                {line.words}
              </p>
            ))}
            {withdrawProblem !== '' && (
              <p
                role="alert"
                className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl"
              >
                {withdrawProblem}
              </p>
            )}
            {!ambassador.bankReady && (
              <button
                type="button"
                disabled={busy}
                onClick={setUpBank}
                className="control bg-paper/10 text-paper border-paper"
              >
                Set up my bank details with Stripe
              </button>
            )}
            {ambassador.bankReady && ambassador.canWithdraw && (
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
          </div>
        )}
      </section>
    </div>
  );
}

const HEARD = 'ozidelivery.referral.news';

/**
 * A reward level reached: Ozi says it the next time the person opens the app, once, then the
 * server marks it heard. For whoever is signed in on this device: a Shopper, a Runner, or a shop
 * or organisation. Asked once a visit for each, a moment after the page opens.
 */
export function ReferralNews(): null {
  const { shopper } = useSession();
  const ozi = useOzi();
  const location = useLocation();
  const latest = useRef(ozi);
  latest.current = ozi;
  const asked = useRef(new Set<ReferralAs>());

  useEffect(() => {
    const signedInShopper = Boolean(shopper?.id);
    // A moment's pause, so it never talks over the greeting.
    const timer = window.setTimeout(() => {
      const signedIn: ReferralAs[] = [];
      if (signedInShopper) signedIn.push('shopper');
      if (readRunnerToken()) signedIn.push('runner');
      if (businessToken() !== '') signedIn.push('business');
      for (const as of signedIn) {
        if (asked.current.has(as)) continue;
        asked.current.add(as);
        try {
          if (window.sessionStorage.getItem(`${HEARD}.${as}`) === 'yes') continue;
          window.sessionStorage.setItem(`${HEARD}.${as}`, 'yes');
        } catch {
          // Storage refused: asked once for this page instead.
        }
        fetchMyReferrals(as)
          .then(async (found) => {
            if (found.referrals.news === '') return;
            await latest.current.say(found.referrals.news);
            await markReferralNewsHeard(as);
          })
          .catch(() => undefined);
      }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [shopper?.id, location.pathname]);

  return null;
}
