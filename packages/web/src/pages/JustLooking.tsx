import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The third door: for someone who has not decided yet.
 *
 * Everything on this page is a plain answer to a question somebody would actually ask. The
 * fee table is a real table, so it can be read row by row rather than as a wall of numbers.
 */
export function JustLooking(): JSX.Element {
  const { bands, runnerPaymentPence } = storeConfig.fees;

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
          One flat fee, decided only by how much the shopping comes to. It never goes up
          because it is raining, or because it is Friday, or because your order is small.
        </p>

        <table className="w-full border-collapse max-w-xl">
          <caption className="text-left pb-2">Our fee, by the size of your shopping</caption>
          <thead>
            <tr className="border-b-2 border-paper">
              <th scope="col" className="text-left py-2">
                If your shopping comes to
              </th>
              <th scope="col" className="text-right py-2">
                The fee is
              </th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band, index) => {
              const from = index === 0 ? 1 : (bands[index - 1]?.uptoPence ?? 0) + 1;
              return (
                <tr key={band.uptoPence} className="border-b border-paper/30">
                  <td className="py-2">
                    {money(from)} to {money(band.uptoPence)}
                  </td>
                  <td className="text-right py-2">{money(band.feePence)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
