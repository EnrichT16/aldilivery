/**
 * Never "I couldn't find it, so I'll leave it out" (19 October 2026): something not in the list
 * is added at a typical price, or the cafés that make it are named, or it is plainly refused.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Estimate, OziBrain } from '../src/lib/language-model.js';
import { ESTIMATED_REF } from '../src/services/suggest.js';
import { buildTestApp, seedCatalogue, type TestHarness } from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

function brainSaying(estimates: Record<string, Estimate>): OziBrain {
  return {
    name: 'model',
    model: 'stand-in',
    understand: async () => null,
    estimate: async (name) => estimates[name.toLowerCase()] ?? null,
  };
}

async function start(brain?: OziBrain) {
  harness = await buildTestApp(new Date('2026-10-19T12:00:00.000Z'), brain ? { brain } : {});
  await seedCatalogue(harness.repository);
}

function suggest(name: string) {
  return harness.app.inject({ method: 'POST', url: '/catalogue/suggest', payload: { name } });
}

describe('something not in the list', () => {
  it('is added at a typical price as an estimate, once, and found by the next search', async () => {
    await start(
      brainSaying({
        quinoa: {
          kind: 'grocery',
          name: 'Quinoa, 300g',
          category: 'Cupboard',
          pricePence: 199,
          reply: null,
        },
      }),
    );
    const first = await suggest('quinoa');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      outcome: 'added',
      item: {
        name: 'Quinoa, 300g',
        category: 'Cupboard',
        estimatedPricePence: 199,
        source: 'community',
      },
    });
    const row = await harness.repository.catalogue.findById(first.json().item.id as string);
    expect(row).toMatchObject({ externalRef: ESTIMATED_REF, ageRestricted: false });
    const again = await suggest('quinoa');
    expect(again.json()).toMatchObject({ outcome: 'found', item: { id: first.json().item.id } });
    const search = await harness.app.inject({ method: 'GET', url: '/catalogue/search?q=quinoa' });
    expect(search.json().items.map((item: { name: string }) => item.name)).toContain(
      'Quinoa, 300g',
    );
  });

  it('names the cafés and takeaways for a meal', async () => {
    await start(
      brainSaying({
        'chicken chow mein': {
          kind: 'prepared',
          name: 'Chicken chow mein',
          category: 'Other',
          pricePence: 0,
          reply: 'Chicken chow mein comes from a takeaway.',
        },
      }),
    );
    await harness.repository.partnerShops.create({
      name: 'Golden Wok',
      address: '1 High Street',
      telephone: '',
      about: 'Chinese takeaway.',
      monthlyPence: 0,
      kind: 'food',
      status: 'approved',
    });
    const answer = await suggest('chicken chow mein');
    expect(answer.json()).toMatchObject({
      outcome: 'shops',
      reply: 'Chicken chow mein comes from a takeaway.',
    });
    expect(answer.json().shops.map((shop: { name: string }) => shop.name)).toContain('Golden Wok');
  });

  it('refuses what is never carried, and anything dearer than one product may be', async () => {
    await start(
      brainSaying({
        'red wine': {
          kind: 'not_allowed',
          name: 'Red wine',
          category: 'Other',
          pricePence: 0,
          reply: 'We do not carry alcohol.',
        },
        'air fryer': {
          kind: 'grocery',
          name: 'Air fryer',
          category: 'Household',
          pricePence: 8999,
          reply: null,
        },
      }),
    );
    expect((await suggest('red wine')).json()).toEqual({
      outcome: 'refused',
      reply: 'We do not carry alcohol.',
    });
    expect((await suggest('air fryer')).json()).toMatchObject({ outcome: 'refused' });
  });

  it('says unknown without the language model, and never adds a row', async () => {
    await start();
    expect((await suggest('quinoa')).json()).toEqual({ outcome: 'unknown' });
    const search = await harness.app.inject({ method: 'GET', url: '/catalogue/search?q=quinoa' });
    expect(search.json().items).toHaveLength(0);
  });
});
