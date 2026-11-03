// A deployment, replayed in a real browser (ruling 95, 3 November 2026: on Chrome "it doesn't
// load fully; the looks and features are not complete", after about twelve releases in four
// days). Two builds of the web app are made with different build ids, A then B, and served from
// a small static server the way the host serves `dist`. A browser opens A, so its service worker
// saves a copy; then the server starts serving B, as a deployment does, and A's files are gone.
//
//   1. A plain deployment: the page is reloaded and the normal update takes over.
//   2. The torn copy: the saved page still points at A's files, but the saved files are gone
//      (the state a phone is left in when a new worker cleans the old cache under an old page,
//      or a browser keeps a stale page). The page must heal itself: one reload, then B.
//
// Run from the repository root, with the packages built. Options as scenario.mjs: --device=,
// --ua=, --viewport=; --skip-build reuses the two builds from the last run.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEVICES, launchOptions, pickDevice } from './devices.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const work = join(tmpdir(), 'ozi-deploy-sim');
const PORT = 5175;
const WEB = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const device = pickDevice(args, DEVICES['desktop-chrome']);
const outFile = (args.find((arg) => arg.startsWith('--out=')) ?? '').slice('--out='.length) || join(here, 'deploy-report.txt');

const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Two builds, A and B, each with its own build id. */
function build(stamp) {
  const dist = join(repo, 'packages', 'web', 'dist');
  const builds = {};
  for (const letter of ['a', 'b']) {
    const id = `sim-${letter}-${stamp}`;
    say(`Building ${id}…`);
    execSync('pnpm --filter @aldilivery/web build:only', {
      cwd: repo,
      stdio: 'pipe',
      env: { ...process.env, BUILD_ID: id, VITE_API_URL: '/api' },
    });
    const to = join(work, letter.toUpperCase());
    rmSync(to, { recursive: true, force: true });
    cpSync(dist, to, { recursive: true });
    builds[letter.toUpperCase()] = { id, dir: to };
  }
  writeFileSync(join(work, 'builds.json'), JSON.stringify(builds));
  return builds;
}

/** The host: `dist` as a static site, every unknown address answered with index.html. */
function serve(state) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, WEB);
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'No API in this replay.' } }));
      return;
    }
    let file = join(state.dir, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    const isFile = existsSync(file) && statSync(file).isFile();
    if (!isFile) {
      if (url.pathname.startsWith('/assets/')) {
        state.missing.push(url.pathname);
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Gone with the last release.');
        return;
      }
      file = join(state.dir, 'index.html');
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const immutable = file.includes(`${join(state.dir, 'assets')}`);
    response.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function openBrowser() {
  const browser = await chromium.launch(launchOptions());
  return browser;
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.mobile,
    hasTouch: device.mobile,
  });
  const page = await context.newPage();
  const seen = { loads: 0, errors: [], notFound: [] };
  page.on('load', () => {
    seen.loads += 1;
  });
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text().slice(0, 160));
  });
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/assets/')) seen.notFound.push(new URL(response.url()).pathname);
  });
  page.on('requestfailed', (request) => {
    seen.errors.push(`${request.url().slice(0, 100)}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  return { context, page, seen };
}

/** Chrome's own HTTP cache emptied, so the service worker's saved copy is the only copy. */
async function clearHttpCache(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.clearBrowserCache');
  await session.detach();
}

/** The build the page shows in its footer, from the version note. */
async function shownBuild(page) {
  return page.evaluate(() => {
    const note = document.querySelector('[aria-label="App version"]');
    return note ? { build: note.getAttribute('data-build'), words: note.textContent.trim(), drawn: true } : { build: null, words: document.body.innerText.trim().slice(0, 120), drawn: document.getElementById('root')?.childNodes.length > 0 };
  });
}

/** What the page's service worker and update check are doing, for the report while we wait. */
async function probe(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const state = (worker) => (worker ? `${worker.state}:${new URL(worker.scriptURL).pathname}` : '-');
    let version = null;
    try {
      version = await (await fetch(`/version.json?at=${Date.now()}`, { cache: 'no-store' })).json();
    } catch (failure) {
      version = String(failure);
    }
    return {
      installing: state(registration?.installing),
      waiting: state(registration?.waiting),
      active: state(registration?.active),
      controller: navigator.serviceWorker.controller !== null,
      serverSays: version?.build ?? version,
      forced: localStorage.getItem('ozidelivery.update.forced'),
      hidden: document.visibilityState,
    };
  }).catch((failure) => ({ gone: String(failure).slice(0, 60) }));
}

async function waitForBuild(page, wanted, ms, { probeEvery = 0 } = {}) {
  const started = Date.now();
  let last = null;
  let probedAt = 0;
  while (Date.now() - started < ms) {
    last = await shownBuild(page).catch(() => null);
    if (last?.build === wanted) return { ...last, afterMs: Date.now() - started };
    if (last?.words.includes('Please close the app')) return { ...last, afterMs: Date.now() - started };
    if (probeEvery > 0 && Date.now() - probedAt >= probeEvery) {
      probedAt = Date.now();
      say(`    at ${Date.now() - started} ms: ${JSON.stringify(await probe(page))}`);
    }
    await sleep(250);
  }
  return { ...(last ?? {}), afterMs: Date.now() - started, timedOut: true };
}

async function savedCopy(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    let files = 0;
    for (const name of names) files += (await (await caches.open(name)).keys()).length;
    return { controller: navigator.serviceWorker.controller !== null, caches: names.length, files };
  });
}

/**
 * Waits for the service worker to have saved the app. The first visit reloads itself once when
 * the worker takes control (src/lib/updates.ts), which destroys the page's context mid-call, so
 * a failed look is simply looked at again.
 */
async function waitForSavedCopy(page) {
  for (let i = 0; i < 80; i += 1) {
    const copy = await savedCopy(page).catch(() => null);
    if (copy && copy.files > 5 && copy.controller) return copy;
    await sleep(250);
  }
  return savedCopy(page).catch(() => null);
}

async function main() {
  mkdirSync(work, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const builds = args.includes('--skip-build') && existsSync(join(work, 'builds.json'))
    ? JSON.parse(readFileSync(join(work, 'builds.json'), 'utf8'))
    : build(stamp);
  say(`Builds: A=${builds.A.id}, B=${builds.B.id}`);
  say(`Browser: ${device.name}, ${device.viewport.width} by ${device.viewport.height}`);

  const state = { dir: builds.A.dir, missing: [] };
  const server = await serve(state);
  const browser = await openBrowser();

  try {
    say('\n=== 1. A plain deployment: the page open on A, the server moves to B, the page is reloaded ===');
    {
      const { context, page, seen } = await newPage(browser);
      await page.goto(`${WEB}/`, { waitUntil: 'load' });
      const copy = await waitForSavedCopy(page);
      say(`  opened A: shows ${JSON.stringify((await shownBuild(page)).words)}; saved copy: ${JSON.stringify(copy)}`);
      state.dir = builds.B.dir;
      state.missing = [];
      say('  the server now serves B. Reloading the page…');
      const before = seen.loads;
      await page.reload({ waitUntil: 'load' });
      const result = await waitForBuild(page, builds.B.id, 30000, { probeEvery: 4000 });
      say(`  after ${result.afterMs} ms the page shows ${JSON.stringify(result.words)} (build ${result.build})`);
      say(`  page loads during the update: ${seen.loads - before}; files asked for that were gone: ${state.missing.length}; browser errors: ${seen.errors.length}`);
      for (const line of seen.errors.slice(0, 5)) say(`    [browser error] ${line}`);
      // Not fresh any more, the page reloads when put away, or once untouched for ten seconds
      // after the safety net has thrown its saved copy away (src/lib/updates.ts).
      say(`  outcome: ${result.build === builds.B.id ? 'UPDATED to B by the normal update' : 'NOT UPDATED while in use: the page is waiting to reload when it is put away or left alone'}`);
      if (result.build !== builds.B.id) {
        say('  leaving the page untouched for twelve seconds more…');
        const later = await waitForBuild(page, builds.B.id, 12000);
        say(`  after another ${later.afterMs} ms the page shows ${JSON.stringify(later.words)} (build ${later.build}): ${later.build === builds.B.id ? 'UPDATED once left alone' : 'STILL NOT UPDATED'}`);
      }
      await context.close();
    }

    say('\n=== 2. The torn copy: the saved page points at files that are gone, on A, with the server on B ===');
    {
      state.dir = builds.A.dir;
      state.missing = [];
      const { context, page, seen } = await newPage(browser);
      await page.goto(`${WEB}/`, { waitUntil: 'load' });
      const copy = await waitForSavedCopy(page);
      say(`  opened A: shows ${JSON.stringify((await shownBuild(page)).words)}; saved copy: ${JSON.stringify(copy)}`);
      const healFlagBefore = await page.evaluate(() => localStorage.getItem('ozidelivery.heal.build'));
      // The deployment, and the tear: the saved page stays, its saved scripts go.
      state.dir = builds.B.dir;
      const torn = await page.evaluate(async () => {
        let removed = 0;
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            if (/\/assets\/.*\.js/.test(request.url)) {
              await cache.delete(request);
              removed += 1;
            }
          }
        }
        return removed;
      });
      // And Chrome's own HTTP cache, which would otherwise quietly hand back A's files, is emptied.
      await clearHttpCache(page);
      say(`  the server now serves B; ${torn} saved script(s) of A removed, the saved page kept, the HTTP cache emptied. Reloading…`);
      const before = seen.loads;
      const started = Date.now();
      await page.reload({ waitUntil: 'load' }).catch(() => undefined);
      const soon = await shownBuild(page).catch(() => ({ words: '(page gone)' }));
      say(`  straight after the reload: drawn=${soon.drawn}, shows ${JSON.stringify(soon.words)}`);
      const result = await waitForBuild(page, builds.B.id, 40000);
      const healFlag = await page.evaluate(() => localStorage.getItem('ozidelivery.heal.build')).catch(() => null);
      const after = await savedCopy(page).catch(() => null);
      say(`  after ${Date.now() - started} ms the page shows ${JSON.stringify(result.words)} (build ${result.build})`);
      say(`  page loads during the recovery: ${seen.loads - before} (the broken one, the healed one, and one more when B's worker takes over, is right); files asked for that were gone: ${state.missing.length} ${JSON.stringify(state.missing.slice(0, 3))}`);
      say(`  heal flag before: ${healFlagBefore}, after: ${healFlag} (the build that was healed, once); saved copy now: ${JSON.stringify(after)}`);
      for (const line of seen.errors.slice(0, 6)) say(`    [browser error] ${line}`);
      const healed = result.build === builds.B.id;
      say(`  outcome: ${healed ? 'HEALED: the broken page threw its saved copy away once and came back as B' : result.words.includes('Please close') ? 'STUCK: told to close the app, with Reset the app' : 'BROKEN: neither healed nor explained'}`);

      say('\n=== 3. No loop: B reloaded again, with its heal already spent ===');
      const loadsBefore = seen.loads;
      await page.reload({ waitUntil: 'load' });
      await sleep(3000);
      const again = await shownBuild(page);
      say(`  shows ${JSON.stringify(again.words)}; extra page loads beyond the reload asked for: ${seen.loads - loadsBefore - 1} (0 is right, or 1 when B's worker has only just taken over)`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    writeFileSync(outFile, report.join('\n'));
    say(`\nReport written to ${outFile}`);
  }
}

main().catch((failure) => {
  console.error(failure);
  process.exit(1);
});
