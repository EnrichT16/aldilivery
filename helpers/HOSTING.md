# Where to run the helpers, and what it costs

Written 7 October 2026. **Prices change.** Every figure below is what each company's own pages
said at the time of writing; check them before deciding or paying for anything. Dollar prices
are charged in dollars; pounds are a rough guide at about $1.30 to £1.

## The short answer

**Start on the Cloudflare Workers free plan, with no brain or Cloudflare's free Workers AI as
the brain.** That costs nothing a month, except a few pence for each urgent text. Grow only
when something is actually too small.

## What the helpers need

Very little. They wake when an email or a web request arrives, or when a timer fires, work for
a fraction of a second, and sleep. A busy day might be 100 emails, 288 Watchman checks (every
five minutes) and two briefings: a few thousand small jobs and a few thousand database writes.

## The places, honestly compared

### 1. Cloudflare Workers, free plan (recommended to start)

| What                            | Free allowance at the time of writing                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs (requests, timers, emails) | 100,000 a day                                                                                                                                                                              |
| Timers (cron triggers)          | 5 per account; the helpers use 3                                                                                                                                                           |
| Computer time per run           | 10 milliseconds (waiting for a website or a brain does not count)                                                                                                                          |
| Memory (D1 database)            | 5 GB stored, 5 million rows read and 100,000 written a day. Since 1 September 2026, going over a daily limit makes the database refuse work until midnight (UTC) rather than charging you. |
| Brain (Workers AI)              | 10,000 "neurons" a day, enough for a fair number of short drafts with a small model; Cloudflare's dashboard shows how much is used.                                                        |
| Receiving email (Email Routing) | Free                                                                                                                                                                                       |

- **Good:** costs nothing, nothing to look after, never needs restarting, fast everywhere.
- **Limits:** the free AI models are good at short, simple replies but not as clever as Claude;
  10 milliseconds of computer time is enough for normal emails, but a very large email may fail
  to be read (it is still forwarded to a person). The free plan cannot send email by itself:
  replies wait in the outbox for a person to send, or go through a sending service such as
  Resend (free for 3,000 emails a month, 100 a day).
- **When to grow:** the **Workers Paid plan, $5 a month** (about £4), gives 10 million runs a
  month, much more computer time and timers, and lets Workers AI go beyond the free allowance at
  $0.011 per 1,000 neurons.

### 2. DigitalOcean (or any small server)

| What                                                    | Price at the time of writing     |
| ------------------------------------------------------- | -------------------------------- |
| Smallest server (512 MB memory)                         | $4 a month                       |
| Small server (1 GB memory), comfortable for the helpers | $6 a month                       |
| Charged                                                 | by the second since January 2026 |

- **Good:** an ordinary computer you control; reads a mailbox by IMAP; Ozi Delivery already
  uses DigitalOcean.
- **Limits:** you look after it (updates, restarts, HTTPS); the memory is a file on the server,
  so it needs backups. **It cannot run a useful local AI model cheaply**: that needs about 8 GB
  of memory ($48 a month or more) and is still slow without a graphics card. Use it with no
  brain, Workers AI over the internet, or Claude.

### 3. A home Mac mini or PC running Ollama

| Machine                                 | One-off cost              | Electricity if on all day and night (about 25p a unit) | What it can run                                                                                                  |
| --------------------------------------- | ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Mac mini (Apple chip, 16 GB)            | from about £600 new       | about £1 to £2 a month                                 | 7 to 8 billion parameter models (for example `llama3.1:8b`, `qwen2.5:7b`) at a good speed. The best home choice. |
| PC without a graphics card              | what you already have     | about £5 to £10 a month                                | Small 3 billion parameter models, slowly. Fine for overnight drafts, not for quick replies.                      |
| PC with a graphics card (12 GB or more) | £300 to £600 for the card | about £10 to £25 a month, more when busy               | 8 to 14 billion parameter models, fast.                                                                          |

- **Good:** the brain is free to use as much as you like, and nothing leaves the house.
- **Limits:** if the power, the broadband or the computer goes off, so does the brain (the
  helpers carry on with taught answers and the review list). To use it from Cloudflare, reach
  it through a free **Cloudflare Tunnel**, protected with a Cloudflare Access service token
  (set `OLLAMA_ACCESS_CLIENT_ID` and `OLLAMA_ACCESS_CLIENT_SECRET`).

### 4. Claude, Anthropic's AI: through the API, or through your monthly Claude plan

These are two different things, paid for separately.

**Claude through the API** is what the helpers' `claude` brain uses. It is billed per use, by
the token (a token is about three quarters of a word), with an API key from the Anthropic
Console. Prices at the time of writing, per million tokens:

| Model                                                | Reading | Writing | A typical email draft* | 30 new drafts a day for a month |
| ---------------------------------------------------- | ------- | ------- | ---------------------- | ------------------------------- |
| Claude Opus 5.5 (the brain's default; the cleverest) | $4      | $20     | about 2 cents          | about $18                       |
| Claude Sonnet 5.5                                    | $2      | $10     | about 1 cent           | about $9                        |
| Claude Haiku 4.5                                     | $1      | $5      | about half a cent      | about $4.50                     |

\* About 2,000 tokens read (the email, the rules and the taught answers) and 600 written. Only
emails that nothing taught can answer reach the brain, so costs fall as the helpers learn. Set
a monthly spending limit in the Anthropic Console so the bill can never surprise you. To change
model, set `"model"` in the helper's brain settings.

**Your monthly Claude plan** (Pro about $20 a month; Max $100 or $200 a month for five or twenty
times more use) covers using Claude yourself: Claude.ai, the apps, and Claude Code, including
**scheduled Claude Code routines**, which run on the plan within its usage limits at no extra
cost. It does **not** cover programs calling the API: the helpers cannot use your plan as their
brain. What a routine _can_ do is the kind of work a person does on the admin page: for example,
each morning, read the review list through the admin API and suggest answers for you to approve.
That gives Claude-quality suggestions at no extra cost, within the plan's limits and Anthropic's
terms for the plan (check them). It is a good fit for the Learning helper later.

### Texts and email

| Service                              | Price at the time of writing                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Twilio texts to UK mobiles           | about $0.046 a text (about 4p), plus a small monthly fee for the number. A few urgent alerts a month cost pennies. |
| Resend (sending replies)             | free for 3,000 emails a month, 100 a day                                                                           |
| Cloudflare Email Routing (receiving) | free                                                                                                               |

## The recommended setup, step by step

**To start (about £0 a month, plus pennies for texts):**

1. Cloudflare Workers free plan, with a D1 database for memory.
2. Cloudflare Email Routing for the business address (for example hello@ the domain), sending
   each email to the Worker and forwarding a copy to a person's normal inbox.
3. Brain: none to begin with. Teach the twenty most common questions first. Then try Workers AI
   for drafts.
4. Replies: the outbox (a person sends them) until you trust the answers, then Resend.
5. Urgent texts: Twilio.

**To grow, one step at a time, only when needed:**

1. Workers Paid ($5 a month) when the free daily limits are reached, or for very large emails.
2. A Mac mini with Ollama at home, through a Cloudflare Tunnel, for a free, private brain.
3. Claude through the API, with a spending limit, for the helper whose drafts need to be best,
   for example complaints. Start with Haiku or Sonnet; Opus 5.5 is the default for quality.
4. Each new business gets its own helpers in the same configuration; customers later get their
   own Worker, so their memory and costs are separate.

## Putting it on Cloudflare

You need a Cloudflare account and the business domain on Cloudflare.

```sh
cd helpers
npm ci
npx wrangler login
npx wrangler d1 create tofadachi-helpers     # put the database_id it prints in wrangler.toml
npx wrangler secret put ADMIN_TOKEN           # a long random password
npx wrangler secret put OWNER_PHONE           # for urgent texts
npx wrangler secret put INBOX_WEBHOOK_SECRET  # only if an email service posts email in
npx wrangler secret put INBOX_FORWARD_TO      # a person's own inbox (must be verified in Email Routing)
npx wrangler secret put TWILIO_ACCOUNT_SID    # and TWILIO_AUTH_TOKEN, TWILIO_FROM, if texting by Twilio
npx wrangler deploy
```

Then, in the Cloudflare dashboard: **Email**, **Email Routing**, **Routing rules**: send the
business address to the Worker `tofadachi-helpers`. Open `https://<your worker>/admin`.

The timers in `wrangler.toml` are in UTC: 06:30 UTC is 07:30 in a British summer and 06:30 in
winter.

## Putting it on a Node server or home computer

```sh
cd helpers
npm ci && npm run build
cp .env.example .env        # fill in what you use; never commit it
node --env-file=.env dist/src/platform/node-server.js
```

Keep it running with your system's service manager (for example `pm2`, `systemd` or a
LaunchAgent on a Mac), and put HTTPS in front of it (for example a Cloudflare Tunnel). To read a
mailbox by IMAP, run `npm install imapflow` and set the `IMAP_` settings, using an app password.
