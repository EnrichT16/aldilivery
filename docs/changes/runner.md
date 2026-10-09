# Runner work, 18 October 2026

What was built on the branch `feat/runner`, in plain English, for the lead to fold into
docs/MASTER_BLUEPRINT.md and docs/STILL_TO_DO.md. One database migration:
`20261018090000_runner_safety_and_pay`.

## 1. The SOS button (Section M)

- On the Runner's job screen, under the call button, there is a large **SOS** button. It asks
  first ("Send an SOS?", with "Yes, send SOS" and "No, I am fine"), so a pocket cannot set it off.
- When sent, the phone's location is taken and sent with it, and then followed while the SOS is
  on (at most every 15 seconds). The Runner sees "SOS is on", the words "If you are in danger, call
  999 now…", a **Call 999** button (a `tel:999` link) and "I am safe now".
- The owner's alert phone (`OWNER_ALERT_PHONE`) gets one text: the Runner's name, their Runner ID,
  their own phone number, the job's reference and area (such as ME7), and a private link. A second
  press never sends a second text.
- The private link is a plain page served by our own API (`/api/sos/<code>`), with no sign-in. The
  code is long and random and only its hash is kept. The page shows the last known place, a link to
  open it in maps, and reloads itself every 20 seconds while the SOS is on. It stops working an
  hour after the SOS is over, and after 12 hours at most (`runners.sosLinkHours`).
- Staff who look after problems see every SOS still on (and those in the last day) at the top of
  the admin panel's Problems tab, with the Runner's own number to ring, the place in maps, and a
  "Mark as over" button. If no alert phone is set up, the SOS is still there, marked so.
- Nothing is sent to the Shopper, and no Shopper's phone number or address is part of any of it.
- The privacy page now says so, in the Runners' section.

## 2. Directions to the shop and to the door

- On the job screen, "Directions to the shop" and "Directions to the door" each open the phone's
  own maps app: Apple Maps on an iPhone, Google Maps everywhere else (both are universal links, so
  they fall back to the maps website), walking, cycling or driving as the Runner travels today.
- The shop is the store named in config/store.json, found near the Runner. The door is the
  Shopper's address, which the server already gives only to the Runner who has the job, only while
  it is in hand (`GET /jobs/current`); old jobs still show the area alone. Shopping first, the shop
  link is first; once on the way, the door is first.

## 3. When a Runner's money reaches their bank (ruling 16)

- On the Money tab: "When your money reaches your bank", with **Once a week, on a Friday** (the
  default) or **Every day**. It is Stripe Connect's own payout schedule on the Runner's account,
  set through `lib/payments.ts` (`setPayoutSchedule`), and set to weekly when a Runner's Stripe
  account is first made.
- What it controls is said plainly: the £5 for each delivery, and the money paid back for the
  shopping (ruling 55), still reach the Runner's own Stripe account straight away, by transfer, as
  before (Rule Ten). The schedule is only how often Stripe sends it on to their bank.
- **Need it now?** shows what Stripe says can go instantly, Stripe's fee, and what they would get
  ("£42.50 can go to your debit card now. Stripe's fee for that is £0.50, paid by you, so you would
  get £42.00."). Nothing is sent until "Yes, send £42.00 now". If the figure changed in between,
  nothing is sent and the new figure is shown. The payout is made for the amount less the fee.
- The fee shown is from config/store.json: `runners.instantPayoutFeeBasisPoints` (100, that is 1%)
  and `runners.instantPayoutFeeMinimumPence` (50).
- The Runner agreement page now says this in its pay section (see "For Anthony" below).

## 4. The private referral reward (rulings 12 and 16)

- Only in the admin panel's Money tab, which only the owner's own account sees. Nothing in the
  app announces it.
- Who refers: Shoppers by their share link, and now Runners too: a Shopper who opens an account
  from a Runner's link (`/join?ref=R…`) is remembered as `runner:<Runner ID>`. Shop, organisation
  and staff links are business and are not counted.
- Who counts: someone referred who has paid for an order that was delivered and never refunded
  (no refund on a problem with it). Guards: nobody counts for themselves (the same account, or the
  same phone number as the referrer, Runner or Shopper); the same card (Stripe's card fingerprint)
  counts once and never when it is a card on the referrer's own account; the same delivery address
  counts once and never the referrer's own. Stripe is only asked about cards once someone is near
  100, so opening the page does not ask Stripe about everybody.
- When 100 count, "Give the reward" gives £150 (`runners.referralRewardPence`): as credit on a
  Shopper's account, or by Stripe Connect transfer to a Runner's own account (once only, by its
  reference), or recorded as paid by hand. Every reward is kept (`ReferralReward`).
- Device patterns are not checked: the service keeps nothing that identifies a phone or computer,
  and adding that would be new personal data.

## 5. The cool bag deposit when a Runner leaves (docs/LEGAL_REVIEW.md, point 3)

- A Runner can now close their Runner account themselves (More tab, "Close my Runner account",
  asked twice), and staff can remove a Runner with a reason (Documents tab, "Remove a Runner").
  Neither works in the middle of a job. Afterwards they are off shift, offered nothing, and cannot
  go back on shift. Pay for jobs already delivered is still paid, with nothing more held back.
- The deposit held is paid back at once, by Stripe Connect transfer to their own account, once
  only (`coolbag:<runner id>`). If their payout account is not ready it is owed, and the minute
  sweep sends it when it is.
- If money is still owed after a written decision (a recovery), nothing is paid or kept by the
  code. The owner is texted, and it waits in Money owed, "Cool bag deposits of Runners who have
  left", where a person keeps no more than is owed, writes down why, and the rest is paid back.
- **Still for Anthony: Rule Ten.** While the deposit is held, the service holds Runner money. This
  work shortens that time when a Runner leaves, but does not end it. The conflict between Rule Ten
  and the deposit, noted in docs/LEGAL_REVIEW.md, remains for Anthony to rule on.

## 6. Insurance reminders for Runners who drive (ruling 14)

- An hourly job texts a Runner who drives 30, 7 and 1 days before their accepted motor insurance
  runs out (`runners.insuranceReminderDays`), once each for each expiry date, to their own phone.
  Their Runner page shows the same words under "Your motor insurance", and the insurance row comes
  back in Your documents so a new certificate can be photographed.
- Once it has run out, driving jobs are paused: no job is offered to a Runner set to drive
  without in-date insurance, none can be accepted, a Runner on shift by car or motorbike is taken
  off shift and texted, and walking or cycling carries on. When a person accepts a new
  certificate, driving starts again and the reminders start over for the new date.

## 7. One-tap substitution call (Section H)

- "Cannot find it" now asks the Shopper on their screen and starts the in-app call in the same
  tap, through the existing LiveKit call flow. The answer still comes back on the screen and is
  recorded against the order line. A Runner never pays for the call.

## 8. Agreeing to the Runner agreement by voice (ruling 55)

- Beside the tick and "I agree", there is **Agree by talking to Ozi**. Ozi says the agreement in
  short (pay per delivery, being paid back for the shopping, the cool bag deposit, that nothing is
  taken automatically and the recovery rate, declining jobs, stopping at any time; every figure
  from config/store.json), then asks for a yes or a no, and asks again if it hears neither. Only a
  clear yes agrees, sent as channel "voice" with the version, which the server already records.
  "No" or "stop" agrees to nothing.

## Where the code is

- API: `services/sos.ts`, `services/payout-schedule.ts`, `services/runner-leaving.ts`,
  `services/insurance.ts`, `services/referral-reward.ts`; routes in `routes/runner-safety.ts`,
  `routes/runner-money.ts`, `routes/referral-reward.ts`; small changes to `services/dispatch.ts`,
  `services/pay-runner.ts`, `routes/jobs.ts`, `routes/accounts.ts`, `routes/payouts.ts`,
  `routes/runner-account.ts`, `lib/payments.ts` (four new gateway methods, with the rehearsal
  gateway) and `index.ts` (the hourly insurance sweep, and deposits in the minute sweep).
- Configuration: a new optional `runners` block in config/store.json, parsed in
  `packages/core/src/config.ts`, with the same figures as defaults.
- Web: `components/RunnerSos.tsx`, `JobNavigation.tsx`, `PayoutChoice.tsx`, `LeaveRunning.tsx`,
  `AgreeByVoice.tsx`, `StaffRunnerSafety.tsx`, `lib/runner-api.ts`; small changes to
  `pages/RunnerHome.tsx`, `pages/Staff.tsx` (four lines, no tab reworked), `components/CallControls.tsx`,
  `pages/Landing.tsx`, `pages/Privacy.tsx` and `pages/RunnerAgreement.tsx`.
- Tests: `packages/api/test/runner-safety.test.ts` and `packages/web/test/runner-safety.test.tsx`.

## For Anthony

- `OWNER_ALERT_PHONE` and Twilio must be set for the SOS text to go; without them the SOS shows
  only in the admin panel. `ALLOWED_ORIGIN` must be the site's address so the private link is right.
- In the Stripe dashboard (Connect, platform pricing for Instant Payouts), pass Stripe's instant
  payout fee on to connected accounts at the rate in `runners.instantPayoutFeeBasisPoints` and
  `instantPayoutFeeMinimumPence`, and check those figures against Stripe's current UK price.
  Instant payouts need a debit card on the Runner's Stripe account.
- Weekly payouts are a change to when Runners receive money (Stripe's usual default is daily). The
  agreement page's wording was updated without changing `RUNNER_AGREEMENT_VERSION`; the agreement
  promises 14 days' notice of a change to pay, so decide whether to bump the version (every Runner
  then agrees again) and when to switch existing accounts to weekly.
- The referral reward pays a Shopper as account credit; say if it should be paid another way.
- How long SOS records (with the last place shared) are kept is not yet set: add it to the
  retention list beside the others.
- Rule Ten and the cool bag deposit: still yours to rule on (see 5).
