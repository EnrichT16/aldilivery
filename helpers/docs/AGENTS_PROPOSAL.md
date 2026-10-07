# The helpers: the plan

For Anthony, 7 October 2026. This brings the original proposal up to date with what is built.
(The first version is `docs/AGENTS_PROPOSAL.md` in the Ozi Delivery repository.)

## In one breath

One standalone helper engine, separate from Ozi Delivery, that any website can plug into. Each
helper is a **workflow**: steps that run on a timer or when something arrives, with a small,
swappable brain, and a **person approving anything public** until Anthony says that kind of
message may go alone. Every approved answer is remembered, so each helper gets better every
week. Each can have its own voice through Oluoma Voice.

## Built

| #   | Helper           | Where                   | What it does                                                                                                                                                                              |
| --- | ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Inbox helper** | `src/helpers/inbox/`    | Email in by Cloudflare Email Routing, webhook or IMAP. Sorts it, answers from what it was taught, drafts the rest for approval, texts Anthony about urgent email, never answers machines. |
| 2   | **Watchman**     | `src/helpers/watchman/` | Checks websites and health addresses every five minutes; texts after two failures in a row and when fixed.                                                                                |
| 3   | **Briefing**     | `src/helpers/briefing/` | Daily and weekly summary, written to be heard; on the admin page, for Oluoma Voice, by text or email.                                                                                     |

All three share the engine in `src/core/`: teaching, the review list, banned words, private
details taken out, permissions, act alone, and the plain English log.

## Still to build, in this order

Each is listed in `src/helpers/planned/index.ts` (shown on the admin page) and will be built
the same way as the first three: a folder in `src/helpers/`, its own permissions and kinds of
message, tests, then switched on in `helpers.config.json`. Each is finished and tested before
the next is started.

### 4. Social media poster

- **Does:** drafts posts and short video captions for Facebook, Instagram, TikTok, YouTube, X
  and LinkedIn, from what it was taught about each business and from rules (tone, hashtags,
  what never to say). A person approves on the admin page; it posts on a schedule.
- **Steps:** a post queue (draft, approved, posted) on the review list; one small adapter per
  platform behind the same interface as the email senders; a timer that posts approved items.
- **Needs from Anthony:** a business account on each platform, and each platform's developer
  approval for posting by software (Meta for Facebook and Instagram, TikTok, Google for YouTube).
  This takes days to weeks per platform. X charges for posting by software.
- **Kinds of message:** `scheduled-post`.

### 5. Community manager

- **Does:** answers comments and messages on Telegram, WhatsApp and Facebook from taught
  answers, hands hard ones to a person, and runs approved activities: quizzes, polls, "what do
  you think of this product", shop reviews, free prize draws.
- **Steps:** a webhook entrance per platform (like `/hooks/email`), the same answer pipeline as
  the Inbox helper, and an activity runner. Starts with Telegram (a free bot, ready in minutes).
- **Needs from Anthony:** a Telegram bot; WhatsApp Business through Meta (conversations the
  business starts are charged per conversation); a Facebook page.
- **Rule:** raffles where people pay to enter need a Gambling Commission licence in Great
  Britain. Free prize draws, quizzes and polls do not. The helper only runs free ones.

### 6. Reviews helper

- **Does:** after a delivery or visit, asks for a review; publishes good ones only with the
  person's permission; sends complaints to customer care (through the Inbox helper's review list).
- **Needs from Anthony:** where reviews live (Google Business Profile, Trustpilot, the website),
  and a webhook from each business when a delivery or visit is finished.

### 7. Outreach helper

- **Does:** finds local shops and organisations (care homes, councils, charities) from public
  listings and drafts a personal invitation for the partnerships staff to send. It never sends
  them itself.
- **Needs from Anthony:** the areas and kinds of organisation, and who sends the invitations.

### 8. Website caretaker (the one to sell)

- **Does:** checks a website daily (broken links, spelling, speed, out of date pages) and
  suggests fixes; makes changes only with approval and only through safe routes (a pull request
  on GitHub, or a WordPress editor account), never with full hosting passwords.
- **Steps:** builds on the Watchman's checking; adds a page reader and a "suggested change"
  review item; adapters for GitHub pull requests and the WordPress editor API.
- **Needs from Anthony:** which websites, and editor access for each.

### 9. Learning helper for Ozi

- **Does:** suggests answers for the questions on Ozi's Learning list, for staff to approve.
- **Steps:** reads the Learning list through Ozi's admin API, drafts with a brain from Ozi's
  taught phrases, and posts suggestions back for staff to approve in Ozi's own admin panel. A
  scheduled Claude Code routine on the monthly Claude plan can do this drafting at no extra
  cost, within the plan's limits (see HOSTING.md).
- **Needs from Anthony:** an admin key for Ozi's Learning list.

## Selling it to customers later

Each customer gets their own copy (their own Cloudflare Worker and database), so their
knowledge, log and costs are separate. The engine stays the same; only `helpers.config.json`
and the secrets differ. The Website caretaker and the Inbox helper are the easiest to sell.

## Rules they always keep

- Nothing public goes out without a person's approval until Anthony says a helper may act alone
  for that kind of message.
- They never see card numbers, passwords or codes, and they never ask for them.
- The same banned-words list as Ozi.
- Everything they do is written in a log that can be read back aloud.
