import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
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

export default defineConfig({
  plugins: [
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
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      // Everything about the store is read from here, never hard coded.
      '@store-config': fileURLToPath(storeConfigUrl),
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
  },
});
