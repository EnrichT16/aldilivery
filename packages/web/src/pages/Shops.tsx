import { useEffect, useRef, useState, type FormEvent } from 'react';
import { preferredRankingWords } from '@aldilivery/core';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { storeConfig } from '../config';
import { BrowsePage } from './Browse';
import {
  fetchCatalogueItem,
  fetchShop,
  rememberJoinedVia,
  sendServiceEnquiry,
  shopPhotoUrl,
  type PublicShopPage,
  type PublicShopProduct,
} from '../lib/api';
import { BROWSE } from '../lib/browse';
import { useDockHeights } from '../lib/dock';
import { money, shownPrice, tooDearWords } from '../lib/money';
import {
  awardWords,
  deliveryFromWords,
  NOT_A_PARTNER_WORDS,
  PREFERRED_PARTNER_WORDS,
  restaurantFeeShortWords,
  REVIEW_POINTS_WORDS,
  SHOP_PRICES_WORDS,
  showsShopPrices,
  TYPICAL_HOURS_WORDS,
} from '../lib/partnership';
import { productEmoji, shopLook } from '../lib/shop-look';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/** "a quote" or "a call back" heard in what a Shopper said on a service's page, or null. */
export function heardEnquiry(said: string): 'quote' | 'call_back' | null {
  const text = said.toLowerCase();
  if (/\b(quote|quotation|estimate|how much (would|will) it cost)\b/.test(text)) return 'quote';
  if (/\b(call ?back|ring me|call me|phone me)\b/.test(text)) return 'call_back';
  return null;
}

/** "30 minutes" or "1 hour 30 minutes". */
export function durationWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
    rest > 0 ? `${rest} minutes` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * The Shops page (ruling 82): the shops we have an agreement with, and those we list ourselves,
 * apart from convenience stores, with the four ways to browse as tabs at the top. Before ruling
 * 82 this page listed every shop, café, takeaway and service together; each now has its page.
 */
export function Shops(): JSX.Element {
  return <BrowsePage section="shops" />;
}

/**
 * One Shop Partner's page: its products, with photos, each one press from the basket.
 *
 * Laid out as the big delivery apps lay out a shop (19 October 2026): a coloured banner, a white
 * sheet with the name, what it is and its awards, a two-box row with delivery and opening hours,
 * the kinds of product as tabs held at the top, and each product as a row with its picture on
 * the right and "+ Add" on the picture. Once something is in the basket, a pill at the foot says
 * so, with the total, and opens the basket.
 *
 * A shop Ozi listed from public details says it is not a partner, and that its hours are typical
 * ones to check; a national chain's branch never invites a claim. The award badge says whose
 * award it is, and that reviewers earn points for any honest rating (Anthony, 30 October 2026).
 */
export function ShopPage(): JSX.Element {
  const { id = '' } = useParams();
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const bars = useDockHeights();
  const [page, setPage] = useState<PublicShopPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [news, setNews] = useState('');
  const [asking, setAsking] = useState<{
    kind: 'quote' | 'call_back';
    product: PublicShopProduct | null;
  } | null>(null);
  const [sent, setSent] = useState('');
  const latest = useRef({ ozi, page, navigate });
  latest.current = { ozi, page, navigate };

  const { shopper, restoring } = useSession();
  // Someone arriving by the shop's share link is counted for the shop if they open an account.
  useEffect(() => {
    if (!restoring && !shopper && id) rememberJoinedVia(`partner:${id}`);
  }, [id, shopper, restoring]);

  useEffect(() => {
    fetchShop(id)
      .then(setPage)
      .catch(() => setMissing(true));
  }, [id]);

  // On a service's page, "ask for a quote" or "book a call back" by voice opens the same form.
  useEffect(() => {
    if (!page || page.shop.kind !== 'service') return undefined;
    const handle = (text: string): boolean => {
      const kind = heardEnquiry(text);
      if (!kind) return false;
      setAsking({ kind, product: null });
      void latest.current.ozi.say(
        shopper
          ? `All right. Tell them what you need and how to reach you on the screen, then press Send. Nothing is paid through ${storeConfig.productName} for this.`
          : 'To ask a service for a quote or a call back, please sign in first.',
      );
      return true;
    };
    latest.current.ozi.setPageCommands(handle);
    return () => latest.current.ozi.setPageCommands(null);
  }, [page, shopper]);

  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!asking || !page) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await sendServiceEnquiry(page.shop.id, {
        kind: asking.kind,
        ...(asking.product ? { productId: asking.product.id } : {}),
        message: String(data.get('enquiry-message') ?? '').trim(),
        contact: String(data.get('enquiry-contact') ?? '').trim(),
      });
      setSent(result.message);
      setAsking(null);
      void ozi.say(result.message);
    } catch (failure) {
      setNews(failure instanceof Error ? failure.message : 'That could not be sent.');
    }
  }

  async function add(product: PublicShopProduct): Promise<void> {
    if (!product.catalogueItemId) return;
    const { item } = await fetchCatalogueItem(product.catalogueItemId);
    if (!item) {
      setNews('That is no longer available.');
      return;
    }
    if (!basket.add(item)) {
      setNews(tooDearWords(product.name));
      return;
    }
    const words = `I've put ${product.name} in your basket. Shall we look at your basket?`;
    setNews(words);
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  if (missing) {
    return (
      <div className="space-y-4">
        <h1 className="text-display font-bold m-0">Shop not found</h1>
        <Link to="/shops" className="control border-paper bg-paper/10 text-paper">
          See the local shops
        </Link>
      </div>
    );
  }
  if (!page) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }
  const service = page.shop.kind === 'service';
  // A restaurant, café or takeaway (30 October 2026): its orders have the restaurant fee.
  const food = page.shop.kind === 'food';
  const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
  const look = shopLook(page.shop.kind);
  const groups = productGroups(page.products, service ? 'Services' : 'Products');
  const inBasket = (product: PublicShopProduct): number =>
    basket.lines.find((line) => line.item.id === product.catalogueItemId)?.quantity ?? 0;
  const showBasketPill = !service && basket.itemCount > 0;
  return (
    <div className="space-y-6 max-w-xl">
      {/* The banner across the top, in the shop's colours, with its way back over it. */}
      <div
        className="relative flex items-center justify-center h-44 rounded-3xl overflow-hidden"
        style={{ background: look.gradient, boxShadow: 'var(--shadow-card)' }}
      >
        <span aria-hidden="true" className="text-[5rem] leading-none">
          {look.emoji}
        </span>
        <Link
          to={BROWSE[page.shop.section ?? 'shops'].path}
          className="control absolute top-3 left-3 !rounded-full !px-4 bg-white text-[#0B1F3A] font-bold shadow"
        >
          <span aria-hidden="true">←</span> All {BROWSE[page.shop.section ?? 'shops'].noun}
        </Link>
      </div>

      <div className="relative -mt-12 mx-2 card-surface rounded-3xl p-5 space-y-3">
        <h1 className="text-display font-bold m-0 leading-tight">{page.shop.name}</h1>
        <p className="m-0 card-muted">
          {page.shop.kindWords}
          {page.shop.area ? ` · ${page.shop.area}` : ''}
        </p>
        <ul className="flex flex-wrap gap-2 list-none m-0 p-0" aria-label="About this shop">
          {(page.shop.awards ?? []).map((award) => (
            <li
              key={award}
              className="rounded-full px-3 py-0.5 font-bold leading-snug"
              style={{ background: '#FFE9A8' }}
            >
              <span aria-hidden="true">🏆 </span>
              {awardWords(award)}
            </li>
          ))}
          {page.shop.preferredPartner && (
            <li
              className="rounded-full px-3 py-0.5 font-bold leading-snug"
              style={{ background: '#FFE9A8' }}
            >
              <span aria-hidden="true">★ </span>
              {PREFERRED_PARTNER_WORDS}
            </li>
          )}
          {showsShopPrices(page.shop.kind) && (
            <li
              className="rounded-full px-3 py-0.5 font-bold leading-snug"
              style={{ background: '#CFF5DE' }}
            >
              {SHOP_PRICES_WORDS}
            </li>
          )}
        </ul>
        {(page.shop.awards ?? []).length > 0 && (
          <p className="m-0 card-muted">{REVIEW_POINTS_WORDS}</p>
        )}
        {page.shop.preferredPartner && (
          <p className="m-0 card-muted">{preferredRankingWords(storeConfig.assistantName)}</p>
        )}
        {page.shop.about && <p className="m-0">{page.shop.about}</p>}
        {[
          ...(page.shop.cuisines ?? []),
          ...(page.shop.specialities ?? []),
          ...(page.shop.categories ?? []),
          ...(page.shop.convenience ? ['Convenience store'] : []),
        ].length > 0 && (
          <p className="m-0">
            {[
              ...(page.shop.cuisines ?? []),
              ...(page.shop.specialities ?? []),
              ...(page.shop.categories ?? []),
              ...(page.shop.convenience ? ['Convenience store'] : []),
            ].join(', ')}
          </p>
        )}
        {page.shop.address && <p className="m-0 card-muted">{page.shop.address}</p>}
        {service && (
          <p className="m-0">
            {page.shop.ofstedNumber
              ? `Ofsted registration number, as the provider gave it: ${page.shop.ofstedNumber}. We have not checked it. `
              : ''}
            {storeConfig.productName} does not vet service providers beyond what this listing says.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border-2 border-paper/40 p-3">
          <p className="m-0 text-lead font-bold leading-tight">
            {service
              ? 'Nothing to pay here'
              : food
                ? restaurantFeeShortWords()
                : deliveryFromWords()}
          </p>
          <p className="m-0 text-paper/90 leading-snug">
            {service
              ? `Not through ${storeConfig.productName}`
              : food
                ? `In place of delivery, on every plan. Smallest order ${money(storeConfig.restaurants.minimumOrderPence)}`
                : 'Depends on your plan and how much you buy'}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-paper/40 p-3">
          <p className="m-0 font-bold leading-snug">{page.shop.hours || 'Ask the shop'}</p>
          <p className="m-0 text-paper/90 leading-snug">
            {page.shop.listedByOzi ? TYPICAL_HOURS_WORDS : 'Opens'}
          </p>
        </div>
      </div>

      {page.shop.listedByOzi && (
        <p className="m-0 border-2 border-paper/40 rounded-2xl p-4">
          {NOT_A_PARTNER_WORDS} Listed by {storeConfig.assistantName} from public details.
          {page.shop.claimable && (
            <>
              {' '}
              Are you the owner?{' '}
              <Link
                to={`/business/join?claim=${encodeURIComponent(page.shop.id)}`}
                className="inline-flex items-center min-h-control underline text-paper font-bold"
              >
                Claim this shop
              </Link>
              .
            </>
          )}
        </p>
      )}
      <p role="status" className="m-0 min-h-control">
        {news || sent}
      </p>
      {service && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAsking({ kind: 'quote', product: null })}
            className="control !rounded-full bg-highlight text-on-accent"
          >
            Ask for a quote
          </button>
          <button
            type="button"
            onClick={() => setAsking({ kind: 'call_back', product: null })}
            className="control !rounded-full border-paper bg-paper/10 text-paper"
          >
            Book a call back
          </button>
        </div>
      )}
      {asking &&
        (shopper ? (
          <form
            onSubmit={(event) => void ask(event)}
            aria-labelledby="enquiry-heading"
            className="space-y-3 border-2 border-highlight rounded-2xl p-4"
          >
            <h2 id="enquiry-heading" className="text-lead font-bold m-0">
              {asking.kind === 'quote' ? 'Ask for a quote' : 'Book a call back'}
              {asking.product ? `: ${asking.product.name}` : ''}
            </h2>
            <p className="m-0">
              {page.shop.name} gets back to you itself. Nothing is paid through{' '}
              {storeConfig.productName} for this.
            </p>
            <label htmlFor="enquiry-message" className="block font-bold">
              What do you need?
            </label>
            <textarea id="enquiry-message" name="enquiry-message" rows={3} className={field} />
            <label htmlFor="enquiry-contact" className="block font-bold">
              How should they reach you? A phone number or an email.
            </label>
            <input id="enquiry-contact" name="enquiry-contact" className={field} />
            <button type="submit" className="control w-full bg-highlight text-on-accent">
              Send
            </button>
            <button
              type="button"
              onClick={() => setAsking(null)}
              className="control bg-paper/10 text-paper underline"
            >
              Never mind
            </button>
          </form>
        ) : (
          <p className="m-0">
            <Link
              to={`/sign-in?next=/shops/${encodeURIComponent(page.shop.id)}`}
              className="inline-flex items-center min-h-control underline text-paper"
            >
              Sign in
            </Link>{' '}
            to ask {page.shop.name} for {asking.kind === 'quote' ? 'a quote' : 'a call back'}.
          </p>
        ))}
      {page.products.length === 0 ? (
        <p className="m-0">
          {service
            ? 'No services listed yet.'
            : page.shop.listedByOzi
              ? `No products of its own yet: say what you want and ${storeConfig.assistantName} finds it in the catalogue.`
              : 'No products yet.'}
        </p>
      ) : (
        <>
          {/* The kinds of thing on the menu, held at the top while the list scrolls. */}
          <nav
            aria-label={service ? 'Kinds of service' : 'Kinds of product'}
            className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-ink border-b-2 border-paper/25"
          >
            <ul className="relative chip-row list-none m-0 p-0">
              {groups.map((group) => (
                <li key={group.id}>
                  <a
                    href={`#${group.id}`}
                    className="control !rounded-full !px-4 bg-paper/10 text-paper no-underline"
                  >
                    {group.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {groups.map((group) => (
            <section
              key={group.id}
              id={group.id}
              aria-labelledby={`${group.id}-heading`}
              className="space-y-1 scroll-mt-24"
            >
              <h2 id={`${group.id}-heading`} className="text-lead font-bold m-0">
                {group.name}
              </h2>
              <ul className="list-none m-0 p-0">
                {group.products.map((product) => {
                  const count = inBasket(product);
                  return (
                    <li key={product.id} className="border-b-2 border-paper/25 last:border-b-0">
                      <article
                        aria-labelledby={`product-${product.id}`}
                        className="flex items-start gap-3 py-4"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <h3 id={`product-${product.id}`} className="text-lead font-bold m-0">
                            {product.name}
                          </h3>
                          {service ? (
                            <p className="m-0">
                              From {money(product.pricePence)}
                              {product.durationMinutes
                                ? `, about ${durationWords(product.durationMinutes)}`
                                : ''}
                              .
                            </p>
                          ) : (
                            <p className="m-0">
                              About {money(shownPrice(product.pricePence))}.
                              {product.expiresOn
                                ? ` Best before ${new Date(product.expiresOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
                                : ''}
                            </p>
                          )}
                          {count > 0 && <p className="m-0 font-bold">{count} in your basket</p>}
                          {otherTags(product.tags, group.name) && (
                            <p className="m-0 text-paper/80">
                              {otherTags(product.tags, group.name)}
                            </p>
                          )}
                          {service && (
                            <button
                              type="button"
                              onClick={() => setAsking({ kind: 'quote', product })}
                              className="control !rounded-full border-paper bg-paper/10 text-paper"
                            >
                              Ask for a quote
                              <span className="visually-hidden">: {product.name}</span>
                            </button>
                          )}
                        </div>
                        <div
                          className="relative shrink-0 w-28 h-28 rounded-2xl overflow-hidden flex items-center justify-center"
                          style={{ background: look.gradient }}
                        >
                          {product.hasPhoto ? (
                            <img
                              src={shopPhotoUrl(page.shop.id, product.id)}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span aria-hidden="true" className="text-[3.2rem] leading-none">
                              {productEmoji(`${product.name} ${product.tags}`, page.shop.kind)}
                            </span>
                          )}
                          {count > 0 && (
                            <span
                              aria-hidden="true"
                              className="absolute top-1 left-1 flex items-center justify-center min-w-[2rem] h-8 px-1 rounded-full bg-[#0B1F3A] text-white font-bold"
                            >
                              {count}
                            </span>
                          )}
                          {!service && (
                            <button
                              type="button"
                              onClick={() => void add(product)}
                              className="control absolute bottom-1 right-1 !rounded-full !px-3 !py-1 bg-white text-[#0B1F3A] border-2 border-[#0B1F3A] font-bold shadow"
                            >
                              <span aria-hidden="true">+</span> Add
                              <span className="visually-hidden"> to my basket: {product.name}</span>
                            </button>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {showBasketPill && (
        <>
          {/* Room at the foot of the page, so the pill never sits over the last product. */}
          <div aria-hidden="true" className="h-20" />
          <div
            className="fixed inset-x-0 z-30 px-4 pointer-events-none text-[0.9rem]"
            style={{ bottom: bars.dock + bars.caption + 8 }}
          >
            <Link
              to="/basket"
              className="control pointer-events-auto relative mx-auto w-full max-w-xl justify-between !rounded-full bg-[#0B1F3A] text-white border-2 border-white font-bold shadow-lg !px-5"
            >
              <span>View basket</span>
              <span className="font-normal">about {money(basket.pricing.totalPence)}</span>
              <span className="flex items-center justify-center min-w-[2rem] h-8 px-1 rounded-full bg-white text-[#0B1F3A]">
                {basket.itemCount}
                <span className="visually-hidden">
                  {basket.itemCount === 1 ? ' thing' : ' things'}
                </span>
              </span>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A shop's products in the kinds it gave them: the first word of each product's tags, in the
 * order they first appear. With no tags, one kind, "Products".
 */
function productGroups(
  products: PublicShopProduct[],
  fallback: string,
): Array<{ id: string; name: string; products: PublicShopProduct[] }> {
  const groups = new Map<string, PublicShopProduct[]>();
  for (const product of products) {
    const name = firstTag(product.tags) || fallback;
    groups.set(name, [...(groups.get(name) ?? []), product]);
  }
  return [...groups.entries()].map(([name, list], at) => ({
    id: `kind-${at}`,
    name,
    products: list,
  }));
}

function tagList(tags: string): string[] {
  return tags
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function firstTag(tags: string): string {
  const first = tagList(tags)[0] ?? '';
  return first ? first[0]!.toUpperCase() + first.slice(1) : '';
}

/** The rest of a product's tags, as its grey second line. */
function otherTags(tags: string, groupName: string): string {
  return tagList(tags)
    .filter((tag) => tag.toLowerCase() !== groupName.toLowerCase())
    .join(', ');
}
