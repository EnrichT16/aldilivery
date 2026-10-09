import { useEffect, useState } from 'react';

import { storeConfig } from '../config';

/** What Chrome hands over when the app can be installed. Not in the standard types. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let saved: InstallPrompt | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    saved = event as InstallPrompt;
  });
}

/** Already opened as the installed app, from the home screen. */
export function runningAsApp(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches === true) return true;
    // Safari on an iPhone says so its own way.
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/**
 * Opened inside the App Store or Google Play app (packages/mobile), where Capacitor puts its
 * bridge on the window. Read from the window rather than imported, so the website does not
 * carry Capacitor's code.
 */
export function runningInStoreApp(): boolean {
  const bridge = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  try {
    return bridge?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function onIPhone(): boolean {
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

export const IPHONE_HINT =
  'On an iPhone: open this page in Safari, press the Share button, then choose Add to Home Screen, then Add.';
export const ANDROID_HINT =
  "On Android: open Chrome's menu, the three dots at the top right, then choose Install app or Add to Home screen.";

/** The steps for an iPhone or iPad, in Safari. */
function IPhoneSteps(): JSX.Element {
  return (
    <section aria-labelledby="get-app-iphone" className="space-y-2">
      <h3 id="get-app-iphone" className="font-bold m-0">
        On an iPhone or iPad
      </h3>
      <ol className="m-0 ps-6 space-y-1">
        <li>Open this page in Safari.</li>
        <li>
          Press the Share button: a square with an arrow pointing up, at the bottom of the screen,
          or at the top on an iPad. VoiceOver reads it as &ldquo;Share&rdquo;.
        </li>
        <li>Scroll down the list and choose Add to Home Screen.</li>
        <li>Press Add, at the top right.</li>
      </ol>
    </section>
  );
}

/** The steps for an Android phone, in Chrome. */
function AndroidSteps(): JSX.Element {
  return (
    <section aria-labelledby="get-app-android" className="space-y-2">
      <h3 id="get-app-android" className="font-bold m-0">
        On an Android phone
      </h3>
      <ol className="m-0 ps-6 space-y-1">
        <li>Open this page in Chrome.</li>
        <li>
          Press the button above, &ldquo;Put {storeConfig.productName} on my phone&rdquo;. If
          nothing appears, open Chrome&rsquo;s menu: the three dots at the top right. TalkBack reads
          it as &ldquo;More options&rdquo;.
        </li>
        <li>Choose Install app, or Add to Home screen.</li>
        <li>Press Install.</li>
      </ol>
    </section>
  );
}

/**
 * Get the app (ruling 50). The website is the app: on Android, in Chrome, one press puts it on
 * the home screen; on an iPhone, Safari's Share button, then Add to Home Screen. Both sets of
 * steps are written out, the reader's own phone first, so a relative helping on a different
 * phone can follow them too. The App Store and Google Play versions follow once the D-U-N-S
 * number arrives (docs/APP_STORES.md); inside those apps this is not shown at all.
 */
export function GetTheApp({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const [news, setNews] = useState('');
  const [installed, setInstalled] = useState(() => runningAsApp() || runningInStoreApp());
  useEffect(() => {
    const done = (): void => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => window.removeEventListener('appinstalled', done);
  }, []);
  if (installed) return null;

  const iPhone = onIPhone();

  const install = async (): Promise<void> => {
    if (saved) {
      await saved.prompt();
      const { outcome } = await saved.userChoice;
      saved = null;
      setNews(
        outcome === 'accepted'
          ? `${storeConfig.productName} is on your home screen now.`
          : 'All right. You can add it any time.',
      );
      return;
    }
    setNews(iPhone ? IPHONE_HINT : ANDROID_HINT);
  };

  const steps = iPhone ? (
    <>
      <IPhoneSteps />
      <AndroidSteps />
    </>
  ) : (
    <>
      <AndroidSteps />
      <IPhoneSteps />
    </>
  );

  return (
    <section aria-labelledby="get-app-heading" className="space-y-3 w-full max-w-xl text-center">
      <h2 id="get-app-heading" className={compact ? 'visually-hidden' : 'text-lead font-bold'}>
        Get the app
      </h2>
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        className="control bg-highlight text-ink"
      >
        Put {storeConfig.productName} on my phone
      </button>
      <p role="status" className="m-0">
        {news}
      </p>
      {compact ? (
        <details className="text-start">
          <summary className="control px-0 underline">How to do it on an iPhone or Android</summary>
          <div className="space-y-4 pt-2">{steps}</div>
        </details>
      ) : (
        <div className="space-y-4 text-start">
          {steps}
          <p className="m-0 extra">
            It works on any phone, straight from the website, and it is free. The App Store and
            Google Play versions are coming soon.
          </p>
        </div>
      )}
    </section>
  );
}
