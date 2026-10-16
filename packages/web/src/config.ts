/**
 * The store configuration, in the browser.
 *
 * The same JSON file the API reads, validated by the same parser from `@aldilivery/core`.
 * There are no strings about the supermarket anywhere else in this package: the name on the
 * screen, the colours, the fees and the catalogue attribution all come from here.
 */

import { parseStoreConfig, type StoreConfig } from '@aldilivery/core';
import rawStoreConfig from '@store-config';

export const storeConfig: StoreConfig = parseStoreConfig(rawStoreConfig);

/** `#0B1F3A` becomes `11 31 58`, the form the stylesheet's `rgb(… / alpha)` takes. */
function channels(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(' ');
}

/** The two appearances a screen can have (Settings, "Appearance"). */
export type Theme = 'dark' | 'light';

/** Keep the browser chrome in step with the brand, rather than repeating it in the HTML. */
export function applyBrandToDocument(config: StoreConfig = storeConfig): void {
  const root = document.documentElement.style;
  root.setProperty('--brand-ink-rgb', channels(config.brand.colours.navy));
  root.setProperty('--brand-highlight-rgb', channels(config.brand.colours.gold));
  root.setProperty('--brand-paper-rgb', channels(config.brand.colours.white));
  root.setProperty('--brand-listening-rgb', channels(config.brand.colours.listening));
  root.setProperty('--base-font-size', `${config.accessibility.baseFontSizePx}px`);
  root.setProperty('--control-height', `${config.accessibility.minimumControlHeightPx}px`);
  const current = document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark';
  applyAppearanceToDocument(current, config);
}

/**
 * The appearance: navy with white words (the default, and the brand) or paper with navy
 * words. The stylesheet swaps the two over on `data-theme`; the bar above the page follows.
 */
export function applyAppearanceToDocument(theme: Theme, config: StoreConfig = storeConfig): void {
  document.documentElement.dataset['theme'] = theme;
  const themeColour = document.querySelector('meta[name="theme-color"]');
  if (themeColour) {
    themeColour.setAttribute(
      'content',
      theme === 'light' ? config.brand.colours.white : config.brand.colours.navy,
    );
  }
}
