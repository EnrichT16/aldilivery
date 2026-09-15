/**
 * What the web app does when something other than the API answers.
 *
 * A request to /api/... can fall through to whatever serves the rest of the site — while the
 * API is redeploying, or if a route is ever misconfigured — and come back as the web app's
 * own HTML page with a cheerful 200 on it. Parsed as JSON that is an empty object, and an
 * empty object is indistinguishable from a shop with nothing in it.
 *
 * A blank catalogue that should have been an error message is the worst of both worlds:
 * nothing works, and nothing says why. These tests pin the honest behaviour.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiUnavailableError, searchCatalogue } from '../src/lib/api';

function respondWith(body: string, contentType: string, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok,
        status,
        headers: new Headers({ 'content-type': contentType }),
        json: async () => JSON.parse(body) as unknown,
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('when the web app’s own HTML answers instead of the API', () => {
  const HTML = '<!doctype html><html lang="en-GB"><body><div id="root"></div></body></html>';

  it('says we cannot reach Aldilivery, rather than showing an empty shop', async () => {
    respondWith('{}', 'text/html; charset=utf-8');

    await expect(searchCatalogue('milk')).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('gives a Shopper one plain sentence, with no jargon in it', async () => {
    respondWith('{}', 'text/html; charset=utf-8');

    await expect(searchCatalogue('milk')).rejects.toThrow(
      'We cannot reach Aldilivery at the moment.',
    );
  });

  it('keeps the real reason for the console, where it helps whoever is debugging', async () => {
    respondWith('{}', 'text/html; charset=utf-8');

    await searchCatalogue('milk').catch((error: unknown) => {
      expect((error as ApiUnavailableError).reason).toBe('the reply was not JSON');
    });
    expect.assertions(1);
  });

  it('does not quietly return an empty result', async () => {
    // The defect this guards: an HTML page parsed as {} used to come back as a successful
    // search with no items in it, so the shop looked empty and correct.
    respondWith('{}', 'text/html; charset=utf-8');

    const result = await searchCatalogue('milk').catch(() => 'threw' as const);
    expect(result).toBe('threw');
    expect(HTML.length).toBeGreaterThan(0);
  });
});

describe('when the API answers properly', () => {
  it('returns the results', async () => {
    respondWith(
      JSON.stringify({ items: [{ id: 'a', name: 'Milk', category: 'Dairy', estimatedPricePence: 125 }], attribution: 'x', source: 'community' }),
      'application/json; charset=utf-8',
    );

    const result = await searchCatalogue('milk');
    expect(result.items).toHaveLength(1);
  });

  it('still reports a proper JSON error from the API in the API’s own words', async () => {
    respondWith(
      JSON.stringify({ error: { message: 'There is nothing at that address.' } }),
      'application/json; charset=utf-8',
      false,
      404,
    );

    await expect(searchCatalogue('milk')).rejects.toThrow('There is nothing at that address.');
  });

  it('treats a lost connection as unreachable, as it always did', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network'))));

    await expect(searchCatalogue('milk')).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
