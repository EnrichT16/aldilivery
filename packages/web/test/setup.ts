import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom has no document language by default, and no layout engine. The language is set here
 * because the real `index.html` sets it and every screen is judged against WCAG with it in
 * place. The missing layout engine is the reason axe reports colour contrast as
 * "incomplete" rather than passing in these tests; contrast is checked separately, by hand,
 * against the two brand colours.
 */
beforeEach(() => {
  document.documentElement.lang = 'en-GB';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A small catalogue, so the shopping page has something to draw. */
export const FAKE_CATALOGUE = {
  items: [
    {
      id: 'item-milk',
      name: 'Semi skimmed milk, 2 pints',
      category: 'Dairy',
      estimatedPricePence: 125,
    },
    {
      id: 'item-bread',
      name: 'White sliced bread, 800g',
      category: 'Bakery',
      estimatedPricePence: 89,
    },
  ],
  attribution: 'Prices are estimates. You pay what the till says.',
  source: 'community',
};

export function stubCatalogueFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => Promise.resolve(FAKE_CATALOGUE),
      } as unknown as Response),
    ),
  );
}
