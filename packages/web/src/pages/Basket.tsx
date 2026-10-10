import { Link } from 'react-router-dom';

import { GetTheApp } from '../components/GetTheApp';
import { storeConfig } from '../config';
import { deliveryWords, money, shownPrice } from '../lib/money';
import { useBasket } from '../state/basket';

/**
 * The basket.
 *
 * Rule Four and Rule One both show themselves on this screen. Every price includes its item
 * charge (ruling 58), and the shopping, the item charges and delivery are each stated on their
 * own line before there is any way to carry on. And the only way to carry on is a link to the confirmation screen: nothing on
 * this page charges anybody.
 */
export function Basket(): JSX.Element {
  const { lines, pricing, overMaximum, setQuantity, remove } = useBasket();

  if (lines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your basket</h1>
        <p className="m-0">There is nothing in your basket yet.</p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Your basket</h1>
      {/* Ordering in a browser: the app is one press away (ruling 50). */}
      <GetTheApp compact />

      <ul className="list-none m-0 p-0 space-y-4">
        {lines.map((line) => (
          <li
            key={line.item.id}
            className="border-2 border-paper/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
          >
            <div>
              <p className="m-0 text-lead font-bold">{line.item.name}</p>
              <p className="m-0 text-paper/90">
                {line.quantity} × about {money(shownPrice(line.item.estimatedPricePence))} ={' '}
                {money(shownPrice(line.item.estimatedPricePence) * line.quantity)}
              </p>
            </div>

            {/* flex-wrap: at 400% zoom the Remove button drops below the quantity rather than
                pushing the page sideways. Measured 18px of horizontal scroll at 320px without it. */}
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor={`quantity-${line.item.id}`} className="visually-hidden">
                How many {line.item.name}
              </label>
              <input
                id={`quantity-${line.item.id}`}
                type="number"
                min={1}
                max={99}
                value={line.quantity}
                onChange={(event) => {
                  setQuantity(line.item.id, Number(event.target.value));
                }}
                className="w-24 min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 text-center"
              />
              <button
                type="button"
                className="control bg-paper text-ink"
                onClick={() => {
                  remove(line.item.id);
                }}
              >
                Remove {line.item.name}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/*
        The fee, before anybody commits to anything. A table because it is a table: rows of
        labels and amounts, which a screen reader will read as pairs.
      */}
      <section aria-labelledby="total-heading" className="space-y-3">
        <h2 id="total-heading" className="text-lead font-bold">
          What this will cost
        </h2>

        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <th scope="row" className="text-left font-normal py-2">
                Your shopping, with item charges, about
              </th>
              <td className="text-right py-2">
                {money(pricing.goodsPence + pricing.itemChargesPence)}
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2 ps-6">
                At the shop&rsquo;s prices
              </th>
              <td className="text-right py-2">{money(pricing.goodsPence)}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2 ps-6">
                Item charges
              </th>
              <td className="text-right py-2">{money(pricing.itemChargesPence)}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2">
                Delivery
              </th>
              <td className="text-right py-2">{money(pricing.feePence)}</td>
            </tr>
            <tr className="border-t-2 border-paper">
              <th scope="row" className="text-left text-lead font-bold py-2">
                Altogether, about
              </th>
              <td className="text-right text-lead font-bold py-2">{money(pricing.totalPence)}</td>
            </tr>
          </tbody>
        </table>

        <p className="m-0">
          {deliveryWords(pricing.plan)} There is no charge for a small order, no charge for being
          busy, and no smallest order. Every price we show already includes its item charge.
        </p>
        <p className="m-0">
          You pay what the till says for the shopping, so the total may change a little.
        </p>
      </section>

      {overMaximum ? (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          This comes to about {money(pricing.goodsPence)} of shopping at the shop&rsquo;s prices,
          and one order carries up to {money(storeConfig.fees.maximumOrderGoodsPence)}. Take some
          things out and send this as one delivery, then order the rest as a second delivery.
        </p>
      ) : (
        <Link to="/confirm" className="control w-full bg-highlight text-ink text-lead">
          Check and send my order
        </Link>
      )}
    </div>
  );
}
