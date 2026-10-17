# Shops join by themselves, pay by themselves, and Ozi lists shops too (ruling 65)

Anthony's rulings of 16 and 17 October 2026, recorded as ruling 65 in docs/BUILD_PROMPT.md.

## What a shop, café, takeaway or service can now do

- **Join** from the "Shop Partner" door or /business, at `/business/join`: name, kind, address and
  postcode, opening hours, contact name, mobile (confirmed with a texted code, role `partner`),
  email, a short description, and a username and password of their own. Ozi can fill the form by
  voice, one question at a time; the email and password are typed. The account works at once, in
  the **pending** state; the page goes public once staff approve it.
- **Claim a shop Ozi listed**: the public page says "Listed by Ozi. Are you the owner? Claim this
  shop", which opens the join form with the details filled in. Claiming needs the mobile code and
  puts the shop back to pending for staff approval.
- **Pay from the dashboard**: Partner Plus (£14.99 a month, first month free, once), Spotlight
  and Spotlight Plus, through a Stripe Checkout page (`purpose: 'partner'`, no address asked,
  nothing kept). Back from Stripe the dashboard records the payment once, from a signed receipt
  and the Checkout session's id. "Ring us" remains, and staff can still record a month paid.
- **A café or takeaway** pays no monthly fee and sees its 10% commission on orders placed through
  the app, this month, on the dashboard and the PDF statement. Nothing is collected automatically.
- **A service** lists services with a price-from and a duration. A Shopper asks for a quote or
  books a call back from its page, by button or by voice; the service sees the request and the
  contact the Shopper gave, and marks it answered with a note the Shopper sees under past orders.
  No payment goes through the app for services.

## The tiers, from `extras.partners` in config/store.json

| Setting                     | Default                                        |
| --------------------------- | ---------------------------------------------- |
| `freeListingCount`          | 100 shops listed free for ever                 |
| `freeProductLimit`          | 10 products on a free listing, no photos       |
| `plusMonthlyPence`          | 1499                                           |
| `plusFirstMonthFree`        | true                                           |
| `foodCommissionBasisPoints` | 1000 (10%)                                     |
| `excludedServiceKinds`      | credit, loans, mortgages, insurance, and so on |

The old `partnerMonthlyPence` (£29.99) is gone. The Ozi blank `{partnerPlan}` now says the Partner
Plus price; `{partnerPlus}`, `{freeShops}`, `{freeProducts}` and `{foodCommission}` are new.

## Staff

People, Shops and organisations: "Add a shop" with the same fields, marked "added by staff from a
paper form" and approved at once; Approve, Pause, Resume and Remove on every shop; "Add the seed
shops". Every change is in the audit log.

## The shops Ozi lists itself

`config/shops-seed.json`: well-known local shops with public addresses and typical hours. Read at
start-up only when there are no shops at all (`seedShopsOnStartup`), and by the staff button at
any time (`seedShops`, by key, so nothing is added twice). Each is `source: 'ozi'`, approved, free,
not counted among the hundred, with no products of its own. Check the hours before launch.

## Where it lives

- Rules: `packages/core/src/partners.ts`; config: `packages/core/src/config.ts`.
- Routes: `packages/api/src/routes/business.ts` (`/partner/join/options`, `/partner/join`,
  `/partner/plan/checkout`, `/partner/plan/confirm`, `/partner/enquiries/:id/answer`,
  `/shops/:id/enquiry`, `/me/enquiries`, `/staff/partners/seed`), `packages/api/src/routes/ozi.ts`
  (which shops are on, is there a barber), `packages/api/src/routes/auth.ts` (the `partner` role).
- Seed: `packages/api/src/lib/shops-seed.ts`, `packages/api/src/data/startup-seed.ts`.
- Web: `PartnerJoin.tsx`, `PartnerDashboard.tsx`, `Shops.tsx`, `Orders.tsx`, `Staff.tsx`.
- Migration: `20261025090000_partners_join_services_and_seed`.
- Tests: `packages/api/test/partners-join.test.ts`, `packages/web/test/partner-join.test.tsx`,
  `packages/core/test/partners.test.ts`.
