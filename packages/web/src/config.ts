/**
 * The store configuration, in the browser.
 *
 * The same JSON file the API reads, validated by the same parser from `@aldilivery/core`.
 * There are no strings about the supermarket anywhere else in this package: the name on the
 * screen, the colours, the fee bands and the catalogue attribution all come from here.
 */

import { parseStoreConfig, type StoreConfig } from '@aldilivery/core';
import rawStoreConfig from '@store-config';

export const storeConfig: StoreConfig = parseStoreConfig(rawStoreConfig);

/** Keep the browser chrome in step with the brand, rather than repeating it in the HTML. */
export function applyBrandToDocument(config: StoreConfig = storeConfig): void {
  const themeColour = document.querySelector('meta[name="theme-color"]');
  if (themeColour) {
    themeColour.setAttribute('content', config.brand.colours.navy);
  }
  document.documentElement.style.setProperty('--colour-ink', config.brand.colours.navy);
  document.documentElement.style.setProperty('--colour-highlight', config.brand.colours.gold);
  document.documentElement.style.setProperty('--colour-paper', config.brand.colours.white);
  document.documentElement.style.setProperty(
    '--base-font-size',
    `${config.accessibility.baseFontSizePx}px`,
  );
  document.documentElement.style.setProperty(
    '--control-height',
    `${config.accessibility.minimumControlHeightPx}px`,
  );
}
