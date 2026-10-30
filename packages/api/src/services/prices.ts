/**
 * Real prices before any shop sends us its own (Anthony, 20 October 2026, ruling 72). Three
 * lawful sources, best first:
 *
 * 1. **Till receipts.** The Runner's photo of the receipt is read by the language model and
 *    each price is matched to what was on the order. Our own data, and the truest there is.
 * 2. **The open price database** (lib/open-prices.ts): prices people have shared under an
 *    open licence.
 * 3. **One web search** by the language model, for something neither of the others knows,
 *    at most `WEB_LOOKUPS_PER_DAY` a day so the cost stays a few pence.
 *
 * Every price seen is kept as a sighting. The catalogue's estimate then follows the best
 * source with a recent sighting. It is still an estimate: the Shopper pays the till price,
 * and nothing here touches an order or a payment (Rule One).
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { CatalogueItem, PriceSighting } from '../domain.js';
import { READABLE_IMAGES, type ReceiptImage } from '../lib/language-model.js';

import { ESTIMATED_REF } from './suggest.js';

/** Best first. */
const SOURCE_RANK: PriceSighting['source'][] = ['receipt', 'open_prices', 'web'];
/** Sightings older than this no longer move an estimate. */
const FRESH_DAYS = 180;
/** At most about £1 a day of web searches. */
export const WEB_LOOKUPS_PER_DAY = 100;
/** How many things the sweep looks up each time it runs. */
const SWEEP_BATCH = 10;
/** A thing is looked up again once its newest sighting is this old. */
const STALE_DAYS = 30;

type PriceContext = Pick<
  AppContext,
  'repository' | 'now' | 'brain' | 'openPrices' | 'lookUpPrices'
>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Moves the item's estimate to the best recent price seen, and gives the new price, or null
 * when nothing changed. A price from outside (not a receipt) that is wildly off the estimate is
 * more likely a different size than a real price, so it is left for a person to look at.
 */
async function partnerHasTerms(
  ctx: Pick<AppContext, 'repository'>,
  externalRef: string | null | undefined,
): Promise<boolean> {
  if (!externalRef?.startsWith('partner:')) return false;
  const product = await ctx.repository.partnerProducts.findById(externalRef.slice(8));
  const shop = product ? await ctx.repository.partnerShops.findById(product.partnerShopId) : null;
  return shop !== null && (shop.agreedMarkupPercent > 0 || shop.agreedDiscountPercent > 0);
}

export async function settlePrice(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  catalogueItemId: string,
): Promise<number | null> {
  const item = await ctx.repository.catalogue.findById(catalogueItemId);
  if (!item || item.retired) return null;
  // A partner with an agreed mark-up or discount (Anthony, 30 October 2026): the till shows the
  // counter price, never the price Shoppers pay, so it never moves the catalogue price.
  if (item.source === 'partner_feed' && (await partnerHasTerms(ctx, item.externalRef))) return null;
  const freshFrom = ctx.now().getTime() - FRESH_DAYS * 86_400_000;
  const sightings = (await ctx.repository.prices.listForItem(item.id, 30)).filter(
    (row) => row.seenAt.getTime() >= freshFrom,
  );
  for (const source of SOURCE_RANK) {
    // A partner's own list is only ever corrected by what the till actually charged.
    if (item.source === 'partner_feed' && source !== 'receipt') continue;
    const rows = sightings.filter((row) => row.source === source).slice(0, 5);
    if (rows.length === 0) continue;
    const price = median(rows.map((row) => row.pricePence));
    if (source !== 'receipt') {
      const ratio = price / Math.max(1, item.estimatedPricePence);
      if (ratio > 4 || ratio < 0.25) return null;
    }
    if (price === item.estimatedPricePence) return null;
    await ctx.repository.catalogue.update(item.id, {
      estimatedPricePence: price,
      lastSeenAt: ctx.now(),
    });
    return price;
  }
  return null;
}

/**
 * Reads the receipt photo kept with an order and learns its prices. Gives how many prices it
 * learned. Never throws: a receipt that cannot be read is simply not learned from.
 */
export async function learnFromReceipt(
  ctx: PriceContext,
  orderId: string,
  log?: FastifyBaseLogger,
): Promise<number> {
  try {
    const read = ctx.brain?.readReceipt;
    if (!read) return 0;
    const photo = await ctx.repository.receiptPhotos.findByOrderId(orderId);
    const type = READABLE_IMAGES.find((one) => one === photo?.contentType);
    if (!photo || !type) return 0;
    const order = await ctx.repository.orders.findById(orderId);
    if (!order) return 0;
    // Only what was bought as asked: a swap's price belongs to a different thing.
    const items = order.items.filter(
      (item) => item.catalogueItemId && item.substitutionOutcome !== 'substituted',
    );
    if (items.length === 0) return 0;
    const image: ReceiptImage = {
      data: Buffer.from(photo.data).toString('base64'),
      mediaType: type,
    };
    const reading = await read.call(
      ctx.brain,
      image,
      items.map((item) => `${item.quantity} x ${item.name}`),
    );
    if (!reading) return 0;
    const learned = new Set<string>();
    for (const line of reading.lines) {
      const item = items[line.item - 1];
      if (!item?.catalogueItemId || learned.has(item.catalogueItemId)) continue;
      learned.add(item.catalogueItemId);
      await ctx.repository.prices.record({
        catalogueItemId: item.catalogueItemId,
        name: item.name,
        pricePence: line.unitPricePence,
        shop: reading.shop?.slice(0, 60) ?? null,
        source: 'receipt',
        orderId,
        barcode: null,
        seenAt: ctx.now(),
      });
    }
    for (const id of learned) await settlePrice(ctx, id);
    log?.info({ orderId, prices: learned.size }, 'Prices learned from a receipt');
    return learned.size;
  } catch (failure) {
    log?.warn({ err: failure, orderId }, 'A receipt could not be learned from');
    return 0;
  }
}

/**
 * Looks one thing up: the open price database first, then one web search if that has
 * nothing and today's searches are not used up. Gives the source that answered, or null.
 */
export async function lookUpPrice(
  ctx: PriceContext,
  item: Pick<CatalogueItem, 'id' | 'name'>,
  log?: FastifyBaseLogger,
): Promise<PriceSighting['source'] | null> {
  try {
    const open = (await ctx.openPrices?.lookUp(item.name)) ?? [];
    if (open.length > 0) {
      for (const price of open.slice(0, 5)) {
        await ctx.repository.prices.record({
          catalogueItemId: item.id,
          name: price.name,
          pricePence: price.pricePence,
          shop: price.shop,
          source: 'open_prices',
          orderId: null,
          barcode: price.barcode,
          seenAt: price.seenAt,
        });
      }
      await settlePrice(ctx, item.id);
      return 'open_prices';
    }
    const search = ctx.brain?.webPrice;
    if (!search) return null;
    const dayAgo = new Date(ctx.now().getTime() - 86_400_000);
    if ((await ctx.repository.prices.countSince('web', dayAgo)) >= WEB_LOOKUPS_PER_DAY) {
      return null;
    }
    const found = await search.call(ctx.brain, item.name);
    if (!found) return null;
    await ctx.repository.prices.record({
      catalogueItemId: item.id,
      name: item.name,
      pricePence: found.pricePence,
      shop: found.shop,
      source: 'web',
      orderId: null,
      barcode: null,
      seenAt: ctx.now(),
    });
    await settlePrice(ctx, item.id);
    return 'web';
  } catch (failure) {
    log?.warn({ err: failure, item: item.id }, 'A price lookup failed');
    return null;
  }
}

/** In the background, when the server is set to: callers never wait for it. */
export function lookUpPriceLater(
  ctx: PriceContext,
  item: Pick<CatalogueItem, 'id' | 'name'>,
  log?: FastifyBaseLogger,
): void {
  if (!ctx.lookUpPrices) return;
  void lookUpPrice(ctx, item, log);
}

export function learnFromReceiptLater(
  ctx: PriceContext,
  orderId: string,
  log?: FastifyBaseLogger,
): void {
  if (!ctx.lookUpPrices) return;
  void learnFromReceipt(ctx, orderId, log);
}

/**
 * Every few hours: a few community things whose price is only an estimate, or was last seen a
 * month ago, are looked up again. Those the language model priced come first.
 */
export async function refreshPrices(
  ctx: PriceContext,
  log?: FastifyBaseLogger,
): Promise<{ looked: number; answered: number }> {
  const staleBefore = ctx.now().getTime() - STALE_DAYS * 86_400_000;
  const candidates = (await ctx.repository.catalogue.search('', { limit: 2000 }))
    .filter((item) => item.source === 'community')
    .sort(
      (a, b) => Number(b.externalRef === ESTIMATED_REF) - Number(a.externalRef === ESTIMATED_REF),
    );
  let looked = 0;
  let answered = 0;
  for (const item of candidates) {
    if (looked >= SWEEP_BATCH) break;
    const newest = (await ctx.repository.prices.listForItem(item.id, 1))[0];
    if (newest && newest.seenAt.getTime() >= staleBefore) continue;
    looked += 1;
    if (await lookUpPrice(ctx, item, log)) answered += 1;
  }
  return { looked, answered };
}
