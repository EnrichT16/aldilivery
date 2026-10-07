# The AI helpers ("agentic AI"): a proposal

For Anthony, 7 October 2026. A proposal for him to decide on; nothing here is built yet.

## In one breath

Yes, they are worth having. Build them as **one standalone "helper engine"**, separate from
Ozi Delivery, that any website can plug into: Ozi Delivery, Tofadachi AI and IT Solutions,
Tofadachi Ride, the care agency website, and customers' websites later. Each helper is a
**workflow**: a set of steps, run on a timer or when something arrives (an email, a comment),
with a small AI "brain" to read and write, and a **person approving anything that goes out in
public** until it has proved itself. Like Ozi's Learning list, every answer a person approves
is remembered, so each helper gets better every week. Each can have its own voice through
Oluoma Voice.

## Build them one after another, in this order

1. **Inbox helper (email and webmail).** Reads the business inbox, sorts it (orders, complaints,
   shops, councils, spam), answers the simple, common questions from what it has been taught,
   drafts the rest for a person to send, and flags anything urgent to you. Learns from every
   reply a person approves.
2. **Watchman.** Checks the website and app every few minutes: down, slow, failed payments,
   odd sign-ins. Texts you when something is wrong.
3. **Briefing.** A short daily and weekly summary (orders, sign-ups, problems, money for you
   only), read to you aloud in an Oluoma voice.
4. **Social media poster.** Drafts posts and short videos' captions for Facebook, Instagram,
   TikTok, YouTube, X and LinkedIn; a person approves; it posts on a schedule.
5. **Community manager.** Answers comments and messages on Telegram, WhatsApp and Facebook from
   what it has been taught, hands hard ones to a person, and runs approved activities: quizzes,
   polls, "what do you think of this product", shop reviews, free prize draws.
6. **Reviews helper.** After a delivery, asks for a review; publishes good ones only with the
   person's permission; sends complaints to customer care.
7. **Outreach helper.** Finds local shops and organisations (care homes, councils, charities),
   drafts a personal invitation for the partnerships staff to send.
8. **Website caretaker.** Checks a website daily (broken links, spelling, speed, out-of-date
   pages) and suggests fixes; makes changes only with approval and only through safe routes
   (a pull request on GitHub, or a WordPress editor account), never with full hosting
   passwords. This is the one that could be sold to customers.
9. **Learning helper for Ozi.** Suggests answers for the questions on Ozi's Learning list, for
   staff to approve.

## Where it runs, and what it costs

| Option | Monthly cost | Good for | Limits |
| ------ | ------------ | -------- | ------ |
| **Cloudflare Workers** (recommended) | Free plan, at the time of writing: about 100,000 runs a day, timers included, a small free database, and a free daily allowance of its own AI models (Workers AI). About $5 a month if we outgrow it. | Helpers that wake on a timer or a message, do their work in seconds, and sleep. Nothing to look after. | Cannot run big programs all day; the free AI models are good but not as clever as Claude. |
| **Oracle Cloud "Always Free"** | Free | A full small server, for anything that must run all the time. | More setup; Oracle can reclaim a server that sits idle. |
| **DigitalOcean** | From about $4 to $6 a month | What Ozi Delivery already uses. | Not free. |

Recommendation: **Cloudflare Workers, free plan**, with Cloudflare's own free AI models as the
brains, so there is nothing to pay Anthropic or DigitalOcean. Prices change, so check
Cloudflare's pricing page before deciding.

## What each helper needs from you before it can work

- **Email:** which inbox (for example hello@ozidelivery.co.uk), and permission to read and send
  from it. Cloudflare can receive email for the domain for free; sending replies needs a
  sending service, several of which have free allowances.
- **Social media:** a business account on each platform, and each platform's own developer
  approval for posting by software (Facebook and Instagram through Meta, TikTok and YouTube
  through their developer programmes). This takes days to weeks per platform.
- **Telegram:** the simplest: a free bot, ready in minutes.
- **WhatsApp:** WhatsApp Business through Meta; conversations started by the business are
  charged per conversation.

## The brains, and what they cost (Anthony asked, 7 October 2026)

- **Claude through the API** is the cleverest, but every message is paid for, from credits.
- **Claude on Anthony's monthly plan** cannot be called by a program. But Claude Code
  *routines* (scheduled jobs, like the nightly "Ozi daily phrases" task already running) do run
  on the monthly plan, within its usage limits, at no extra cost. So the thinking-heavy jobs
  that can wait a few hours (drafting a week of posts, summarising the inbox, suggesting answers
  for review, checking websites) can be done by routines on the monthly plan.
- **Free open models** answer instantly, every minute of the day: Cloudflare's free daily AI
  allowance, or a home computer running Ollama. Good at sorting, short replies from what they
  were taught, and summaries; less clever than Claude.
- **A home computer as the server:** a Mac mini with Apple's M-series chip and 16 to 32 GB of
  memory runs good open models quietly, using little electricity; a PC with a graphics card
  (for example 12 GB or more of video memory) is faster but louder and uses more power. Either
  must stay switched on and online, and is only as reliable as the home broadband and power.
  A laptop works for trying it out, but is not built to run all day.

**Recommended start, costing little or nothing a month:**

1. The helper engine on **Cloudflare Workers' free plan**: always on, nothing to look after.
2. Its everyday brain: **Cloudflare's free AI allowance**, plus everything Anthony and the
   staff have taught it (which costs nothing and gets better every week).
3. The clever, slower jobs: **Claude Code routines on the monthly plan**.
4. Later, if the free allowance runs out or more privacy is wanted: a **Mac mini** at home or
   in the office, running Ollama, which the same engine can use without any change.

## Rules they always keep

- Nothing public goes out without a person's approval until you say a helper may act alone for
  that kind of message.
- They never see card numbers, passwords or codes, and they never ask for them.
- The same banned-words list as Ozi.
- **Raffles where people pay to enter need a licence in Great Britain** (Gambling Commission);
  free prize draws, quizzes and polls do not.
- Everything they do is written in a log you can hear read back.
