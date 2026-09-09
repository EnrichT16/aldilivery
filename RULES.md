# Aldilivery — Inviolable Rules

These rules are not guidance. They are the product. Every line of code in this repository
obeys them. A change that breaks one of these rules must break a test.

---

## The rules

**One.** A single explicit confirmation from the Shopper is required before any payment is taken.

**Two.** The Runner receives five pounds on every completed order, without exception.

**Three.** Aldilivery never nets below two pounds on any order after payment processing costs.

**Four.** No surge pricing, no small order fee, no minimum spend.

**Five.** A notice is sent thirty minutes before any recurring Set order fires, with a one word skip.

**Six.** No age restricted goods in version one.

**Seven.** Every screen meets WCAG two point two level double A.

**Eight.** Aldilivery shares no code, database, login or payment account with any other product.

**Nine.** Store identity, name, colours, catalogue source and legal entity are configuration, never code.

**Ten.** Aldilivery never stores card numbers and never holds Runner money.

---

## Where each rule is enforced

| Rule | Enforcement point |
| --- | --- |
| One | `POST /orders` refuses to create a Stripe payment intent unless `spokenConfirmationAt` has already been written to the order. `packages/api/src/routes/orders.ts`, proved in `packages/api/test/orders.test.ts`. The web confirmation screen has exactly one confirming control, reading *Send my order*. |
| Two | `RUNNER_PAYMENT_PENCE` in `packages/core/src/rules.ts` is the only source of the figure. The payout route transfers exactly that amount per completed order. Pooled orders each pay it in full. Proved in `packages/core/test/fees.test.ts` and `packages/api/test/payout.test.ts`. |
| Three | `aldiliveryNetPence` in `packages/core/src/fees.ts`, proved for every goods total from 1p to 30000p in `packages/core/test/fees.test.ts`. The fee bands are configuration; the 200p floor is a constant that the test asserts against and that no band edit may lower. |
| Four | The fee is a function of the goods band alone. No time input, no demand input, no distance input, no order count input reaches `feeForGoodsPence`; its signature makes surge pricing unrepresentable. No minimum basket value exists in `POST /basket/price`. Proved in `packages/core/test/fees.test.ts`. |
| Five | `packages/api/src/services/sets.ts` computes `noticeDueAt` as fire time minus the configured `noticeMinutesBefore` (30) and refuses to fire a Set whose notice was not sent. The skip token is one word, configured, and case insensitive. Proved in `packages/api/test/sets.test.ts`. |
| Six | `CatalogueItem.ageRestricted` is rejected at basket time in `POST /basket/price` and again at order creation. Proved in `packages/api/test/basket.test.ts`. |
| Seven | `eslint-plugin-jsx-a11y` in `eslint.config.js`, and `axe-core` run against every screen in `packages/web/test`. Any violation fails the build. Minimum control height, base font size and focus visibility are enforced in `packages/web/src/styles/index.css`. |
| Eight | This repository contains one product. `docker-compose.yml` starts a database named for this product alone, on its own port and volume. There is no shared authentication provider, no shared Stripe account, and no imported code from any other product of Anthony. |
| Nine | Everything about the store lives in `config/store.json`. The string *Aldi* appears in that file, in documentation, and nowhere else in any source file. Proved by a repository scan test in `packages/core/test/config.test.ts`. |
| Ten | `PaymentMethod` in `packages/api/prisma/schema.prisma` has a Stripe payment method identifier and last four digits, and no field capable of holding a card number. Runner money moves by Stripe Connect transfer to the Runner own connected account; Aldilivery never takes custody. |
