/**
 * Every phone runs the newest version (Anthony, 19 October 2026: "once there are new changes
 * on the server, it automatically updates everybody using the app"). The home-screen app asks
 * for a new version when it opens, whenever it comes back to the front, and every half hour.
 * A new version takes over at once (pwa.ts: skipWaiting, clientsClaim) and the page reloads
 * itself, but never in the middle of someone using it: only in the first seconds after the app
 * opens or comes back to the front, otherwise the next time it comes back to the front, or the
 * next time it is opened.
 *
 * Never while somebody is in the middle of something (10 November 2026, ruling 100: Runners said
 * "the app logs me out within 5 minutes on Chrome", and one gave up because he could not send
 * his documents). Three things were wrong, and each is put right here:
 *   - On a first ever visit the new service worker claims the page, which looks just like a new
 *     version taking over. That is not an update, and it no longer queues a reload.
 *   - A page that was put away used to reload at that moment. But the camera, the file picker,
 *     going to Messages for the sign-in code and the agreement in a new tab all put the page
 *     away, so the photo, the code step or the half-filled form was lost. A page is never
 *     reloaded for being hidden any more.
 *   - Every automatic reload (a new version, the safety net, a heal) now waits while the page is
 *     busy: while a screen holds reloads (`holdReloads`: an upload on its way, the code step of
 *     signing in), for two minutes after a file or camera button was used, and while anything
 *     typed into a field has not been sent. A reload that waits happens when the page next comes
 *     back to the front with nothing held and nothing typed, or the next time the app is opened.
 * The once-for-each-build rules below are unchanged, so nothing can loop.
 *
 * And a safety net (20 October 2026: "on Chrome the changes show, saved on the home screen
 * they don't"): each build knows its own name (`__BUILD_ID__`) and the server says the newest
 * in `/version.json`, which the service worker never keeps. If they differ and the normal
 * update has not taken over, the old copy is thrown away (its service worker and its saved
 * files) and the page reloads from the server. Once for each new build, so it can never loop.
 *
 * And self-healing loads (ruling 95, 3 November 2026: on Chrome "it doesn't load fully; the
 * looks and features are not complete"). With a release most days, a saved copy of the app can
 * point at files the server no longer has. When one of the app's own files fails to load (a
 * dynamic import, a chunk, a module script) the saved copy is thrown away, once for each build,
 * and the page reloads from the server: `watchForBrokenLoads` and `healOnce`. The same once-only
 * rule keeps it from ever looping. index.html carries a small plain script that does the same
 * for the very first file, which this code cannot catch because it is in that file.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Just opened, or just brought back: a reload now is not noticed. */
const FRESH_MS = 8000;
/** How long the normal update gets before the old copy is thrown away. */
const GRACE_MS = 6000;
/** Untouched for this long, the page is not being used: the safety net may reload it. */
const QUIET_MS = 10_000;
const FORCED_KEY = 'ozidelivery.update.forced';
/** The build whose broken load was healed on this device, so it is only ever done once a build. */
export const HEALED_KEY = 'ozidelivery.heal.build';

/* ------------------------------------------------------------------ busy: do not reload now */

/** After a camera or file button is used, the page is left alone for this long. */
export const FILE_QUIET_MS = 2 * 60 * 1000;

/** How many screens are holding reloads off just now. */
let holds = 0;
/** When a camera or file button was last used on this page; 0 for never. */
let fileUsedAt = 0;
/** Fields somebody has typed in since the page opened. */
const typedIn = new Set<HTMLInputElement | HTMLTextAreaElement>();
let watchingFields = false;
/** A heal that is waiting for the page to stop being busy. */
let waitingHeal: (() => void) | null = null;

/** The kinds of input that hold no typed words: ticks, buttons, files and the like. */
const NOT_TYPED = /^(hidden|checkbox|radio|file|submit|button|reset|image|range|color)$/;

/**
 * Holds every automatic reload off until the function it returns is called: for an upload on
 * its way, or the step of signing in where the code is typed. Calling the release twice is
 * harmless. Nothing reloads at the moment of release: the next return to the front does it.
 */
export function holdReloads(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

/** A camera or file button has just been used. The page listens for this itself. */
export function noteFileUsed(at: number = Date.now()): void {
  fileUsedAt = at;
}

function isField(target: unknown): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    typeof HTMLElement !== 'undefined' &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  );
}

/**
 * Listens, once, for file buttons being used and for typing. A tap on a camera or file button
 * counts as well as a file being chosen, because the camera hides the page before any file
 * comes back. Typing is noted here too, because a field React fills in itself always looks
 * unchanged when compared with what it started with.
 */
function watchFields(): void {
  if (watchingFields || typeof document === 'undefined') return;
  watchingFields = true;
  const file = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') noteFileUsed();
  };
  document.addEventListener('click', file, true);
  document.addEventListener('change', file, true);
  document.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (isField(target) && !NOT_TYPED.test(target.type)) typedIn.add(target);
    },
    true,
  );
}

/** Whether any field on the page holds words that have been typed and not yet sent. */
function somethingTyped(): boolean {
  if (typeof document === 'undefined') return false;
  for (const field of typedIn) {
    // A field that has left the page was sent, or abandoned with its screen.
    if (!field.isConnected) typedIn.delete(field);
    else if (field.value !== '') return true;
  }
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]),textarea',
  )) {
    if (NOT_TYPED.test(field.type)) continue;
    if (field.value !== field.defaultValue) return true;
  }
  return false;
}

/**
 * Whether an automatic reload must wait: a screen is holding reloads, a camera or file button
 * was used in the last two minutes, or something typed has not been sent.
 */
export function reloadsMustWait(now: number = Date.now()): boolean {
  return holds > 0 || (fileUsedAt > 0 && now - fileUsedAt < FILE_QUIET_MS) || somethingTyped();
}

/** For tests: nothing held, nothing used, nothing typed, nothing waiting. */
export function forgetBusy(): void {
  holds = 0;
  fileUsedAt = 0;
  typedIn.clear();
  waitingHeal = null;
}

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
export async function forgetOldCopy(): Promise<void> {
  const workers = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (workers?.getRegistrations) {
    const registrations = await workers.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((one) => one.unregister().catch(() => false)));
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    const names = await caches.keys().catch(() => [] as string[]);
    await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
  }
}

/* ------------------------------------------------------------------ self-healing loads */

/**
 * The words browsers use when one of the app's own files could not be loaded: Chrome, Safari
 * and Firefox each say it their own way, and Vite's preload helper adds one more.
 */
const LOAD_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk|Unable to preload CSS|ChunkLoadError/i;

/** Whether an error, a rejection reason or a message says one of the app's files failed to load. */
export function isLoadFailure(reason: unknown): boolean {
  const message =
    typeof reason === 'string'
      ? reason
      : reason && typeof reason === 'object' && 'message' in reason
        ? (reason as { message?: unknown }).message
        : undefined;
  return typeof message === 'string' && LOAD_FAILURE.test(message);
}

function healedAlready(build: string): boolean {
  try {
    return localStorage.getItem(HEALED_KEY) === build;
  } catch {
    // Without storage a heal could not be remembered, so it is not attempted: no loops.
    return true;
  }
}

function markHealed(build: string): void {
  try {
    localStorage.setItem(HEALED_KEY, build);
  } catch {
    // See healedAlready.
  }
}

/**
 * Throws the saved copy away and reloads the page from the server, once for each build on
 * this device. False when that has already been done for this build: the page is not going to
 * get better by itself, and whoever called should say so plainly instead of reloading again.
 *
 * While the page is busy (ruling 100, see the top of this file) the heal waits, and is done when
 * the page next comes back to the front with nothing in hand. It is not marked as done until it
 * is done, so opening the app afresh heals it too.
 */
export async function healOnce(
  build: string = __BUILD_ID__,
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  if (healedAlready(build)) return false;
  watchFields();
  if (reloadsMustWait()) {
    if (!waitingHeal && typeof document !== 'undefined') {
      const whenBack = (): void => {
        if (document.visibilityState !== 'visible' || reloadsMustWait()) return;
        document.removeEventListener('visibilitychange', whenBack);
        if (waitingHeal !== whenBack) return;
        waitingHeal = null;
        void healOnce(build, reload);
      };
      waitingHeal = whenBack;
      document.addEventListener('visibilitychange', whenBack);
    }
    // In hand: it will be done, so nobody need say the page cannot be mended.
    return true;
  }
  markHealed(build);
  await forgetOldCopy();
  reload();
  return true;
}

/**
 * Watches for one of the app's files failing to load after the page is up: Vite's own
 * `vite:preloadError`, an error or an unhandled rejection whose words say a module or chunk
 * could not be fetched. The first one heals the page (see `healOnce`). Returns a function that
 * stops watching.
 */
export function watchForBrokenLoads(heal: () => Promise<boolean> = () => healOnce()): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let healing = false;
  const broken = (): void => {
    if (healing) return;
    healing = true;
    void heal().then((did) => {
      if (!did) healing = false;
    });
  };
  const onPreloadError = (event: Event): void => {
    // Vite would otherwise throw it again; the reload is the answer.
    event.preventDefault();
    broken();
  };
  const onError = (event: ErrorEvent): void => {
    if (isLoadFailure(event.error ?? event.message)) broken();
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    if (isLoadFailure(event.reason)) broken();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * "Reset the app" (ruling 95): the saved copy goes (every service worker and every saved
 * file), the page loads afresh from the server, and every sign-in kept on the device stays: the
 * Shopper's and the Runner's tokens, a staff member remembered on their phone, and this tab's
 * staff sign-in. Only the update bookkeeping is forgotten, so a heal may run again afterwards.
 */
export async function resetApp(
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    localStorage.removeItem(FORCED_KEY);
    localStorage.removeItem(HEALED_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
  await forgetOldCopy();
  reload();
}

export function keepUpToDate(reloadPage: () => void = () => window.location.reload()): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  watchFields();
  // Whether a service worker already had this page when it opened. Without one, the first
  // worker claiming the page is a first visit, not a new version (ruling 100).
  const hadController = !!navigator.serviceWorker.controller;
  let freshAt = Date.now();
  // When the person last touched the page: a page nobody has touched for a while is not in
  // the middle of being used.
  let touchedAt = 0;
  let waitingToReload = false;
  let reloading = false;
  for (const kind of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(
      kind,
      () => {
        touchedAt = Date.now();
      },
      { passive: true },
    );
  }

  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    reloadPage();
  };
  /**
   * Reloads now if that will not be noticed, otherwise the next time the app comes back to the
   * front. `urgent` is the safety net, whose page has just lost its saved copy (ruling 95:
   * installing a new version on a slow connection takes longer than the first seconds, and a
   * page left like that is the half-loaded app people reported), so a page that has not been
   * touched for a while reloads too.
   *
   * Never because the page is hidden, and never while it is busy (ruling 100): the camera, the
   * file picker and Messages all hide the page, and the photo or the code must still be there
   * when the person comes back.
   */
  const reloadWhenQuiet = (urgent = false): void => {
    const untouched = Date.now() - touchedAt >= QUIET_MS;
    const unnoticed =
      document.visibilityState !== 'hidden' &&
      (Date.now() - freshAt < FRESH_MS || (urgent && untouched));
    if (unnoticed && !reloadsMustWait()) {
      reload();
    } else {
      waitingToReload = true;
    }
  };

  // A new version has taken over the page. Not the first worker this page has ever had.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    reloadWhenQuiet();
  });

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
        reloadWhenQuiet(true);
      })();
    }, GRACE_MS);
  };

  let check: (() => void) | null = null;
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      check = (): void => {
        void registration.update().catch(() => undefined);
        void safetyNet();
      };
      check();
      window.setInterval(check, CHECK_EVERY_MS);
    })
    .catch(() => {
      void safetyNet();
    });

  document.addEventListener('visibilitychange', () => {
    // Put away: nothing happens. A hidden page is very often a page in the middle of something.
    if (document.visibilityState === 'hidden') return;
    freshAt = Date.now();
    // Back at the front: a reload that was waiting happens now, unless the page is still busy,
    // in which case it goes on waiting for the next return or the next time the app is opened.
    if (waitingToReload && !reloadsMustWait()) {
      reload();
      return;
    }
    check?.();
  });
}
