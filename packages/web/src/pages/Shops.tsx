import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  fetchCatalogueItem,
  fetchShop,
  fetchShops,
  rememberJoinedVia,
  sendServiceEnquiry,
  shopPhotoUrl,
  type PublicShop,
  type PublicShopPage,
  type PublicShopProduct,
} from '../lib/api';
import { money, shownPrice, tooDearWords } from '../lib/money';
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
 * Local shops, cafés, takeaways and services with their own page (7 October 2026; ruling 65),
 * each with its kind and area, so somebody can see at a glance what is near them.
 */
export function Shops(): JSX.Element {
  const [shops, setShops] = useState<PublicShop[] | null>(null);
  useEffect(() => {
    fetchShops()
      .then((result) => setShops(result.shops))
      .catch(() => setShops([]));
  }, []);
  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">Local shops</h1>
      <p className="m-0">
        Shops, cafés, takeaways and services on {storeConfig.productName}, with the area each is in.
        From a shop, a Runner buys it there and brings it to you. From a service, you ask for a
        quote or a call back.
      </p>
      {shops === null ? (
        <p className="m-0">Finding the shops.</p>
      ) : shops.length === 0 ? (
        <p className="m-0">No local shops have their own page yet.</p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-3">
          {shops.map((shop) => (
            <li key={shop.id}>
              <Link
                to={`/shops/${shop.id}`}
                className="block border-2 border-paper rounded-2xl p-4 text-paper no-underline"
              >
                <span className="block text-lead font-bold underline">{shop.name}</span>
                <span className="block">
                  {shop.kindWords}
                  {shop.area ? `, ${shop.area}` : ''}. {shop.about}{' '}
                  {shop.kind === 'service'
                    ? `${shop.products} service${shop.products === 1 ? '' : 's'}.`
                    : shop.products > 0
                      ? `${shop.products} product${shop.products === 1 ? '' : 's'}.`
                      : shop.listedByOzi
                        ? `Listed by ${storeConfig.assistantName}.`
                        : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/business/join" className="control border-paper bg-paper/10 text-paper">
        Own a shop? Join free
      </Link>
    </div>
  );
}

/** One Shop Partner's page: its products, with photos, each one press from the basket. */
export function ShopPage(): JSX.Element {
  const { id = '' } = useParams();
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
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
  const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">{page.shop.name}</h1>
      <p className="m-0">
        {page.shop.kindWords}
        {page.shop.area ? `, ${page.shop.area}` : ''}.{page.shop.about ? ` ${page.shop.about}` : ''}
      </p>
      {page.shop.address && <p className="m-0">{page.shop.address}</p>}
      {page.shop.hours && <p className="m-0">Open: {page.shop.hours}</p>}
      {page.shop.listedByOzi && (
        <p className="m-0 border-2 border-paper/40 rounded-2xl p-4">
          Listed by {storeConfig.assistantName} from public details.
          {page.shop.claimable && (
            <>
              {' '}
              Are you the owner?{' '}
              <Link
                to={`/business/join?claim=${encodeURIComponent(page.shop.id)}`}
                className="underline"
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
            className="control bg-highlight text-on-accent"
          >
            Ask for a quote
          </button>
          <button
            type="button"
            onClick={() => setAsking({ kind: 'call_back', product: null })}
            className="control border-paper bg-paper/10 text-paper"
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
              className="underline"
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
        <ul className="list-none m-0 p-0 space-y-4">
          {page.products.map((product) => (
            <li key={product.id}>
              <article
                aria-labelledby={`product-${product.id}`}
                className="border-2 border-paper rounded-2xl p-4 space-y-2"
              >
                {product.hasPhoto && (
                  <img
                    src={shopPhotoUrl(page.shop.id, product.id)}
                    alt={product.name}
                    className="w-full max-h-64 object-contain rounded-xl bg-paper"
                  />
                )}
                <h2 id={`product-${product.id}`} className="text-lead font-bold m-0">
                  {product.name}
                </h2>
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
                {service ? (
                  <button
                    type="button"
                    onClick={() => setAsking({ kind: 'quote', product })}
                    className="control w-full border-paper bg-paper/10 text-paper"
                  >
                    Ask for a quote<span className="visually-hidden">: {product.name}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(product)}
                    className="control w-full bg-highlight text-on-accent"
                  >
                    Add to my basket<span className="visually-hidden">: {product.name}</span>
                  </button>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
