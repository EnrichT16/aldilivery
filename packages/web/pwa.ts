/**
 * What makes the website installable as an app (ruling 50): the web app manifest and the
 * service worker's offline rules, kept here so that vite.config.ts uses them and
 * test/install.test.ts can check them.
 *
 * Every name and colour comes from config/store.json (Rule Nine), passed in by the caller.
 */

export interface StoreIdentity {
  productName: string;
  tagline: string;
  brand: { colours: { navy: string } };
}

/** The icons in packages/web/public, with the size each one really is. */
export const ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  // Android crops these to its own shape, so the picture sits well inside the edges.
  { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const;

/** The icon an iPhone puts on the home screen; iOS ignores the manifest's icons. */
export const APPLE_TOUCH_ICON = { src: '/apple-touch-icon.png', size: 180 } as const;

/** Files in public/ that the service worker keeps, so the app opens without a signal. */
export const INCLUDE_ASSETS = [
  'favicon.svg',
  APPLE_TOUCH_ICON.src.slice(1),
  ...ICONS.map((icon) => icon.src.slice(1)),
];

export function webAppManifest(store: StoreIdentity) {
  return {
    // A fixed identity, so the installed app stays the same app if start_url ever changes.
    id: '/',
    name: store.productName,
    // Twelve characters or fewer fits under an icon on most phones without being cut off.
    short_name: store.productName,
    description: store.tagline,
    start_url: '/',
    scope: '/',
    display: 'standalone' as const,
    // Never locked to upright: someone with a phone fixed to a wheelchair, or who reads larger
    // text sideways, must be able to turn it (WCAG 2.2, 1.3.4 Orientation).
    orientation: 'any' as const,
    background_color: store.brand.colours.navy,
    theme_color: store.brand.colours.navy,
    lang: 'en-GB',
    dir: 'ltr' as const,
    categories: ['shopping', 'food', 'lifestyle'],
    icons: ICONS.map((icon) => ({ ...icon })),
    // A long press on the icon on Android offers these.
    shortcuts: [
      { name: 'Shop', url: '/shop', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Your order', url: '/my-order', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}

/** The service worker's rules for working without a signal. */
export const WORKBOX = {
  globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
  // Any page opened without a signal is answered with the app itself, which then says plainly
  // that it cannot reach us, instead of the browser's own "no internet" page.
  navigateFallback: '/index.html',
  // The API shares this hostname, so without this the service worker answers a visit
  // to /api/health with the cached app, in any browser that has opened the app
  // before. The request never leaves the browser, which is why a redeploy, a hard
  // refresh habit or a correct routing rule all change nothing. Found 25 Sep 2026.
  navigateFallbackDenylist: [/^\/api(\/|$)/],
  // Shows a Runner's question as a notification when no page is open. See the file.
  importScripts: ['/push-sw.js'],
};
