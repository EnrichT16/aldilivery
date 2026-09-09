# Aldilivery — Foundation Build Plan

**Owner:** Anthony Tochukwu Ibe
**Phase:** Foundation only. No voice, speech or telephony features are built in this phase.
**Date started:** 2026-09-09

---

## 1. What Aldilivery is

Aldilivery is a voice-first grocery messenger service for the United Kingdom. A **Shopper**
orders groceries from a configured supermarket (currently Aldi). An independent **Runner**
buys those groceries at the shelf price and delivers them for one flat fee. The assistant is
named **Ozi**.

The product is designed, from the first line of code, for blind, visually impaired, disabled,
elderly and low-literacy users. Accessibility is not a later pass; it is a build gate.

This phase delivers the skeleton: the money rules, the data model, the API surface, the
allocation engine, and an accessible web shell. The microphone button exists on screen but
only announces that voice is not yet available.

---

## 2. The ten inviolable rules

The ten rules are written verbatim into `RULES.md` at the repository root. They are not
advisory. Where a rule can be expressed as a constant, a type, a database constraint or a
test, it is. The mapping from rule to enforcement point is recorded in `RULES.md` itself so
that any future change that breaks a rule breaks a test.

---

## 3. Repository shape

```
aldilivery/
  PLAN.md                    this file
  RULES.md                   the ten inviolable rules, verbatim, plus enforcement map
  BUILD_LOG.md               dated entry after every step
  README.md                  short orientation
  package.json               root workspace scripts
  pnpm-workspace.yaml        pnpm workspaces
  tsconfig.base.json         shared TypeScript settings
  eslint.config.js           flat ESLint config, including jsx-a11y for web
  docker-compose.yml         local PostgreSQL only
  .env.example               every variable, no secrets
  .gitignore
  config/
    store.json               ALL store identity and commercial configuration
  packages/
    core/                    shared, dependency-light, pure logic
    api/                     Fastify + Prisma + Stripe
    web/                     React + TypeScript + Vite + Tailwind PWA
```

Three packages, one shared `core`, wired with pnpm workspaces.

---

## 4. config/store.json — the single source of store identity

Nothing about Aldi is hard coded anywhere. The file holds:

- `productName` — currently `Aldilivery`
- `assistantName` — currently `Ozi`
- `store.displayName` — currently `Aldi`
- `store.legalEntityName` — placeholder pending incorporation
- `store.catalogueSource.mode` — `partner_feed` or `community`, currently `community`
- `brand.colours` — navy `#0B1F3A`, gold `#D4AF37`, white `#FFFFFF`
- `fees.bands` — the flat fee bands in pence
- `fees.runnerPaymentPence` — 500, the Runner share of every completed order
- `fees.minimumNetPence` — 200, the floor Aldilivery never goes below
- `payments.supportedCardRegions` — currently `["UK", "EU"]`
- `accessibility` — base font size, minimum control height
- `recurringOrders.noticeMinutesBefore` — 30, and the one-word skip token

Tailwind reads the brand colours from this file. The web shell reads the product name,
assistant name and store display name from this file. The API reads the fee bands and card
regions from this file. Swapping supermarket is a configuration edit, never a code edit.

---

## 5. packages/core — the fee engine and shared truth

Pure TypeScript, no framework, no file system access on the browser path. Exports:

1. `feeForGoodsPence(goodsPence, bands)` — pure. Returns the flat fee in pence.
   Bands as specified: goods up to 3500 gives 800; above that up to 10000 gives 900; above
   that up to 16500 gives 1000; above that, 1100.
2. `processorCostPence(totalTransactionPence)` — models the payment processor at 1.5 percent
   of the total transaction plus 20 pence, rounded up to the nearest penny. Rounding up is
   the conservative direction: it can only make our modelled net smaller, never larger.
3. `aldiliveryNetPence(goodsPence, bands)` — fee minus 500 for the Runner minus processor
   cost.
4. `priceBasket(goodsPence, bands)` — returns goods estimate, fee and total together, so the
   API and the web never compute money independently.
5. Config types and a validator, so a malformed `store.json` fails loudly at startup.

**The proving test.** For every goods total from 1 pence to 30000 pence inclusive, in steps
of one penny, `aldiliveryNetPence` must be at least 200 pence. If the bands as specified fail
that test, the band boundaries are adjusted — never the 200 pence floor — and the change is
reported in `BUILD_LOG.md` with the arithmetic.

Additional tests cover: the fee is flat inside a band, no order attracts a surcharge, the
Runner figure is exactly 500 in every band, and the pence either side of every band edge.

---

## 6. packages/api — Fastify, Prisma, Stripe

### Data model (Prisma, PostgreSQL)

| Model | Purpose |
| --- | --- |
| `Shopper` | display name, unique handle, phone, spoken code hash, preferred language, doorstep protocol text, substitution default, budget cap, deletion scheduled date for the seven day recycle bin |
| `Runner` | name, phone, vehicle type, right to work verified flag, criminal record check verified flag, Stripe connected account identifier, cool bag deposit status, completed delivery count |
| `Organisation` | name, contact, invoice terms, and many Shoppers as service users |
| `HouseholdCircle` | links Shoppers together with consent explicitly recorded |
| `CatalogueItem` | name, category, estimated price in pence, age restricted flag, source, last seen date |
| `Order` | items, goods estimate, receipt total, fee, Runner, status, substitution outcomes, doorstep protocol snapshot, spoken confirmation timestamp |
| `Set` | recurring order: items, address, payment method reference, schedule, active flag, next fire time, notice sent time |
| `PaymentMethod` | Stripe payment method identifier and last four digits only |

No card number is stored, anywhere, in any form. The `PaymentMethod` model has no field
capable of holding one.

### Routes

- `POST /auth/request-code`, `POST /auth/verify-code` — phone plus one time code
- `POST /shoppers`, `POST /runners` — registration
- `GET /catalogue/search` — search the catalogue
- `POST /basket/price` — returns goods estimate, fee and total, and **rejects any age
  restricted item at basket time**
- `POST /orders` — must record the Shopper explicit confirmation *before* the Stripe payment
  intent is created; without confirmation the route refuses
- `POST /jobs/:orderId/offer`, `POST /jobs/:orderId/accept` — Runner offer with a sixty
  second hold
- `POST /orders/:id/status` — status transitions
- `POST /orders/:id/receipt` — receipt total submission, reprices the order to the receipt
- `POST /webhooks/stripe` — signature verified Stripe webhooks
- `POST /orders/:id/payout` — Stripe Connect transfer of exactly 500 pence per completed
  order, with the cool bag deposit rule applied
- `POST /sets`, `GET /sets`, `POST /sets/:id/skip` — recurring orders and the thirty minute
  notice hook
- `POST /account/delete` — sets the recycle bin date, deletes nothing

### Cool bag deposit

1000 pence is withheld across early payouts and released after the Runner twentieth completed
delivery. The Runner still earns 500 pence per order; the deposit is a withholding against
money already earned, tracked explicitly, and never a reduction of the 500.

### Allocation

A rotating fair queue. Each job is offered to the nearest available Runner who has waited
longest since their last job. The offer is held for sixty seconds, then passes to the next
Runner. Orders within one mile of each other can be pooled into a single trip, and each
pooled order still pays the Runner 500 pence.

Aldilivery never holds Runner money: Stripe Connect transfers move the Runner 500 pence to
their own connected account.

---

## 7. packages/web — the accessible shell

React and TypeScript, Vite, Tailwind. A Progressive Web App with a web app manifest and a
service worker so it installs to a phone home screen, structured so Capacitor can wrap it for
the app stores later without a rewrite.

**Screens in this phase, shell only:**

1. **Landing** — deep navy background, one large centred gold microphone button, white text
   at a default of 20 pixels, the line *Say it, Ozi shops it, a Runner brings it*, and a
   placeholder for the telephone number. Three door buttons: Shopper, Runner, Just looking.
2. **Sign up**
3. **Catalogue browse**
4. **Basket** — the fee is shown plainly *before* confirmation
5. **Confirm** — a single large button reading **Send my order**

The microphone button is present and focusable but announces only that voice is not yet
available.

**Accessibility gates.** Every control at least 48 pixels tall. Visible focus on everything
focusable. Semantic HTML. ARIA labels that match the visible text word for word. No
information carried by colour alone. Text resizable to 200 percent without loss of content.
`eslint-plugin-jsx-a11y` in the lint config and `axe-core` run inside the component tests.
Any axe violation fails the build.

---

## 8. Local development

`docker-compose.yml` provides PostgreSQL only — no other service, and no shared database with
any other product. `.env.example` lists every variable with a safe placeholder. Real secrets
never enter the repository; `.env` is git ignored.

---

## 9. Order of work

1. `RULES.md`, `BUILD_LOG.md`, `.gitignore`, git repository init
2. Workspace scaffolding, `config/store.json`, docker compose, environment example
3. `packages/core`: fee engine plus the penny by penny proving test
4. `packages/api`: Prisma schema, then routes, then allocation, then payments
5. `packages/web`: PWA shell and the accessibility test gate
6. Full test run, lint, commits, and the closing *What Anthony Should Check* section

Every step gets a dated entry in `BUILD_LOG.md`, including any decision I made on Anthony
behalf and why.
