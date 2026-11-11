// The founder on his own phone, also signed in as a Shopper (11 November 2026). This is what
// went wrong for Anthony: after signing in to a Shopper account to try it, his words went to the
// shopping script, which asked him how many bananas. Here he signs in as the owner, a Shopper is
// signed in on the same phone, and he talks to Ozi on the home page: every answer must come from
// his own model with his desk tools, and shopping happens only when he asks for it.
// Run `bash start.sh` first.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = () => readFileSync(requestsLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
let failed = 0;
const check = (what, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  [${detail}]` : ''}`);
};
async function talk(page, words, waitMs = 6000) {
  const before = await page.evaluate(() => window.__spoken.length);
  const asked = requests().length;
  await page.evaluate((t) => window.__ozi.say(t), words);
  await sleep(waitMs);
  const heard = (await page.evaluate(() => window.__spoken.slice())).slice(before).join(' ');
  const made = requests().slice(asked);
  console.log(`\n>> He says: "${words}"\n   Ozi: "${heard.slice(0, 220)}"\n   model: ${made.map((r) => `${r.body.model} tools=${(r.body.tools ?? []).length}`).join(' | ') || '(not asked)'}`);
  return { heard, made };
}
const scripted = /banana|what would you like|shopping order|I can take a|create an account/i;
const ownTurn = (turn) =>
  turn.made.length > 0 &&
  turn.made.every((r) => /opus/.test(r.body.model) && (r.body.tools ?? []).some((t) => t.name === 'needs_you'));

await fetch(`${API}/staff/owner`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-staff-key': STAFF_KEY, origin: WEB }, body: JSON.stringify(owner) });
const made = await fetch(`${API}/shoppers`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: JSON.stringify({ displayName: 'Anthony', phone: '+447700900123', doorstepProtocol: 'Knock and wait.' }) });
const shopper = await made.json();
check('a Shopper account was made for the test', typeof shopper.token === 'string', String(made.status));

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: device.viewport, userAgent: device.userAgent, isMobile: device.mobile, hasTouch: device.mobile, permissions: ['microphone'] });
await context.addInitScript(stubs);
let page = await context.newPage();
await page.goto(`${WEB}/staff`, { waitUntil: 'networkidle' });
await page.mouse.click(5, 5);
await page.fill('#staff-username', owner.username);
await page.fill('#staff-password', owner.password);
await page.click('button[type="submit"]');
await sleep(1500);
if (await page.$('#staff-passcode')) {
  await page.fill('#staff-passcode', owner.passcode);
  await page.click('button[type="submit"]');
  await sleep(2500);
}
const heading = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
check('his dashboard says Founder and Director', heading === 'Founder and Director', heading);
// The Shopper sign-in on the same phone, as after trying the Shopper account.
await page.evaluate((token) => localStorage.setItem('ozidelivery.session.token', token), shopper.token);
await page.close();

page = await context.newPage();
await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
await page.mouse.click(5, 5);
await sleep(4000);
const signedIn = await page.evaluate(() => ({ shopper: !!localStorage.getItem('ozidelivery.session.token'), owner: localStorage.getItem('ozidelivery.staff.owner') }));
check('both are signed in on this phone', signedIn.shopper && signedIn.owner === '1', JSON.stringify(signedIn));

const hello = await talk(page, 'Hello Ozi');
check('"Hello Ozi": his own model, with his desk tools', ownTurn(hello));
check('"Hello Ozi": never the shopping script', !scripted.test(hello.heard), hello.heard.slice(0, 100));
const turn = String(hello.made[0]?.body.messages?.at(-1)?.content ?? '');
check('it is told he is the founder, and that his Shopper account is signed in', /owner and founder/.test(turn) && /His own Shopper account is signed in/.test(turn));
check('its instructions put his work first', /His work comes first/.test(JSON.stringify(hello.made[0]?.body.system ?? '')));

const runners = await talk(page, 'how many runners are waiting for my approval');
check('a question about Runners, with no name said: his own model again', ownTurn(runners) && !scripted.test(runners.heard), runners.heard.slice(0, 100));
const partners = await talk(page, 'and any shop partners?');
check('a follow-up about Shop Partners: his own model again', ownTurn(partners) && !scripted.test(partners.heard), partners.heard.slice(0, 100));

const bread = await talk(page, 'put some bread in my basket please', 8000);
check('when he asks to shop, the same assistant does it', bread.made.every((r) => /opus/.test(r.body.model)) && /in your basket/.test(bread.heard), bread.heard.slice(0, 120));
const after = await talk(page, 'thank you, what else needs me today');
const told = /His basket now:[^\n]*/.exec(String(after.made[0]?.body.messages?.at(-1)?.content ?? ''))?.[0] ?? '';
check('the bread is in his basket, and he is back to his work', /bread/i.test(told) && ownTurn(after), told.slice(0, 160));

await browser.close();
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
