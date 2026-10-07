import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { addNamedItems, currentOffers } from '../lib/extras';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';

/**
 * Offers from local shops we work with (7 October 2026). Only offers agreed in writing with the
 * shop are listed (config/offers.json), so the list may be empty. Shops can ask to work with us.
 */
export function Offers(): JSX.Element {
  const offers = currentOffers();
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const [news, setNews] = useState('');

  async function add(item: string): Promise<void> {
    const { added } = await addNamedItems([{ item, quantity: 1 }], basket);
    const words =
      added.length > 0
        ? `I've put ${added[0]} in your basket. Shall we look at your basket?`
        : "I couldn't find that in the shop just now.";
    setNews(words);
    if (added.length === 0) {
      void ozi.say(words);
      return;
    }
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">Offers</h1>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {offers.length === 0 ? (
        <p className="m-0">
          There are no offers just now. When local shops have one, it will be here.
        </p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-4">
          {offers.map((offer) => (
            <li key={offer.id}>
              <article
                aria-labelledby={`offer-${offer.id}`}
                className="space-y-2 border-2 border-paper rounded-xl p-4"
              >
                <h2 id={`offer-${offer.id}`} className="text-lead font-bold m-0">
                  {offer.title}
                </h2>
                <p className="m-0">From {offer.shop}.</p>
                <p className="m-0">{offer.details}</p>
                <p className="m-0">
                  Until{' '}
                  {new Date(`${offer.until}T12:00:00`).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  .
                </p>
                {offer.item && (
                  <button
                    type="button"
                    onClick={() => void add(offer.item ?? '')}
                    className="control w-full bg-highlight text-ink"
                  >
                    Add it to my basket<span className="visually-hidden">: {offer.title}</span>
                  </button>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="shops" className="space-y-3">
        <h2 id="shops" className="text-lead font-bold m-0">
          Own a local shop?
        </h2>
        <p className="m-0">
          Work with {storeConfig.productName}: your shop&rsquo;s offers, in front of people who shop
          with us every week, and brought to their door by our Runners.
        </p>
        <Link to="/organisations?shop=1#enquiry" className="control bg-paper text-ink">
          Ask to work with us
        </Link>
      </section>
    </div>
  );
}
