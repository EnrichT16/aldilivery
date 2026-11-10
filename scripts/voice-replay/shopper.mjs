// A visitor shops by talking (ruling 99, 10 November 2026), in a real browser against the real
// API and web app, with the stand-in model behind them. It shows that what is said reaches the
// conversation (never the book of ready-made answers), that the conversation stays open without
// Ozi's name being said again, that things asked for land in the basket on the phone, and that
// sending an order is refused kindly without an account. Run `bash start.sh` first.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEVICES, launchOptions, pickDevice } from './devices.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:5173';
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

async function talk(page, words, waitMs = 5000) {
  const before = await page.evaluate(() => window.__spoken.length);
  const asked = requests().length;
  await page.evaluate((t) => window.__ozi.say(t), words);
  await sleep(waitMs);
  const heard = (await page.evaluate(() => window.__spoken.slice())).slice(before);
  const made = requests().slice(asked);
  console.log(`\n>> They say: "${words}"`);
  for (const line of heard) console.log(`   Ozi: "${line}"`);
  if (heard.length === 0) console.log('   Ozi: (nothing)');
  console.log(`   model asked ${made.length} time(s): ${made.map((r) => `${r.body.model} tools=${(r.body.tools ?? []).length}`).join(' | ')}`);
  return { heard: heard.join(' '), made };
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: device.viewport,
  userAgent: device.userAgent,
  isMobile: device.mobile,
  hasTouch: device.mobile,
  permissions: ['microphone'],
});
await context.addInitScript(stubs);
const page = await context.newPage();
const errors = [];
// The dev server has no service worker script and no way out to the internet: not the app's errors.
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !/unsupported MIME type|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR_/.test(text)) errors.push(text.slice(0, 200));
});
await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
await page.mouse.click(5, 5);
await sleep(3500);
console.log(`Browser: ${device.name}. Ozi said on opening:`);
for (const line of await page.evaluate(() => window.__spoken.slice())) console.log(`   "${line}"`);
await talk(page, 'yes', 4000); // the welcome's own question
const later = await talk(page, 'not now', 3500); // an account can wait
check('"not now": no phone number read out', !/zero one|phone number/i.test(later.heard), later.heard.slice(0, 100));

// A question left waiting must never swallow a new request.
await page.evaluate(() => window.__ozi.say('what is your phone number'));
await sleep(9000);

const milk = await talk(page, 'Ozi, can I have some milk please', 7000);
check('milk: the conversation was asked, with its tools', milk.made.some((r) => (r.body.tools ?? []).some((t) => t.name === 'search_shop')));
check('milk: it looked, added, and said so', /Let me have a look/.test(milk.heard) && /in your basket/.test(milk.heard), milk.heard.slice(0, 120));

const bread = await talk(page, 'and some bread', 7000);
check('bread, with no name said: still the conversation', bread.made.length >= 2 && /in your basket/.test(bread.heard), bread.heard.slice(0, 120));

const rice = await talk(page, 'which rice is better for a curry, basmati or long grain?', 6000);
check('a real question goes to the model, not the book', rice.made.length === 1 && /Stand-in conversation, the middle one/.test(rice.heard), rice.heard.slice(0, 120));
const system = JSON.stringify(rice.made[0]?.body.system ?? '');
check('its instructions ask for a real conversation', /There is no script/.test(system));
const lastTurn = String(rice.made[0]?.body.messages?.at(-1)?.content ?? '');
// The basket the phone sends with the next turn is the proof that both things went in.
const told = /Their basket now:[^\n]*/.exec(lastTurn)?.[0] ?? '';
check('both things are in the basket on the phone, as the next turn tells the model', /2 x [^;]*milk/i.test(told) && /2 x [^;]*bread/i.test(told) && /total £/.test(told), told.slice(0, 260));
check('earlier turns go back as real turns', (rice.made[0]?.body.messages ?? []).length >= 3);

const down = await talk(page, "Ozi, I'm not feeling great today", 6000);
check('"not feeling great" gets the model, never the helpline line', down.made.length === 1 && !/Samaritans/.test(down.heard), down.heard.slice(0, 100));

const send = await talk(page, "that's all, send it", 7000);
check('sending without an account: refused kindly, nothing ordered', /need an account/.test(send.heard), send.heard.slice(0, 120));

const show = await talk(page, 'open my basket', 5000);
check('"open my basket" opens the basket page', new URL(page.url()).pathname === '/basket', page.url());
const onPage = await page.evaluate(() => document.body.innerText);
check('the basket page shows them', /bread/i.test(onPage) && /milk/i.test(onPage));

check('no errors in the browser console', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
