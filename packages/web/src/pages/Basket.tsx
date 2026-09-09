import { Link } from 'react-router-dom';

import { money } from '../lib/money';
import { useBasket } from '../state/basket';

/**
 * The basket.
 *
 * Rule Four and Rule One both show themselves on this screen. The fee is stated in words,
 * on its own line, with a sentence saying it is the only one, before there is any way to
 * carry on. And the only way to carry on is a link to the confirmation screen: nothing on
 * this page charges anybody.
 */
export function Basket(): JSX.Element {
  const { lines, pricing, setQuantity, remove } = useBasket();

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

      <ul className="list-none m-0 p-0 space-y-4">
        {lines.map((line) => (
          <li
            key={line.item.id}
            className="border-2 border-paper/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
          >
            <div>
              <p className="m-0 text-lead font-bold">{line.item.name}</p>
              <p className="m-0 text-paper/90">
                {line.quantity} × about {money(line.item.estimatedPricePence)} ={' '}
                {money(line.item.estimatedPricePence * line.quantity)}
              </p>
            </div>

            <div className="flex items-center gap-3">
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
                Your shopping, about
              </th>
              <td className="text-right py-2">{money(pricing.goodsPence)}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2">
                Our fee
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
          {money(pricing.feePence)} is the only fee. There is no charge for a small order, no
          charge for being busy, and no smallest order.
        </p>
        <p className="m-0">
          You pay what the till says for the shopping, so the total may change a little.
        </p>
      </section>

      <Link to="/confirm" className="control w-full bg-highlight text-ink text-lead">
        Check and send my order
      </Link>
    </div>
  );
}
