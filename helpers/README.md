# Tofadachi Helpers

Helpers that do work people would otherwise do, for little or no money each month, that you can
teach, and that get better every week. Made for Anthony Ibe, Tofadachi AI and IT Solutions UK
Ltd, for any of his businesses' websites (Ozi Delivery, Tofadachi AI and IT Solutions, Tofadachi
Ride, the care agency), and to sell to customers later.

This folder is complete on its own. It lives inside the Ozi Delivery repository for now only
because a new repository could not be made yet, and it will move to its own repository,
`tofadachi-helpers`, unchanged. It shares nothing with Ozi Delivery's code.

## What works today

| Helper                                                                                        | What it does                                                                                                                                                                                                                   | Status           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| **Inbox helper**                                                                              | Receives email, sorts it (spam, complaints, orders, shops and partners, councils, jobs, general), answers common questions from what it was taught, drafts the rest for a person to approve, and texts you about urgent email. | Built and tested |
| **Watchman**                                                                                  | Checks websites and an app's health address every five minutes. Texts you after two failed checks in a row, and again when it is fixed.                                                                                        | Built and tested |
| **Briefing**                                                                                  | A short daily and weekly summary, written to be heard. Kept on the admin page with a Read aloud button, ready for Oluoma Voice, and can be texted or emailed.                                                                  | Built and tested |
| Social media poster, Community manager, Reviews, Outreach, Website caretaker, Learning helper | Planned, in that order. See [docs/AGENTS_PROPOSAL.md](docs/AGENTS_PROPOSAL.md).                                                                                                                                                | Not started      |

## How a helper answers, and how it learns

1. **Exact match.** Has someone taught this exact question (or another way of asking it)? Then
   it uses the approved answer, word for word.
2. **Keyword match.** Does the message share enough meaning words with a taught question? Never
   on one common word alone: "my delivery was damaged" does not match "what are your delivery
   times".
3. **The brain.** If the helper has one, it is given only the taught answers and rules as facts,
   and told to say UNKNOWN rather than guess.
4. **A person.** Anything still unanswered goes on the **review list**.

On the review list, a person approves the suggested answer, corrects it, or turns it down. An
approved answer is **taught**, so next time the same question is answered at step 1, for free.
The most-asked questions come first.

**Nothing public goes out without approval**, unless you switch that kind of message to **act
alone** on the admin page (for example "replies using an answer you approved before"). Complaints
and urgent emails are separate kinds, so they keep waiting for a person even when ordinary
replies go alone.

## The rules every helper keeps

- **Banned words are never stored**: swearing, slurs and anything vulgar, found however they
  are disguised (capitals, spaced letters, stars, numbers for letters, stretched letters). The
  list is `config/banned-words.json`, the same list as Ozi.
- **Card numbers, passwords, codes and bank details are never stored.** They are taken out of
  every email before anything is kept.
- **No helper ever asks for them.** Any reply that does is refused, even if a person wrote it.
- **Each helper does only what its permissions allow** (for example `send-email`, `text-owner`).
- **Secrets come only from environment settings**, never from files in this folder.
- **Everything is logged in plain English**, for example: "An email from Jane Smith about
  "Opening hours" arrived. It looks like a general question."
- **It never answers a machine**: no replies to no-reply addresses, mailing lists or out of
  office messages, so two robots can never write to each other all night.

## Brains: choose one per helper

| Brain                             | Cost                 | Set in `helpers.config.json`                                                            |
| --------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| No brain: taught answers only     | Free                 | `{ "type": "none" }`                                                                    |
| Cloudflare Workers AI             | Free daily allowance | `{ "type": "workers-ai" }`                                                              |
| Ollama on a home computer         | Free, private        | `{ "type": "ollama", "model": "llama3.1:8b" }`                                          |
| Any OpenAI-compatible service     | Varies               | `{ "type": "openai-compatible", "baseUrl": "...", "model": "...", "apiKeyEnv": "..." }` |
| Claude through the API (optional) | Per use              | `{ "type": "claude", "effort": "low" }`                                                 |

Costs and the recommended setup are in [HOSTING.md](HOSTING.md).

## Where it runs

The same code runs in three places. Only small adapters differ.

- **Cloudflare Workers** (recommended, free to start): `src/platform/worker.ts`, memory in
  Cloudflare D1, email by Cloudflare Email Routing, timers by Cloudflare cron triggers.
- **Any Node server**, such as DigitalOcean: `src/platform/node-server.ts`, memory in a JSON file.
- **A home computer or Mac mini**: the same Node server, with Ollama as a free brain.

## Try it on a computer

You need Node 20 or newer.

```sh
cd helpers
npm ci
npm test                  # the tests: engine, teaching, banned words, and each helper
npm run build
ADMIN_TOKEN=choose-a-long-password npm start
```

Then open http://localhost:8787/admin and sign in with that password. To try the Inbox helper
without real email, post one to it:

```sh
curl -X POST http://localhost:8787/hooks/email \
  -H 'x-helpers-secret: another-long-password' -H 'content-type: application/json' \
  -d '{"from":"jane@example.org","to":"hello@example.com","subject":"Opening hours","text":"When are you open?"}'
```

(Start the server with `INBOX_WEBHOOK_SECRET=another-long-password` as well.)

## Setting it up for a business

Everything is in **`helpers.config.json`**: the businesses, the helpers, which brain each
uses, its permissions, the addresses the Inbox helper looks after, the websites the Watchman
checks, and how texts and emails are sent. It never holds a secret: it names the environment
setting that does (for example `"apiKeyEnv": "ANTHROPIC_API_KEY"`). The program checks it at
start and lists any mistake in plain English. `.env.example` lists every environment setting.

To add a business, add it to `businesses` and give it its own helpers (for example an inbox
helper with its own address). Each helper has its own knowledge, review list and settings.

## The web addresses

| Address                            | Who uses it                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                           | The admin page: teach, approve, act alone, briefing, outbox, log. Screen reader first.                                                  |
| `/hooks/email`                     | An email service posting incoming email (needs `INBOX_WEBHOOK_SECRET`).                                                                 |
| `/api/ask/<helper>`                | A website's help box. Answers only from approved answers, only if switched to act alone, only from websites listed in `allowedOrigins`. |
| `/api/briefing/latest?format=text` | The latest briefing as plain text, for Oluoma Voice to speak. Needs the admin key.                                                      |
| `/health`                          | For the Watchman to watch the helpers themselves.                                                                                       |
| `/api/...`                         | Everything the admin page does (needs `ADMIN_TOKEN`).                                                                                   |

## Voices

Each helper has a `voice` setting (`{ "oluomaVoiceId": "..." }`) ready for Oluoma Voice. The
admin page's Read aloud button uses the computer's own voice until then.

## How the code is laid out

```
src/core/       the engine: teaching, matching, safety, log, configuration, timers
src/brains/     the brains, each behind the same small interface
src/storage/    memory: JSON file, Cloudflare D1, Cloudflare KV
src/senders/    sending email and texts
src/helpers/    inbox/, watchman/, briefing/, and planned/ for the next six
src/admin/      the web API and the admin page
src/platform/   Cloudflare Worker and Node server entry points
config/         the banned words
test/           the tests
docs/           the plan for every helper
```

## Moving it to its own repository

Copy this folder's contents to the root of the new `tofadachi-helpers` repository. Nothing else
is needed: it has its own `package.json`, lockfile, settings and tests.
