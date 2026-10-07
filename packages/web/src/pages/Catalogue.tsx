import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  ApiUnavailableError,
  fetchAdvert,
  fetchCatalogueItem,
  searchCatalogue,
  type Advert,
  type CatalogueItem,
} from '../lib/api';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: CatalogueItem[]; attribution: string }
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

/**
 * Browsing the shopping.
 *
 * The list is a real list. Each row says what the item is, what it is likely to cost, and
 * has one large button that adds it. When something is added, a live region says so, so a
 * screen reader user hears the confirmation without having to go looking for it.
 */
export function Catalogue(): JSX.Element {
  // A link can open the shop already searched: /shop?q=essentials.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [lastAdded, setLastAdded] = useState('');
  const basket = useBasket();
  const ozi = useOzi();
  const { shopper } = useSession();
  const signedIn = Boolean(shopper);
  const [advert, setAdvert] = useState<Advert | null>(null);
  const voice = useRef(ozi);
  voice.current = ozi;

  // Spotlight (ruling 42): after the genuine results, at most one advert, clearly called one,
  // and only for something the Shopper is looking for.
  useEffect(() => {
    setAdvert(null);
    if (!signedIn || query.trim().length < 2) return;
    let cancelled = false;
    fetchAdvert(query)
      .then((result) => {
        if (cancelled || !result.advert) return;
        setAdvert(result.advert);
        void voice.current.say(result.advert.words);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query, signedIn]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    searchCatalogue(query)
      .then((result) => {
        if (cancelled) return;
        setState({ kind: 'ready', items: result.items, attribution: result.attribution });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiUnavailableError) {
          setState({ kind: 'unavailable' });
          return;
        }
        setState({ kind: 'failed', message: (error as Error).message });
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Your shopping</h1>

      <form
        role="search"
        className="space-y-2 max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setQuery(String(data.get('q') ?? ''));
        }}
      >
        <label htmlFor="catalogue-search" className="block text-lead font-bold">
          What are you looking for?
        </label>
        <p id="catalogue-search-hint" className="m-0 text-paper/90 extra">
          Try milk, or bread, or leave it empty to see everything.
        </p>
        <div className="flex flex-wrap gap-3">
          <input
            id="catalogue-search"
            name="q"
            type="search"
            defaultValue={query}
            aria-describedby="catalogue-search-hint"
            className="flex-1 min-w-[12rem] min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          <button type="submit" className="control bg-highlight text-ink">
            Search
          </button>
        </div>
      </form>

      <p role="status" aria-live="polite" className="m-0 min-h-control">
        {lastAdded === '' ? '' : `${lastAdded} added to your basket.`}
      </p>

      {state.kind === 'loading' && <p className="m-0">Getting the shopping list…</p>}

      {state.kind === 'unavailable' && (
        <div role="alert" className="border-2 border-paper p-4 rounded-xl space-y-2">
          <h2 className="text-lead font-bold m-0">We cannot reach the shopping list</h2>
          <p className="m-0">
            The {storeConfig.productName} server is not answering. If you are running this on your
            own computer, start the server and this page will fill itself in.
          </p>
        </div>
      )}

      {state.kind === 'failed' && (
        <div role="alert" className="border-2 border-paper p-4 rounded-xl">
          <h2 className="text-lead font-bold m-0">Something went wrong</h2>
          <p className="m-0">{state.message}</p>
        </div>
      )}

      {state.kind === 'ready' && (
        <section aria-labelledby="results-heading" className="space-y-4">
          <h2 id="results-heading" className="text-lead font-bold">
            {state.items.length === 0
              ? 'Nothing matched that'
              : `${state.items.length} ${state.items.length === 1 ? 'thing' : 'things'} you can add`}
          </h2>
          <p className="m-0 text-paper/90 extra">{state.attribution}</p>

          <ul className="list-none m-0 p-0 space-y-4">
            {state.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 border-2 border-paper/40 rounded-xl p-4"
              >
                <div>
                  <p className="m-0 text-lead font-bold">{item.name}</p>
                  <p className="m-0 text-paper/90">
                    {item.category} · about {money(item.estimatedPricePence)}
                  </p>
                </div>
                <button
                  type="button"
                  className="control bg-highlight text-ink"
                  onClick={() => {
                    basket.add(item);
                    setLastAdded(item.name);
                  }}
                >
                  <span aria-hidden="true">+</span>
                  <span>Add {item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {advert && (
        <aside
          aria-labelledby="advert-heading"
          className="border-2 border-highlight rounded-xl p-4 space-y-2"
        >
          <h2 id="advert-heading" className="text-lead font-bold m-0">
            Advert
          </h2>
          <p className="m-0">{advert.words.replace(/^Advert: /, '')}</p>
          <p className="m-0 text-paper/90">
            {advert.shopName} pays for this mention. It does not change what{' '}
            {storeConfig.assistantName} recommends.
          </p>
          {advert.catalogueItemId && (
            <button
              type="button"
              className="control bg-highlight text-ink"
              onClick={() =>
                void fetchCatalogueItem(advert.catalogueItemId ?? '').then(({ item }) => {
                  if (!item) return;
                  basket.add(item);
                  setLastAdded(item.name);
                })
              }
            >
              Add {advert.productName} from {advert.shopName}
            </button>
          )}
        </aside>
      )}
    </div>
  );
}
