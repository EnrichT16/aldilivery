import { useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';

/**
 * The confirmation screen. Rule One made visible.
 *
 * There is exactly one button on this page that could ever lead to a payment, it is the
 * largest thing on the screen, and it says what it does: send my order. Everything above it
 * is a plain statement of what will happen and what it will cost. Nothing is pre-ticked,
 * nothing is assumed, and there is no second way to confirm hidden anywhere.
 */
export function Confirm(): JSX.Element {
  const { lines, pricing, clear } = useBasket();
  const [sent, setSent] = useState(false);

  if (lines.length === 0 && !sent) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Send your order</h1>
        <p className="m-0">There is nothing in your basket yet.</p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">That is as far as we go for now</h1>
        <p role="status" className="m-0 max-w-xl">
          Nothing has been charged and nothing has been sent. Sending real orders is not
          switched on yet. This screen is here so you can see the one button that will ever
          take a payment, and read exactly what it says before it does.
        </p>
        <Link to="/" className="control bg-highlight text-ink">
          Back to the start
        </Link>
      </div>
    );
  }

  const statement = `Send my order. About ${money(pricing.totalPence)} altogether, including our fee of ${money(pricing.feePence)}.`;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Send your order</h1>

      <section aria-labelledby="what-heading" className="space-y-3">
        <h2 id="what-heading" className="text-lead font-bold">
          What you are asking for
        </h2>
        <ul className="list-none m-0 p-0 space-y-2">
          {lines.map((line) => (
            <li key={line.item.id} className="m-0">
              {line.quantity} × {line.item.name}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cost-heading" className="space-y-3">
        <h2 id="cost-heading" className="text-lead font-bold">
          What it will cost
        </h2>
        <p className="m-0">Your shopping, about {money(pricing.goodsPence)}.</p>
        <p className="m-0">Our fee, {money(pricing.feePence)}. That is the only fee.</p>
        <p className="m-0 text-lead font-bold">
          Altogether, about {money(pricing.totalPence)}.
        </p>
        <p className="m-0">
          You pay what the till says for the shopping, so this may change a little. Your Runner
          gets {money(storeConfig.fees.runnerPaymentPence)} of the fee.
        </p>
      </section>

      <section aria-labelledby="promise-heading" className="space-y-3">
        <h2 id="promise-heading" className="text-lead font-bold">
          Before you press it
        </h2>
        <p className="m-0">
          Pressing the button below is the only thing that will ever take a payment. Nothing
          before it has charged you a penny, and nothing after it will charge you again
          without asking.
        </p>
      </section>

      <button
        type="button"
        className="control w-full bg-highlight text-ink text-display py-8"
        onClick={() => {
          clear();
          setSent(true);
        }}
      >
        Send my order
      </button>

      <p className="m-0">
        <span className="visually-hidden">You are agreeing to this: </span>
        {statement}
      </p>

      <Link to="/basket" className="control bg-paper text-ink">
        Go back and change something
      </Link>
    </div>
  );
}
