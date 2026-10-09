import type { CapacitorConfig } from '@capacitor/cli';

import { loadIdentity } from './scripts/identity.ts';

/**
 * The phone apps: the built web app inside an iOS and an Android shell (docs/APP_STORES.md).
 *
 * The name and identifier come from config/store.json (Rule Nine), through scripts/identity.ts.
 * The native projects are generated into build/ios and build/android by `pnpm --filter mobile
 * build`, never committed, so the name is only ever written into them at build time.
 *
 * By default the app carries its own copy of the web app, so it opens without a signal and
 * Apple's reviewers see a real app rather than a website in a frame. Setting APP_LIVE_URL
 * (such as https://ozidelivery.co.uk) at build time makes it load the live website instead,
 * which picks up every change without a new store release: useful for a test copy on our own
 * phones, and best avoided for the copy sent to Apple.
 */
const identity = loadIdentity();
const liveUrl = process.env['APP_LIVE_URL']?.trim();

const config: CapacitorConfig = {
  appId: identity.appId,
  appName: identity.name,
  webDir: '../web/dist',
  // Pinch to zoom in and out, and pan around, in the phone apps as on the website (Anthony,
  // 7 October 2026, ruling 43: an accessibility need). App web views turn it off unless asked.
  zoomEnabled: true,
  backgroundColor: identity.navy,
  android: {
    path: 'build/android',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    path: 'build/ios',
    contentInset: 'automatic',
    backgroundColor: identity.navy,
  },
  server: {
    androidScheme: 'https',
    ...(liveUrl ? { url: liveUrl, cleartext: false } : {}),
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: identity.navy,
      showSpinner: false,
    },
    StatusBar: {
      // Light writing on the navy bar.
      style: 'DARK',
      backgroundColor: identity.navy,
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
