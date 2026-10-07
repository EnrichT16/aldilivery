import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { moneyOut } from '../lib/alert';

import { PriceConfirm } from '../components/PriceConfirm';
import { storeConfig } from '../config';
import { askToFind, fetchCatalogueItem, fetchFindRequests, type FindRequest } from '../lib/api';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * Ozi Finds It (7 October 2026): something hard to find. A person looks in up to three shops
 * near you and says here what they found and the price; then it can go in the basket like
 * anything else. The small finder fee is agreed first, comes back if nothing is found, and is
 * included in Ozi Plus. Never alcohol, tobacco, medicines or cash.
 */
export function FindIt(): JSX.Element {
  const { shopper } = useSession();
  // Loaded once per person: changing their details here must not reload over the answer.
  const shopperId = shopper?.id;
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [what, setWhat] = useState(params.get('what') ?? '');
  const [requests, setRequests] = useState<FindRequest[] | null>(null);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const { findItPence, findItShops } = storeConfig.extras;
  const name = `${storeConfig.assistantName} Finds It`;
  const covered = Boolean(shopper?.plusUntil && new Date(shopper.plusUntil) > new Date());

  useEffect(() => {
    if (!shopperId) return;
    fetchFindRequests()
      .then((result) => setRequests(result.requests))
      .catch(() => setRequests([]));
  }, [shopperId]);

  async function send(): Promise<void> {
    if (what.trim().length < 3) {
      setProblem('Please say what you are looking for.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const result = await askToFind(what.trim());
      setRequests((before) => [result.request, ...(before ?? [])]);
      setNews(result.message);
      if (/was taken from your card/.test(result.message)) moneyOut();
      setWhat('');
      void ozi.say(result.message);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
      void ozi.say(message);
    } finally {
      setBusy(false);
    }
  }

  async function addFound(row: FindRequest): Promise<void> {
    if (!row.catalogueItemId) return;
    const { item } = await fetchCatalogueItem(row.catalogueItemId);
    if (!item) {
      setProblem('That is no longer available.');
      return;
    }
    basket.add(item);
    const words = `I've put ${row.foundName ?? item.name} in your basket. Shall we look at your basket?`;
    setNews(words);
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">{name}</h1>
      <p className="m-0">
        Can&rsquo;t find something? Tell us what it is. A person looks in up to {findItShops} shops
        near you, and tells you here what they found and the price. Then you can add it to your
        basket, and your Runner brings it with your shopping.
      </p>
      <p className="m-0">
        {covered
          ? `It's included in your ${storeConfig.assistantName} Plus.`
          : `It costs ${money(findItPence)}, and you get it back if it can't be found.`}{' '}
        We never look for alcohol, tobacco, medicines or cash.
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {!shopper ? (
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up an account first
        </Link>
      ) : (
        <section aria-labelledby="ask" className="space-y-3">
          <h2 id="ask" className="text-lead font-bold m-0">
            What are you looking for?
          </h2>
          <label htmlFor="find-what" className="block font-bold">
            Describe it
          </label>
          <p id="find-what-hint" className="m-0 text-paper/90">
            For example: Welsh cakes, a blue teapot, gluten free bread rolls.
          </p>
          <textarea
            id="find-what"
            aria-describedby="find-what-hint"
            value={what}
            onChange={(event) => setWhat(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          {covered ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send()}
              className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
            >
              Ask for it to be found
            </button>
          ) : (
            <PriceConfirm
              key={requests?.length ?? 0}
              start="Ask for it to be found"
              question={`${money(findItPence)} will be taken from your saved card now, and given back if it can't be found. Is that all right?`}
              yes={`Yes, find it for ${money(findItPence)}`}
              busy={busy}
              onAsk={(question) => void ozi.say(question)}
              onYes={() => void send()}
            />
          )}
        </section>
      )}
      {requests && requests.length > 0 && (
        <section aria-labelledby="mine" className="space-y-3">
          <h2 id="mine" className="text-lead font-bold m-0">
            What you asked for
          </h2>
          <ul className="list-none m-0 p-0 space-y-3">
            {requests.map((row) => (
              <li key={row.id} className="border-2 border-paper/40 rounded-xl p-4 space-y-2">
                <p className="m-0 font-bold">{row.description}</p>
                {row.status === 'looking' && <p className="m-0">Still looking.</p>}
                {row.status === 'not_found' && (
                  <p className="m-0">
                    Not found, sorry.
                    {row.feePence > 0 ? ` Your ${money(row.feePence)} is on its way back.` : ''}
                    {row.note ? ` ${row.note}` : ''}
                  </p>
                )}
                {row.status === 'found' && (
                  <>
                    <p className="m-0">
                      Found: {row.foundName}, at {row.foundShop}, about{' '}
                      {money(row.foundPricePence ?? 0)}.{row.note ? ` ${row.note}` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => void addFound(row)}
                      className="control w-full bg-highlight text-ink"
                    >
                      Add it to my basket<span className="visually-hidden">: {row.foundName}</span>
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
