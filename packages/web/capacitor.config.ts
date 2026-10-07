import { readFileSync } from 'node:fs';

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor is not used yet. This file is here so that wrapping the web app for the app
 * stores later is a `npx cap add ios` away rather than a rebuild.
 *
 * The identifier and name describe the product, not the supermarket, and both come from
 * config/store.json, so that Rule Nine survives into the store listings. The identifier is the
 * product name as one lower case word, in the reverse domain form the app stores expect, which
 * today gives `uk.co.ozidelivery.app`. No app has been published, so
 * nothing yet depends on it; once one is, it must never change again.
 */
const storeConfig = JSON.parse(
  readFileSync(new URL('../../config/store.json', import.meta.url), 'utf8'),
) as { productName: string };
const oneWord = storeConfig.productName.toLowerCase().replace(/[^a-z0-9]/g, '');

const config: CapacitorConfig = {
  appId: `uk.co.${oneWord}.app`,
  appName: storeConfig.productName,
  webDir: 'dist',
  // Pinch to zoom in and out, and pan around, in the phone apps as on the website (Anthony,
  // 7 October 2026: an accessibility need). App web views turn it off unless asked.
  zoomEnabled: true,
  server: {
    androidScheme: 'https',
  },
};

export default config;
