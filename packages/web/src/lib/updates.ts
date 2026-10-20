/**
 * Every phone runs the newest version (Anthony, 19 October 2026: "once there are new changes
 * on the server, it automatically updates everybody using the app"). The home-screen app asks
 * for a new version when it opens, whenever it comes back to the front, and every half hour.
 * A new version takes over at once (pwa.ts: skipWaiting, clientsClaim) and the page reloads
 * itself, but never in the middle of someone using it: only in the first seconds after the app
 * opens or comes back to the front, otherwise the next time it is put away.
 *
 * And a safety net (20 October 2026: "on Chrome the changes show, saved on the home screen
 * they don't"): each build knows its own name (`__BUILD_ID__`) and the server says the newest
 * in `/version.json`, which the service worker never keeps. If they differ and the normal
 * update has not taken over, the old copy is thrown away (its service worker and its saved
 * files) and the page reloads from the server. Once for each new build, so it can never loop.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Just opened, or just brought back: a reload now is not noticed. */
const FRESH_MS = 8000;
/** How long the normal update gets before the old copy is thrown away. */
const GRACE_MS = 6000;
const FORCED_KEY = 'ozidelivery.update.forced';

/** The newest build on the server, when it is not this one; otherwise null. */
export async function newerBuildOnServer(
  current: string = __BUILD_ID__,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(`/version.json?at=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { build?: unknown };
    return typeof body.build === 'string' && body.build !== current ? body.build : null;
  } catch {
    return null;
  }
}

function alreadyForced(build: string): boolean {
  try {
    return localStorage.getItem(FORCED_KEY) === build;
  } catch {
    return true;
  }
}

function markForced(build: string): void {
  try {
    localStorage.setItem(FORCED_KEY, build);
  } catch {
    // Without storage the safety net stays off: better than reloading again and again.
  }
}

/** Throws away the saved copy: every service worker of this site and every saved file. */
async function forgetOldCopy(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(registrations.map((one) => one.unregister().catch(() => false)));
  if ('caches' in window) {
    const names = await caches.keys().catch(() => [] as string[]);
    await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
  }
}

export function keepUpToDate(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  let freshAt = Date.now();
  let waitingToReload = false;
  let reloading = false;

  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  const reloadWhenQuiet = (): void => {
    if (Date.now() - freshAt < FRESH_MS || document.visibilityState === 'hidden') reload();
    else waitingToReload = true;
  };

  // A new version has taken over the page.
  navigator.serviceWorker.addEventListener('controllerchange', reloadWhenQuiet);

  const safetyNet = async (): Promise<void> => {
    const newer = await newerBuildOnServer();
    if (!newer || alreadyForced(newer)) return;
    window.setTimeout(() => {
      void (async () => {
        if (reloading) return;
        // Still old after the normal update had its chance.
        if (!(await newerBuildOnServer())) return;
        markForced(newer);
        await forgetOldCopy();
        reloadWhenQuiet();
      })();
    }, GRACE_MS);
  };

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      const check = (): void => {
        void registration.update().catch(() => undefined);
        void safetyNet();
      };
      check();
      window.setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (waitingToReload) reload();
          return;
        }
        freshAt = Date.now();
        check();
      });
    })
    .catch(() => {
      void safetyNet();
    });
}
