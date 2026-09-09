import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor is not used yet. This file is here so that wrapping the web app for the app
 * stores later is a `npx cap add ios` away rather than a rebuild.
 *
 * The identifier and name deliberately describe the product, not the supermarket, so that
 * Rule Nine survives into the store listings.
 */
const config: CapacitorConfig = {
  appId: 'uk.co.aldilivery.app',
  appName: 'Aldilivery',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
