/**
 * The API answers on both `/` and `/api`.
 *
 * On App Platform the API is served at `/api` and the platform strips that prefix before the
 * request arrives, so the server sees `/health`. That is how Aldilivery is deployed and it
 * works. But whether the prefix is stripped is a setting on a dashboard, and the failure when
 * it is not stripped is silent in the worst way: `/api/health` falls past the API, lands on
 * the web app's catch-all, and comes back 200 with an HTML page. The API then looks missing
 * rather than misrouted, which is a much harder thing to work out at eleven at night.
 *
 * Answering on both paths removes the whole class of problem.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, seedCatalogue, signUpShopper, type TestHarness } from './helpers.js';

describe('every route answers with and without the /api prefix', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildTestApp();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('answers the health check on both, which is what the platform polls', async () => {
    const bare = await harness.app.inject({ method: 'GET', url: '/health' });
    const prefixed = await harness.app.inject({ method: 'GET', url: '/api/health' });

    expect(bare.statusCode).toBe(200);
    expect(prefixed.statusCode).toBe(200);
    expect(prefixed.json()).toMatchObject({ status: 'ok' });
    expect(prefixed.json()).toEqual(bare.json());
  });

  it('answers the public configuration on both', async () => {
    const bare = await harness.app.inject({ method: 'GET', url: '/config' });
    const prefixed = await harness.app.inject({ method: 'GET', url: '/api/config' });

    expect(prefixed.statusCode).toBe(200);
    expect(prefixed.json()).toEqual(bare.json());
  });

  it('answers a catalogue search on both, query string and all', async () => {
    await seedCatalogue(harness.repository);

    const bare = await harness.app.inject({ method: 'GET', url: '/catalogue/search?q=milk' });
    const prefixed = await harness.app.inject({
      method: 'GET',
      url: '/api/catalogue/search?q=milk',
    });

    expect(prefixed.statusCode).toBe(200);
    expect(prefixed.json()).toEqual(bare.json());
  });

  it('accepts a POST with a body and a token on the prefixed path too', async () => {
    const items = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/basket/price',
      headers: shopper.authHeader,
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 2 }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ feePence: 800 });
  });

  it('keeps Rule Six on the prefixed path: the prefix is not a way round a rule', async () => {
    // A second mount of every route is a second front door. It must not be a weaker one.
    const items = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);

    const search = await harness.app.inject({
      method: 'GET',
      url: '/api/catalogue/search?q=wine',
    });
    expect((search.json() as { items: unknown[] }).items).toEqual([]);

    const basket = await harness.app.inject({
      method: 'POST',
      url: '/api/basket/price',
      headers: shopper.authHeader,
      payload: { lines: [{ catalogueItemId: items.wine, quantity: 1 }] },
    });
    expect(basket.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('gives its own JSON not-found under the prefix, never an empty body', async () => {
    // This is the signature that tells you routing is right: an unknown path under /api
    // answers in the API's words, rather than falling through to the web app's catch-all.
    const response = await harness.app.inject({ method: 'GET', url: '/api/nonsense' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'not_found', message: 'There is nothing at that address.' },
    });
  });

  it('gives the same not-found without the prefix', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/nonsense' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('does not answer a doubled prefix, which would mean something is wrong', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/api/health' });

    expect(response.statusCode).toBe(404);
  });
});
