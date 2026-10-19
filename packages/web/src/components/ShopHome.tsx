import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { fetchShops, type CatalogueItem, type PublicShop } from '../lib/api';
import { money, sellable, shownPrice } from '../lib/money';
import { shopLook } from '../lib/shop-look';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * The top of the shop (19 October 2026, Anthony: "not too plain"): the shape the big delivery
 * apps have taught people (a greeting with where it is going, category chips, shops near you,
 * popular things, offers), with the one thing they do not have first: talking. Later the same
 * day, nearer still to their look: section headings with a round "See all" arrow, big shop
 * cards with a coloured banner, two rows of round shop badges, and a panel for the season.
 * White cards with navy words sit on the dark page (15 to 1). Every chip and
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

export const CATEGORY_EMOJI: Record<string, string> = {
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
    <div className="space-y-9">
      <p className="m-0 text-display font-bold leading-tight">
        {greeting(new Date())}
        {firstName ? `, ${firstName}` : ''}.
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
          className="control !rounded-full bg-ink text-paper border-4 border-ink font-bold text-lead"
        >
          <span aria-hidden="true">🎙️</span> Talk to {assistant}
        </button>
      </section>

      {search}

      <nav aria-labelledby="chips-heading" className="relative">
        <h2 id="chips-heading" className="visually-hidden">
          Browse by kind
        </h2>
        <ul className="relative list-none m-0 p-0 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {CHIPS.map((chip) => (
            <li key={chip.words} className="snap-start shrink-0">
              <Link
                to={chip.to}
                className="flex flex-col items-center justify-start gap-1 w-24 min-h-control rounded-2xl text-paper no-underline text-center font-bold p-1"
              >
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center w-16 h-16 rounded-full text-[2rem] leading-none bg-paper/10"
                >
                  {chip.emoji}
                </span>
                <span className="leading-tight">{chip.words}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="stock-heading" className="space-y-3">
        <SectionHeading id="stock-heading" to="/shops" hidden="local shops">
          Stock up at local shops
        </SectionHeading>
        {shops === null ? (
          <p className="m-0">Finding the shops near you.</p>
        ) : shops.length === 0 ? (
          <p className="m-0">Local shops are joining now. Ask {assistant} for anything.</p>
        ) : (
          <ul className="relative list-none m-0 p-0 flex gap-4 overflow-x-auto pb-3 -mx-1 px-1 snap-x">
            {shops.slice(0, 10).map((shop) => (
              <li key={shop.id} className="snap-start shrink-0 w-[17rem] max-w-[80vw]">
                <StoreCard shop={shop} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <SeasonPanel now={new Date()} />

      {shops !== null && shops.length > 0 && (
        <section aria-labelledby="near-heading" className="space-y-3">
          <SectionHeading id="near-heading" to="/shops" hidden="shops near you">
            Shops near you
          </SectionHeading>
          <ul className="relative list-none m-0 p-0 grid grid-rows-2 grid-flow-col auto-cols-[6.5rem] gap-x-3 gap-y-4 overflow-x-auto pb-2 snap-x">
            {shops.slice(0, 12).map((shop) => (
              <li key={shop.id} className="snap-start">
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
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picks.length > 0 && (
        <section aria-labelledby="popular-heading" className="space-y-3">
          <SectionHeading id="popular-heading" to="/shop?q=essentials" hidden="everyday essentials">
            Popular right now
          </SectionHeading>
          <p className="m-0 text-paper/90 extra">
            Till prices, no mark-up. Prices include the item charge.
          </p>
          <ul className="relative list-none m-0 p-0 flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x">
            {picks.map((item) => (
              <li
                key={item.id}
                className="card-surface relative snap-start shrink-0 w-44 rounded-3xl p-3 flex flex-col gap-2"
              >
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center h-24 rounded-2xl text-[2.8rem]"
                  style={{ background: tint(item.category) }}
                >
                  {CATEGORY_EMOJI[item.category] ?? '🛍️'}
                </span>
                <span className="font-bold leading-tight">{item.name}</span>
                <span className="card-muted">
                  about {money(shownPrice(item.estimatedPricePence))}
                </span>
                <button
                  type="button"
                  onClick={() => onAdd(item)}
                  className="control !rounded-full bg-highlight text-on-accent mt-auto border-2 border-[#0B1F3A]"
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
                className="flex items-center gap-4 h-full min-h-control rounded-3xl p-4 no-underline"
                style={{
                  background: card.style,
                  color: '#0B1F3A',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center shrink-0 w-14 h-14 rounded-full bg-white/60 text-[1.8rem] leading-none"
                >
                  {card.emoji}
                </span>
                <span>
                  <span className="block text-lead font-bold leading-tight">{card.title}</span>
                  <span className="block">{card.words}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A soft colour behind each kind of thing, light enough for navy words on it. */
const TINTS: Record<string, string> = {
  'Fruit and vegetables': '#DFF5E6',
  Dairy: '#E3EEFB',
  Bakery: '#FBEBD5',
  Cupboard: '#F6E3D9',
  Household: '#ECE6FA',
  'Everyday essentials': '#FFF4CC',
  'Meat and fish': '#FBE0E0',
  Frozen: '#DDF3F8',
};
export function tint(category: string): string {
  return TINTS[category] ?? '#EEF1F5';
}

/**
 * A section's heading with "See all" and a round arrow beside it, as the big apps have it. The
 * arrow is decoration; the words say what it does, and a screen reader hears what it is all of.
 */
function SectionHeading({
  id,
  to,
  hidden,
  children,
}: {
  id: string;
  to: string;
  hidden: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="relative flex items-center justify-between gap-3">
      <h2 id={id} className="text-lead font-bold m-0 leading-tight">
        {children}
      </h2>
      <Link
        to={to}
        className="control relative shrink-0 !rounded-full !px-3 !py-1 bg-paper/10 text-paper font-bold"
      >
        See all<span className="visually-hidden"> {hidden}</span>
        <span
          aria-hidden="true"
          className="flex items-center justify-center w-8 h-8 rounded-full bg-paper text-ink"
        >
          →
        </span>
      </Link>
    </div>
  );
}

/** A big card for a shop: a coloured banner with its picture, then its name and its promise. */
function StoreCard({ shop }: { shop: PublicShop }): JSX.Element {
  const look = shopLook(shop.kind);
  const award = (shop.awards ?? [])[0];
  return (
    <Link
      to={`/shops/${shop.id}`}
      className="card-surface block min-h-control rounded-3xl overflow-hidden no-underline"
    >
      <span
        className="relative flex items-center justify-center h-32"
        style={{ background: look.gradient }}
      >
        <span aria-hidden="true" className="text-[3.6rem] leading-none">
          {look.emoji}
        </span>
        {award && (
          <span className="absolute top-2 left-2 max-w-[90%] rounded-full bg-white text-[#0B1F3A] font-bold px-3 py-0.5 leading-snug shadow">
            <span aria-hidden="true">🏆 </span>
            {award}
          </span>
        )}
      </span>
      <span className="block p-3 space-y-1">
        <span className="block text-lead font-bold leading-tight">{shop.name}</span>
        <span className="block card-muted leading-snug">
          {shop.kindWords}
          {shop.area ? ` · ${shop.area}` : ''}
        </span>
        <span
          className="inline-block rounded-full px-3 py-0.5 font-bold leading-snug"
          style={{ background: shop.kind === 'service' ? '#D6E9FB' : '#CFF5DE' }}
        >
          {shop.kind === 'service' ? 'Ask for a quote' : 'Till prices, no mark-up'}
        </span>
      </span>
    </Link>
  );
}

/**
 * The seasonal panel, by the date: Halloween through October, Christmas through December, and
 * the weekly shop the rest of the year.
 */
export function seasonFor(now: Date): 'halloween' | 'christmas' | 'weekly' {
  const month = now.getMonth();
  return month === 9 ? 'halloween' : month === 11 ? 'christmas' : 'weekly';
}

function SeasonPanel({ now }: { now: Date }): JSX.Element {
  const assistant = storeConfig.assistantName;
  const season = seasonFor(now);
  const panel =
    season === 'halloween'
      ? {
          emoji: '🎃',
          title: 'Halloween treats',
          words: `Sweets for the door, pumpkins and party bits. Tell ${assistant} what you need.`,
          link: 'See the offers',
          to: '/offers',
          background: 'linear-gradient(135deg, #FFB25B 0%, #FFE2B8 100%)',
        }
      : season === 'christmas'
        ? {
            emoji: '🎄',
            title: 'Christmas, sorted',
            words: `The big shop, little gifts and everything for the table. ${assistant} keeps the list.`,
            link: 'See the little gifts',
            to: '/gifts',
            background: 'linear-gradient(135deg, #F9C6CB 0%, #CDEBD3 100%)',
          }
        : {
            emoji: '📅',
            title: 'Your weekly shop',
            words: `The same shopping every week, and ${assistant} asks before each one.`,
            link: 'Set up a weekly shop',
            to: '/weekly-shop',
            background: 'linear-gradient(135deg, #9FE3BE 0%, #E1F7EA 100%)',
          };
  return (
    <section
      aria-labelledby="season-heading"
      className="rounded-3xl p-5 flex items-center gap-4"
      style={{ background: panel.background, color: '#0B1F3A', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex-1 min-w-0 space-y-3">
        <h2 id="season-heading" className="text-lead font-bold m-0 leading-tight">
          {panel.title}
        </h2>
        <p className="m-0">{panel.words}</p>
        <Link
          to={panel.to}
          className="control !rounded-full !px-4 bg-[#0B1F3A] text-white font-bold"
        >
          {panel.link}
        </Link>
      </div>
      <span aria-hidden="true" className="shrink-0 text-[4rem] leading-none">
        {panel.emoji}
      </span>
    </section>
  );
}
