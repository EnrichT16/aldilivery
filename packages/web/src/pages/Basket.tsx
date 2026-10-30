import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { GetTheApp } from '../components/GetTheApp';
import { OverOneRunner } from '../components/OverOneRunner';
import { storeConfig } from '../config';
import { deliveryWords, money, shownPrice } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { tint } from '../components/ShopHome';
import { itemEmoji } from '../lib/shop-look';

/**
 * The basket.
 *
 * Rule Four and Rule One both show themselves on this screen. Every price includes its item
 * charge (ruling 58), and the shopping, the item charges and delivery are each stated on their
 * own line before there is any way to carry on. And the only way to carry on is a link to the confirmation screen: nothing on
 * this page charges anybody.
 *
 * Laid out as the big delivery apps lay out a basket (19 October 2026): a white card of rows,
 * each with its picture, its price, and a pill to change how many (Remove at one, Less above
 * one, the number, More); "+ Add items"; the costs on their own card; and one wide button on.
 */
export function Basket(): JSX.Element {
  const {
    lines,
    pricing,
    overMaximum,
    overOneRunner,
    parts,
    setQuantity,
    remove,
    allowanceWords,
    restaurant,
    restaurantProblem,
  } = useBasket();
  // What stops a restaurant order going (Anthony, 30 October 2026) is said by Ozi as well as
  // shown: once each time it changes.
  const ozi = useOzi();
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (restaurantProblem && said.current !== restaurantProblem) void ozi.say(restaurantProblem);
    said.current = restaurantProblem;
  }, [restaurantProblem, ozi]);

  if (lines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your basket</h1>
        <p className="m-0">There is nothing in your basket yet.</p>
        <Link to="/shop" className="control bg-highlight text-on-accent">
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

      <ul className="list-none m-0 p-0 rounded-3xl card-surface divide-y-2 divide-[#0B1F3A]/10 overflow-hidden">
        {lines.map((line) => (
          <li key={line.item.id} className="p-4 flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="flex items-center justify-center shrink-0 w-14 h-14 rounded-2xl text-[1.8rem] leading-none"
              style={{ background: tint(line.item.category) }}
            >
              {itemEmoji(line.item.name, line.item.category)}
            </span>
            <div className="flex-1 min-w-[10rem]">
              <p className="m-0 font-bold leading-tight">{line.item.name}</p>
              <p className="m-0 card-muted leading-snug">
                {line.quantity} × about {money(shownPrice(line.item.estimatedPricePence))} ={' '}
                {money(shownPrice(line.item.estimatedPricePence) * line.quantity)}
              </p>
            </div>

            {/* The stepper, a pill as the big apps have it: Remove at one, Less above one, the
                number (which can be typed), and More. flex-wrap on the row: at 400% zoom it drops
                below the name rather than pushing the page sideways. */}
            <div className="ms-auto max-w-full flex items-center gap-1 text-[0.9rem] rounded-full border-2 border-[#0B1F3A]/30 p-1">
              {line.quantity <= 1 ? (
                <button
                  type="button"
                  className="control !rounded-full !px-3 !py-1 bg-[#0B1F3A]/10 text-[#0B1F3A]"
                  onClick={() => {
                    remove(line.item.id);
                  }}
                >
                  <TrashIcon /> Remove<span className="visually-hidden"> {line.item.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="control !rounded-full !px-3 !py-1 bg-[#0B1F3A]/10 text-[#0B1F3A]"
                  onClick={() => {
                    setQuantity(line.item.id, line.quantity - 1);
                  }}
                >
                  <span aria-hidden="true">−</span> Less
                  <span className="visually-hidden">: {line.item.name}</span>
                </button>
              )}
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
                className="w-12 min-h-control !rounded-full border-0 bg-transparent text-[#0B1F3A] font-bold p-1 text-center"
              />
              <button
                type="button"
                disabled={line.quantity >= 99}
                className="control !rounded-full !px-3 !py-1 bg-[#0B1F3A]/10 text-[#0B1F3A] disabled:opacity-50"
                onClick={() => {
                  setQuantity(line.item.id, line.quantity + 1);
                }}
              >
                <span aria-hidden="true">+</span> More
                <span className="visually-hidden">: {line.item.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Link
        to="/shop"
        className="control !rounded-full bg-paper/10 text-paper border-2 border-paper/40"
      >
        <span aria-hidden="true">+</span> Add items
      </Link>

      {/*
        The fee, before anybody commits to anything. A table because it is a table: rows of
        labels and amounts, which a screen reader will read as pairs.
      */}
      <section aria-labelledby="total-heading" className="card-surface rounded-3xl p-5 space-y-3">
        <h2 id="total-heading" className="text-lead font-bold m-0">
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
              <th scope="row" className="text-left font-normal py-2 ps-6 card-muted">
                At the shop&rsquo;s prices
              </th>
              <td className="text-right py-2">{money(pricing.goodsPence)}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2 ps-6 card-muted">
                Item charges
              </th>
              <td className="text-right py-2">{money(pricing.itemChargesPence)}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-normal py-2">
                {restaurant ? 'Restaurant fee, in place of delivery' : 'Delivery'}
              </th>
              <td className="text-right py-2">{money(pricing.feePence)}</td>
            </tr>
            {pricing.allowanceExtraPence > 0 && (
              <tr>
                <th scope="row" className="text-left font-normal py-2">
                  Extra delivery charge
                </th>
                <td className="text-right py-2">{money(pricing.allowanceExtraPence)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-[#0B1F3A]">
              <th scope="row" className="text-left text-lead font-bold py-2">
                Altogether, about
              </th>
              <td className="text-right text-lead font-bold py-2">{money(pricing.totalPence)}</td>
            </tr>
          </tbody>
        </table>

        {restaurant ? (
          <p className="m-0 card-muted">
            A restaurant order from {restaurant.name}: dishes at the restaurant&rsquo;s own prices,
            and a flat restaurant fee of {money(storeConfig.restaurants.feePence)} in place of
            delivery, on every plan ({money(storeConfig.restaurants.largeOrderFeePence)} for{' '}
            {money(storeConfig.restaurants.largeOrderFromPence)} of dishes or more, when your Runner
            is paid {money(storeConfig.fees.largeOrderRunnerPaymentPence)}). The smallest restaurant
            order is {money(storeConfig.restaurants.minimumOrderPence)}. Every price we show already
            includes its item charge.
          </p>
        ) : (
          <p className="m-0 card-muted">
            {deliveryWords(pricing.plan)} There is no charge for a small order, no charge for being
            busy, and no smallest order. Every price we show already includes its item charge.
          </p>
        )}
        {allowanceWords && <p className="m-0 font-bold">{allowanceWords}</p>}
        <p className="m-0 card-muted">
          You pay what the till says for the shopping, so the total may change a little.
        </p>
      </section>

      {overOneRunner && <OverOneRunner parts={parts} />}

      {restaurantProblem ? (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {restaurantProblem}
        </p>
      ) : overMaximum ? (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          This comes to about {money(pricing.goodsPence)} of shopping at the shop&rsquo;s prices,
          and one basket holds up to {money(storeConfig.fees.maximumBasketGoodsPence)}, brought by
          several Runners. Please take some things out.
        </p>
      ) : overOneRunner ? (
        <div className="space-y-3">
          <p className="m-0">
            To stay with one Runner, take something out or swap it above. Or keep everything:
          </p>
          <Link
            to="/confirm"
            className="control w-full !rounded-full !py-4 bg-highlight text-on-accent text-lead font-bold"
          >
            Keep everything and check my order
          </Link>
        </div>
      ) : (
        <Link
          to="/confirm"
          className="control w-full !rounded-full !py-4 bg-highlight text-on-accent text-lead font-bold"
        >
          Check and send my order
        </Link>
      )}
    </div>
  );
}

/** Decoration: the word "Remove" is beside it. */
function TrashIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}
