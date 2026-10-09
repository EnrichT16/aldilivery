import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * For family and carers: someone who wants to help a Shopper with their shopping. Ozi Family and
 * Carer (ruling 58, 9 October 2026) replaces the earlier T1 proposal: one monthly price, from
 * config/store.json, for up to four people in different homes, paid with one card.
 */
export function LookingAfter(): JSX.Element {
  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">If you look after someone</h1>
      <p className="text-lead m-0 max-w-xl">
        Many people help a parent, a relative or a friend with their shopping.{' '}
        {storeConfig.productName} is built so you can help without doing it all yourself.
      </p>
      <section aria-labelledby="now-heading" className="space-y-3 max-w-xl">
        <h2 id="now-heading" className="text-lead font-bold">
          What you can do now
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Help them set up their own account, and save an address for them.</li>
          <li>
            Join a call between them and their Runner, when they add you, to speak for them. They
            send you a link; you do not need an account.
          </li>
          <li>Send shopping to them from your own account, to an address you save.</li>
        </ul>
      </section>
      <section aria-labelledby="plan-heading" className="space-y-3 max-w-xl">
        <h2 id="plan-heading" className="text-lead font-bold">
          {storeConfig.assistantName} Family and Carer
        </h2>
        <p className="m-0">
          {money(storeConfig.extras.familyPence)} a month for up to{' '}
          {storeConfig.extras.familyMaximum} people in different homes, with delivery at{' '}
          {money(storeConfig.fees.delivery.plusPence)}. You see every order and are told when it is
          ordered, on its way and delivered; you can approve orders above a limit you choose; one
          card pays for everyone; and you get a weekly summary. You can cancel at any time with one
          button.
        </p>
        <Link to="/plus" className="control bg-paper text-ink">
          See the plans
        </Link>
      </section>
      <Link to="/sign-up" className="control bg-highlight text-ink">
        Set up an account
      </Link>
      <Link to="/" className="control bg-paper/10 text-paper underline">
        Back to the start
      </Link>
    </div>
  );
}
