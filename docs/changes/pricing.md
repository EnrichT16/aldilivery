# New prices, plans and the free month, 9 October 2026 (ruling 58)

What was built for Anthony's new pricing, in plain English, matching the approved plan text
"Ozi Delivery: Prices, Plans and Benefits" (9 October 2026). Every figure is in
`config/store.json`; nothing is written into the code. One database migration:
`20261020090000_pricing_plans`.

## 1. The item charge on every product

- Every unit has a charge added to its shop price: **50p, and 50p more for every whole £6** of
  the shop price (`fees.itemCharge`: `basePence` 50, `stepPence` 50, `everyPence` 600).

  | Shop price of one product | Charge added |
  | --- | --- |
  | Under £6 | 50p |
  | £6.00 to £11.99 | £1.00 |
  | £12.00 to £17.99 | £1.50 |
  | £18.00 to £23.99 | £2.00 |
  | £24.00 and up | £2.50, and 50p more every £6 |

- Each unit counts on its own: three bananas are three charges. The same on every plan, never
  removed (`itemChargePence` and `itemChargesForLines` in `packages/core/src/fees.ts`).
- **Prices are always shown and said with the charge in** (UK rules against drip pricing): the
  catalogue, the basket, a partner shop's page, Finds It results, Ozi reading the order back,
  the telephone read-back, and the receipt. A £1.40 banana is shown as £1.90
  (`displayPricePence`; `shownPrice` in `packages/web/src/lib/money.ts`).
- The basket and the confirmation screen show the shopping with the item charges in, then the
  shop's prices and the item charges as their own lines, then delivery, then the total. The PDF
  receipt lists each product with its charge, then **Shop total**, **Item charges** and
  **Delivery** as lines.
- The orders table keeps `itemChargesPence` and `deliveryPlan` for every order.
- **The shop is paid shop prices only.** The till total, the difference settled on the
  Shopper's card (`services/till.ts`), the Runner's pay-back (`services/reimburse.ts`) and the
  Ozi card's load (`services/runner-card.ts`) all use the goods at shop prices. When the till
  total comes in, only the shopping moves: the item charges and delivery stay as agreed. The
  item charges go to the business.
- **No single product over £60** (`fees.maximumProductPence`): it is refused, by name, in plain
  words, by the server (`product_too_dear`), the basket, Ozi and the telephone line: "We can't
  bring X: no single product can cost more than £60.00."
- **The whole-order cap** is now `fees.maximumOrderGoodsPence`, **£150 of shopping at shop
  prices**, confirmed by Anthony on 10 October 2026 (ruling 59). Above it, the
  Shopper is offered two deliveries. The till limit helpers (pay-back and Ozi card) follow the
  same cap.

## 2. Delivery

| Who | Delivery | Runner | Business keeps from delivery |
| --- | --- | --- | --- |
| Pay as you go, £15.00 or less | £7.99 | £5 | £2.99 |
| Pay as you go, over £15.00 | £13.50 | £5 | £8.50 |
| Ozi Membership, and people an organisation looks after | £7.99 | £5 | £2.99 |
| Ozi Plus and Ozi Family and Carer | £5.99 | £5 | £0.99 |

- `deliveryFeePence(goods, plan, fees)` in `packages/core/src/fees.ts`. Its only inputs are the
  shop total, the plan and the configured prices: no time, place or demand (Rule Four). A
  smaller shop is never dearer, and there is still no minimum.
- The plan is decided on the server from the account (`deliveryPlanFor` in
  `packages/api/src/services/plans.ts`): a paid-up plan, or an active organisation that looks
  after the Shopper, or pay as you go. The web basket uses the same function, with the plan the
  server reports on the account, so the screen and the charge always agree.
- The configuration parser refuses any delivery price, on any plan, that does not cover the
  Runner's £5 (Rule Two).

## 3. The first month is free of membership

- Every new account (app, website, or a telephone caller's first order, which makes their
  account) has `freeMonthUntil` one month on. During it they have Membership's extras (Recipes
  and a free Ozi Finds It) and pay the **pay-as-you-go delivery**, not the member price, unless
  they choose to join.
- About **three days before** it ends (`extras.freeMonthReminderDaysBefore`), the hourly sweep
  sends one reminder by notification, or text to a mobile: the free month ends on that day,
  nothing will be taken, they can choose to join for £10 a month, and if they don't they simply
  pay as they go.
- **Nothing is ever taken without the Shopper choosing to join.** Anyone who does not join keeps
  paying as they go; nobody is refused service.
- Existing accounts were given a free month from the day they signed up, in the migration.

## 4. The plans

Restructured from ruling 37's Ozi Plus code, not duplicated (`/plans`, kept also at
`/extras/plus`; `services/plans.ts`).

- **Ozi Membership, £10 a month**: delivery £7.99; the Recipe Pass included; one free Ozi Finds
  It a month (`extras.freeFindItsPerMonth`); favourites and the usual order remembered.
- **Ozi Plus, £15 a month**: everything in Membership; delivery £5.99; **my regular Runner**:
  the Runner who last delivered to them with no problem reported is offered the job first when
  on shift and free (`regularRunnerFor` in `services/dispatch.ts`), everybody else keeping their
  place in the fair rotation; **priority at busy times**: waiting orders of Plus and Family
  Shoppers are offered to Runners first; **no adverts** (the Spotlight mention and the advert
  square are not shown); a **friendly check-in** after 14 days without an order
  (`extras.checkInAfterDays`), once per quiet spell.
- **Ozi Family and Carer, £20 a month**: everything in Plus for up to four people in different
  homes, joined with the six-letter family code. The payer (family member or carer) is told at
  each stage of every member's order (ordered, a Runner has it, on its way, delivered); sees
  every order on the plans page; can set a limit above which a member's order **waits for their
  approval before anything is taken** (approve or "not this time"); **one card pays** (a
  member's order is paid with the payer's card, and the till difference is settled on it); and a
  **weekly summary** by notification or text. Members can still order for a loved one at a saved
  address from their own phone.
- **Joining** needs two agreements, both said on the screen before anything is sent: the monthly
  price, and that it is taken each month until they cancel. The first month is taken from the
  saved card at once (the same saved-card charge the old Plus used), then **on the same date each
  month** by the hourly sweep, only while `planRenews` is on. Joining Membership during the free
  month takes nothing until the free month ends. Each payment is told to the Shopper with the
  amount, the plan, the date and the card's last four digits.
- **Cancelling** is as easy as joining: **Cancel my plan** in Settings or on the plans page, or
  saying "cancel my membership" to Ozi (one yes) or on the telephone. Nothing more is taken and
  the plan runs to the end of the month already paid for, then it is pay as you go.
- A card refused at renewal ends the plan, takes nothing, and tells the Shopper they pay as they
  go and can join again any time.
- Anybody on the old 30-day Plus keeps what they paid for: it becomes Membership (or Family and
  Carer for a family plan) for the days left, and never renews.

## 5. Organisations

- **£10 a client a month, every 51st client half price (£5)**: the sum over clients numbered 1
  to N of £5 when the number is a multiple of 51 and £10 otherwise (`organisationMonthlyPence`;
  `extras.organisations`). 120 clients: 118 × £10 + 2 × £5 = **£1,190 a month**.
- Shown on the organisation dashboard ("Your monthly plan"), said by Ozi with the spending, and
  added to the PDF statement and the spreadsheet.
- The people an organisation looks after have Membership delivery (£7.99) and the item charges.
- Invoicing or charging the organisation for it is not built (ruling 41 still needs Anthony on
  paying by invoice).

## 6. The words everywhere

- The plans page (now "Ozi plans"), Settings ("Your plan"), the basket, the confirmation screen,
  the About, How it works, Terms (plans, monthly fee, the free month, cancelling), If you look
  after someone and the Runner agreement pages, and the store listing docs.
- Ozi's phrase files use new blanks for every figure (`{smallFee}`, `{smallUpTo}`, `{fee}`,
  `{memberFee}`, `{plusFee}`, `{itemCharge}`, `{membership}`, `{plusPrice}`, `{familyPrice}`,
  `{orgClient}`, `{maximum}`, `{maximumProduct}`), never a price or the product or store name
  (Rule Nine).

## Worked examples (computed by the code)

- **John, first month, £58.36 of shopping** (1.40, 1.25, 0.95, 2.49, 2.79, 4.99, 6.50, 7.00,
  12.49, 18.50): item charges **£8.50**; pay-as-you-go delivery **£13.50**; total **£80.36**.
- **John as a Member**: £58.36 + £8.50 + £7.99 = **£74.85** (plus £10 for the month).
- **Mary, milk, bread and eggs, £4.69**: item charges **£1.50**, delivery **£7.99**: **£14.18**.
- **An organisation with 120 clients**: **£1,190 a month**.

Proved in `packages/core/test/fees.test.ts`, `packages/api/test/plans.test.ts`,
`packages/api/test/basket.test.ts`, `packages/api/test/telephone.test.ts` and
`packages/web/test/pricing.test.tsx`.

## Pending

- A reminder before any future price change (none is planned yet).
- A PDF receipt for each monthly plan payment (today it is told by notification or text).
- Charging organisations the monthly amount (shown, not billed).
- Stripe Subscriptions, if wanted instead of the saved-card monthly charge.
