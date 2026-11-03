// Replays Anthony's steps in a real browser: a new phone opens the admin page, he signs in as
// the owner with "Remember me on this phone", talks to Ozi, closes and reopens the app on the
// home page, and talks again. Prints everything Ozi said and what the model was asked.
//
// The browser in hand is an option (ruling 95: Chrome, Safari and most browsers):
//   --device=iphone          Safari on an iPhone, 390 by 844 (the default)
//   --device=desktop-chrome  Chrome 130 on Windows, 1280 by 800
//   --device=android-chrome  Chrome on a Pixel, 412 by 915
//   --ua="<user agent>"      any user agent, with --viewport=WIDTHxHEIGHT
//   --out=<file>             where the report goes (report.txt here by default)
// The browser itself is Playwright's Chromium, or the Chrome named in CHROME_PATH.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEVICES, launchOptions, pickDevice } from './devices.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:5173';
const API = 'http://localhost:8080';
const STAFF_KEY = 'e2e-staff-key-0123456789';
const owner = { name: 'Anthony Ibe', username: 'anthony', password: 'a-long-password-1', passcode: '123456!' };
const stubs = readFileSync(join(here, 'stubs.js'), 'utf8');
const requestsLog = join(here, 'requests.jsonl');
const device = pickDevice(process.argv.slice(2), DEVICES.iphone);
const outFile = (process.argv.find((arg) => arg.startsWith('--out=')) ?? '').slice('--out='.length) || join(here, 'report.txt');

const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spokenSince(page, from) {
  const all = await page.evaluate(() => window.__spoken.slice());
  return all.slice(from);
}
function modelRequestsSince(count) {
  const lines = readFileSync(requestsLog, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(count).map((line) => JSON.parse(line));
}
function modelRequestCount() {
  const text = readFileSync(requestsLog, 'utf8').trim();
  return text === '' ? 0 : text.split('\n').length;
}
function describe(reqs) {
  return reqs.map((r) => {
    const sys = JSON.stringify(r.body.system ?? '');
    const last = r.body.messages?.[r.body.messages.length - 1];
    const user = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
    return `    model=${r.body.model} tools=${(r.body.tools ?? []).map((t) => t.name).join(',') || 'none'} effort=${r.body.output_config?.effort} ownerPrompt=${/owner/i.test(sys)} user="${user.replace(/\s+/g, ' ').slice(0, 220)}"`;
  });
}

async function talk(page, words, waitMs = 4000) {
  const before = (await page.evaluate(() => window.__spoken.length));
  const reqBefore = modelRequestCount();
  await page.evaluate((t) => window.__ozi.say(t), words);
  await sleep(waitMs);
  const heard = await spokenSince(page, before);
  const reqs = modelRequestsSince(reqBefore);
  say(`  >> He says: "${words}"`);
  for (const line of heard) say(`     Ozi said: "${line}"`);
  if (heard.length === 0) say('     Ozi said: (nothing)');
  say(`     model asked ${reqs.length} time(s)`);
  for (const line of describe(reqs)) say(line);
  return { heard, reqs };
}

async function openPage(context, path, { settle = 3500 } = {}) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') report.push(`     [browser error] ${m.text().slice(0, 200)}`);
  });
  const before = modelRequestCount();
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await page.mouse.click(5, 5); // the first touch, which lets a page speak
  await sleep(settle);
  const heard = await page.evaluate(() => window.__spoken.slice());
  say(`  Opened ${path}. Ozi said on its own:`);
  for (const line of heard) say(`     "${line}"`);
  if (heard.length === 0) say('     (nothing)');
  const reqs = modelRequestsSince(before);
  if (reqs.length > 0) {
    say(`     model asked ${reqs.length} time(s) on opening`);
    for (const line of describe(reqs)) say(line);
  }
  return page;
}

async function main() {
  // The owner's account, made once with the staff key.
  const made = await fetch(`${API}/staff/owner`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-staff-key': STAFF_KEY, origin: WEB },
    body: JSON.stringify(owner),
  });
  say(`Owner account: ${made.status} ${(await made.text()).slice(0, 120)}`);

  say(`Browser: ${device.name}, ${device.viewport.width} by ${device.viewport.height}`);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    permissions: ['microphone'],
  });
  await context.addInitScript(stubs);

  say('\n=== STEP 1: a brand-new phone opens the admin page ===');
  let page = await openPage(context, '/staff');
  const version = await page.evaluate(() => {
    const notes = Array.from(document.querySelectorAll('[aria-label="App version"]'));
    return notes.map((note) => note.textContent.trim());
  });
  say(`  version shown on the page: ${JSON.stringify(version)}`);
  const signInExtras = await page.evaluate(() => ({
    resetButton: Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Reset the app'),
    headingOk: document.querySelector('h1')?.textContent.trim(),
    styled: getComputedStyle(document.body).backgroundColor,
    bottomBar: document.querySelector('nav[aria-label="Main"]') !== null,
  }));
  say(`  sign-in page: ${JSON.stringify(signInExtras)}`);

  say('\n=== STEP 2: he signs in as the owner ===');
  await page.fill('#staff-username', owner.username);
  await page.fill('#staff-password', owner.password);
  await page.click('button[type="submit"]');
  await sleep(1500);
  const passcodeBox = await page.$('#staff-passcode');
  say(`  passcode asked for: ${passcodeBox !== null}`);
  if (passcodeBox) {
    const remember = await page.$('#staff-remember');
    say(`  "Remember me on this phone" shown: ${remember !== null}, ticked: ${remember ? await remember.isChecked() : 'n/a'}`);
    await page.fill('#staff-passcode', owner.passcode);
    await page.click('button[type="submit"]');
    await sleep(2500);
  }
  const stored = await page.evaluate(() => ({
    localKey: (localStorage.getItem('ozidelivery.staff.key') ?? '').slice(0, 4),
    localOwner: localStorage.getItem('ozidelivery.staff.owner'),
    sessionKey: (sessionStorage.getItem('ozidelivery.staff.key') ?? '').slice(0, 4),
    sessionOwner: sessionStorage.getItem('ozidelivery.staff.owner'),
    url: location.pathname,
  }));
  say(`  after sign-in: ${JSON.stringify(stored)}`);
  const spokenAfterSignIn = await page.evaluate(() => window.__spoken.slice());
  say(`  everything said so far on this page:`);
  for (const line of spokenAfterSignIn) say(`     "${line}"`);

  say('\n=== STEP 3: on the admin page, signed in, he talks to Ozi ===');
  await talk(page, 'Hello Ozi', 5000);
  await talk(page, 'Do I have any shop partners I need to approve?', 8000);
  await page.close();

  say('\n=== STEP 4: he closes the app and opens it again on the home page ===');
  page = await openPage(context, '/', { settle: 4000 });
  await talk(page, 'Hello Ozi', 5000);
  await talk(page, 'Good morning Ozi', 5000);
  await talk(page, 'Do you know my name?', 6000);
  await page.close();

  say('\n=== STEP 5: he opens the admin page again ===');
  page = await openPage(context, '/staff', { settle: 4000 });
  await talk(page, 'Hello Ozi', 5000);
  await talk(page, 'Do I have any shop partners I need to approve?', 8000);
  await page.close();

  say('\n=== STEP 6: a visitor on a different phone, never signed in ===');
  const visitor = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    permissions: ['microphone'],
  });
  await visitor.addInitScript(stubs);
  page = await openPage(visitor, '/', { settle: 4000 });
  await talk(page, 'yes', 4000);
  await talk(page, 'Hello Ozi, what time do you deliver?', 6000);
  await talk(page, 'Ozi, what version is this?', 4000);

  say('\n=== STEP 7: Chrome ends a listen for silence, and Ozi listens again ===');
  const listeningBefore = await page.evaluate(() => window.__ozi.listening());
  await page.evaluate(() => window.__ozi.silence());
  await sleep(1200);
  const listeningAfter = await page.evaluate(() => window.__ozi.listening());
  const noteShown = await page.evaluate(() => document.body.innerText.includes('cannot listen'));
  say(`  listening before: ${listeningBefore}, after no-speech: ${listeningAfter}, "cannot listen" shown: ${noteShown}`);
  await page.close();

  await browser.close();
  writeFileSync(outFile, report.join('\n'));
}

main().catch((failure) => {
  console.error(failure);
  process.exit(1);
});
