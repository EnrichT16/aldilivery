import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The third door: for someone who has not decided yet.
 *
 * Everything on this page is a plain answer to a question somebody would actually ask. The fee
 * is one flat figure (docs/BUILD_PROMPT.md, Section B), so it is said in one sentence.
 */
export function JustLooking(): JSX.Element {
  const { standardDeliveryPence, maximumGoodsPence, runnerPaymentPence } = storeConfig.fees;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">How {storeConfig.productName} works</h1>

      <section aria-labelledby="plain-heading" className="space-y-3">
        <h2 id="plain-heading" className="text-lead font-bold">
          In plain words
        </h2>
        <p className="m-0 max-w-xl">
          You tell us what shopping you want. A Runner, who is a real person nearby, goes to{' '}
          {storeConfig.store.displayName}, buys it at the ordinary shelf price, and brings it to
          your door. You pay for the shopping, plus one fee.
        </p>
        <p className="m-0 max-w-xl">
          We will never take a payment without asking you first, and we never keep your card
          number.
        </p>
      </section>

      <section aria-labelledby="fee-heading" className="space-y-3">
        <h2 id="fee-heading" className="text-lead font-bold">
          The fee
        </h2>
        <p className="m-0 max-w-xl">
          One flat fee of {money(standardDeliveryPence)} for each delivery, whatever the shopping
          comes to. It never goes up because it is raining, or because it is Friday, or because
          your order is small.
        </p>
        <p className="m-0 max-w-xl">
          One delivery carries up to {money(maximumGoodsPence)} of shopping, which is about as
          much as one Runner can carry safely. If you need more than that, it goes as two
          deliveries.
        </p>

        <p className="m-0 max-w-xl">
          {money(runnerPaymentPence)} of that fee goes to the Runner who does your shopping,
          whatever the order.
        </p>
      </section>

      <section aria-labelledby="promises-heading" className="space-y-3">
        <h2 id="promises-heading" className="text-lead font-bold">
          What we promise
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>We ask you once, clearly, before we take any payment.</li>
          <li>No surge pricing, no small order fee, and no smallest order.</li>
          <li>
            If you set up a regular order, we tell you {storeConfig.recurringOrders.noticeMinutesBefore}{' '}
            minutes beforehand and you can stop it by saying &ldquo;
            {storeConfig.recurringOrders.skipWord}&rdquo;.
          </li>
          <li>Every screen is built to be used by ear, by keyboard, or with very large text.</li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-4">
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up an account
        </Link>
        <Link to="/shop" className="control bg-paper text-ink">
          Have a look at the shopping
        </Link>
      </div>
    </div>
  );
}
