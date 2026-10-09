# The Runner spending card, 19 October 2026

What was built on the branch `feat/runner-card`, in plain English, for the lead to fold into
docs/MASTER_BLUEPRINT.md, docs/BUILD_PROMPT.md (as a ruling) and docs/STILL_TO_DO.md. One
database migration: `20261019090000_runner_card`.

## Anthony's decision (9 October 2026)

Runners pay at the till with a **preloaded Ozi spending card from Stripe (Stripe Issuing)**, front
and centre. The second choice is their own card, paid back straight away (ruling 55), which stays
as the fallback. The reason: no Runner should need their own money to do a job.

## 1. How a Runner chooses

- On the Runner page (Today tab, when no job is in hand) there is a part headed **How you pay at
  the till**, with two choices, in this order: **Ozi card (recommended)** and **My own card, paid
  back straight away**. The card's name is the assistant's name from config/store.json plus
  "card".
- Choosing the card the first time opens **Set up your Ozi card**: the first line of their
  address, a second line if they have one, the town and the postcode, and a tick to accept the
  cardholder terms of Stripe and the bank that issues the card. Stripe needs a billing address for
  every cardholder; it goes to Stripe for the card and is **not kept** by us (the Runner record
  has no address field).
- The tick is kept on the Runner's account with the date and the internet address it came from,
  and is sent to Stripe with the browser's description, in the field Stripe uses for cardholder
  terms (`individual.card_issuing.user_terms_acceptance`).
- The card is then made: a virtual card in pounds, **frozen** (inactive) and limited to grocery
  shops. The Runner sees "Your Ozi card ends 1234. It is frozen until you take a job."
- **Show my card details** shows the number, expiry date and security code, each in Stripe's own
  box on the page (Stripe Issuing Elements). The way it works, following Stripe's own steps: the
  browser asks Stripe.js for a one-off nonce for that card; our server turns the nonce into a
  short-lived key for that one card (`POST /runners/me/card/key`); Stripe's boxes then fetch the
  details from Stripe directly. **The card number never passes through our server or our code**
  (Rule Ten). "Hide my card details" takes them off the screen.
- **Add it to Apple Pay or Google Pay** opens a short guide: on an iPhone, Wallet, the plus
  button, Debit or Credit Card, Enter Card Details Manually; on Android, Google Wallet, Add to
  Wallet, Payment card, enter the details yourself; and at the till, choose the Ozi card, not
  their own. It says that a one-tap "add to wallet" button comes with the store apps (Stripe's
  push provisioning needs a native app and Stripe's approval).
- They can switch back to their own card at any time with the other choice.
- The longer explanations use the existing `.extra` pattern: always read by a screen reader,
  shown on screen only with "Show words on the screen" on.

## 2. Each order

- When a Runner who chose the card **accepts a job**, the card is **loaded** for that order and
  switched on: at most the shopping estimate plus the larger of £5 or a fifth of it (the same
  `tillLimitPence` the Shopper's card is settled within), and never more than one delivery carries
  (£60, Rule Three). The Runner is told: "The job is yours. Your Ozi card is loaded with up to
  £X for this order. Tap your phone at the till."
- The job screen shows, while they are shopping, a box: "Your Ozi card is loaded with up to £X
  for this order." and, large, **Tap your phone at the till**, with (in `.extra` words) that it
  works in grocery shops only, for this order only, and that if it is declined they can pay with
  their own card and are paid back.
- If the card cannot be loaded (Stripe cannot be reached), the order is not held up: they are told
  to pay with their own card this time and are paid back as ruling 55 has it.
- **Every tap at a till is checked by us in real time.** Stripe sends
  `issuing_authorization.request` to our existing webhook and waits about two seconds. We approve
  only if all of these are true, and otherwise decline with the reason kept:
  - the card switch is on (`STRIPE_ISSUING_ENABLED`);
  - the card belongs to a Runner who has not left;
  - that Runner has an order in hand, loaded on the card, still accepted or being shopped;
  - the payment is in pounds;
  - the shop is a grocery shop (`grocery_stores_supermarkets`, `miscellaneous_food_stores`,
    `bakeries`, `dairy_products_stores`, Stripe's category names);
  - with what the card has already been approved for on this order, it is within what was loaded.
- The answer is the webhook's own response, as Stripe asks: `{ "approved": true }` or `false`,
  with the `Stripe-Version` header. The signature is checked exactly as for every other Stripe
  event, on the same route (`/webhooks/stripe`).
- `issuing_authorization.created` and `.updated` record what Stripe did (including declines Stripe
  made itself, such as a frozen card or not enough in the Issuing balance, with the reason in
  plain words), and `issuing_transaction.created` records the money that actually moved: amount,
  shop's name and time. What the card spent on the order (`cardSpentPence`) is the transactions
  once there are any, and until then what was approved and not reversed; the shop's name is kept
  too (`cardMerchant`).

## 3. The till total for a card order

- The till total is **what the card actually paid**. The Runner still types the receipt total; if
  it matches the card within 5p, the card's figure is used. If it does not match, the order goes
  on the owner's till screen ("needs a person", the reason starting "card:"), the owner is texted,
  and the Shopper's card is not settled automatically. If a transaction arrives later and no
  longer matches a till total already in, the same happens.
- When the till total goes in, or the order is delivered, cancelled or refunded, the card is
  **frozen and its limit put back to nothing**. A minute sweep also freezes any card left on with
  no order in hand.
- **No pay-back for a card order**: the business paid the shop directly. The Runner is told: "The
  shop was paid with your Ozi card, so there is nothing to pay back. Your £5.00 for the delivery
  follows when you hand the shopping over." Their £5 at delivery is unchanged (Rule Two).
- Settling the Shopper's card (ruling 52, services/till.ts) works as before, on the actual spent
  amount: less goes back, more is taken within the limit, anything larger waits for a person.
- A card that paid nothing (declined, so the Runner used their own card) is treated as an own-card
  order after all, and the Runner is paid back as ruling 55 has it.

## 4. The switch

- Everything here is active only when `STRIPE_ISSUING_ENABLED=true` (added to the server's
  settings, .env.example and .do/app.yaml, where it is the plain value "false"). While it is off,
  the Runner page shows their own card only and the line "The Ozi card is coming soon.", every
  till payment on a card is declined, and paying back works exactly as before.
- DEPLOY.md, "Switching on the Runner spending card", has Anthony's steps: Issuing switched on by
  Stripe, the four Issuing events added to the **existing** webhook, the timeout fallback set to
  decline, then the switch to true.

## 5. The owner's Money page

A new part, **Runner spending cards**: each Runner's card with its last four digits and whether
it is frozen or loaded (and whether they are paying with their own card for now); a table of the
last month's card orders with what each was loaded with, what it spent, the shop and the receipt
total (marked when it needs the owner); and the latest declines with the Runner, amount, shop and
reason.

## Database (`20261019090000_runner_card`)

- Runner: `payMethod` ("card" or "own", default "own"), `issuingCardholderId`, `issuingCardId`
  (unique), `cardLast4`, `cardStatus`, `issuingTermsAcceptedAt`, `issuingTermsAcceptedIp`.
- Order: `payMethodUsed`, `cardLimitPence`, `cardSpentPence`, `cardMerchant`.
- A new table, `CardAuthorization`: one row per Stripe authorization or transaction (keyed by
  Stripe's identifier, so a repeated webhook changes nothing), with the order, the Runner, the
  amount, approved or not, the reason, Stripe's status, the shop and the time.
- Applied to a fresh PostgreSQL 16 database after all earlier migrations, with no difference from
  the schema.

## Where it lives

- `packages/api/src/lib/payments.ts`: the Stripe Issuing calls (cardholder, virtual card, loading,
  freezing, clearing the limit, the short-lived key), real and rehearsal.
- `packages/api/src/services/runner-card.ts`: the rules (loading, the real-time decision,
  recording, the till total, freezing, the sweep).
- `packages/api/src/routes/runner-card.ts`: `GET /runners/me/card`, `POST /runners/me/pay-method`,
  `POST /runners/me/card`, `POST /runners/me/card/key`.
- `packages/api/src/routes/webhooks.ts`, `jobs.ts`, `orders.ts`, `owner.ts`: the hooks above.
- `packages/web/src/components/TillPayment.tsx`, `packages/web/src/lib/runner-card.ts`, the job box
  in `RunnerHome.tsx`, and `RunnerCards` in `Staff.tsx`.
- Tests: `packages/api/test/runner-card.test.ts`, `packages/web/test/till-payment.test.tsx`, and a
  card case in `packages/web/test/runner-home.test.tsx`.

## Choices made, for Anthony to confirm

- **No all-time limit on the card.** Stripe's all-time limit counts everything the card has ever
  spent, across every order, so it cannot be "the order amount". The card carries a
  per-payment limit of the order's load, and our real-time check keeps the running total for the
  order. The card is also frozen whenever no order is loaded.
- **The cap is £60**, the most one delivery carries, even where the estimate plus the margin
  would be more; the same cap as paying back.
- **Clearing the limit** after an order sets a per-payment limit of zero after freezing. If Stripe
  were to refuse a zero limit, the card is still frozen and our check still declines; the failure
  is only logged.
- **Grocery categories**: the four listed above. Discount and variety stores and convenience
  stores (where a supermarket's small branches are sometimes filed) are left out for now; adding
  one is a one-line change in `GROCERY_CATEGORIES`.
- **The cardholder terms link** on the set-up form points at Stripe's legal page. Stripe will give
  the exact terms for the UK programme when Issuing is switched on; the link and wording should be
  changed to those.

## Still to rule on

- Whether the Runner agreement (and its version, which asks everyone again) should say the card
  belongs to the business, may only be used for the order in hand, and that misuse is recovered
  like any other refund the Runner is found at fault for.
- Whether a card order whose receipt does not match should hold the Runner's £5 (it does not now).
- What happens when the Issuing balance runs low: today Stripe declines (reason "Not enough in
  the business's card balance"), the decline is shown on the Money page, and the Runner pays with
  their own card and is paid back. A low-balance text to the owner could follow.
