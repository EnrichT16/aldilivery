# The admin panel's missing parts, the audit log, and two-step codes for all staff

Built 9 October 2026 on the branch `feat/admin-security`, for docs/STILL_TO_DO.md items 12, 13
and 14 (Section Q of docs/BUILD_PROMPT.md, and docs/SECURITY_PROPOSAL.md). Written for Anthony,
in plain words, so the lead can fold it into the blueprint and the to-do list.

---

## 1. The admin panel's missing parts (item 12)

New tabs along the top of the admin panel. Each is checked by the server for the person's job,
exactly as the old tabs are.

| Tab | What it shows | Who sees it |
| --- | --- | --- |
| **Orders** | Live orders (still on their way) and past orders (delivered, completed, cancelled, refunded). Search by the order's reference, the Shopper's name, the Runner or the postcode district; filter by status and by the day it was made. "Open the timeline" lists everything that happened to the order, in order: started, the Shopper's yes, offered to which Runner, accepted, items not found and what the Shopper chose, till total, delivered, problems and how they were decided, the Runner paid, cancelled and why, and anything staff did to it (from the audit log). Only the postcode district shows here, never the full address. | Founder, operations manager, customer care |
| **Runners** | Who is active now (on shift or on a job, and which order), and for each Runner: jobs today, and what they earned today, this week and altogether. | Founder, operations manager, finance |
| **Reports** | Signups of Shoppers and Runners by day, week or month (the last twelve); cancellations in the last 30 days, counted by reason; refunds in the last 30 days, each with why it went out; and how fresh the prices are (seen in the last week, the last month, or longer ago, the oldest twenty, and partner shops that have not updated in 30 days). | Founder, operations manager, finance |
| **Shopper accounts** | Find a Shopper by name, username or phone number, open their whole account (details, addresses, cards by last four digits, orders, regular orders, complaints, Finds It, gift cards bought), and **export everything we hold about them as a spreadsheet file (CSV)** for a subject access request. Searching, opening and exporting are each written in the audit log. | **The owner alone** |
| **Audit log** | See section 3. | **The owner alone** |

Other changes:

- **Refunds above a threshold are the owner's alone.** Deciding a complaint with a refund of more
  than £25 is refused for anyone but the owner, with the words "A refund of more than £25.00 is
  for the owner to give." The figure is `admin.ownerOnlyRefundAbovePence` in `config/store.json`
  (2500, so £25). Small automatic refunds (£5 or less) are unchanged.
- **Money totals stay the owner's alone** (ruling 43). The refunds list shows each refund to
  staff, but the total only to the owner.
- **Why an order was cancelled** is now written on the order, at every place an order is
  cancelled: the Shopper cancelling before paying, the card refused when the order was sent, the
  card payment failing at the bank, a payment link running out, a telephone order whose link
  could not be made or texted, and staff cancelling a bank transfer that never came. Orders
  cancelled before today show "No reason was recorded."
- **New jobs' areas.** The founder, operations manager, customer care and finance have the new
  tabs listed above. No job, and not the staff key, ever has Shopper accounts, the audit log or
  the money: the owner's own account, signed in with his passcode, has them.

## 2. Spoken answers (Ozi in the admin panel)

Ozi now answers, from the actual data, with numbers, totals and patterns only, never a name
(the "spoken answers and privacy" hard rule in Section Q). The owner still hears "Yes, sir." first
and "sir" at the end.

- "How many signups this month?" (also today, yesterday, this week, last week, last month, this
  year): "This month, 12 Shoppers and 3 Runners signed up, sir."
- "What refunds went out yesterday and why?": "Yesterday, 3 refunds went out: 2 for complaints
  and 1 for the till coming to less than the estimate. £12.50 altogether, sir." The total is said
  only to the owner.
- "Read me the cancellations": the last seven days unless a period is said, by reason: "In the
  last seven days, 3 orders were cancelled. Twice, the Shopper cancelled before paying and once,
  the card payment failed at the bank, sir."
- "How many Runners are active right now?": "3 Runners are active right now: 2 on shift and 1 on
  a job."
- "Read me the orders" reads live orders one at a time, by reference, status, number of items and
  postcode district, never the Shopper's name. "Open the audit log" and "Shopper accounts" open the
  tab and say that names are not read aloud.

If the figures cannot be loaded, Ozi says it does not know yet, rather than guessing.

## 3. The audit log (item 13)

- **Every change made in the admin panel is written down**: who did it (their name and job, or
  "Founder (staff key)"), what it was (in plain words, such as "Decided a complaint"), what it was
  done to (such as the complaint or order), when, and from which internet address. A short note of
  what was sent is kept, with every password, passcode and code taken out first.
- It is done by one hook for every route, so a new admin route cannot forget to be recorded.
  Looks are not recorded, except the ones that matter in law: searching for a Shopper, opening a
  Shopper's account and exporting their data. Sign-ins are recorded, and so are refused sign-ins
  (never the password that was tried). What staff say to Ozi is not recorded.
- **Nothing in it can be changed or removed.** The server has no way to do it (the code only adds
  and reads), and the database itself refuses: a trigger in the migration stops any update,
  delete or emptying of the table, whoever asks. This was checked against PostgreSQL 16.
- **Only the owner sees it**, in the Audit log tab, newest first, searchable by a name, what was
  done, an order or an internet address, and by date.
- Still to do from docs/SECURITY_PROPOSAL.md section 3: also copying each entry to a separate
  write-only store elsewhere (such as Backblaze with object lock).

## 4. Two-step codes for every staff sign-in (item 14)

- The owner's existing two-step codes (ruling 43: an authenticator app's 6-digit code, RFC 6238)
  now work for **every** staff account. Each person sets them up in a new "Two-step codes" tab
  (the owner in My settings): add the key to an authenticator app, type the code it shows, and
  they are on.
- When they are switched on, **eight recovery codes** are shown once, each good once in place of a
  code from the app, for a lost phone. A fresh set can be made with a code from the app. They are
  stored only as hashes.
- From then on, signing in asks for the code after the password (after the passcode for the
  owner). Wrong codes count towards the five tries before the fifteen-minute wait.
- **A grace period, then a must.** Everyone has `admin.staffTwoStepGraceDays` (14) days, counted
  from the later of `admin.staffTwoStepFrom` (17 October 2026) and the day their account was made.
  For everyone who exists today, that is midnight at the start of 31 October 2026. After it,
  someone who has not set them up can sign in, but only to set them up: nothing else opens until
  they have, and then the panel opens straight away. Before then they can be switched off again
  (with the password, or the owner's passcode); after it, not.
- **A lost phone and lost recovery codes:** the founder presses "Reset two-step codes" on that
  person in the Team tab; they are signed out and set them up again at their next sign-in. The
  owner's are never reset by anybody else; he uses a recovery code.
- Family and investor accounts only look at the business, but set up two-step codes for their own
  sign-in like everyone else. The staff key has no account and so no codes of its own; it stays the server's
  key and the way the owner's account is first made, and it can still never see the money,
  Shopper accounts or the audit log.
- This settles, in code, the open question "two-step for every staff login (Section Q) against
  ruling 38" in favour of Section Q, with the grace period so nobody is locked out on the day.

## What Anthony needs to do

1. **Set up two-step codes on your own account before 31 October 2026** (My settings, Two-step
   codes), and write the eight recovery codes down somewhere safe. Ask each member of staff to do
   the same in their Two-step codes tab.
2. If £25 is the wrong figure for refunds only you may give, or 14 days the wrong grace period,
   change `admin` in `config/store.json`.
3. Deploying runs the new migration `20261017090000_admin_audit_and_two_step` (no data is changed;
   it adds two columns and the audit table with its guard).

## Files

- Server: `packages/api/src/routes/admin.ts` (new), `packages/api/src/lib/audit.ts` (new),
  `packages/api/src/lib/staff.ts`, `packages/api/src/routes/staff.ts`, `packages/api/src/app.ts`,
  the repository (`data/repository.ts`, `data/memory.ts`, `data/prisma.ts`), `domain.ts`,
  `routes/problems.ts`, and the cancellation reasons in `routes/orders.ts`, `routes/telephone.ts`,
  `routes/webhooks.ts` and `routes/payments.ts`.
- Database: `packages/api/prisma/schema.prisma` and
  `packages/api/prisma/migrations/20261017090000_admin_audit_and_two_step/migration.sql`.
- Configuration: `config/store.json` (`admin`), parsed in `packages/core/src/config.ts`.
- App: `packages/web/src/pages/StaffAdmin.tsx` (new), `packages/web/src/pages/Staff.tsx`,
  `packages/web/src/lib/api.ts`, `packages/web/src/voice/staff-voice.ts`,
  `packages/web/src/components/StaffVoice.tsx`.
- Tests: `packages/api/test/admin.test.ts`, `audit.test.ts`, `staff-two-step.test.ts` (new) and
  `staff-accounts.test.ts`; `packages/web/test/staff-admin.test.tsx` (new, with axe on every new
  screen), `staff-voice.test.tsx` and `staff-accounts.test.tsx`.
