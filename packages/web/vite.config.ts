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
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_BASE_URL'] ?? 'http://localhost:3001',
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
  },
});
