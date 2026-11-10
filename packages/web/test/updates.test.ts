/**
 * The home-screen app can always tell when it is out of date (20 October 2026): it compares its
 * own build with the server's /version.json. And a copy whose files will not load heals itself,
 * once for each build (ruling 95), while "Reset the app" keeps every sign-in.
 *
 * And the page is never reloaded under somebody in the middle of something (10 November 2026,
 * ruling 100): not on a first visit, not for being hidden, and not while it is busy.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STAFF_KEY, STAFF_NAME, STAFF_OWNER } from '../src/lib/staff-session';
import {
  FILE_QUIET_MS,
  forgetBusy,
  HEALED_KEY,
  healOnce,
  holdReloads,
  isLoadFailure,
  keepUpToDate,
  newerBuildOnServer,
  reloadsMustWait,
  resetApp,
  watchForBrokenLoads,
} from '../src/lib/updates';

function server(answer: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => answer })) as unknown as typeof fetch;
}

/** A browser with one service worker registered and two caches full of saved files. */
function savedCopy(): { unregistered: () => number; cachesLeft: () => string[] } {
  const registrations = [{ unregister: vi.fn(async () => true) }];
  let names = ['workbox-precache-v2', 'images'];
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { getRegistrations: async () => registrations },
  });
  vi.stubGlobal('caches', {
    keys: async () => names,
    delete: vi.fn(async (name: string) => {
      names = names.filter((one) => one !== name);
      return true;
    }),
  });
  return {
    unregistered: () => registrations.filter((one) => one.unregister.mock.calls.length > 0).length,
    cachesLeft: () => names,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetBusy();
});

/* ------------------------------------------------------------------ ruling 100 */

/**
 * A browser with a service worker: `controlled` says whether one already had the page when it
 * opened. The server always says this build is the newest, so only a new worker taking over can
 * ask for a reload here.
 */
function browserWithWorker(controlled: boolean): { takeOver: () => void } {
  const listeners: Array<() => void> = [];
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: {
      controller: controlled ? {} : null,
      addEventListener: (name: string, listener: () => void) => {
        if (name === 'controllerchange') listeners.push(listener);
      },
      register: async () => ({ update: async () => undefined }),
      getRegistrations: async () => [],
    },
  });
  vi.stubGlobal('fetch', server({ build: __BUILD_ID__ }));
  return { takeOver: () => listeners.forEach((listener) => listener()) };
}

function show(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('a new version never reloads the page under somebody (ruling 100)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    show('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a first ever visit, when the first worker claims the page, does not reload', () => {
    const page = browserWithWorker(false);
    const reload = vi.fn();
    keepUpToDate(reload);
    page.takeOver();
    show('hidden');
    show('visible');
    expect(reload).not.toHaveBeenCalled();
  });

  it('a new version taking over just after the app opens reloads at once, unnoticed', () => {
    const page = browserWithWorker(true);
    const reload = vi.fn();
    keepUpToDate(reload);
    page.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads because the page was put away: it waits for the page to come back', () => {
    const page = browserWithWorker(true);
    const reload = vi.fn();
    keepUpToDate(reload);
    // In use for a while, so a reload now would be noticed.
    vi.advanceTimersByTime(60_000);
    page.takeOver();
    expect(reload).not.toHaveBeenCalled();

    // The camera, the file picker, Messages: all hide the page. Nothing happens.
    show('hidden');
    expect(reload).not.toHaveBeenCalled();

    show('visible');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while reloads are held, and reloads on a later return to the front', () => {
    const page = browserWithWorker(true);
    const reload = vi.fn();
    keepUpToDate(reload);
    const release = holdReloads();
    expect(reloadsMustWait()).toBe(true);

    // Just opened, when a reload would otherwise happen at once.
    page.takeOver();
    expect(reload).not.toHaveBeenCalled();

    // Away to Messages for the code and back, still held: still waiting.
    show('hidden');
    show('visible');
    expect(reload).not.toHaveBeenCalled();

    // Released: nothing at that moment, so the screen that has just finished is not pulled away.
    release();
    release();
    expect(reloadsMustWait()).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    show('hidden');
    show('visible');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for two minutes after a camera or file button is used', () => {
    const page = browserWithWorker(true);
    const reload = vi.fn();
    keepUpToDate(reload);
    const camera = document.createElement('input');
    camera.type = 'file';
    document.body.append(camera);
    camera.dispatchEvent(new Event('click', { bubbles: true }));

    page.takeOver();
    // Back from the camera with the photo: the page must still be there.
    show('hidden');
    show('visible');
    expect(reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FILE_QUIET_MS + 1000);
    show('hidden');
    show('visible');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while something typed has not been sent', () => {
    const page = browserWithWorker(true);
    const reload = vi.fn();
    keepUpToDate(reload);
    const field = document.createElement('input');
    field.type = 'tel';
    document.body.append(field);
    field.value = '07700 900123';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    // A tick is not typing, and neither is a field still holding what it started with.
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = true;
    document.body.append(tick);

    page.takeOver();
    show('hidden');
    show('visible');
    expect(reload).not.toHaveBeenCalled();

    // Sent, and the form gone from the page.
    field.remove();
    show('hidden');
    show('visible');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a heal waits too, is not marked done until it is done, and happens on a later return', async () => {
    vi.useRealTimers();
    const copy = savedCopy();
    const reload = vi.fn();
    const release = holdReloads();

    // In hand, so nobody is told the page cannot be mended; but nothing is thrown away yet.
    expect(await healOnce('build-20', reload)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(copy.unregistered()).toBe(0);
    expect(window.localStorage.getItem(HEALED_KEY)).toBeNull();

    release();
    show('hidden');
    show('visible');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(copy.unregistered()).toBe(1);
    expect(window.localStorage.getItem(HEALED_KEY)).toBe('build-20');

    // Once for each build, as ever: no loop.
    expect(await healOnce('build-20', reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('is there a newer build?', () => {
  it('names the newer build when the server has one', async () => {
    expect(await newerBuildOnServer('old', server({ build: 'new' }))).toBe('new');
  });

  it('says no when this is the newest, the file is missing, or the network is down', async () => {
    expect(await newerBuildOnServer('same', server({ build: 'same' }))).toBeNull();
    expect(await newerBuildOnServer('old', server({}, false))).toBeNull();
    expect(await newerBuildOnServer('old', server({ nothing: true }))).toBeNull();
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await newerBuildOnServer('old', offline)).toBeNull();
  });
});

describe('a file of the app that will not load (ruling 95)', () => {
  it('knows the words each browser uses for it', () => {
    expect(
      isLoadFailure(new TypeError('Failed to fetch dynamically imported module: /assets/a.js')),
    ).toBe(true);
    expect(isLoadFailure(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isLoadFailure(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isLoadFailure('Loading chunk 12 failed.')).toBe(true);
    expect(isLoadFailure({ message: 'Loading CSS chunk 3 failed' })).toBe(true);
    expect(isLoadFailure(new Error('That code was not right.'))).toBe(false);
    expect(isLoadFailure(undefined)).toBe(false);
    expect(isLoadFailure(42)).toBe(false);
  });

  it('heals once for each build: the saved copy goes and the page reloads, then never again', async () => {
    const copy = savedCopy();
    const reload = vi.fn();

    expect(await healOnce('build-7', reload)).toBe(true);
    expect(copy.unregistered()).toBe(1);
    expect(copy.cachesLeft()).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(HEALED_KEY)).toBe('build-7');

    // The same build failing again is not reloaded again: no loop.
    expect(await healOnce('build-7', reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // A newer build gets its own one chance.
    expect(await healOnce('build-8', reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('watches for a failed import, a chunk error and a rejected import, healing the first', async () => {
    const heal = vi.fn(async () => true);
    const stop = watchForBrokenLoads(heal);

    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await Promise.resolve();
    expect(heal).toHaveBeenCalledTimes(1);

    // Already healing: a second failure in the same breath does not start another.
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Failed to fetch dynamically imported module: x' }),
    );
    expect(heal).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores errors that are not about loading files', () => {
    const heal = vi.fn(async () => true);
    const stop = watchForBrokenLoads(heal);
    window.dispatchEvent(new ErrorEvent('error', { message: 'Cannot read properties of null' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('The server said no.');
    window.dispatchEvent(rejection);
    expect(heal).not.toHaveBeenCalled();

    const broken = new Event('unhandledrejection') as Event & { reason?: unknown };
    broken.reason = new TypeError('Importing a module script failed.');
    window.dispatchEvent(broken);
    expect(heal).toHaveBeenCalledTimes(1);
    stop();
  });

  it('"Reset the app" clears the saved copy and reloads, keeping every sign-in', async () => {
    const copy = savedCopy();
    const reload = vi.fn();
    window.localStorage.setItem('ozidelivery.session.token', 'shopper-token');
    window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
    window.localStorage.setItem(STAFF_KEY, 'st1.remembered');
    window.localStorage.setItem(STAFF_NAME, 'Anthony');
    window.localStorage.setItem(STAFF_OWNER, '1');
    window.sessionStorage.setItem(STAFF_KEY, 'st1.this-tab');
    window.localStorage.setItem(HEALED_KEY, 'build-7');
    window.localStorage.setItem('ozidelivery.update.forced', 'build-6');

    await resetApp(reload);

    expect(copy.unregistered()).toBe(1);
    expect(copy.cachesLeft()).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('ozidelivery.session.token')).toBe('shopper-token');
    expect(window.localStorage.getItem('ozidelivery.runner.token')).toBe('runner-token');
    expect(window.localStorage.getItem(STAFF_KEY)).toBe('st1.remembered');
    expect(window.localStorage.getItem(STAFF_NAME)).toBe('Anthony');
    expect(window.localStorage.getItem(STAFF_OWNER)).toBe('1');
    expect(window.sessionStorage.getItem(STAFF_KEY)).toBe('st1.this-tab');
    // Only the update bookkeeping goes, so a heal may run again afterwards.
    expect(window.localStorage.getItem(HEALED_KEY)).toBeNull();
    expect(window.localStorage.getItem('ozidelivery.update.forced')).toBeNull();
  });
});

/**
 * The plain script in index.html, which runs before any file of the app: the one thing that can
 * catch the first file failing. Read out of the page and run against a small pretend browser.
 */
describe('the self-healing script in index.html', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  interface PretendBrowser {
    reloads: number;
    unregistered: number;
    deleted: string[];
    rootHtml: () => string;
    fail: (tag: 'SCRIPT' | 'LINK' | 'IMG', address?: string) => void;
    tick: () => void;
  }

  const SITE = 'https://www.example.test';

  function run(build: string): PretendBrowser {
    const state: PretendBrowser = {
      reloads: 0,
      unregistered: 0,
      deleted: [],
      rootHtml: () => root.innerHTML,
      fail: () => undefined,
      tick: () => undefined,
    };
    const root = document.createElement('div');
    root.id = 'root';
    const listeners: Array<(event: { target: { tagName: string; src?: string } }) => void> = [];
    let timer: (() => void) | null = null;
    const pretend = {
      window: {
        addEventListener: (
          name: string,
          handler: (event: { target: { tagName: string; src?: string } }) => void,
        ) => {
          if (name === 'error') listeners.push(handler);
        },
        caches: {
          keys: async () => ['workbox-precache-v2'],
          delete: async (name: string) => {
            state.deleted.push(name);
            return true;
          },
        },
      },
      navigator: {
        onLine: true,
        serviceWorker: {
          getRegistrations: async () => [
            {
              unregister: async () => {
                state.unregistered += 1;
                return true;
              },
            },
          ],
        },
      },
      document: { getElementById: (id: string) => (id === 'root' ? root : root.querySelector(`#${id}`)) },
      location: {
        origin: SITE,
        href: `${SITE}/`,
        reload: () => {
          state.reloads += 1;
        },
      },
      localStorage: window.localStorage,
      setTimeout: (fn: () => void) => {
        timer = fn;
        return 1;
      },
    };
    const body = script.replace(/%BUILD_ID%/g, build).replace(/%STORE_PRODUCT_NAME%/g, 'The app');
    new Function(
      'window',
      'navigator',
      'document',
      'location',
      'localStorage',
      'setTimeout',
      'caches',
      body,
    )(
      pretend.window,
      pretend.navigator,
      pretend.document,
      pretend.location,
      pretend.localStorage,
      pretend.setTimeout,
      pretend.window.caches,
    );
    state.fail = (tag, address = `${SITE}/assets/index-abc123.js`) => {
      for (const listener of listeners) listener({ target: { tagName: tag, src: address } });
    };
    state.tick = () => timer?.();
    return state;
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it('is there, filled in by the build, before the app itself', () => {
    expect(script).toContain('%BUILD_ID%');
    expect(script).toContain('ozidelivery.heal.build');
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });

  it('throws the saved copy away and reloads when a script of the page fails, once for each build', async () => {
    const first = run('build-1');
    first.fail('IMG'); // a picture failing is not the app failing
    first.fail('SCRIPT', 'https://js.stripe.com/v3/'); // nor a file from somewhere else
    first.fail('LINK', 'https://fonts.example.test/words.css');
    await settle();
    expect(first.reloads).toBe(0);
    first.fail('SCRIPT');
    await settle();
    expect(first.unregistered).toBe(1);
    expect(first.deleted).toEqual(['workbox-precache-v2']);
    expect(first.reloads).toBe(1);
    expect(window.localStorage.getItem('ozidelivery.heal.build')).toBe('build-1');

    // The same build, broken again after its reload: no second reload, plain words instead.
    const second = run('build-1');
    second.fail('LINK');
    await settle();
    expect(second.reloads).toBe(0);
    expect(second.rootHtml()).toContain('Please close the app and open it again.');
    expect(second.rootHtml()).toContain('Reset the app');
    expect(second.rootHtml()).toContain('The app');
  });

  it('heals when nothing has been drawn after a good while, with a connection', async () => {
    const page = run('build-2');
    page.tick();
    await settle();
    expect(page.reloads).toBe(1);
  });
});
