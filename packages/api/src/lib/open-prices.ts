/**
 * The open price database (20 October 2026, ruling 72): prices people across the UK have
 * photographed on shelves and receipts and shared under an open licence, with the open food
 * database's product names and barcodes. Free and lawful to use; nothing is copied off a
 * shop's own website.
 *
 * A name is looked up in two steps: the food database finds UK products with that name and
 * their barcodes, then the price database gives the recent prices in pounds for those
 * barcodes. Anything slow, missing or odd is simply no answer: the estimate stays as it was.
 */

import { z } from 'zod';

const PRODUCTS_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const PRICES_URL = 'https://prices.openfoodfacts.org/api/v1/prices';
const WAIT_MS = 10_000;
/** A price older than this says little about today's. */
const OLDEST_DAYS = 365;

export interface OpenPrice {
  barcode: string;
  name: string;
  pricePence: number;
  shop: string | null;
  seenAt: Date;
}

export interface OpenPricesLookup {
  lookUp(name: string): Promise<OpenPrice[]>;
  /**
   * One product by its barcode, for a Shop Partner scanning their shelves (ruling 75): its name
   * and size from the food database, and the newest UK price seen for it, if any. Optional, so
   * stand-ins in tests need not have it.
   */
  lookUpBarcode?(barcode: string): Promise<BarcodeProduct | null>;
}

export interface BarcodeProduct {
  barcode: string;
  name: string;
  /** The newest UK price seen for one, or null: someone else's shelf, so only an estimate. */
  pricePence: number | null;
}

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

const productShape = z.object({
  status: z.number().optional(),
  product: z
    .object({
      product_name: z.string().optional().nullable(),
      quantity: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

const productsShape = z.object({
  products: z.array(
    z.object({
      code: z.string(),
      product_name: z.string().optional().nullable(),
      quantity: z.string().optional().nullable(),
    }),
  ),
});

const pricesShape = z.object({
  items: z.array(
    z.object({
      price: z.number(),
      currency: z.string(),
      date: z.string(),
      price_per: z.string().optional().nullable(),
      location: z.object({ osm_name: z.string().optional().nullable() }).optional().nullable(),
    }),
  ),
});

type Fetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function openPrices(
  settings: { userAgent: string; now?: () => Date },
  fetcher: Fetch = fetch as unknown as Fetch,
): OpenPricesLookup {
  const now = settings.now ?? (() => new Date());
  const get = async (url: string): Promise<unknown> => {
    const response = await fetcher(url, {
      // The databases ask every app to say who it is.
      headers: { 'user-agent': settings.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    if (!response.ok) return null;
    return response.json();
  };

  /** The recent prices in pounds for one barcode, newest first, as pence for one. */
  const pricesFor = async (barcode: string, name: string): Promise<OpenPrice[]> => {
    const prices = pricesShape.safeParse(
      await get(
        `${PRICES_URL}?${new URLSearchParams({
          product_code: barcode,
          currency: 'GBP',
          order_by: '-date',
          size: '10',
        })}`,
      ),
    );
    if (!prices.success) return [];
    const oldest = now().getTime() - OLDEST_DAYS * 86_400_000;
    const found: OpenPrice[] = [];
    for (const price of prices.data.items) {
      const seenAt = new Date(price.date);
      if (price.currency !== 'GBP' || Number.isNaN(seenAt.getTime())) continue;
      if (seenAt.getTime() < oldest) continue;
      // Loose fruit and the like are priced by the kilo, not for one.
      if (price.price_per && price.price_per !== 'UNIT') continue;
      const pricePence = Math.round(price.price * 100);
      if (pricePence < 1 || pricePence > 100_000) continue;
      found.push({
        barcode,
        name: name.slice(0, 120),
        pricePence,
        shop: price.location?.osm_name?.slice(0, 60) ?? null,
        seenAt,
      });
    }
    return found;
  };

  return {
    async lookUpBarcode(barcode) {
      if (!/^\d{8,14}$/.test(barcode)) return null;
      try {
        const product = productShape.safeParse(
          await get(
            `${PRODUCT_URL}/${barcode}?${new URLSearchParams({ fields: 'product_name,quantity' })}`,
          ),
        );
        if (!product.success || !product.data.product?.product_name) return null;
        const name = [product.data.product.product_name, product.data.product.quantity]
          .filter(Boolean)
          .join(', ')
          .slice(0, 100);
        const prices = await pricesFor(barcode, name);
        return { barcode, name, pricePence: prices[0]?.pricePence ?? null };
      } catch {
        return null;
      }
    },
    async lookUp(name) {
      try {
        const query = new URLSearchParams({
          search_terms: name.slice(0, 80),
          search_simple: '1',
          action: 'process',
          json: '1',
          page_size: '5',
          fields: 'code,product_name,quantity',
          tagtype_0: 'countries',
          tag_contains_0: 'contains',
          tag_0: 'en:united-kingdom',
        });
        const products = productsShape.safeParse(await get(`${PRODUCTS_URL}?${query}`));
        if (!products.success) return [];
        const found: OpenPrice[] = [];
        for (const product of products.data.products.slice(0, 3)) {
          if (!/^\d{8,14}$/.test(product.code)) continue;
          const label = [product.product_name, product.quantity].filter(Boolean).join(', ');
          found.push(...(await pricesFor(product.code, label || name)));
          if (found.length >= 5) break;
        }
        return found.slice(0, 10);
      } catch {
        return [];
      }
    },
  };
}
