import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';
import { WrongAppWarning } from '../components/GetTheApp';
import { ENHANCED_DBS_OPTIONAL, paidBackInFull } from '../lib/runner-words';

/**
 * The Runner door.
 *
 * Rule Two is a promise to a person, so it is stated as a number on the first screen a
 * Runner ever sees, with no asterisk. Every figure is from config, and each promise says only
 * what the code does (Anthony, 30 October 2026).
 */
export function RunnerDoor(): JSX.Element {
  const { runnerPaymentPence, coolBag, largeOrderFromPence, largeOrderRunnerPaymentPence } =
    storeConfig.fees;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Run for {storeConfig.productName}</h1>

      <p className="text-lead m-0 max-w-xl">
        You get {money(runnerPaymentPence)} a standard delivery,{' '}
        {money(largeOrderRunnerPaymentPence)} for orders of {money(largeOrderFromPence)} or more,
        delivered whole by car or van. When a big order is split between Runners, each part pays{' '}
        {money(storeConfig.dispatch.splitRunnerPayPence)}, shown before you say yes.
      </p>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-lead font-bold">
          How it works
        </h2>
        <ol className="m-0 ps-6 space-y-2">
          <li>
            A job is offered to you and held for you for {storeConfig.allocation.offerHoldSeconds}{' '}
            seconds.
          </li>
          <li>
            You buy the shopping at the shelf price with your own card and keep the receipt.{' '}
            {paidBackInFull()}
          </li>
          <li>You take it to the door and follow whatever the Shopper asked for.</li>
          <li>Your pay goes to your Stripe account, then to your bank on your payout schedule.</li>
        </ol>
      </section>

      <section aria-labelledby="fair-heading" className="space-y-3">
        <h2 id="fair-heading" className="text-lead font-bold">
          How jobs are shared out
        </h2>
        <p className="m-0 max-w-xl">
          Jobs go first to available Runners in your area, nearest first. Each offer is held for
          you, so you do not have to sit staring at your phone to earn.
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
          first few payments, up to {money(coolBag.depositPence)} in total, and give the whole lot
          back to you after your {coolBag.releaseAfterCompletedDeliveries}th delivery. It is your
          money, held back and then given back.
        </p>
      </section>

      <section aria-labelledby="checks-heading" className="space-y-3">
        <h2 id="checks-heading" className="text-lead font-bold">
          What we need from you
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Proof of your right to work in the United Kingdom.</li>
          <li>A basic criminal record check (a basic DBS check).</li>
          <li>Your own bank account, so we can pay you directly.</li>
          <li>You must be 18 or over.</li>
        </ul>
        <p className="m-0 max-w-xl">{ENHANCED_DBS_OPTIONAL}</p>
      </section>

      <section aria-labelledby="agreement-heading" className="space-y-3">
        <h2 id="agreement-heading" className="text-lead font-bold">
          Working for yourself
        </h2>
        <p className="m-0 max-w-xl">
          Runners are self-employed. You choose when you work, and you can say no to any job without
          a reason. The Runner agreement says how it all works, in plain words.
        </p>
        <Link to="/runner/agreement" className="control bg-paper/10 text-paper underline">
          Read the Runner agreement
        </Link>
      </section>

      {/* Another app called Ozi is in the app stores; ours is not yet (Anthony, 30 October 2026). */}
      <WrongAppWarning homeScreen />

      <Link to="/runner/sign-up" className="control bg-highlight text-on-accent text-lead">
        Start signing up as a Runner
      </Link>
      <Link to="/runner/sign-in" className="control bg-paper/10 text-paper underline">
        Already signed up? Sign in to your Runner page
      </Link>
    </div>
  );
}
