import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { addNamedItems, GIFTS, listInWords, type Gift } from '../lib/extras';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';

/**
 * Little Gifts (Anthony, 6 October 2026): ready-made, affordable gift bundles from the shop, a
 * card, flowers, chocolates, a small toy, brought with the shopping. One press, or one sentence
 * to Ozi, puts the whole bundle in the basket, where the prices are shown before anything is
 * sent. Never alcohol (Section K).
 */
export function Gifts(): JSX.Element {
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const [news, setNews] = useState('');

  async function add(gift: Gift): Promise<void> {
    const { added, missing } = await addNamedItems(
      gift.items.map((item) => ({ item, quantity: 1 })),
      basket,
    );
    const words =
      `I've put the ${gift.name} gift in your basket: ${listInWords(added)}.` +
      (missing.length > 0 ? ` I couldn't find ${listInWords(missing)}.` : '') +
      ' Shall we look at your basket?';
    setNews(words);
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Little Gifts</h1>
      <p className="m-0 max-w-xl">
        A thoughtful gift, brought with your shopping by your Runner. Choose one, and it goes in
        your basket with its prices, for one {storeConfig.productName} delivery.
      </p>
      <p role="status" className="m-0 min-h-control max-w-xl">
        {news}
      </p>
      <ul className="list-none m-0 p-0 space-y-6 max-w-xl">
        {GIFTS.map((gift) => (
          <li key={gift.id}>
            <article
              aria-labelledby={`gift-${gift.id}`}
              className="space-y-3 border-2 border-paper rounded-xl p-4"
            >
              <h2 id={`gift-${gift.id}`} className="text-lead font-bold m-0">
                {gift.name}
              </h2>
              <p className="m-0">For: {gift.forWho}.</p>
              <p className="m-0">In it: {listInWords(gift.items)}.</p>
              <button
                type="button"
                onClick={() => void add(gift)}
                className="control w-full bg-highlight text-ink"
              >
                Add this gift to my basket
              </button>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
