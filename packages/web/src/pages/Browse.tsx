import { useEffect, useRef, useState, type FormEvent } from 'react';
import { preferredRankingWords } from '@aldilivery/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { BrowseNav } from '../components/BrowseNav';
import { storeConfig } from '../config';
import { fetchShops, type BrowseSection, type PublicShop } from '../lib/api';
import { BROWSE, browseNoun, browseQuery, emptyWords, listEntry, postcodeIn } from '../lib/browse';
import {
  NOT_A_PARTNER_WORDS,
  PREFERRED_PARTNER_WORDS,
  TYPICAL_HOURS_WORDS,
} from '../lib/partnership';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/** The place a Shopper named after "open", among those listed, or null. */
export function placeNamed(said: string, places: readonly PublicShop[]): PublicShop | null {
  const plain = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const match =
    /^(?:please )?(?:open|show me|go to|take me to)\s+(?:the )?(.+?)(?:'s)?(?: page)?$/.exec(
      plain(said).replace(/^(hey )?(ozi|ozzy|ozzie) /, ''),
    );
  const wanted = match?.[1]?.trim() ?? '';
  if (wanted === '') return null;
  return (
    places.find((place) => plain(place.name) === wanted) ??
    places.find((place) => plain(place.name).startsWith(wanted)) ??
    null
  );
}

/** What it is chosen under: "African, Caribbean", a convenience store, "Plumber". */
function tagsOf(place: PublicShop): string[] {
  return [
    ...(place.cuisines ?? []),
    ...(place.specialities ?? []),
    ...(place.categories ?? []),
    ...(place.convenience ? ['Convenience store'] : []),
  ];
}

/**
 * One of the four pages for browsing places (ruling 82): Restaurants, Shops, Convenience stores
 * or Services, each at its own address so it can go on a flyer, with the four as tabs at the
 * top. "Country and continental" at the top right (on Services, "Kinds of service") is a
 * disclosure button: it opens the list from config, and choosing one lists only those places.
 * A search looks through names, descriptions, cuisines, specialities and categories, and with
 * the Shopper's postcode (their delivery address, or one typed) the places in the same district
 * come first under "Near you", then the rest under "Further away". Each place is a disclosure
 * too, opening to its details and a link to its page. Ozi opens one by name: "open Mama Joy".
 */
export function BrowsePage({ section }: { section: BrowseSection }): JSX.Element {
  const info = BROWSE[section];
  const navigate = useNavigate();
  const ozi = useOzi();
  const { shopper } = useSession();
  const [params, setParams] = useSearchParams();
  const filter = info.filter
    ? listEntry(info.filter.list, params.get(info.filter.param) ?? '')
    : '';
  const search = params.get('q') ?? '';
  const near = params.get('near') ?? postcodeIn(shopper?.deliveryAddress ?? '');
  const [places, setPlaces] = useState<PublicShop[] | null>(null);
  /** Said next to the list when Preferred Partners are shown first (CMA, 30 October 2026). */
  const [ranking, setRanking] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const chooser = useRef<HTMLButtonElement>(null);
  const latest = useRef({ ozi, navigate, places });
  latest.current = { ozi, navigate, places };

  useEffect(() => {
    let cancelled = false;
    setPlaces(null);
    fetchShops(browseQuery(section, filter, { q: search, near }))
      .then((result) => {
        if (cancelled) return;
        setPlaces(result.shops);
        setRanking(result.ranking ?? null);
      })
      .catch(() => {
        if (!cancelled) setPlaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [section, filter, search, near]);

  // "Open Mama Joy": the place's own page, from those on the screen.
  useEffect(() => {
    const handle = (text: string): boolean => {
      const place = placeNamed(text, latest.current.places ?? []);
      if (!place) return false;
      latest.current.navigate(`/shops/${place.id}`);
      void latest.current.ozi.say(`Here is ${place.name}.`);
      return true;
    };
    latest.current.ozi.setPageCommands(handle);
    return () => latest.current.ozi.setPageCommands(null);
  }, []);

  const change = (updates: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value.trim() === '') next.delete(key);
      else next.set(key, value.trim());
    }
    setParams(next);
  };

  const choose = (entry: string): void => {
    if (!info.filter) return;
    change({ [info.filter.param]: entry });
    setChoosing(false);
    chooser.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    change({
      q: String(data.get('browse-search') ?? ''),
      near: String(data.get('browse-near') ?? ''),
    });
  };

  const toggle = (id: string): void =>
    setOpen((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]));

  const words = browseNoun(section, filter);
  // The ranking is commercial, and said so next to the list (CMA): always on Restaurants, and on
  // any other list a Preferred Partner is in.
  const disclosure =
    ranking ??
    (section === 'restaurants' ? preferredRankingWords(storeConfig.assistantName) : null);
  const nearby = places?.filter((place) => place.nearYou === true) ?? [];
  const further = places?.filter((place) => place.nearYou !== true) ?? [];
  const assistant = storeConfig.assistantName;

  const list = (rows: PublicShop[]): JSX.Element => (
    <ul className="list-none m-0 p-0 space-y-3">
      {rows.map((place) => {
        const expanded = open.includes(place.id);
        const panel = `place-${place.id}`;
        const tags = tagsOf(place);
        return (
          <li key={place.id} className="border-2 border-paper rounded-2xl">
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panel}
                onClick={() => toggle(place.id)}
                className="control w-full justify-start text-left gap-3 bg-transparent text-paper p-4"
              >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <span className="flex flex-col">
                  <span className="text-lead font-bold">{place.name}</span>
                  {place.preferredPartner && (
                    <span className="font-bold">
                      <span aria-hidden="true">★ </span>
                      {PREFERRED_PARTNER_WORDS}
                    </span>
                  )}
                  <span className="font-normal">
                    {place.kindWords}
                    {place.area ? `, ${place.area}` : ''}
                    {tags.length > 0 ? `. ${tags.join(', ')}` : ''}
                  </span>
                </span>
              </button>
            </h3>
            {/* Said on the card itself, open or closed (30 October 2026). */}
            {place.listedByOzi && <p className="m-0 px-4 pb-4">{NOT_A_PARTNER_WORDS}</p>}
            <div id={panel} hidden={!expanded} className="px-4 pb-4 space-y-2">
              {place.about && <p className="m-0">{place.about}</p>}
              {place.hours && (
                <p className="m-0">
                  {place.listedByOzi ? `${TYPICAL_HOURS_WORDS}: ` : 'Open: '}
                  {place.hours}
                </p>
              )}
              {place.ofstedNumber ? (
                <p className="m-0">
                  Ofsted registration number, as the provider gave it: {place.ofstedNumber}.{' '}
                  {storeConfig.productName} has not checked it.
                </p>
              ) : null}
              {section === 'services' && (
                <p className="m-0">
                  {storeConfig.productName} does not vet service providers beyond what this listing
                  says.
                </p>
              )}
              {place.listedByOzi && <p className="m-0">Listed by {assistant}.</p>}
              <Link
                to={`/shops/${place.id}`}
                className="control border-paper bg-paper/10 text-paper"
              >
                Open {place.name}’s page
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <BrowseNav variant="tabs" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-display font-bold m-0">{info.heading}</h1>
        {info.filter && (
          <button
            ref={chooser}
            type="button"
            aria-expanded={choosing}
            aria-controls="browse-filter-list"
            onClick={() => setChoosing((now) => !now)}
            className="control bg-highlight text-on-accent font-bold ms-auto"
          >
            <span aria-hidden="true">🌍</span> {info.filter.button}
          </button>
        )}
      </div>
      {info.filter && (
        <section
          id="browse-filter-list"
          hidden={!choosing}
          aria-labelledby="browse-filter-heading"
          className="border-2 border-highlight rounded-2xl p-4 space-y-3"
        >
          <h2 id="browse-filter-heading" className="text-lead font-bold m-0">
            {info.filter.heading}
          </h2>
          <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
            <li>
              <button
                type="button"
                aria-pressed={filter === ''}
                onClick={() => choose('')}
                className="control border-paper bg-paper/10 text-paper aria-pressed:bg-paper aria-pressed:text-ink"
              >
                All {info.noun}
              </button>
            </li>
            {info.filter.list.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  aria-pressed={filter === entry}
                  onClick={() => choose(entry)}
                  className="control border-paper bg-paper/10 text-paper aria-pressed:bg-paper aria-pressed:text-ink"
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="m-0">{info.about}</p>
      {section === 'services' && (
        <p className="m-0 border-2 border-highlight rounded-2xl p-4">
          {storeConfig.productName} does not vet service providers beyond what each listing says.
          Nannies, childminders and cooks work in people’s homes, so please check anyone yourself
          before they start. A childminder must be registered with Ofsted: where a provider gives
          its Ofsted registration number, we show it as they gave it. We do not check it.
        </p>
      )}

      <form
        role="search"
        aria-label={`Find ${info.noun}`}
        onSubmit={submit}
        className="space-y-3"
        key={`${search}|${near}`}
      >
        <div className="space-y-2">
          <label htmlFor="browse-search" className="block text-lead font-bold">
            Search {info.noun}
          </label>
          <input
            id="browse-search"
            name="browse-search"
            type="search"
            defaultValue={search}
            className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="browse-near" className="block font-bold">
            Your postcode, to see what is near you first
          </label>
          <input
            id="browse-near"
            name="browse-near"
            defaultValue={near}
            autoComplete="postal-code"
            className="w-full max-w-xs min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
          />
        </div>
        <button type="submit" className="control bg-highlight text-on-accent">
          <span aria-hidden="true">🔎</span> Search
        </button>
      </form>

      <p role="status" className="m-0 font-bold">
        {places === null
          ? `Finding ${words}.`
          : places.length === 0
            ? ''
            : `${places.length} ${places.length === 1 ? words.replace(/s$/, '') : words}${search ? ` matching “${search}”` : ''}.`}
      </p>

      {places !== null && places.length > 0 && disclosure && (
        <p className="m-0 border-2 border-highlight rounded-2xl p-4">{disclosure}</p>
      )}

      {places !== null && places.length === 0 && (
        <p className="m-0 border-2 border-paper rounded-2xl p-4">
          {emptyWords(section, filter, search)}
        </p>
      )}

      {places !== null && places.length > 0 && near !== '' && (
        <>
          <section aria-labelledby="near-you-heading" className="space-y-3">
            <h2 id="near-you-heading" className="text-lead font-bold m-0">
              Near you
            </h2>
            {nearby.length > 0 ? (
              list(nearby)
            ) : (
              <p className="m-0">None in your postcode district yet.</p>
            )}
          </section>
          {further.length > 0 && (
            <section aria-labelledby="further-heading" className="space-y-3">
              <h2 id="further-heading" className="text-lead font-bold m-0">
                Further away
              </h2>
              {list(further)}
            </section>
          )}
        </>
      )}

      {places !== null && places.length > 0 && near === '' && (
        <section aria-labelledby="all-places-heading" className="space-y-3">
          <h2 id="all-places-heading" className="text-lead font-bold m-0">
            All {words}
          </h2>
          <p className="m-0">Give your postcode above to see what is near you first.</p>
          {list(places)}
        </section>
      )}

      <Link to="/business/join" className="control border-paper bg-paper/10 text-paper">
        Own one? Join {storeConfig.productName}
      </Link>
    </div>
  );
}
