# Replaying a conversation with Ozi in a real browser

Ruling 87 (31 October 2026). The founder said "Hello Ozi" on his own phone and was asked whether
he was blind and whether he wanted an account. Nothing in the unit tests caught it, because the
fault was in how the pieces met on a phone: the page open, the sign-in kept on the device, the
bubble's welcome and the server's idea of who was speaking. This replays those steps end to end.

What runs:

- `fake-model.mjs`: a stand-in for the model's API on port 9797. It logs every request body to
  `requests.jsonl`, so the model asked, the instructions, the tools and the words sent can all be
  read afterwards, and answers with one plain sentence that names the tier asked. A request with
  `stream: true` (as the API now sends, ruling 92) is answered as server-sent events in several
  deltas, so the sentence-by-sentence path is exercised: expect three spoken lines per answer.
- `start.sh`: starts the stand-in, the API on the in-memory store (no database, no real keys;
  `ANTHROPIC_BASE_URL` points the model client at the stand-in) and the web app's dev server.
- `stubs.js`: injected into the browser before the app loads. A phone that can hear and speak
  under the script's control: `window.__ozi.say(words)` is the person speaking, `window.__spoken`
  is everything Ozi said aloud, and the microphone counts as already allowed.
- `scenario.mjs`: makes the owner's account with the staff key, then drives a phone-sized
  browser through his steps: a new phone opening the admin page, signing in with "Remember me on
  this phone", talking on the admin page, closing and reopening on the home page, talking again,
  and a visitor who never signed in. It prints what Ozi said and what the model was asked.

- `devices.mjs`: the browsers a replay can pretend to be (ruling 95): Safari on an iPhone (the
  default), Chrome 130 on Windows at 1280 by 800 (`--device=desktop-chrome`), Chrome on a Pixel
  at 412 by 915 (`--device=android-chrome`), or any `--ua="…"` with `--viewport=WIDTHxHEIGHT`.
  The scenario also reads the version shown on the page, asks Ozi "what version is this", and
  ends a listen the way Chrome does after silence (`window.__ozi.silence()`), to see that Ozi
  listens again without a note.
- `deploy-sim.mjs`: a deployment, replayed (ruling 95). It builds the web app twice with
  different build ids, serves the first the way the host serves `dist`, opens it in the browser
  so the service worker saves a copy, then serves the second: once as a plain deployment, where
  the normal update must take over on a reload, and once with the saved copy torn (the saved
  page kept, its saved scripts gone, the state behind "it doesn't load fully"), where the page
  must heal itself: one reload, then the new build, and no loop after that. `--skip-build`
  reuses the two builds from the last run. It writes `deploy-report.txt`.

To run it, from the repository root, with the packages built (`pnpm build`):

    scripts/voice-replay/start.sh
    node scripts/voice-replay/scenario.mjs
    node scripts/voice-replay/scenario.mjs --device=desktop-chrome --out=scripts/voice-replay/report-desktop-chrome.txt
    node scripts/voice-replay/scenario.mjs --device=android-chrome --out=scripts/voice-replay/report-android-chrome.txt
    node scripts/voice-replay/deploy-sim.mjs --device=desktop-chrome

Read the report for the words Ozi spoke. Anything that mentions an account or extra help to the
owner, or a question of his that reaches the model 0 times, is a fault. It needs the Chromium
that Playwright installs, or any Chrome named in `CHROME_PATH` (a Chrome for Testing from
`npx @puppeteer/browsers install chrome` does, where Playwright's own download is not allowed
through); `playwright` itself may live outside the repository, named in `NODE_PATH`. It is not
part of the test suite because it starts three servers.

## A Shopper's conversation (ruling 99)

`node shopper.mjs` (after `bash start.sh`) plays a visitor shopping by talking: milk and bread
asked for and found in the basket, a real question answered by the model and never by the book of
ready-made answers, the conversation carrying on without Ozi's name being said again, a question
left waiting that does not swallow a new request, and an order refused kindly without an account.
It ends with `All checks passed.` or the checks that failed, and exits non-zero on a failure. The
stand-in model plays a short exchange with the tools it is given, so the tools really run.

