# Ozi Delivery — Inviolable Rules

These rules are not guidance. They are the product. Every line of code in this repository
obeys them. A change that breaks one of these rules must break a test.

Where anything here conflicts with **[docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md)** (30 September
2026, version two), that document wins. Rules Two and Three were changed to match it on 30
September 2026, Rule Three was amended again on 9 October 2026 (ruling 58), 16 October 2026
(ruling 63) and 20 October 2026 (ruling 73), and Rule Two on 10 October 2026 (ruling 60); the
other eight stand as they were.

---

## The rules

**One.** A single explicit confirmation from the Shopper is required before any payment is taken.

*Amended 9 October 2026 (ruling 55): the one control that gives that confirmation reads* Send my order and pay*, so it says plainly that it means paying (Consumer Contracts Regulations 2013, regulation 14(3)). The rule itself is unchanged.*

**Two.** The Runner receives five pounds on every standard delivery, untouched, whatever the basket.

*Amended 10 October 2026 (ruling 60, Anthony's decisions): five pounds stays the pay for every standard delivery; an order whose shopping at shop prices comes to £120.00 or more, delivered whole by one Runner, pays that Runner £7.00 (`fees.largeOrderRunnerPaymentPence` and `fees.largeOrderFromPence` in config/store.json); each part of a split job (an order too big for any available Runner, split into parts of up to £60) pays its Runner £5.00 (`dispatch.splitRunnerPayPence`), shown before they say yes. On Plus and Family and Carer, whose delivery is £5.99, a £7 order makes a small loss on the delivery fee, covered by its item charges.*

*Noted 20 October 2026 (ruling 73): the five pounds, and the £7 for £120 or more delivered whole, are unchanged. Every plan's delivery now covers it (Plus and Family and Carer £6.99 up to £60, £8.99 over), and the extra delivery charge past a plan's monthly allowance goes to the business, never to or out of the Runner's pay.*

*Amended 16 October 2026 (ruling 63): the five pounds is unchanged. Pay as you go must cover it in every delivery band, and the configuration parser refuses a pay-as-you-go price that does not; a plan's delivery price may be below it (Ozi Plus and Ozi Family and Carer pay £3.99 for shopping up to £60), the Runner still receiving five pounds, the difference coming from the plan's monthly price and the item charges.*

**Three.** Delivery is priced by plan and by the size of the shop, every price covering the Runner and shown before any yes; every product carries an item charge, always included in the price shown; no single product may cost more than sixty pounds, and one order carries at most the configured most of shopping.

*Amended 16 October 2026 (ruling 63): delivery is priced in bands by the value of the shopping at shop prices, on every plan, from `fees.delivery.bands` in config/store.json. Pay as you go is £7.99 up to £30, £9.99 over £30 up to £60 and £13.50 over £60; Ozi Membership £5.99 up to £60 and £9.99 over; Ozi Plus and Ozi Family and Carer £3.99 up to £60 and £7.99 over. The item charge, the £60 product limit and the £150 order cap are unchanged.*

*Amended 9 October 2026 (ruling 58): delivery is now tiered and item charges apply. Pay as you go is £7.99 for shopping of £15 or less and £13.50 above; Ozi Membership £7.99; Ozi Plus and Ozi Family and Carer £5.99; an item charge of 50p, plus 50p for every whole £6 of shop price, on every unit; no product over £60; one order up to £150 of shopping (confirmed by Anthony on 10 October 2026, ruling 59). Every figure is in config/store.json. This replaces the Rule Three ruled on 29 September 2026, "Standard delivery is thirteen pounds fifty, flat, and one delivery carries at most sixty pounds of shopping", which itself replaced the earlier two pound net floor and its fee bands.*

*Amended 20 October 2026 (ruling 73, Anthony's decisions): new delivery bands. Pay as you go is £10.99 up to £30, £12.99 over £30 up to £60 and £14.99 over £60; Ozi Membership (and the people an organisation looks after) £7.99 up to £60 and £9.99 over; Ozi Plus and Ozi Family and Carer £6.99 up to £60 and £8.99 over. Every monthly plan has a monthly order allowance (`fees.delivery.allowance`): Membership 5 orders a calendar month, Plus 8, Family and Carer 5 for each person; the order after it carries an extra delivery charge of £5.99, then two orders without it, then the extra again. The Shopper is told before the one yes, the extra is its own line on the basket, the confirmation and the receipt, and it goes to the business, never changing the Runner's pay. Pay as you go has no allowance.*

*Foundational, 20 October 2026 (ruling 73, Anthony): the item charge, 50p plus 50p for every whole £6 of the product's shop price, on every unit and every plan, is a foundational rule. It may never be adjusted, by any plan, offer or configuration change.*

**Four.** No surge pricing, no small order fee, no minimum spend.

**Five.** A notice is sent thirty minutes before any recurring Set order fires, with a one word skip.

**Six.** No age restricted goods in version one.

*Confirmed 1 October 2026 for alcohol in particular: none is sold or carried in version one, by any service, and no identity check is ever made at a handover (docs/BUILD_PROMPT.md, rulings).*

**Seven.** Every screen meets WCAG two point two level double A.

**Eight.** Ozi Delivery shares no code, database, login or payment account with any other product.

**Nine.** Store identity, name, colours, catalogue source and legal entity are configuration, never code.

**Ten.** Ozi Delivery never stores card numbers and never holds Runner money.

---

## Where each rule is enforced

| Rule | Enforcement point |
| --- | --- |
| One | `POST /orders` refuses to create a Stripe payment intent unless `spokenConfirmationAt` has already been written to the order. `packages/api/src/routes/orders.ts`, proved in `packages/api/test/orders.test.ts`. The web confirmation screen has exactly one confirming control, reading *Send my order and pay* (ruling 55), proved in `packages/web/test/shell.test.tsx` and `packages/web/test/wiring.test.tsx`; Ozi's spoken question asks "Shall I send your order and pay now…" (`packages/web/test/voice-order.test.tsx`). |
| Two | `RUNNER_PAYMENT_PENCE` in `packages/core/src/rules.ts` is the only source of the standard figure (ruling 60: `runnerPaymentFor` in `packages/core/src/fees.ts` gives £7 for £120 or more delivered whole, and a split part pays `dispatch.splitRunnerPayPence`; `payOutOrder` refuses any other figure, proved in `packages/api/test/split.test.ts`), and the configuration parser refuses any pay-as-you-go delivery price, in any band, that would not cover it (a plan's price may be below it, the plan's monthly price making up the difference, ruling 63). The payout transfers exactly that amount per standard delivery; pooled orders each pay it in full. Extras (another shop, handing to the person, tips) are paid on top and never out of it. Proved in `packages/core/test/fees.test.ts`, `packages/core/test/config.test.ts` and `packages/api/test/jobs.test.ts`. |
| Three | `deliveryFeePence` in `packages/core/src/fees.ts` returns, from the bands in `fees.delivery.bands` in `config/store.json` (ruling 73), 1099 pay as you go up to 3000, 1299 up to 6000 and 1499 above; 799 up to 6000 and 999 above on Membership; 699 up to 6000 and 899 above on Plus and Family and Carer; `allowanceExtraPence` adds `fees.delivery.allowance.extraChargePence` (599) to the order after a plan's monthly allowance and every third order after it, counted from the Shopper's own orders by `orderNumberThisMonth` in `packages/api/src/services/plans.ts`, proved in `packages/api/test/allowance.test.ts`; and refuses a basket over `fees.maximumOrderGoodsPence` (15000) with an offer of two deliveries; `itemChargePence` adds 50p plus 50p for every whole £6 to every unit; `priceBasket` refuses a product over `fees.maximumProductPence` (6000). Proved one penny at a time in `packages/core/test/fees.test.ts` (with the worked examples: £43.98 for a Member's 6th order of £25, £17.18 for Mary's £4.69 on pay as you go); the API in `packages/api/test/basket.test.ts` and `packages/api/test/plans.test.ts`; the screens in `packages/web/test/shell.test.tsx` and `packages/web/test/pricing.test.tsx`. The plan comes from the account on the server (`deliveryPlanFor` in `packages/api/src/services/plans.ts`). The figures are configuration because the owner can change pricing; the tests pin them so a change is made on purpose. |
| Four | Delivery depends only on the goods total and the plan the Shopper chose. No time input, no demand input, no distance input, no order count input reaches `deliveryFeePence`; its signature makes surge pricing unrepresentable. The monthly order allowance (ruling 73) is separate fair use of a monthly plan: `allowanceExtraPence` reads only the plan, the Shopper's own order number this month and the configured allowance, never the time, the place or the demand. A smaller shop is never dearer to deliver, and no minimum basket value exists in `POST /basket/price`. Proved in `packages/core/test/fees.test.ts`. |
| Five | `packages/api/src/services/sets.ts` computes `noticeDueAt` as fire time minus the configured `noticeMinutesBefore` (30) and refuses to fire a Set whose notice was not sent. The skip token is one word, configured, and case insensitive. Proved in `packages/api/test/sets.test.ts`. |
| Six | `CatalogueItem.ageRestricted` is rejected at basket time in `POST /basket/price` and again at order creation. Proved in `packages/api/test/basket.test.ts`. |
| Seven | `eslint-plugin-jsx-a11y` in `eslint.config.js`, and `axe-core` run against every screen in `packages/web/test`. Any violation fails the build. Minimum control height, base font size and focus visibility are enforced in `packages/web/src/styles/index.css`. |
| Eight | This repository contains one product. `docker-compose.yml` starts a database named for this product alone, on its own port and volume. There is no shared authentication provider, no shared Stripe account, and no imported code from any other product of Anthony. Oluoma Voice, the separate voice product (docs/BUILD_PROMPT.md, Section E), is reached only through a documented interface: no shared code, database, login or payment account. |
| Nine | Everything about the store and the product lives in `config/store.json`. The store name, the product name and the legal entity each appear in that file, in documentation, and nowhere else in any source file, and the product's retired name appears nowhere in the repository, code, comments or documents, outside database migrations that have already run. The web page shown before JavaScript runs is filled in from the same file at build time, and the two rules above that name the product take the name from it too (`inviolableRules` in `packages/core/src/rules.ts`). Proved by repository scan tests in `packages/core/test/config.test.ts`. |
| Ten | `PaymentMethod` in `packages/api/prisma/schema.prisma` has a Stripe payment method identifier and last four digits, and no field capable of holding a card number. Runner money moves by Stripe Connect transfer to the Runner own connected account; Ozi Delivery never takes custody. Paying a Runner back for the shopping they bought with their own card (ruling 55) goes the same way, straight out when the till total is in, in `packages/api/src/services/reimburse.ts`, proved in `packages/api/test/reimburse.test.ts`. The Runner spending card (Stripe Issuing, 9 October 2026, docs/changes/runner-card.md) keeps the rule the same way: the gateway has no method that takes or returns a card number; the Runner sees their card only in Stripe's own frames (Issuing Elements) with a short-lived key made from a nonce, and the card spends the business's own Issuing balance, so no Runner money is held. Proved in `packages/api/test/runner-card.test.ts` and `packages/web/test/till-payment.test.tsx`. The cool bag deposit, held back until the twentieth delivery, is the one exception noted in docs/LEGAL_REVIEW.md; it is unchanged, for a ruling. |

