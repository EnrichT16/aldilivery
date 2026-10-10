import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The third door: for someone who has not decided yet.
 *
 * Everything on this page is a plain answer to a question somebody would actually ask. The
 * prices are those of ruling 58 (9 October 2026), all from config/store.json.
 */
export function JustLooking(): JSX.Element {
  const { delivery, itemCharge, maximumOrderGoodsPence, maximumProductPence, runnerPaymentPence } =
    storeConfig.fees;
  const { extras, assistantName } = storeConfig;

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
          your door. You pay for the shopping, with a small item charge on each product, and
          delivery.
        </p>
        <p className="m-0 max-w-xl">
          We will never take a payment without asking you first, and we never keep your card number.
        </p>
      </section>

      <section aria-labelledby="fee-heading" className="space-y-3">
        <h2 id="fee-heading" className="text-lead font-bold">
          The prices
        </h2>
        <p className="m-0 max-w-xl">
          Every product has a small item charge, already included in the price we show and say:{' '}
          {money(itemCharge.basePence)} for anything under {money(itemCharge.everyPence)}, and{' '}
          {money(itemCharge.stepPence)} more for every {money(itemCharge.everyPence)} of its shop
          price. No single product can cost more than {money(maximumProductPence)}.
        </p>
        <p className="m-0 max-w-xl">
          Delivery, if you pay as you go: {money(delivery.payAsYouGoSmallOrderPence)} for shopping
          of {money(delivery.payAsYouGoSmallOrderUpToPence)} or less, and{' '}
          {money(delivery.payAsYouGoPence)} above that. With {assistantName} Membership (
          {money(extras.membershipPence)} a month) it is {money(delivery.membershipPence)} every
          time; with {assistantName} Plus ({money(extras.plusPence)} a month) or Family and Carer (
          {money(extras.familyPence)} a month), {money(delivery.plusPence)}. Your first month of
          membership is free. It never goes up because it is raining, or because it is Friday.
        </p>
        <p className="m-0 max-w-xl">
          One order carries up to {money(maximumOrderGoodsPence)} of shopping. If you need more than
          that, you can keep everything and a second Runner brings the rest, for an extra{' '}
          {money(storeConfig.fees.extraRunnerDeliveryPence)} delivery, taken only when they collect
          it.
        </p>

        <p className="m-0 max-w-xl">
          {money(runnerPaymentPence)} of every delivery goes to the Runner who does your shopping,
          whatever the order, and {money(storeConfig.fees.largeOrderRunnerPaymentPence)} for an
          order of {money(storeConfig.fees.largeOrderFromPence)} or more.
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
            If you set up a regular order, we tell you{' '}
            {storeConfig.recurringOrders.noticeMinutesBefore} minutes beforehand and you can stop it
            by saying &ldquo;
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
