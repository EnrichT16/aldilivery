/**
 * Deciding a shop's product or service: the one place it is done (ruling 74). Staff in the
 * Shops tab, the owner on Ozi's call, and the automatic check all come through
 * `decidePartnerProduct`. Approved, a product goes in the catalogue with the shop's name on it;
 * a service never does, because nobody buys it here, they ask for a quote (ruling 65).
 */

import { markedUpPricePence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PartnerProduct, PartnerShop } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { NEVER_FOUND } from '../lib/restricted.js';

/**
 * What Shoppers see and pay for a partner's thing at this shop price: the price with the
 * partner's agreed mark-up on it (Anthony, 30 October 2026). The catalogue holds this price.
 */
export function shopperPricePence(
  shop: Pick<PartnerShop, 'agreedMarkupPercent'>,
  pricePence: number,
): number {
  return markedUpPricePence(pricePence, shop.agreedMarkupPercent ?? 0);
}

/**
 * The partner's agreed mark-up changed: every one of its things in the catalogue takes the price
 * Shoppers pay now. Orders already placed keep what was agreed.
 */
export async function refreshPartnerPrices(
  ctx: Pick<AppContext, 'repository'>,
  shop: PartnerShop,
): Promise<void> {
  for (const product of await ctx.repository.partnerProducts.listForShop(shop.id)) {
    if (!product.catalogueItemId || product.status !== 'approved') continue;
    await ctx.repository.catalogue.update(product.catalogueItemId, {
      estimatedPricePence: shopperPricePence(shop, product.pricePence),
    });
  }
}

export async function decidePartnerProduct(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  product: PartnerProduct,
  input: { approve: boolean; note?: string | null },
): Promise<PartnerProduct> {
  const { repository } = ctx;
  if (product.status !== 'pending') throw new ConflictError('That one has already been decided.');
  if (!input.approve) {
    return repository.partnerProducts.update(product.id, {
      status: 'rejected',
      note: input.note ?? null,
      decidedAt: ctx.now(),
    });
  }
  if (NEVER_FOUND.test(`${product.name} ${product.tags}`)) {
    throw new BadRequestError('That is something we never bring, so it cannot be approved.');
  }
  const shop = await repository.partnerShops.findById(product.partnerShopId);
  if (!shop) throw new NotFoundError('partner shop');
  const item =
    shop.kind === 'service'
      ? null
      : await repository.catalogue.create({
          name: `${product.name} (${shop.name})`,
          category: `From ${shop.name}`,
          estimatedPricePence: shopperPricePence(shop, product.pricePence),
          source: 'partner_feed',
          externalRef: `partner:${product.id}`,
        });
  return repository.partnerProducts.update(product.id, {
    status: 'approved',
    catalogueItemId: item?.id ?? null,
    note: input.note ?? null,
    decidedAt: ctx.now(),
  });
}

/**
 * Taking a live product off (the owner declining one the automatic check doubted after a
 * change of price): it leaves the catalogue at once.
 */
export async function withdrawPartnerProduct(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  product: PartnerProduct,
  note: string,
): Promise<PartnerProduct> {
  if (product.catalogueItemId) {
    await ctx.repository.catalogue.update(product.catalogueItemId, { retired: true });
  }
  return ctx.repository.partnerProducts.update(product.id, {
    status: 'rejected',
    note,
    decidedAt: ctx.now(),
  });
}
