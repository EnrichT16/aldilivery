import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The Runner door.
 *
 * Rule Two is a promise to a person, so it is stated as a number on the first screen a
 * Runner ever sees, with nothing hedged and no asterisk.
 */
export function RunnerDoor(): JSX.Element {
  const { runnerPaymentPence, coolBag } = storeConfig.fees;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Run for {storeConfig.productName}</h1>

      <p className="text-lead m-0 max-w-xl">
        You get {money(runnerPaymentPence)} for every order you complete. Every order, without
        exception.
      </p>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-lead font-bold">
          How it works
        </h2>
        <ol className="m-0 ps-6 space-y-2">
          <li>A job is offered to you and held for you for sixty seconds.</li>
          <li>You buy the shopping at the shelf price and keep the receipt.</li>
          <li>You take it to the door and follow whatever the Shopper asked for.</li>
          <li>{money(runnerPaymentPence)} goes to your own bank account.</li>
        </ol>
      </section>

      <section aria-labelledby="fair-heading" className="space-y-3">
        <h2 id="fair-heading" className="text-lead font-bold">
          How jobs are shared out
        </h2>
        <p className="m-0 max-w-xl">
          Jobs go to whoever is nearby and has waited longest since their last one. It is a
          rotation, not a race, so you do not have to sit staring at your phone to earn.
        </p>
        <p className="m-0 max-w-xl">
          If two orders are close together we may give you both in one trip. You are paid{' '}
          {money(runnerPaymentPence)} for each of them, not one payment split between them.
        </p>
      </section>

      <section aria-labelledby="bag-heading" className="space-y-3">
        <h2 id="bag-heading" className="text-lead font-bold">
          The cool bag
        </h2>
        <p className="m-0 max-w-xl">
          You will need a cool bag. We hold back {money(coolBag.withholdPerOrderPence)} from your
          first few payments, up to {money(coolBag.depositPence)} in total, and give the whole
          lot back to you after your {coolBag.releaseAfterCompletedDeliveries}th delivery. It is
          held, not taken.
        </p>
      </section>

      <section aria-labelledby="checks-heading" className="space-y-3">
        <h2 id="checks-heading" className="text-lead font-bold">
          What we need from you
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Proof of your right to work in the United Kingdom.</li>
          <li>A criminal record check.</li>
          <li>Your own bank account, so we can pay you directly.</li>
        </ul>
      </section>

      <Link to="/sign-up" className="control bg-highlight text-ink text-lead">
        Start signing up as a Runner
      </Link>
    </div>
  );
}
