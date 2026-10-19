/**
 * Every phone runs the newest version (Anthony, 19 October 2026: "once there are new changes
 * on the server, it automatically updates everybody using the app"). The home-screen app asks
 * for a new version when it opens, whenever it comes back to the front, and every half hour.
 * A new version takes over at once (pwa.ts: skipWaiting, clientsClaim) and the page reloads
 * itself, but never in the middle of someone using it: straight away only in the first seconds
 * after opening, otherwise the next time the app is brought back to the front.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Just opened: a reload now is not noticed. */
const FRESH_MS = 8000;

export function keepUpToDate(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const openedAt = Date.now();
  let waitingToReload = false;
  let reloading = false;

  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  // A new version has taken over the page.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (Date.now() - openedAt < FRESH_MS || document.visibilityState === 'hidden') reload();
    else waitingToReload = true;
  });

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      const check = (): void => {
        void registration.update().catch(() => undefined);
      };
      window.setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (waitingToReload) reload();
          return;
        }
        check();
      });
    })
    .catch(() => undefined);
}
