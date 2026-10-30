import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  becomeAmbassador,
  businessToken,
  fetchMyReferrals,
  markReferralNewsHeard,
  type MyReferrals,
  type ReferralAs,
} from '../lib/api';
import { EDUCATION_NOTE } from '../lib/ambassador';
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
 * "Earn as an Ozi Ambassador" (since applications began, 30 October 2026): one line and "Find
 * out more", which opens /ambassador to apply. Their money, businesses and withdrawals are on the
 * Ambassador dashboard at /ambassador/home.
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
export const AMBASSADOR_EDUCATION = EDUCATION_NOTE;

/**
 * "Earn as an Ozi Ambassador" (Anthony, 30 October 2026), on every dashboard: what it is in one
 * line, and "Find out more", which opens /ambassador. Since applications began, nobody becomes an
 * Ambassador here: they apply there. An approved Ambassador opens their Ambassador dashboard; one
 * who is applying sees where it is; one who opted in before applications ("documents needed") is
 * told plainly that their link and earnings carry on and the Toolkit and withdrawals wait.
 */
function AmbassadorCard({
  as,
  ambassador,
  onNews,
  onChanged,
}: {
  as: ReferralAs;
  ambassador: MyReferrals['ambassador'];
  onNews: (words: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const approved = ambassador.approved === true;
  return (
    <section
      aria-labelledby="ambassador-heading"
      className="space-y-3 border-2 border-highlight rounded-2xl p-4"
    >
      <h2 id="ambassador-heading" className="text-lead font-bold m-0">
        Earn as an Ozi Ambassador
      </h2>
      <p className="m-0">Introduce restaurants and shops to Ozi and earn from their orders.</p>
      {ambassador.joined && !approved && ambassador.statusWords && (
        <p className="m-0 font-bold">Your application: {ambassador.statusWords}.</p>
      )}
      {ambassador.joined && !approved && ambassador.applicationMessage && (
        <p className="m-0">{ambassador.applicationMessage}</p>
      )}
      {ambassador.joined && ambassador.termsChanged && (
        <TermsChanged
          words={ambassador.termsChangedWords ?? ''}
          termsName="Ozi Ambassador terms"
          termsPath={ambassador.termsPath}
          onAgree={async () => {
            await becomeAmbassador(as, ambassador.termsVersion);
            onNews('Thank you. You have agreed to the new Ozi Ambassador terms.');
            onChanged();
          }}
        />
      )}
      {ambassador.link && (
        <div className="space-y-2">
          <p className="m-0">Your Introduce a business link:</p>
          <p className="m-0 break-all">{ambassador.link}</p>
          <button
            type="button"
            onClick={() => {
              const link = ambassador.link ?? '';
              void share(
                link,
                `Join ${storeConfig.productName} as a partner business: ${link}`,
                onNews,
              );
            }}
            className="control bg-highlight text-on-accent"
          >
            Share my Introduce a business link
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {ambassador.joined && (
          <Link to={`/ambassador/home?as=${as}`} className="control bg-highlight text-on-accent">
            Open my Ambassador dashboard
          </Link>
        )}
        <Link to={`/ambassador?as=${as}`} className="control border-paper bg-paper/10 text-paper">
          Find out more
        </Link>
      </div>
    </section>
  );
}

export function ReferralCard({
  as,
  onNews,
}: {
  as: ReferralAs;
  onNews: (words: string) => void;
}): JSX.Element | null {
  const [data, setData] = useState<MyReferrals | null>(null);

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

      <AmbassadorCard as={as} ambassador={ambassador} onNews={onNews} onChanged={load} />
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
