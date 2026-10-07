import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  fetchCatalogueItem,
  fetchShop,
  fetchShops,
  shopPhotoUrl,
  type PublicShop,
  type PublicShopProduct,
} from '../lib/api';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';

/** Shop Partners: local shops showing their own products and prices (7 October 2026). */
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
        Local shops that show their own products and prices on {storeConfig.productName}. A Runner
        buys it there and brings it to you.
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
                className="block border-2 border-paper rounded-xl p-4 text-paper no-underline"
              >
                <span className="block text-lead font-bold underline">{shop.name}</span>
                <span className="block">
                  {shop.about} {shop.products} product{shop.products === 1 ? '' : 's'}.
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One Shop Partner's page: its products, with photos, each one press from the basket. */
export function ShopPage(): JSX.Element {
  const { id = '' } = useParams();
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchShop>> | null>(null);
  const [missing, setMissing] = useState(false);
  const [news, setNews] = useState('');

  useEffect(() => {
    fetchShop(id)
      .then(setPage)
      .catch(() => setMissing(true));
  }, [id]);

  async function add(product: PublicShopProduct): Promise<void> {
    if (!product.catalogueItemId) return;
    const { item } = await fetchCatalogueItem(product.catalogueItemId);
    if (!item) {
      setNews('That is no longer available.');
      return;
    }
    basket.add(item);
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
        <Link to="/shops" className="control bg-paper text-ink">
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
  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">{page.shop.name}</h1>
      {page.shop.about && <p className="m-0">{page.shop.about}</p>}
      {page.shop.address && <p className="m-0">{page.shop.address}</p>}
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {page.products.length === 0 ? (
        <p className="m-0">No products yet.</p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-4">
          {page.products.map((product) => (
            <li key={product.id}>
              <article
                aria-labelledby={`product-${product.id}`}
                className="border-2 border-paper rounded-xl p-4 space-y-2"
              >
                {product.hasPhoto && (
                  <img
                    src={shopPhotoUrl(page.shop.id, product.id)}
                    alt={product.name}
                    className="w-full max-h-64 object-contain rounded-lg bg-paper"
                  />
                )}
                <h2 id={`product-${product.id}`} className="text-lead font-bold m-0">
                  {product.name}
                </h2>
                <p className="m-0">
                  About {money(product.pricePence)}.
                  {product.expiresOn
                    ? ` Best before ${new Date(product.expiresOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
                    : ''}
                </p>
                <button
                  type="button"
                  onClick={() => void add(product)}
                  className="control w-full bg-highlight text-ink"
                >
                  Add to my basket<span className="visually-hidden">: {product.name}</span>
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
