/**
 * Never "I couldn't find it, so I'll leave it out" (Anthony, 19 October 2026). When something
 * asked for is not in the shop list, the language model is asked what it is:
 *
 * - **Something a shop sells off the shelf**: it is added to the community list at a typical
 *   UK price, marked as an estimate like every other community price, and goes in the basket.
 *   The Runner buys it at the till and the Shopper pays the till price, as for anything else.
 * - **A meal from a café or takeaway**: the listed cafés and takeaways are named, so the Shopper
 *   can choose one, as the big apps list the restaurants that sell a dish.
 * - **Something the service never carries** (alcohol, tobacco, medicines, cash): said plainly.
 *
 * Without the model, or when it is slow, the answer is "unknown" and the caller says so kindly.
 * Nothing here ever takes money: the read-back and the one yes are unchanged (Rule One).
 */

import { productAllowed } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { CatalogueItem } from '../domain.js';
import { bannedList, containsBanned } from '../lib/banned.js';
import { remember } from '../lib/ozi-memory.js';

import { lookUpPriceLater } from './prices.js';

export type Suggestion =
  | { outcome: 'found'; item: CatalogueItem }
  | { outcome: 'added'; item: CatalogueItem }
  | { outcome: 'shops'; reply: string; shops: Array<{ id: string; name: string }> }
  | { outcome: 'refused'; reply: string }
  | { outcome: 'unknown' };

/** Marks a community row the language model priced, so staff can find and correct them. */
export const ESTIMATED_REF = 'estimate:model';

function tidy(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function suggestItem(
  ctx: Pick<
    AppContext,
    'repository' | 'config' | 'env' | 'now' | 'brain' | 'openPrices' | 'lookUpPrices'
  >,
  asked: string,
  channel: 'app' | 'phone' = 'app',
): Promise<Suggestion> {
  const wanted = tidy(asked);
  if (wanted.length < 2 || containsBanned(wanted, bannedList(ctx.env.storeConfigPath))) {
    return { outcome: 'unknown' };
  }
  const { repository, config } = ctx;
  const estimate = await ctx.brain?.estimate?.(wanted);
  if (!estimate) return { outcome: 'unknown' };

  const keep = (said: string, outcome: 'answered' | 'added' | 'refused'): void => {
    void remember(ctx, {
      channel,
      account: 'shopper',
      conversation: `suggest:${wanted}`,
      turn: 0,
      heard: wanted,
      said,
      brain: 'model',
      outcome,
    });
  };

  if (estimate.kind === 'prepared') {
    const shops = (await repository.partnerShops.list())
      .filter((shop) => shop.active && shop.status === 'approved' && shop.kind === 'food')
      .slice(0, 5)
      .map((shop) => ({ id: shop.id, name: shop.name }));
    const reply =
      estimate.reply ?? `${wanted} comes from a café or takeaway rather than a supermarket.`;
    keep(reply, 'answered');
    return { outcome: 'shops', reply, shops };
  }
  if (estimate.kind !== 'grocery') {
    const reply =
      estimate.reply ??
      (estimate.kind === 'not_allowed'
        ? `${config.productName} does not carry that, I'm afraid.`
        : `I'm not sure what ${wanted} is. Could you say it another way?`);
    keep(reply, 'refused');
    return { outcome: 'refused', reply };
  }

  const name = tidy(estimate.name || wanted);
  // Already there under the tidy name: use that row, never a second one.
  const existing = (
    await repository.catalogue.search(name, { includeAgeRestricted: false, limit: 5 })
  ).find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing) return { outcome: 'found', item: existing };

  const pricePence = Math.max(10, Math.round(estimate.pricePence));
  if (!productAllowed(pricePence, config.fees)) {
    const reply = `${name} usually costs more than one product may cost on ${config.productName}.`;
    keep(reply, 'refused');
    return { outcome: 'refused', reply };
  }
  const item = await repository.catalogue.create({
    name,
    category: estimate.category === 'Other' ? 'Everyday essentials' : estimate.category,
    estimatedPricePence: pricePence,
    source: 'community',
    externalRef: ESTIMATED_REF,
    ageRestricted: false,
    lastSeenAt: ctx.now(),
  });
  keep(`[added: ${name}, about ${pricePence}p]`, 'added');
  // A real price in the background (ruling 72): the open price database, or one web search.
  lookUpPriceLater(ctx, item);
  return { outcome: 'added', item };
}
