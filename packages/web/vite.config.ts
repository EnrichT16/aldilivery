import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The whole of the store's identity comes from one file (Rule Nine), including the values
 * that have to be baked into the web app manifest at build time.
 */
const storeConfigUrl = new URL('../../config/store.json', import.meta.url);
const storeConfig = JSON.parse(readFileSync(storeConfigUrl, 'utf8')) as {
  productName: string;
  tagline: string;
  brand: { colours: { navy: string; gold: string; white: string } };
};

/**
 * The page the browser loads before any JavaScript runs — its title, the line shown when
 * JavaScript is off, the description and the theme colour — is filled in from the same file,
 * so that none of it is written into index.html (Rule Nine). Each `%STORE_…%` token there is
 * replaced here, and the build fails if one is left over.
 */
function storeIdentityInHtml(): Plugin {
  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tokens: Record<string, string> = {
    '%STORE_PRODUCT_NAME%': storeConfig.productName,
    '%STORE_TAGLINE%': storeConfig.tagline,
    '%STORE_NAVY%': storeConfig.brand.colours.navy,
  };
  return {
    name: 'store-identity-in-html',
    transformIndexHtml(html) {
      let filled = html;
      for (const [token, value] of Object.entries(tokens)) {
        filled = filled.split(token).join(escape(value));
      }
      const leftOver = filled.match(/%STORE_[A-Z_]+%/);
      if (leftOver)
        throw new Error(`index.html uses ${leftOver[0]}, which vite.config.ts does not fill in.`);
      return filled;
    },
  };
}

export default defineConfig({
  plugins: [
    storeIdentityInHtml(),
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: storeConfig.productName,
        short_name: storeConfig.productName,
        description: storeConfig.tagline,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: storeConfig.brand.colours.navy,
        theme_color: storeConfig.brand.colours.navy,
        lang: 'en-GB',
        categories: ['shopping', 'food', 'lifestyle'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // The API shares this hostname, so without this the service worker answers a visit
        // to /api/health with the cached app, in any browser that has opened the app
        // before. The request never leaves the browser, which is why a redeploy, a hard
        // refresh habit or a correct routing rule all change nothing. Found 25 Sep 2026.
        navigateFallbackDenylist: [/^\/api(\/|$)/],
        // Shows a Runner's question as a notification when no page is open. See the file.
        importScripts: ['/push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      // Everything about the store is read from here, never hard coded.
      '@store-config': fileURLToPath(storeConfigUrl),
      // What Ozi says to everyday words, added to daily (ruling 34).
      '@ozi-phrases': fileURLToPath(new URL('../../config/ozi-phrases.json', import.meta.url)),
      // Ozi Recipes and Little Gifts (6 October 2026).
      '@recipes': fileURLToPath(new URL('../../config/recipes.json', import.meta.url)),
      '@gifts': fileURLToPath(new URL('../../config/gifts.json', import.meta.url)),
      '@offers': fileURLToPath(new URL('../../config/offers.json', import.meta.url)),
      '@adverts': fileURLToPath(new URL('../../config/adverts.json', import.meta.url)),
    },
  },
  // Everything the browser needs is in `dist` and nothing else: a static site, served from
  // the root of its own hostname, so the manifest, the service worker and its scope all
  // resolve from `/`.
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Only used by anyone who builds with VITE_API_URL set to /api. The default in
    // development is to call the local API directly, which exercises CORS the same way
    // production does.
    proxy: {
      '/api': {
        target: process.env['VITE_API_URL'] ?? 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    css: true,
    include: ['test/**/*.test.{ts,tsx}'],
    /**
     * Generous, because these run on whatever machine builds the app and not only on a
     * developer's. Several tests render the whole application and wait on it, which takes
     * about a second here and can take several times that on a small build container. A
     * test that fails because the box was slow teaches nobody anything and blocks a deploy,
     * so the limit is set well clear of the real work rather than just above it.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    /**
     * One test file at a time.
     *
     * These files each render the whole application repeatedly, and one of them runs axe over
     * every screen, so they are heavy on processor rather than on waiting. Run in parallel on
     * a build container with few cores they compete with each other: the deployment log showed
     * 113 seconds of test time inside 73 seconds of wall clock, which is several workers
     * getting in each other's way. In series it is less total work, and — more importantly —
     * the same work every time, on any machine.
     */
    fileParallelism: false,
  },
});
