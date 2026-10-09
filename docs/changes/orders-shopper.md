# The Shopper side of orders: what was built (branch feat/orders-shopper)

Written for the lead to fold into a ruling. Plain English first; the files are named at the end
of each part. Built on 9 October 2026 from main at c80005e. One migration:
`20261016090000_orders_shopper`.

Nothing here changes a rule. Rule One holds for regular orders that send themselves (the Shopper's
own agreement and the notice they did not stop are written on the order before any money moves).
Rule Five is now carried out by the server itself. No telephone number passes between Shopper and
Runner. No card number is anywhere in our code: only Stripe's own reference and the last four
digits, as before.

## 1. The owner's till screen (STILL_TO_DO item 1)

When the till total cannot be settled on the Shopper's card by itself (a large extra, a bank
transfer order, or a refund or charge the card refused), the order is now marked as needing a
person, with the reason, and appears on the Payments tab (founder and finance officer only) under
"Till totals to settle with the Shopper". Each shows what was charged at first, what the till came
to with the delivery, the difference, the reason, and the receipt photo if there is one. The
person can:

- take the extra from the saved card, never more than the difference, so the Shopper never pays
  more than the till total;
- give the difference back to the card, never more than the difference;
- mark it settled by hand: "I sent it back by hand" (a bank transfer refund), "It was paid by
  hand", or "Let the extra go".

The Shopper is told each time in plain words, by notification or text (the existing
`tellShopperWords`). Who settled it and when is kept on the order. Paying the Runner back stays
separate, with its Approve button underneath, as ruling 55 has it.

Files: `packages/api/src/routes/till-cases.ts`, `services/till.ts` (records the case),
`packages/web/src/components/TillCases.tsx`, one line in `pages/Staff.tsx`.

## 2. Photo of the till receipt (item 2)

The Runner can take a photo of the receipt when they put in the till total ("Take a photo of the
receipt", optional but encouraged), or add it afterwards. It is kept with the order and shown,
one press, to the people on the Payments tab beside each pay-back waiting for approval and on the
till screen. Nobody else can see it: not the Shopper, not other Runners.

New rule for paying Runners back: without a photo, a pay-back above £30
(`receipts.photoNeededAbovePence` in `config/store.json`) waits for a person. If the photo arrives
afterwards, that pay-back goes at once, with no person needed. With a photo, the existing limits
of ruling 55 apply unchanged.

Files: `services/receipt-photo.ts`, `routes/receipt-photos.ts`, `services/reimburse.ts`,
`routes/orders.ts` (the receipt route takes an optional photo), `pages/RunnerHome.tsx`.

## 3. Regular orders on a clock (item 4)

The server now runs Sets itself, once a minute, in the same way as the payout sweeps:

- The notice goes about thirty-two minutes before (never later than thirty, Rule Five), by
  notification, or by text to a mobile, with the skip word.
- The one-word skip works three ways: said to Ozi ("skip"), pressed in the app ("Skip this one"
  on the weekly shop page), or texted back to the notice (the Twilio text webhook now recognises
  it).
- A Set the Shopper agreed should send itself (a new tick on the weekly shop page, with the exact
  words they agree to, and a saved card) is then placed and paid for with that card, through the
  same checks as any order: today's prices, nothing age restricted, no more than one delivery
  carries, and their own spending limit. The confirmation is written on the order (channel "set",
  with the words agreed, when, and that the notice went and was not skipped) before the card is
  charged. The card is charged with the Shopper not present, which they agreed to when they set it
  up.
- A Set without that agreement stays a reminder: the notice says nothing is sent until they say
  so, and nothing is ever paid.
- Each occurrence happens once only: the order records which occurrence it was for, and the
  database will not hold two for the same one, so a sweep that runs twice never charges twice.
- If the notice could not reach the Shopper at all (no notifications and no mobile), that
  occurrence is not sent, and nothing is taken. If a notice was missed or late, that occurrence
  is passed over and the Shopper is told; it is never sent late.
- If the card is refused, the order is cancelled and the Shopper told; nothing is taken.
- A closing account gets no more notices and no regular orders.

`/sets/notices/run` and `/sets/run` still exist but now need the staff key (they were open to
anybody before).

Not built: orders booked for one future time. The rules for those do not exist in core (only the
Set rules do), so this needs a ruling on how much notice and what skip, if any, a one-off future
order gets.

Files: `services/set-runner.ts`, `routes/sets.ts`, `routes/telephone.ts` (texted skip),
`index.ts` (the sweep), `pages/WeeklyShop.tsx`, `components/WeeklyReminder.tsx`.

## 4. Arrival time (item 6)

The order page now says "Expected in about 20 to 30 minutes, by around 2:35pm". It is worked out
afresh each time the page asks (every few seconds), from where the order has got to (finding a
Runner, going to the shop, shopping, paying, on the way) and, once the Runner is on the way and the
app knows where they are, from how far they are from the door at their travel mode's town speed.
It is always a range said with "about", and the words under it say it is a best guess, not a
promise.

Files: `services/eta.ts`, `routes/questions.ts` (`GET /orders/current`), `pages/MyOrder.tsx`.

## 5. Door safe word (item 7, T6)

When a Runner takes an order, it gets two easy everyday words, such as "blue kettle" (never a
number). The Shopper's order page shows "Tomasz will say: blue kettle", with a button to have Ozi
say it, and Ozi answers "what are the door words?" or "who's at the door?" with the Runner's first
name and the words, and that they need not open the door if the words are not said. The Runner
sees the same words on their job, with "Say them before anything else".

Files: `services/door-word.ts`, `routes/jobs.ts`, `routes/questions.ts`, `pages/MyOrder.tsx`,
`pages/RunnerHome.tsx`, `state/ozi.tsx`.

## 6. Feedback after delivery, with delivery credit (item 10)

Once the shopping has arrived, the order page asks "How did it go?": a score, a list of things to
tick (it came on time, it came late, something was missing, and so on), and their own words, any
one of which is enough. Any feedback earns delivery credit once per order, whatever it says:
£1 by default (`feedback.creditPence` in `config/store.json`, newly added). The credit goes on the
account like gift card money and comes off the next order.

Shops see patterns only: how many raised each theme and the average score, over the last three
months, and nothing at all until there are at least ten pieces of feedback. A Shop Partner can ask
for these patterns (`GET /business/feedback-patterns`; not yet shown on the partner dashboard).
Customer care (the Feedback area) sees the words, with no names.

Files: `packages/core/src/feedback.ts`, `services/feedback.ts`, `routes/order-extras.ts`,
`components/OrderFeedback.tsx`.

## 7. Closing an account, and the retention jobs (docs/LEGAL_REVIEW.md gaps 1 and 2)

- "Close my account" is now in Settings (two presses), and Ozi does it on "close my account"
  after asking once more. It waits 7 days (`accountDeletion.recycleBinDays`), with a "Keep my
  account" button until then.
- Every hour the server removes closed accounts whose 7 days are up: name, telephone number,
  addresses, doorstep words, PIN, Stripe customer reference, saved cards, devices, saved
  addresses, regular orders and organisation link go. The orders and money records stay, as the
  privacy page says, without the delivery address or doorstep words. An account with an order
  still on its way waits until it is finished.
- The same hourly job keeps the other promises on the privacy page: problem photos, voice notes
  and notes are removed two years after the problem was decided; sign-in codes after one year;
  the usage figures after three years; and orders older than seven years are made anonymous
  (address and doorstep words removed, money kept), with the receipt photo removed.
- The privacy page and the terms now say an account can be closed in Settings or by asking Ozi,
  and the privacy page mentions the receipt photo and feedback.

Not covered, for a later change: Runner check records "two years after they stop" (nothing records
a Runner stopping yet; the deposit refund on leaving is with worker C), and the Stripe customer
itself at Stripe (we drop our reference to it; Stripe keeps its own records under its own policy).
Callers' numbers are already kept only in the server's memory for the call.

Files: `services/retention.ts`, `data/erasure.ts`, the `retention` part of the repository,
`components/CloseAccount.tsx`, `pages/Settings.tsx`, `pages/Privacy.tsx`, `pages/Terms.tsx`,
`state/ozi.tsx`.

## The database (migration 20261016090000_orders_shopper)

Adds to the order: the till case (status, reason, who settled it and when), the door words, the
Set occurrence it was placed for (unique with the Set), and when it was made anonymous. Adds to
the Shopper: when the account was removed. Adds to the Set: when the Shopper agreed it sends
itself, and the words. New tables: the receipt photo (one per order) and Shopper feedback (one per
order). Nothing is dropped or renamed.

## For Anthony

- Nothing must be set for these to work. Texts need Twilio (already listed in LAUNCH.md),
  notifications need the VAPID keys; without either, a Set that sends itself is never sent,
  because its notice cannot reach anybody.
- Two new settings in `config/store.json`, each with a sensible default: `feedback.creditPence`
  (100, £1) and `receipts.photoNeededAbovePence` (3000, £30). Change them if you want.
- A ruling is needed for orders booked for one future time (see 3).
