# Ozi Delivery — Inviolable Rules

These rules are not guidance. They are the product. Every line of code in this repository
obeys them. A change that breaks one of these rules must break a test.

Where anything here conflicts with **[docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md)** (30 September
2026, version two), that document wins. Rules Two and Three were changed to match it on 30
September 2026, and Rule Three was amended again on 9 October 2026 (ruling 58); the other eight
stand as they were.

---

## The rules

**One.** A single explicit confirmation from the Shopper is required before any payment is taken.

*Amended 9 October 2026 (ruling 55): the one control that gives that confirmation reads* Send my order and pay*, so it says plainly that it means paying (Consumer Contracts Regulations 2013, regulation 14(3)). The rule itself is unchanged.*

**Two.** The Runner receives five pounds on every standard delivery, untouched, whatever the basket.

**Three.** Delivery is priced by plan and by the size of the shop, every price covering the Runner and shown before any yes; every product carries an item charge, always included in the price shown; no single product may cost more than sixty pounds, and one order carries at most the configured most of shopping.

*Amended 9 October 2026 (ruling 58): delivery is now tiered and item charges apply. Pay as you go is £7.99 for shopping of £15 or less and £13.50 above; Ozi Membership £7.99; Ozi Plus and Ozi Family and Carer £5.99; an item charge of 50p, plus 50p for every whole £6 of shop price, on every unit; no product over £60; one order up to £150 of shopping (pending Anthony's confirmation). Every figure is in config/store.json. This replaces the Rule Three ruled on 29 September 2026, "Standard delivery is thirteen pounds fifty, flat, and one delivery carries at most sixty pounds of shopping", which itself replaced the earlier two pound net floor and its fee bands.*

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
| Two | `RUNNER_PAYMENT_PENCE` in `packages/core/src/rules.ts` is the only source of the figure, and the configuration parser refuses any delivery price, on any plan, that would not cover it. The payout transfers exactly that amount per standard delivery; pooled orders each pay it in full. Extras (another shop, handing to the person, tips) are paid on top and never out of it. Proved in `packages/core/test/fees.test.ts`, `packages/core/test/config.test.ts` and `packages/api/test/jobs.test.ts`. |
| Three | `deliveryFeePence` in `packages/core/src/fees.ts` returns, from `fees.delivery` in `config/store.json`, 799 pay as you go up to `payAsYouGoSmallOrderUpToPence` (1500) and 1350 above, 799 on Membership, 599 on Plus and Family and Carer, and refuses a basket over `fees.maximumOrderGoodsPence` (15000) with an offer of two deliveries; `itemChargePence` adds 50p plus 50p for every whole £6 to every unit; `priceBasket` refuses a product over `fees.maximumProductPence` (6000). Proved one penny at a time in `packages/core/test/fees.test.ts` (with the worked examples: £80.36, £74.85, £14.18); the API in `packages/api/test/basket.test.ts` and `packages/api/test/plans.test.ts`; the screens in `packages/web/test/shell.test.tsx` and `packages/web/test/pricing.test.tsx`. The plan comes from the account on the server (`deliveryPlanFor` in `packages/api/src/services/plans.ts`). The figures are configuration because the owner can change pricing; the tests pin them so a change is made on purpose. |
| Four | Delivery depends only on the goods total and the plan the Shopper chose. No time input, no demand input, no distance input, no order count input reaches `deliveryFeePence`; its signature makes surge pricing unrepresentable. A smaller shop is never dearer to deliver, and no minimum basket value exists in `POST /basket/price`. Proved in `packages/core/test/fees.test.ts`. |
| Five | `packages/api/src/services/sets.ts` computes `noticeDueAt` as fire time minus the configured `noticeMinutesBefore` (30) and refuses to fire a Set whose notice was not sent. The skip token is one word, configured, and case insensitive. Proved in `packages/api/test/sets.test.ts`. |
| Six | `CatalogueItem.ageRestricted` is rejected at basket time in `POST /basket/price` and again at order creation. Proved in `packages/api/test/basket.test.ts`. |
| Seven | `eslint-plugin-jsx-a11y` in `eslint.config.js`, and `axe-core` run against every screen in `packages/web/test`. Any violation fails the build. Minimum control height, base font size and focus visibility are enforced in `packages/web/src/styles/index.css`. |
| Eight | This repository contains one product. `docker-compose.yml` starts a database named for this product alone, on its own port and volume. There is no shared authentication provider, no shared Stripe account, and no imported code from any other product of Anthony. Oluoma Voice, the separate voice product (docs/BUILD_PROMPT.md, Section E), is reached only through a documented interface: no shared code, database, login or payment account. |
| Nine | Everything about the store and the product lives in `config/store.json`. The store name, the product name and the legal entity each appear in that file, in documentation, and nowhere else in any source file, and the product's retired name appears nowhere in the repository, code, comments or documents, outside database migrations that have already run. The web page shown before JavaScript runs is filled in from the same file at build time, and the two rules above that name the product take the name from it too (`inviolableRules` in `packages/core/src/rules.ts`). Proved by repository scan tests in `packages/core/test/config.test.ts`. |
| Ten | `PaymentMethod` in `packages/api/prisma/schema.prisma` has a Stripe payment method identifier and last four digits, and no field capable of holding a card number. Runner money moves by Stripe Connect transfer to the Runner own connected account; Ozi Delivery never takes custody. Paying a Runner back for the shopping they bought with their own card (ruling 55) goes the same way, straight out when the till total is in, in `packages/api/src/services/reimburse.ts`, proved in `packages/api/test/reimburse.test.ts`. The Runner spending card (Stripe Issuing, 9 October 2026, docs/changes/runner-card.md) keeps the rule the same way: the gateway has no method that takes or returns a card number; the Runner sees their card only in Stripe's own frames (Issuing Elements) with a short-lived key made from a nonce, and the card spends the business's own Issuing balance, so no Runner money is held. Proved in `packages/api/test/runner-card.test.ts` and `packages/web/test/till-payment.test.tsx`. The cool bag deposit, held back until the twentieth delivery, is the one exception noted in docs/LEGAL_REVIEW.md; it is unchanged, for a ruling. |

