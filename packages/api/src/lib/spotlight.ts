/**
 * Spotlight and Spotlight Plus (ruling 42): paid mentions by Ozi, for Shop Partners only.
 *
 * Section O still governs: the genuine answer comes first, the mention after it, called an
 * advert, with checkable facts only ("in stock at", "about £3.50"), never "better". A mention is
 * only made when the Shopper is looking for something that shop sells, and the same Shopper
 * hears a given shop at most once a week on Spotlight, or three times on Spotlight Plus. One
 * advert at most per search.
 */

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PartnerProduct, PartnerShop } from '../domain.js';
import { personKey } from './analytics.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Advert {
  shopId: string;
  shopName: string;
  productName: string;
  pricePence: number;
  catalogueItemId: string | null;
  words: string;
}

function matches(product: PartnerProduct, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .map((word) => word.replace(/(es|s)$/, ''));
  if (words.length === 0) return false;
  const text = `${product.name} ${product.tags}`.toLowerCase();
  return words.some((word) => text.includes(word));
}

export function spotlightActive(shop: PartnerShop, now: Date): boolean {
  return (
    shop.active &&
    shop.spotlight !== 'none' &&
    shop.spotlightUntil !== null &&
    shop.spotlightUntil > now &&
    shop.paidUntil !== null &&
    shop.paidUntil > now
  );
}

/** The one advert for this search, if any shop has earned it, and records that it was made. */
export async function chooseAdvert(
  ctx: AppContext,
  shopperId: string,
  query: string,
): Promise<Advert | null> {
  const { repository, config, env, now } = ctx;
  const at = now();
  const shopperKey = personKey(shopperId, env.authTokenSecret);
  const heard = await repository.spotlightMentions.listForShopperSince(
    shopperKey,
    new Date(at.getTime() - WEEK_MS),
  );
  const candidates: Array<{ shop: PartnerShop; product: PartnerProduct; heard: number }> = [];
  for (const shop of await repository.partnerShops.list()) {
    if (!spotlightActive(shop, at)) continue;
    const limit =
      shop.spotlight === 'plus'
        ? config.extras.spotlightPlusPerWeek
        : config.extras.spotlightPerWeek;
    const times = heard.filter((mention) => mention.partnerShopId === shop.id).length;
    if (times >= limit) continue;
    const product = (await repository.partnerProducts.listForShop(shop.id)).find(
      (row) => row.status === 'approved' && matches(row, query),
    );
    if (product) candidates.push({ shop, product, heard: times });
  }
  if (candidates.length === 0) return null;
  // The shop this Shopper has heard least this week, Spotlight Plus first among equals.
  candidates.sort(
    (a, b) =>
      a.heard - b.heard ||
      Number(b.shop.spotlight === 'plus') - Number(a.shop.spotlight === 'plus'),
  );
  const { shop, product } = candidates[0]!;
  await repository.spotlightMentions.create({
    partnerShopId: shop.id,
    shopperKey,
    query: query.trim().toLowerCase().slice(0, 80),
    at,
  });
  const price = formatPence(product.pricePence, config.store.currencySymbol);
  return {
    shopId: shop.id,
    shopName: shop.name,
    productName: product.name,
    pricePence: product.pricePence,
    catalogueItemId: product.catalogueItemId,
    words: `Advert: ${product.name} is in stock at ${shop.name}, about ${price}.`,
  };
}
