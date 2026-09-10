# Aldilivery

A voice-first grocery messenger service for the United Kingdom.

A **Shopper** orders groceries from a configured supermarket. An independent **Runner** buys
them at the shelf price and delivers them for one flat fee. The assistant is called **Ozi**.

Aldilivery is built for blind, visually impaired, disabled, elderly and low-literacy users
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

- `pnpm test` — 197 tests across the three packages.
- `pnpm lint` — includes `eslint-plugin-jsx-a11y` in its strict configuration.
- `pnpm --filter @aldilivery/web build` — runs the axe accessibility tests and refuses to
  produce a bundle if any screen has a violation.

---

## What is where

| Path | What it is |
| --- | --- |
| `config/store.json` | Everything about the store: name, colours, legal entity, catalogue source, fee bands, card regions. Rule Nine means nothing about the supermarket is anywhere else. |
| `packages/core` | The fee engine, the rule constants, and the configuration contract. No framework, no I/O. |
| `packages/api` | Fastify, PostgreSQL through Prisma, Stripe. |
| `packages/web` | React, TypeScript, Vite, Tailwind. An installable Progressive Web App, ready for Capacitor later. |
| `docker-compose.yml` | Local PostgreSQL, and nothing else. |
| `.do/app.yaml` | The DigitalOcean App Platform spec: the `api` service, the `web` static site, and the `aldilivery-db` database. |

## Deploying

`.do/app.yaml` describes the whole app: an `api` service on port 8080 with a `/health`
check, a `web` static site built to `packages/web/dist`, and a managed PostgreSQL database.
DigitalOcean reads it straight out of the repository. The four values that cannot live here
— the two Stripe secrets, the session signing secret, and the app's own address for
`ALLOWED_ORIGIN` — are pasted into the dashboard. **[DEPLOY.md](DEPLOY.md)** walks through
every screen.

The API reads `PORT` (8080 by default) and binds `0.0.0.0`. With `DATABASE_URL` set it uses
PostgreSQL through Prisma, running `prisma migrate deploy` before the server starts; without
it, the in-memory store, saying so loudly. In production it refuses to start at all rather
than run without a database or without its Stripe keys.

---

## The fee

One flat fee, decided only by how much the shopping comes to. No surge pricing, no small
order fee, no minimum spend. The Runner gets £5 of it on every completed order, without
exception, and Aldilivery never nets below £2 after payment processing. That last promise is
proved for every possible order total, one penny at a time, in
`packages/core/test/fees.test.ts`.
