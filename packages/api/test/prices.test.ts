/**
 * Real prices before any shop sends its own (20 October 2026, ruling 72): till receipts, the
 * open price database, and one web search, best first, with the estimate following the best.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../src/app.js';
import type { OziBrain } from '../src/lib/language-model.js';
import { readWebPrice } from '../src/lib/language-model.js';
import { openPrices, type OpenPrice } from '../src/lib/open-prices.js';
import {
  WEB_LOOKUPS_PER_DAY,
  learnFromReceipt,
  lookUpPrice,
  refreshPrices,
  settlePrice,
} from '../src/services/prices.js';
import { ESTIMATED_REF } from '../src/services/suggest.js';
import { STAFF, buildTestApp, seedCatalogue, signUpShopper, type TestHarness } from './helpers.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

function brain(parts: Partial<OziBrain>): OziBrain {
  return { name: 'model', model: 'stand-in', understand: async () => null, ...parts };
}

function withParts(parts: Partial<AppContext>): AppContext {
  return { ...harness.app.ctx, ...parts };
}

function openSaying(prices: OpenPrice[]) {
  const asked: string[] = [];
  return {
    asked,
    lookup: {
      lookUp: async (name: string) => {
        asked.push(name);
        return prices;
      },
    },
  };
}

describe('the estimate follows the best price seen', () => {
  it('prefers a receipt to the open database, and the database to a web search', async () => {
    harness = await buildTestApp(NOW);
    const { milk } = await seedCatalogue(harness.repository);
    const sight = (source: 'receipt' | 'open_prices' | 'web', pricePence: number) =>
      harness.repository.prices.record({
        catalogueItemId: milk,
        name: 'Milk',
        pricePence,
        shop: null,
        source,
        orderId: null,
        barcode: null,
        seenAt: NOW,
      });
    await sight('web', 140);
    expect(await settlePrice(harness.app.ctx, milk)).toBe(140);
    await sight('open_prices', 130);
    await sight('open_prices', 120);
    await sight('open_prices', 150);
    expect(await settlePrice(harness.app.ctx, milk)).toBe(130);
    await sight('receipt', 115);
    expect(await settlePrice(harness.app.ctx, milk)).toBe(115);
    expect((await harness.repository.catalogue.findById(milk))?.estimatedPricePence).toBe(115);
  });

  it('leaves a wildly different outside price alone, and ignores old ones', async () => {
    harness = await buildTestApp(NOW);
    const { milk } = await seedCatalogue(harness.repository);
    await harness.repository.prices.record({
      catalogueItemId: milk,
      name: 'Milk, 6 pints',
      pricePence: 900,
      shop: null,
      source: 'open_prices',
      orderId: null,
      barcode: null,
      seenAt: NOW,
    });
    await harness.repository.prices.record({
      catalogueItemId: milk,
      name: 'Milk',
      pricePence: 99,
      shop: null,
      source: 'receipt',
      orderId: null,
      barcode: null,
      seenAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    expect(await settlePrice(harness.app.ctx, milk)).toBeNull();
    expect((await harness.repository.catalogue.findById(milk))?.estimatedPricePence).toBe(125);
  });
});

describe('a till receipt', () => {
  it('teaches the catalogue the price of each thing bought as asked', async () => {
    harness = await buildTestApp(NOW);
    const { milk, bread, beans } = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      goodsEstimatePence: 300,
      feePence: 1350,
      totalEstimatePence: 1650,
      deliveryAddress: 'Somewhere ME7 1AA',
      items: [
        {
          catalogueItemId: milk,
          name: 'Semi skimmed milk, 2 pints',
          quantity: 2,
          estimatedPricePence: 125,
        },
        {
          catalogueItemId: bread,
          name: 'White sliced bread, 800g',
          quantity: 1,
          estimatedPricePence: 89,
        },
        { catalogueItemId: beans, name: 'Baked beans, 415g', quantity: 1, estimatedPricePence: 45 },
      ],
    });
    await harness.repository.receiptPhotos.save({
      orderId: order.id,
      data: Buffer.from('a photo'),
      contentType: 'image/jpeg',
      createdAt: NOW,
    });
    let shown: string[] = [];
    const reader = brain({
      readReceipt: async (photo, items) => {
        expect(photo).toEqual({
          data: Buffer.from('a photo').toString('base64'),
          mediaType: 'image/jpeg',
        });
        shown = items;
        // Bread could not be read, so it is left out; a line number past the list is ignored.
        return {
          shop: 'Corner Shop',
          lines: [
            { item: 1, unitPricePence: 135 },
            { item: 3, unitPricePence: 55 },
            { item: 9, unitPricePence: 1 },
          ],
        };
      },
    });
    expect(await learnFromReceipt(withParts({ brain: reader }), order.id)).toBe(2);
    expect(shown).toEqual([
      '2 x Semi skimmed milk, 2 pints',
      '1 x White sliced bread, 800g',
      '1 x Baked beans, 415g',
    ]);
    expect((await harness.repository.catalogue.findById(milk))?.estimatedPricePence).toBe(135);
    expect((await harness.repository.catalogue.findById(bread))?.estimatedPricePence).toBe(89);
    expect((await harness.repository.catalogue.findById(beans))?.estimatedPricePence).toBe(55);
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/staff/prices',
      headers: STAFF,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().prices).toHaveLength(2);
    expect(listed.json().prices[0]).toMatchObject({ source: 'receipt', shop: 'Corner Shop' });
  });

  it('is not read when the photo is a kind the model cannot read, or there is no model', async () => {
    harness = await buildTestApp(NOW);
    const { milk } = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      goodsEstimatePence: 125,
      feePence: 1350,
      totalEstimatePence: 1475,
      deliveryAddress: 'Somewhere ME7 1AA',
      items: [{ catalogueItemId: milk, name: 'Milk', quantity: 1, estimatedPricePence: 125 }],
    });
    await harness.repository.receiptPhotos.save({
      orderId: order.id,
      data: Buffer.from('x'),
      contentType: 'image/heic',
      createdAt: NOW,
    });
    let asked = false;
    const reader = brain({
      readReceipt: async () => {
        asked = true;
        return null;
      },
    });
    expect(await learnFromReceipt(withParts({ brain: reader }), order.id)).toBe(0);
    expect(await learnFromReceipt(harness.app.ctx, order.id)).toBe(0);
    expect(asked).toBe(false);
  });
});

describe('looking a price up', () => {
  it('uses the open database first and does not search the web', async () => {
    harness = await buildTestApp(NOW);
    const { milk } = await seedCatalogue(harness.repository);
    const open = openSaying([
      {
        barcode: '5000000000001',
        name: 'Milk 2 pints',
        pricePence: 145,
        shop: 'A shop',
        seenAt: NOW,
      },
    ]);
    let searched = false;
    const ctx = withParts({
      openPrices: open.lookup,
      brain: brain({
        webPrice: async () => {
          searched = true;
          return null;
        },
      }),
    });
    expect(await lookUpPrice(ctx, { id: milk, name: 'Semi skimmed milk, 2 pints' })).toBe(
      'open_prices',
    );
    expect(searched).toBe(false);
    expect((await harness.repository.catalogue.findById(milk))?.estimatedPricePence).toBe(145);
    expect((await harness.repository.prices.listForItem(milk, 5))[0]).toMatchObject({
      barcode: '5000000000001',
      source: 'open_prices',
    });
  });

  it('searches the web once when the database has nothing, up to a daily limit', async () => {
    harness = await buildTestApp(NOW);
    const { bread } = await seedCatalogue(harness.repository);
    let searches = 0;
    const ctx = withParts({
      openPrices: openSaying([]).lookup,
      brain: brain({
        webPrice: async () => {
          searches += 1;
          return { pricePence: 95, shop: 'A supermarket' };
        },
      }),
    });
    expect(await lookUpPrice(ctx, { id: bread, name: 'White sliced bread, 800g' })).toBe('web');
    expect((await harness.repository.catalogue.findById(bread))?.estimatedPricePence).toBe(95);
    for (let index = 1; index < WEB_LOOKUPS_PER_DAY; index += 1) {
      await harness.repository.prices.record({
        catalogueItemId: null,
        name: 'something',
        pricePence: 100,
        shop: null,
        source: 'web',
        orderId: null,
        barcode: null,
        seenAt: NOW,
      });
    }
    expect(await lookUpPrice(ctx, { id: bread, name: 'White sliced bread, 800g' })).toBeNull();
    expect(searches).toBe(1);
  });

  it('looks up estimated things first in the sweep, and skips ones seen lately', async () => {
    harness = await buildTestApp(NOW);
    const { milk } = await seedCatalogue(harness.repository);
    const guessed = await harness.repository.catalogue.create({
      name: 'Quinoa, 300g',
      category: 'Cupboard',
      estimatedPricePence: 199,
      source: 'community',
      externalRef: ESTIMATED_REF,
    });
    await harness.repository.prices.record({
      catalogueItemId: milk,
      name: 'Milk',
      pricePence: 125,
      shop: null,
      source: 'receipt',
      orderId: null,
      barcode: null,
      seenAt: NOW,
    });
    const open = openSaying([]);
    const report = await refreshPrices(withParts({ openPrices: open.lookup }));
    expect(open.asked[0]).toBe(guessed.name);
    expect(open.asked).not.toContain('Semi skimmed milk, 2 pints');
    expect(report.answered).toBe(0);
    expect(report.looked).toBe(open.asked.length);
  });

  it('a thing added at an estimate is looked up in the background when switched on', async () => {
    const open = openSaying([
      { barcode: '5000000000002', name: 'Quinoa 300g', pricePence: 210, shop: null, seenAt: NOW },
    ]);
    harness = await buildTestApp(NOW, {
      brain: brain({
        estimate: async () => ({
          kind: 'grocery',
          name: 'Quinoa, 300g',
          category: 'Cupboard',
          pricePence: 199,
          reply: null,
        }),
      }),
    });
    harness.app.ctx.openPrices = open.lookup;
    harness.app.ctx.lookUpPrices = true;
    const added = await harness.app.inject({
      method: 'POST',
      url: '/catalogue/suggest',
      payload: { name: 'quinoa' },
    });
    expect(added.json()).toMatchObject({ outcome: 'added', item: { estimatedPricePence: 199 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(open.asked).toEqual(['Quinoa, 300g']);
    const row = await harness.repository.catalogue.findById(added.json().item.id as string);
    expect(row?.estimatedPricePence).toBe(210);
  });
});

describe('reading the answers', () => {
  it('reads the last price line of a web lookup', () => {
    expect(readWebPrice('It is about £1.10.\nPRICE_PENCE=110; SHOP=A supermarket')).toEqual({
      pricePence: 110,
      shop: 'A supermarket',
    });
    expect(readWebPrice('Nothing clear.\nPRICE_PENCE=0; SHOP=none')).toBeNull();
    expect(readWebPrice('no line at all')).toBeNull();
    expect(readWebPrice('PRICE_PENCE=89; SHOP=none')).toEqual({ pricePence: 89, shop: null });
  });

  it('turns the open databases into prices in pence, skipping old, foreign and per-kilo ones', async () => {
    const asked: string[] = [];
    const lookup = openPrices({ userAgent: 'test/1.0', now: () => NOW }, async (url, init) => {
      asked.push(url);
      expect(init.headers['user-agent']).toBe('test/1.0');
      if (url.includes('search.pl')) {
        return {
          ok: true,
          json: async () => ({
            products: [{ code: '5012345678900', product_name: 'Plain flour', quantity: '1.5 kg' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            { price: 1.15, currency: 'GBP', date: '2026-10-01', location: { osm_name: 'A shop' } },
            { price: 1.05, currency: 'EUR', date: '2026-10-01' },
            { price: 0.9, currency: 'GBP', date: '2024-01-01' },
            { price: 2.5, currency: 'GBP', date: '2026-10-02', price_per: 'KILOGRAM' },
          ],
        }),
      };
    });
    expect(await lookup.lookUp('plain flour')).toEqual([
      {
        barcode: '5012345678900',
        name: 'Plain flour, 1.5 kg',
        pricePence: 115,
        shop: 'A shop',
        seenAt: new Date('2026-10-01'),
      },
    ]);
    expect(asked[1]).toContain('product_code=5012345678900');
    expect(asked[1]).toContain('currency=GBP');
  });

  it('gives nothing when the databases cannot be reached', async () => {
    const lookup = openPrices({ userAgent: 'test/1.0' }, async () => {
      throw new Error('offline');
    });
    expect(await lookup.lookUp('flour')).toEqual([]);
  });
});
