import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The terms for Shoppers, in plain words.
 *
 * A DRAFT for Anthony's solicitor, written from the rules the service actually enforces: the flat
 * fee, the most one delivery carries, paying what the till says, nothing charged without a yes,
 * nothing swapped without a yes, the refund timeline and the call price. Every figure comes from
 * configuration, so a price changed there changes here. Runners will have their own agreement.
 */
export function Terms(): JSX.Element {
  const name = storeConfig.productName;
  const { standardDeliveryPence, maximumGoodsPence, runnerPaymentPence } = storeConfig.fees;
  const { instantRefundUpToPence, decideWithinWorkingDays } = storeConfig.problems;
  const company = storeConfig.store.legalEntityIsPlaceholder
    ? 'the company that runs it (its registered name and number will be shown here)'
    : storeConfig.store.legalEntityName;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Our terms</h1>
      <p className="m-0 border-2 border-paper rounded-xl p-4">
        This is a draft, being checked by our solicitor before we open to everyone. Nothing here
        takes away your rights under UK consumer law.
      </p>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold">
          What we do
        </h2>
        <p className="m-0">
          {name}, run by {company}, takes your shopping order, and a Runner buys it at the shop for
          you and brings it to your door.
        </p>
      </section>

      <section aria-labelledby="price" className="space-y-3">
        <h2 id="price" className="text-lead font-bold">
          What it costs
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Delivery is {money(standardDeliveryPence)}, the only fee. {money(runnerPaymentPence)} of
            it goes to your Runner, every time.
          </li>
          <li>
            One delivery carries up to {money(maximumGoodsPence)} of shopping. More than that goes
            as a second delivery.
          </li>
          <li>
            The prices shown are estimates. You pay what the shop&rsquo;s till charges, shown on the
            receipt, which may be a little more or less.
          </li>
          <li>
            In-app calls cost {storeConfig.calls.pencePerMinute}p a minute, paid by the Shopper, for
            each person on the call, and are agreed before each call.
          </li>
        </ul>
      </section>

      <section aria-labelledby="yes" className="space-y-3">
        <h2 id="yes" className="text-lead font-bold">
          Nothing without your yes
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Nothing is charged until you confirm the order, with the total and the delivery address
            put to you first.
          </li>
          <li>
            If something is not on the shelf, your Runner asks you. Nothing is swapped without your
            say. If you do not answer, it is left out, and you are not charged for it.
          </li>
          <li>An order made by voice only ever goes to your registered home address.</li>
        </ul>
      </section>

      <section aria-labelledby="not" className="space-y-3">
        <h2 id="not" className="text-lead font-bold">
          What we cannot bring
        </h2>
        <p className="m-0">
          Alcohol, tobacco, medicines and cash are not delivered. Your Runner will leave out
          anything the shop or the law does not allow us to bring.
        </p>
      </section>

      <section aria-labelledby="wrong" className="space-y-3">
        <h2 id="wrong" className="text-lead font-bold">
          When something goes wrong
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Tell us in the app, or ring us. You can add photos, voice notes or a note.</li>
          <li>
            Asking for {money(instantRefundUpToPence)} or less back? It is refunded straight away.
          </li>
          <li>
            Otherwise a person decides within {decideWithinWorkingDays} working days and tells you
            why, and any refund goes back to your card the day it is decided.
          </li>
          <li>
            Your rights under the Consumer Rights Act 2015 still apply: goods must be of
            satisfactory quality and as described, and our service must be done with reasonable care
            and skill.
          </li>
        </ul>
      </section>

      <section aria-labelledby="cancel" className="space-y-3">
        <h2 id="cancel" className="text-lead font-bold">
          Changing your mind
        </h2>
        <p className="m-0">
          To cancel an order, ring us before your Runner starts shopping for it, and we will cancel
          it and refund you in full. Fresh and perishable food cannot be returned once delivered,
          unless something is wrong with it.
        </p>
      </section>

      <section aria-labelledby="law" className="space-y-3">
        <h2 id="law" className="text-lead font-bold">
          The law that applies
        </h2>
        <p className="m-0">
          These terms are under the law of England and Wales. If you live elsewhere in the UK, you
          keep the protections of the law where you live.
        </p>
      </section>

      <Link to="/privacy" className="control bg-paper/10 text-paper underline">
        Privacy
      </Link>
    </article>
  );
}
