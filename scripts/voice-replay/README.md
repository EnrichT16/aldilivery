# Replaying a conversation with Ozi in a real browser

Ruling 87 (31 October 2026). The founder said "Hello Ozi" on his own phone and was asked whether
he was blind and whether he wanted an account. Nothing in the unit tests caught it, because the
fault was in how the pieces met on a phone: the page open, the sign-in kept on the device, the
bubble's welcome and the server's idea of who was speaking. This replays those steps end to end.

What runs:

- `fake-model.mjs`: a stand-in for the model's API on port 9797. It logs every request body to
  `requests.jsonl`, so the model asked, the instructions, the tools and the words sent can all be
  read afterwards, and answers with one plain sentence that names the tier asked.
- `start.sh`: starts the stand-in, the API on the in-memory store (no database, no real keys;
  `ANTHROPIC_BASE_URL` points the model client at the stand-in) and the web app's dev server.
- `stubs.js`: injected into the browser before the app loads. A phone that can hear and speak
  under the script's control: `window.__ozi.say(words)` is the person speaking, `window.__spoken`
  is everything Ozi said aloud, and the microphone counts as already allowed.
- `scenario.mjs`: makes the owner's account with the staff key, then drives a phone-sized
  browser through his steps: a new phone opening the admin page, signing in with "Remember me on
  this phone", talking on the admin page, closing and reopening on the home page, talking again,
  and a visitor who never signed in. It prints what Ozi said and what the model was asked.

To run it, from the repository root, with the packages built (`pnpm build`):

    scripts/voice-replay/start.sh
    node scripts/voice-replay/scenario.mjs

Read the report for the words Ozi spoke. Anything that mentions an account or extra help to the
owner, or a question of his that reaches the model 0 times, is a fault. It needs the Chromium
that Playwright installs; it is not part of the test suite because it starts three servers.
