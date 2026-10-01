# Ozi Delivery

A voice-first grocery messenger service for the United Kingdom, at
**[ozidelivery.co.uk](https://ozidelivery.co.uk)**.

The product was renamed on 28 September 2026, because Aldi announced an exclusive delivery
partnership with Deliveroo on 24 September 2026 and the earlier name is blocked at domain
registrars. That earlier name is retired and appears nowhere in this repository except inside
database migrations that have already run on the live database, which must never be edited.
The GitHub repository, the DigitalOcean app and database, and the code package names still
carry it until the coordinated rename in BUILD_LOG Step 31 is done. The governing document for
everything built from 30 September 2026 is **[docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md)**.

A **Shopper** orders groceries from a configured supermarket. An independent **Runner** buys
them at the shelf price and delivers them for one flat fee. The assistant is called **Ozi**.

Ozi Delivery is built for blind, visually impaired, disabled, elderly and low-literacy users
first. Accessibility is a build gate here, not a later pass: any axe violation fails the
build.

Owner: Anthony Tochukwu Ibe.

---

## Read these first

- **[RULES.md](RULES.md)** — the ten inviolable rules, and the exact file and test that
  enforces each one. Read this before changing anything.
- **[PLAN.md](PLAN.md)** — what this foundation phase set out to build.
- **[BUILD_LOG.md](BUILD_LOG.md)** — a dated record of every step and every decision, ending
  with *What Anthony Should Check*.
- **[DEPLOY.md](DEPLOY.md)** — how to put this on DigitalOcean, written in plain prose with
  no lists or symbols, so it reads properly aloud.
- **[docs/OLUOMA_VOICE.md](docs/OLUOMA_VOICE.md)** — the voice interface Ozi calls, written for
  the team building Oluoma Voice, the separate voice product.
- **[TESTING_WITH_PEOPLE.md](TESTING_WITH_PEOPLE.md)** — how to run a testing session with
  screen reader users and the other people Ozi Delivery is for, in the same plain prose.

**This phase has no voice, speech or telephony in it.** The microphone button exists on the
landing page and says so when pressed.

---

## Getting it running

```bash
pnpm install
pnpm run build:core     # the shared fee engine, which everything else imports
pnpm run dev:api        # http://localhost:8080
pnpm run dev:web        # http://localhost:5173
```

No database is needed to look around. With no `DATABASE_URL` set, the API runs on an
in-memory backend, seeds itself with an everyday grocery catalogue, and says so loudly in
the log. Nothing is saved when it stops, and no money can move.

For a real database:

```bash
cp .env.example .env    # then fill it in; never commit it
pnpm run db:up          # PostgreSQL in Docker, on port 5433
pnpm run db:push
pnpm run db:seed
```

## Checking it

```bash
pnpm run verify         # lint, typecheck, and every test
```

- `pnpm test` — every test across the three packages.
- `pnpm lint` — includes `eslint-plugin-jsx-a11y` in its strict configuration.
- `pnpm --filter @aldilivery/web build` — runs the axe accessibility tests and refuses to
  produce a bundle if any screen has a violation.

---

## What is where

| Path | What it is |
| --- | --- |
| `config/store.json` | Everything about the store and the product: the product name, the store name, colours, legal entity, catalogue source, delivery fee and maximum basket, card regions. Rule Nine means nothing about the supermarket is anywhere else. |
| `packages/core` | The fee engine, the rule constants, and the configuration contract. No framework, no I/O. |
| `packages/api` | Fastify, PostgreSQL through Prisma, Stripe. |
| `packages/web` | React, TypeScript, Vite, Tailwind. An installable Progressive Web App, ready for Capacitor later. |
| `docker-compose.yml` | Local PostgreSQL, and nothing else. |
| `.do/app.yaml` | The DigitalOcean App Platform spec: the `api` service, the `web` static site, and the `aldilivery-db` database. |

## Deploying

`.do/app.yaml` describes the whole app: an `api` service on port 8080 with a `/health`
check, a `web` static site built to `packages/web/dist`, and a managed PostgreSQL database.
DigitalOcean reads it straight out of the repository. The four values that cannot live here
— the two Stripe secrets, the session signing secret, and the app's own addresses for
`ALLOWED_ORIGIN` — are pasted into the dashboard. `ALLOWED_ORIGIN` takes a comma separated
list with the main address first, which is how `ozidelivery.co.uk` and the older
`ondigitalocean.app` address both keep working. **[DEPLOY.md](DEPLOY.md)** walks through
every screen.

The API reads `PORT` (8080 by default) and binds `0.0.0.0`. With `DATABASE_URL` set it uses
PostgreSQL through Prisma, running `prisma migrate deploy` before the server starts; without
it, the in-memory store, saying so loudly. In production it refuses to start at all rather
than run without a database or without its Stripe keys.

---

## The fee

Standard delivery is £13.50, flat, whatever the shopping comes to, and one delivery carries at
most £60 of shopping, which is what one Runner can carry safely; above that it goes as two
deliveries. No surge pricing, no small order fee, no minimum spend. The Runner gets £5 of every
standard delivery, untouched. Ruled on 29 September 2026 (docs/BUILD_PROMPT.md, Section B) and
proved one penny at a time in `packages/core/test/fees.test.ts`. The other services' prices in
Section B are still to be built.
