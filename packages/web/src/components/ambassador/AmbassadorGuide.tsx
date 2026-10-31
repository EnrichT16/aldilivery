import { useRef } from 'react';

import { storeConfig } from '../../config';
import { money } from '../../lib/money';
import {
  AMBASSADOR_RULES,
  EXAMPLES_ONLY,
  REMOVAL_FOR_FRAUD_WORDS,
  earningLines,
} from '../../lib/ambassador';
import { FREE_JOINING_WORDS } from '../FreeJoiningNotice';
import { useOzi } from '../../state/ozi';

/**
 * The Ambassador Guide (Anthony, 30 October 2026): a plain page, read aloud by Ozi on request.
 * The two-minute pitch for restaurant owners, answers to the questions they ask, how an
 * Ambassador earns, and what never to say. Every figure from config/store.json. Written only from
 * what the service really does: no supermarket partnership, no insurance, no promises. No other
 * company is named (Anthony, 31 October 2026): Ambassadors say "other delivery apps".
 */
export function AmbassadorGuide({ headingLevel = 2 }: { headingLevel?: 2 | 3 }): JSX.Element {
  const ozi = useOzi();
  const page = useRef<HTMLDivElement>(null);
  const product = storeConfig.productName;
  const restaurants = storeConfig.restaurants;
  const partners = storeConfig.extras.partners;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const Sub = headingLevel === 2 ? 'h3' : 'h4';

  return (
    <section aria-labelledby="guide-heading" className="space-y-6">
      <H id="guide-heading" className="text-lead font-bold m-0">
        The Ambassador Guide
      </H>
      <button
        type="button"
        onClick={() => {
          void ozi.say(page.current?.innerText || page.current?.textContent || '');
        }}
        className="control border-paper bg-paper/10 text-paper"
      >
        Read the guide to me
      </button>
      <div ref={page} className="space-y-6">
        <section
          aria-labelledby="guide-free"
          className="space-y-2 border-4 border-highlight rounded-2xl p-4"
        >
          <Sub id="guide-free" className="font-bold m-0">
            Say this to every business: joining is free
          </Sub>
          <p className="m-0">{FREE_JOINING_WORDS}</p>
          <p className="m-0">
            Every business you sign up confirms it with a code we text to its own phone. They type
            it in themselves, on their own phone or computer. Anybody can check your Ambassador
            code on our website.
          </p>
        </section>

        <section aria-labelledby="guide-pitch" className="space-y-2">
          <Sub id="guide-pitch" className="font-bold m-0">
            The two-minute pitch for restaurant owners
          </Sub>
          <p className="m-0">
            Hello, I am an Ambassador for {product}, a local delivery service made for everyone,
            including older and disabled people and their carers, who order by speaking to Ozi or by
            phone.
          </p>
          <p className="m-0">
            Those customers find it hard to use other apps, so many of them will be new to you. Our
            Runners (drivers) come to your counter and pay you in full, there and then. There is no
            commission.
          </p>
          <p className="m-0">
            Your own price stays the same. We add a small mark-up on our side, which you agree. If
            you choose to give us a discount, of {restaurants.preferredDiscountPercent}% or more,
            you become a Preferred Partner, shown first to customers.
          </p>
          <p className="m-0">
            Joining is free and takes a few minutes. I can sign you up now, on my phone, or you can
            scan the code on my flyer. A person at {product} checks every business before it goes
            live.
          </p>
        </section>

        <section aria-labelledby="guide-questions" className="space-y-3">
          <Sub id="guide-questions" className="font-bold m-0">
            Answers to common questions
          </Sub>
          <p className="m-0 font-bold">
            &ldquo;Why join when I am already on other delivery apps?&rdquo;
          </p>
          <p className="m-0">
            You can do both. {product} reaches people other apps often miss: older and disabled
            customers and their carers, ordering by voice or by phone. And {product} pays you at the
            counter straight away, your price in full, with no commission. Other delivery apps pay
            you later and take a commission.
          </p>
          <p className="m-0 font-bold">&ldquo;What is the mark-up?&rdquo;</p>
          <p className="m-0">
            A percentage we add to your prices on {product}, agreed with you, at most{' '}
            {restaurants.maximumMarkupPercent}%. The customer sees and pays it, and is told that
            prices on {product} may be higher than in your shop. You still get your own price.
          </p>
          <p className="m-0 font-bold">&ldquo;When am I paid?&rdquo;</p>
          <p className="m-0">
            Straight away. The Runner pays you at the counter when they collect the order, in full,
            less any discount you chose to give.
          </p>
          <p className="m-0 font-bold">&ldquo;Who are the customers?&rdquo;</p>
          <p className="m-0">
            Local people who find it hard to get out or to use apps: older people, disabled people
            and people who are blind, and the families and carers who order for them.
          </p>
          <p className="m-0 font-bold">&ldquo;What does it cost?&rdquo;</p>
          <p className="m-0">
            A restaurant, café or takeaway listing is free. A shop can have a free basic listing
            while they last, or Partner Plus at {money(partners.plusMonthlyPence)} a month
            {partners.plusFirstMonthFree ? ', with the first month free' : ''}.
          </p>
        </section>

        <section aria-labelledby="guide-earn" className="space-y-2">
          <Sub id="guide-earn" className="font-bold m-0">
            How you earn
          </Sub>
          <ul className="m-0 ps-6 space-y-1">
            {earningLines().map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="m-0">{EXAMPLES_ONLY}</p>
        </section>

        <section aria-labelledby="guide-never" className="space-y-2">
          <Sub id="guide-never" className="font-bold m-0">
            What never to say or do
          </Sub>
          <ul className="m-0 ps-6 space-y-1">
            {AMBASSADOR_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="m-0 font-bold">{REMOVAL_FOR_FRAUD_WORDS}</p>
        </section>
      </div>
    </section>
  );
}
