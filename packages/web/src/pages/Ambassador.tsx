import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { storeConfig } from '../config';
import { fetchMyReferrals, type MyReferrals } from '../lib/api';
import {
  AMBASSADOR_RULES,
  EDUCATION_NOTE,
  EXAMPLES_ONLY,
  ambassadorAs,
  earningLines,
  exampleLines,
} from '../lib/ambassador';

/**
 * "Become an Ozi Ambassador" (Anthony, 30 October 2026): the page the card on every dashboard and
 * the footer link open, for anyone, signed in or not. In plain words: what an Ambassador does, how
 * they earn with the figures from the settings, honest examples labelled as examples, the
 * education note, the rules, the terms, and how to apply.
 *
 * Somebody with no account applies by setting up a Shopper account first, the same phone-code
 * sign-up everybody uses, which brings them straight back to the application.
 */
export function Ambassador(): JSX.Element {
  const [params] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [mine, setMine] = useState<MyReferrals['ambassador'] | null>(null);
  const product = storeConfig.productName;

  useEffect(() => {
    if (!as) return;
    fetchMyReferrals(as)
      .then((found) => setMine(found.ambassador))
      .catch(() => undefined);
  }, [as]);

  const approved = mine?.approved === true;
  const applying = mine?.joined === true && !approved;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Become an Ozi Ambassador</h1>
      <p className="m-0 text-lead">
        Introduce restaurants and shops to {product} and earn from their orders.
      </p>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold m-0">
          What an Ambassador does
        </h2>
        <p className="m-0">
          An Ambassador is an independent marketer. You tell local restaurants, cafés, takeaways and
          shops about {product}, and help them join. You are not our employee: you choose when and
          how you do it.
        </p>
        <p className="m-0">
          You also introduce Runners (drivers) and Shoppers, with your own referral link, because a
          business only gets orders when there are people to order and people to deliver.
        </p>
      </section>

      <section aria-labelledby="earn" className="space-y-3">
        <h2 id="earn" className="text-lead font-bold m-0">
          How you earn
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          {earningLines().map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="examples" className="space-y-3">
        <h2 id="examples" className="text-lead font-bold m-0">
          Examples
        </h2>
        <p className="m-0 font-bold">{EXAMPLES_ONLY}</p>
        <ul className="m-0 ps-6 space-y-2">
          {exampleLines().map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="education" className="space-y-3">
        <h2 id="education" className="text-lead font-bold m-0">
          Introduce Runners and Shoppers too
        </h2>
        <p className="m-0">{EDUCATION_NOTE}</p>
      </section>

      <section aria-labelledby="rules" className="space-y-3">
        <h2 id="rules" className="text-lead font-bold m-0">
          The rules
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          {AMBASSADOR_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="m-0">
          <Link to="/ambassador/terms" className="underline">
            Read the Ozi Ambassador terms
          </Link>
        </p>
      </section>

      <section aria-labelledby="apply" className="space-y-3">
        <h2 id="apply" className="text-lead font-bold m-0">
          How to apply
        </h2>
        <ol className="m-0 ps-6 space-y-2">
          <li>Read and agree to the Ozi Ambassador terms.</li>
          <li>
            Send your documents from your phone: a photo ID, a proof of address from the last{' '}
            {storeConfig.ambassador.addressWithinMonths} months, and a photo of your face.
          </li>
          <li>Have a short chat with our founder.</li>
          <li>Once you are approved, you get your Ambassador links, the Toolkit and earnings.</li>
        </ol>
        {approved ? (
          <Link to="/ambassador/home" className="control bg-highlight text-on-accent">
            Open my Ambassador dashboard
          </Link>
        ) : as ? (
          <Link to="/ambassador/apply" className="control bg-highlight text-on-accent">
            {applying ? 'Carry on with my application' : 'Apply to be an Ambassador'}
          </Link>
        ) : (
          <div className="space-y-3">
            <p className="m-0">
              First, set up your free account with your phone number. Then you come straight back
              here to apply.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/sign-up?next=/ambassador/apply"
                className="control bg-highlight text-on-accent"
              >
                Set up my account and apply
              </Link>
              <Link
                to="/sign-in?next=/ambassador/apply"
                className="control border-paper bg-paper/10 text-paper"
              >
                I have an account: sign in
              </Link>
            </div>
          </div>
        )}
      </section>
    </article>
  );
}
