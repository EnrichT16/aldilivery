import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { fetchShops, type CatalogueItem, type PublicShop } from '../lib/api';
import { money, sellable, shownPrice } from '../lib/money';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * The top of the shop (19 October 2026, Anthony: "not too plain"): the shape the big delivery
 * apps have taught people (a greeting with where it is going, category chips, shops near you,
 * popular things, offers), with the one thing they do not have first: talking. Every chip and
 * card has its words on it, every emoji is decoration only, and each row is a list with a
 * heading, so a screen reader hears "Shops near you, list, 6 items".
 */

const CHIPS: Array<{ emoji: string; words: string; to: string }> = [
  { emoji: '🛒', words: 'Everything', to: '/shop' },
  { emoji: '🍎', words: 'Fruit and veg', to: '/shop?q=fruit' },
  { emoji: '🥛', words: 'Dairy', to: '/shop?q=milk' },
  { emoji: '🍞', words: 'Bakery', to: '/shop?q=bread' },
  { emoji: '🥫', words: 'Cupboard', to: '/shop?q=tin' },
  { emoji: '🧻', words: 'Household', to: '/shop?q=household' },
  { emoji: '🏪', words: 'Local shops', to: '/shops' },
  { emoji: '☕', words: 'Cafés and takeaways', to: '/shops' },
  { emoji: '✂️', words: 'Services', to: '/shops' },
  { emoji: '🏷️', words: 'Offers', to: '/offers' },
  { emoji: '📅', words: 'Weekly shop', to: '/weekly-shop' },
  { emoji: '🍲', words: 'Recipes', to: '/recipes' },
];

/** A colour for a shop's round badge, the same every time for the same shop. */
const BADGES = [
  '#D4AF37',
  '#2FBF71',
  '#E76F51',
  '#4C9BE8',
  '#9B5DE5',
  '#F4A261',
  '#E63946',
  '#2A9D8F',
];
function badgeColour(name: string): string {
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return BADGES[hash % BADGES.length]!;
}
function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)
  ).toUpperCase();
}

const CATEGORY_EMOJI: Record<string, string> = {
  'Fruit and vegetables': '🍎',
  Dairy: '🥛',
  Bakery: '🍞',
  Cupboard: '🥫',
  Household: '🧻',
  'Everyday essentials': '🧺',
  'Meat and fish': '🍗',
  Frozen: '🧊',
  Health: '🩹',
  'Cards and gifts': '🎁',
};

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** What a weekly shop is made of comes first in "Popular right now". */
const POPULAR_ORDER = [
  'Dairy',
  'Bakery',
  'Fruit and vegetables',
  'Everyday essentials',
  'Cupboard',
  'Meat and fish',
  'Frozen',
  'Household',
];

export function ShopHome({
  popular,
  onAdd,
  search,
}: {
  popular: CatalogueItem[];
  onAdd: (item: CatalogueItem) => void;
  /** The search box, placed under the talk card as the big apps place theirs. */
  search?: ReactNode;
}): JSX.Element {
  const { shopper } = useSession();
  const ozi = useOzi();
  const [shops, setShops] = useState<PublicShop[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchShops()
      .then((result) => {
        if (!cancelled) setShops(result.shops);
      })
      .catch(() => {
        if (!cancelled) setShops([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = shopper?.displayName.trim().split(/\s+/)[0] ?? '';
  const street = shopper?.deliveryAddress.split(',')[0]?.trim() ?? '';
  const rank = (category: string): number => {
    const at = POPULAR_ORDER.indexOf(category);
    return at === -1 ? POPULAR_ORDER.length : at;
  };
  // One or two of each everyday kind, the weekly shop's order, never gifts or anything refused.
  const seen = new Map<string, number>();
  const picks = popular
    .filter(
      (item) => sellable(item.estimatedPricePence) && rank(item.category) < POPULAR_ORDER.length,
    )
    .sort((a, b) => rank(a.category) - rank(b.category))
    .filter((item) => {
      const count = seen.get(item.category) ?? 0;
      seen.set(item.category, count + 1);
      return count < 2;
    })
    .slice(0, 10);
  const assistant = storeConfig.assistantName;

  return (
    <div className="space-y-8">
      <p className="m-0 text-lead">
        <span className="font-bold">
          {greeting(new Date())}
          {firstName ? `, ${firstName}` : ''}.
        </span>{' '}
        {street ? (
          <span>
            Delivering to{' '}
            <Link
              to="/addresses"
              className="inline-flex items-center min-h-control text-paper font-bold"
            >
              {street}
            </Link>
            .
          </span>
        ) : null}
      </p>

      <section
        aria-labelledby="talk-heading"
        className="rounded-3xl p-5 sm:p-6 text-on-accent space-y-3"
        style={{
          background: 'linear-gradient(135deg, rgb(var(--highlight-rgb)) 0%, #F5D46B 100%)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2 id="talk-heading" className="text-display font-bold m-0">
          Just say it.
        </h2>
        <p className="m-0 text-lead">
          &ldquo;{assistant}, get me two pints of milk and a loaf of bread.&rdquo; {assistant} reads
          it back and waits for your yes.
        </p>
        <button
          type="button"
          onClick={() => ozi.tapToTalk()}
          className="control bg-ink text-paper border-4 border-ink font-bold text-lead"
        >
          <span aria-hidden="true">🎙️</span> Talk to {assistant}
        </button>
      </section>

      {search}

      <nav aria-labelledby="chips-heading">
        <h2 id="chips-heading" className="visually-hidden">
          Browse by kind
        </h2>
        <ul className="relative list-none m-0 p-0 flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {CHIPS.map((chip) => (
            <li key={chip.words} className="snap-start shrink-0">
              <Link
                to={chip.to}
                className="flex flex-col items-center justify-center gap-1 w-28 min-h-control h-28 rounded-2xl border-2 border-paper/40 bg-paper/10 text-paper no-underline text-center font-bold p-2"
              >
                <span aria-hidden="true" className="text-[2.2rem] leading-none">
                  {chip.emoji}
                </span>
                <span className="leading-tight">{chip.words}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="near-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="near-heading" className="text-lead font-bold m-0">
            Shops near you
          </h2>
          <Link to="/shops" className="inline-flex items-center min-h-control text-paper font-bold">
            See all<span className="visually-hidden"> local shops</span>
          </Link>
        </div>
        {shops === null ? (
          <p className="m-0">Finding the shops near you.</p>
        ) : shops.length === 0 ? (
          <p className="m-0">Local shops are joining now. Ask {assistant} for anything.</p>
        ) : (
          <ul className="relative list-none m-0 p-0 flex gap-4 overflow-x-auto pb-2 snap-x">
            {shops.slice(0, 12).map((shop) => (
              <li key={shop.id} className="snap-start shrink-0 w-24">
                <Link
                  to={`/shops/${shop.id}`}
                  className="flex flex-col items-center gap-1 min-h-control text-paper no-underline text-center"
                >
                  <span
                    aria-hidden="true"
                    className="flex items-center justify-center w-20 h-20 rounded-full text-[1.6rem] font-bold border-4 border-paper/80"
                    style={{ background: badgeColour(shop.name), color: '#0B1F3A' }}
                  >
                    {initials(shop.name)}
                  </span>
                  <span className="font-bold leading-tight">{shop.name}</span>
                  <span className="leading-tight text-paper/90">
                    {shop.kindWords}
                    {shop.area ? `, ${shop.area}` : ''}
                  </span>
                  {(shop.awards ?? []).length > 0 && (
                    <span className="font-bold leading-tight">
                      <span aria-hidden="true">🏆 </span>
                      {shop.awards![0]}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {picks.length > 0 && (
        <section aria-labelledby="popular-heading" className="space-y-3">
          <h2 id="popular-heading" className="text-lead font-bold m-0">
            Popular right now
          </h2>
          <p className="m-0 text-paper/90 extra">
            Till prices, no mark-up. Prices include the item charge.
          </p>
          <ul className="relative list-none m-0 p-0 flex gap-4 overflow-x-auto pb-2 snap-x">
            {picks.map((item) => (
              <li
                key={item.id}
                className="snap-start shrink-0 w-48 rounded-2xl border-2 border-paper/40 bg-paper/10 p-3 flex flex-col gap-2"
              >
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center h-20 rounded-xl text-[2.6rem] bg-paper/10"
                >
                  {CATEGORY_EMOJI[item.category] ?? '🛍️'}
                </span>
                <span className="font-bold leading-tight">{item.name}</span>
                <span>about {money(shownPrice(item.estimatedPricePence))}</span>
                <button
                  type="button"
                  onClick={() => onAdd(item)}
                  className="control bg-highlight text-on-accent mt-auto"
                >
                  <span aria-hidden="true">+</span> Quick add
                  <span className="visually-hidden">: {item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="extras-heading" className="space-y-3">
        <h2 id="extras-heading" className="text-lead font-bold m-0">
          More from {storeConfig.productName}
        </h2>
        <ul className="list-none m-0 p-0 grid gap-3 sm:grid-cols-3">
          {[
            {
              to: '/plus',
              emoji: '⭐',
              title: 'Membership',
              words: 'Lower delivery on every order. First month free.',
              style: 'linear-gradient(135deg, #2FBF71 0%, #7BE0A6 100%)',
            },
            {
              to: '/find-it',
              emoji: '🔎',
              title: `${assistant} Finds It`,
              words: 'Something hard to find? We look in three shops for you.',
              style: 'linear-gradient(135deg, #4C9BE8 0%, #9CC8F5 100%)',
            },
            {
              to: '/gift-cards',
              emoji: '🎁',
              title: 'Gift cards',
              words: 'Send shopping to someone you love.',
              style: 'linear-gradient(135deg, #F4A261 0%, #F8C99A 100%)',
            },
          ].map((card) => (
            <li key={card.to}>
              <Link
                to={card.to}
                className="block h-full min-h-control rounded-2xl p-4 no-underline"
                style={{
                  background: card.style,
                  color: '#0B1F3A',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <span aria-hidden="true" className="block text-[2rem] leading-none">
                  {card.emoji}
                </span>
                <span className="block text-lead font-bold">{card.title}</span>
                <span className="block">{card.words}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
