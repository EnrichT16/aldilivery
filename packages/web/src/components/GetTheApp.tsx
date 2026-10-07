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
    return window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

function onIPhone(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Get the app (ruling 50). The website is the app: on Android, in Chrome, one press puts it on
 * the home screen; on an iPhone, Safari's Share button, then Add to Home Screen. The App Store
 * and Google Play versions follow once the D-U-N-S number arrives.
 */
export function GetTheApp({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const [news, setNews] = useState('');
  const [installed, setInstalled] = useState(runningAsApp());
  useEffect(() => {
    const done = (): void => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => window.removeEventListener('appinstalled', done);
  }, []);
  if (installed) return null;

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
    setNews(
      onIPhone()
        ? "On an iPhone: press Safari's Share button at the bottom of the screen, then Add to Home Screen."
        : "In your browser's menu, choose Install app, or Add to Home screen.",
    );
  };

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
      {!compact && (
        <p className="m-0 extra">
          It works on any phone, straight from the website. The App Store and Google Play versions
          are coming soon.
        </p>
      )}
    </section>
  );
}
