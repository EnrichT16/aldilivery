# Aldilivery — Build Log

A dated entry after every step. Decisions made on Anthony behalf are recorded here with the
reason, so nothing is a surprise later.

---

## 2026-09-09 — Step 0: environment check

Checked the machine before writing anything.

- Node v24.18.0, npm 11.16.0 — fine.
- Git 2.54.0 — fine.
- pnpm was not installed. `corepack enable` failed with `EPERM` because it wants to write
  into `C:\Program Files\nodejs`, which needs an administrator shell. Installed pnpm the
  other way instead, `npm install -g pnpm@9`, which writes to
  `C:\Users\commy\AppData\Roaming\npm` and needs no elevation. pnpm 9.15.9 is now available.
- **Docker is not installed on this machine.** The `docker-compose.yml` for local PostgreSQL
  is still written, exactly as specified, because it is part of the deliverable. Anthony will
  need Docker Desktop for Windows before `docker compose up` will run. This is noted again in
  *What Anthony Should Check* at the end of this log.

**Decision.** pnpm 9, not 10. Version 9 is the widely deployed line and its workspace
protocol behaviour is what the tooling in this repository expects. Recorded so the choice is
deliberate rather than accidental.

---

## 2026-09-09 — Step 1: PLAN.md, RULES.md, BUILD_LOG.md

Wrote `PLAN.md` describing the whole foundation build before touching any code.

Wrote `RULES.md` with the ten inviolable rules reproduced word for word at the top of the
file, followed by a table naming the exact file, function and test that enforces each one.
The table matters more than the list: a rule with no enforcement point is a slogan. Where a
rule could be turned into a constant, a type signature or a test, the table says where.

Two enforcement choices worth calling out now, because they shape code written later:

- **Rule four is enforced by a type signature, not by a check.** `feeForGoodsPence` takes the
  goods total and the bands, and nothing else. There is no time argument, no distance
  argument, no demand argument and no order history argument. Surge pricing is not forbidden
  by an `if` statement that someone could later delete; it is simply not expressible.
- **Rule nine is enforced by a repository scan.** A test walks the source tree and fails if
  the string *Aldi* appears in any source file outside `config/store.json` and the
  documentation. That is a stronger guarantee than discipline.

Created this build log.

---

## 2026-09-09 — Step 2: the workspace, the configuration file, Docker and secrets

Set up the pnpm workspace with three packages: `core`, `api` and `web`. Wrote
`config/store.json`, `docker-compose.yml`, `.env.example`, `.gitignore`, `.npmrc`, the
shared TypeScript settings and the ESLint configuration.

`config/store.json` holds the store display name, the product name, the assistant name Ozi,
the brand colours, a placeholder legal entity, the catalogue source mode (`community`), the
fee bands, and the supported card regions (UK and EU). It also holds the accessibility
floor, the recurring order notice period and skip word, the allocation timings and the cool
bag deposit.

**Decisions.**

- **The local database port is 5433, not 5432.** Rule Eight says Aldilivery shares no
  database with any other product. The default PostgreSQL port is exactly where another
  product's database would already be sitting, and a mistyped connection string that happens
  to work is the worst possible outcome. A non-default port makes an accidental crossover
  fail loudly.
- **`.env` is git-ignored and `.env.example` contains only obvious placeholders**, each
  carrying a marker (`placeholder`, `change_me`, `replace_with`) that the environment reader
  recognises. In production the API refuses to start on a placeholder secret. In development
  it falls back to a clearly labelled rehearsal mode that moves no money.
- **The store configuration is validated, not merely read.** The parser refuses any file
  that contradicts a rule: a Runner payment that is not five pounds, a lowered net floor, a
  notice period that is not thirty minutes, a multi-word skip, an age restriction switched
  on, a control height below forty eight pixels, or fee bands that would lose money. A JSON
  edit therefore cannot quietly break a promise; the process will not start, and the error
  names the rule.

---

## 2026-09-09 — Step 3: the fee engine, and a change to the band boundaries

Built `packages/core`: `feeForGoodsPence`, `processorCostPence`, `aldiliveryNetPence`,
`priceBasket` and `orderEconomics`, all pure, all in whole pence, with the rule constants and
the configuration contract alongside them.

### The bands as specified do not hold, and what I changed

The proving test asks that Aldilivery nets at least 200 pence for every goods total from 1
penny to 30000 pence. The bands as given were:

| Goods up to | Fee |
| --- | --- |
| 3500p | 800p |
| 10000p | 900p |
| 16500p | 1000p |
| above that | 1100p |

The first three bands hold comfortably. Their worst point is the very top of each band,
because the fee is flat across a band while the processor's percentage keeps climbing with
the goods total:

| Band top | Fee | Transaction | Processor cost | Aldilivery net |
| --- | --- | --- | --- | --- |
| 3500p | 800p | 4300p | 85p | **215p** |
| 10000p | 900p | 10900p | 184p | **216p** |
| 16500p | 1000p | 17500p | 283p | **217p** |

The fourth band was open ended, and that is where it fails. At a goods total of 30000p the
transaction is 31100p, the processor takes 487p, and Aldilivery nets **113p** — 87 pence
short of the floor. Working backwards, the 1100p band holds only up to a goods total of
**24233p**; every penny above that breaches Rule Three.

**What I changed, and what I did not.** I did not lower the floor. I closed the fourth band
and added a fifth:

| Goods up to | Fee | Net at the top of the band |
| --- | --- | --- |
| 3500p | 800p | 215p |
| 10000p | 900p | 216p |
| 16500p | 1000p | 217p |
| **24000p** (was open ended) | 1100p | **203p** |
| **30000p** (new band) | **1200p** | **212p** |

24000p rather than 24233p because a round two hundred and forty pounds is a number a person
can hold in their head, and it leaves a little room.

**And the ceiling.** No flat fee can hold the floor forever: the processor's cut is a
percentage and eventually eats any fixed amount. So `fees.maximumGoodsPence` is 30000p, the
top of the last band, and a basket above it is refused with a plain sentence asking the
Shopper to split it into two orders, rather than being priced at a loss. The configuration
loader insists the last band and the maximum agree, so the two cannot drift apart. A £300
grocery shop is far outside what this product is for; refusing it honestly is better than
mispricing it quietly.

**A second guard, for the future.** `assertBandsHonourNetFloor` runs at configuration load
and checks every band at its worst point. Anybody who edits the bands later — to add a
sixth, or to lower a fee — gets a startup error naming the band and the shortfall in pence,
not a slow leak.

### Other decisions in this step

- **The processor cost rounds up.** 1.5 percent of a transaction is rarely a whole number of
  pence. Rounding up can only make the modelled net smaller than reality, never larger, so
  Rule Three is proved against the pessimistic figure.
- **`feeForGoodsPence` takes the bands as an argument** rather than reading configuration
  itself. It keeps the function pure and, more importantly, keeps a single source of truth:
  there is no duplicate copy of the bands in code that could drift from `store.json`.
- **The test reads the live `config/store.json`**, not a fixture. If somebody edits the real
  bands into a loss, the test suite fails rather than passing against a copy.

**Result.** 43 tests in `core`, all passing, including the penny by penny scan of all 30000
goods totals and a repository scan proving the store name appears in no source file.

---

## 2026-09-09 — Step 4: the API

Built `packages/api`: the Prisma schema, the routes, the allocation engine, the payout
rules, and the recurring order scheduler.

**The largest decision: routes talk to a repository interface, not to Prisma.**

There are two implementations — `prismaRepository` over PostgreSQL, and `memoryRepository`
in process. This was not abstraction for its own sake. It means the entire rule-proving test
suite runs with no database, no network and no Stripe account, in under three seconds,
against the real application rather than a simplified stand-in. It also means the API starts
and serves on a machine with no PostgreSQL installed, which matters today because this
machine has no Docker. The in-memory mode announces itself as a warning in the log at
startup, seeds itself from the same seed data the real database uses, and cannot be selected
in production.

**Rule One is a named function, not a line in a handler.** `assertConfirmedBeforePayment`
reads the confirmation back off the *stored* order, not off the request body, and every path
to a payment goes through it. `POST /orders` reads in four deliberate steps: write the
order, record the confirmation, assert the confirmation, then create the payment intent. The
confirmation timestamp is written onto the Stripe payment intent's metadata, so a future
dispute can be answered from Stripe's own records.

There is one more guard I added that the specification did not ask for: the Shopper sends
the total they were shown, and the route refuses to charge a different amount from the one
they agreed to. If the price moved between the screen and the button, nothing is charged and
they are asked again. A confirmation of £10.50 is not a confirmation of £12.

**Rule Two is a constant, and the cool bag needed a decision.** The specification says 1000p
is withheld from early payouts and released after the twentieth delivery, but not how fast
to collect it. Taking it from the first two payouts would mean a Runner works two deliveries
for nothing, which reads as a breach of the promise even though the arithmetic survives. So
**100p is withheld per order for the first ten orders**, the Runner takes home 400p on each
of those, and the whole 1000p is transferred back on the twentieth delivery. Every payout
plan reports `earnedPence` and `transferredPence` as separate figures, so the earning is
always five pounds and the withholding is visibly a holding rather than a deduction. The
configuration parser refuses a per-order withholding of five pounds or more.

**Allocation: nearest, in buckets, then longest waiting.** "The nearest available Runner who
has waited longest" is two orderings, and taken literally as distance-then-time it becomes a
race won by whoever happens to be standing outside the shop. Distance is therefore bucketed
into half miles before the ordering is applied. Inside a bucket, the longest wait always
wins. A Runner fifty yards nearer does not beat a Runner who has waited two hours; a Runner
four miles away does not beat one on the doorstep. A Runner who has never had a job counts
as having waited forever, so new Runners are not starved behind established ones. Runners
whose right to work or criminal record check is unverified never enter the queue at all.

**Pooling never divides the five pounds.** An order joins a pool only if it is within the
radius of *every* order already in it, so a pool cannot stretch into a chain of far apart
stops. Three pooled orders pay fifteen pounds.

**Rule Five is a precondition, not a courtesy.** `mayFire` refuses any Set whose notice was
not sent at least thirty minutes before the firing time — a notice that went out twenty nine
minutes beforehand does not count, because it does not give the Shopper the thirty minutes
they were promised. When a Set does fire it produces a *draft* order, which must still pass
through the ordinary order route and therefore through Rule One before any money moves. The
skip word is accepted with any capitalisation and a trailing full stop, but a sentence
containing the word is not a skip.

**Rule Ten is structural.** Look at `PaymentsGateway`: no method on it accepts a card
number, an expiry or a security code. `PaymentMethod` in the schema has a Stripe identifier
and four digits. A test strips the comments from the schema and fails if any field
declaration mentions a card number, a PAN, a CVC, a CVV, a security code or an expiry.

**Deletion sets a date.** `POST /account/delete` writes a date seven days out and deletes
nothing. I added `POST /account/restore` alongside it, which the specification did not ask
for: a recycle bin nobody can reach into is just a slower deletion.

**Result.** 108 tests in `api`, all passing.

---

## 2026-09-09 — Step 5: the web shell

Built `packages/web`: React and TypeScript on Vite, Tailwind, a web app manifest and a
service worker through `vite-plugin-pwa`, and a `capacitor.config.ts` so the app stores are
a `npx cap add` away later rather than a rewrite.

Screens: the landing page, sign up, catalogue browse, basket, and confirmation, plus the
Runner door and the "just looking" door behind the three landing buttons.

**The landing page** is deep navy with one large gold microphone in the middle, white text at
twenty pixels, and the line *Say it, Ozi shops it, a Runner brings it*. The microphone is
present, focusable, and says in plain words that talking to Ozi is not ready yet. It has no
`aria-label`: its accessible name is its own visible text, *Say what you need*, which is
also exactly what a voice control user would say to press it.

**Accessibility decisions.**

- **Twenty pixel base text comes from configuration**, not from a stylesheet constant, and
  the same value is fed to Tailwind's type scale and to a CSS custom property.
- **`aria-label` is avoided wherever there is visible text.** A test walks every control on
  every screen and fails if a label is present but does not match the visible text word for
  word.
- **Nothing is carried by colour.** Form errors are listed in words at the top of the form,
  each one a link to the field it is about. Status messages are in live regions and are also
  plainly visible.
- **The focus ring is two rings, light and dark**, so it is visible against the navy
  background, against the gold button and against white.
- **Contrast, checked by hand:** gold `#D4AF37` on navy `#0B1F3A` is about **7.9 : 1**, and
  white on navy about **16.5 : 1**. Both pass AA comfortably; both in fact pass AAA for
  normal text. This is recorded here because axe cannot measure contrast in jsdom, which has
  no layout engine.

**The build is the gate.** `pnpm --filter @aldilivery/web build` runs ESLint (with
`eslint-plugin-jsx-a11y` in its strict configuration), then the type check, then the axe
tests, and only then produces a bundle. A violation on any screen means no bundle.

**A defect the tests found.** The first version of the landing page had the telephone number
as a plain inline link. The test that checks every control carries the minimum forty eight
pixel size caught it: an inline anchor is well under WCAG 2.2's target size minimum, and far
under our own promise. It is now a full sized control on its own line. This is exactly the
kind of thing that a manual pass finds three months late, and it was found in the first
minute of the gate existing.

**A limitation, recorded honestly.** jsdom has no layout engine, so the tests cannot measure
that a rendered control really is forty eight pixels tall, nor that text reflows correctly at
200 percent zoom. The tests check that every control carries the class that sets the
minimum, and the CSS sets it. Real measurement needs a browser, and a Playwright pass at 200
percent zoom belongs in the next phase. It is on the list, not forgotten.

**Result.** 27 tests in `web`, all passing, including axe against all eight screens.

---

## 2026-09-09 — Step 6: the full check

- `pnpm lint` — clean, no errors and no warnings.
- `pnpm run typecheck` — clean across all three packages.
- `pnpm test` — **178 tests passing**: 43 in `core`, 108 in `api`, 27 in `web`.
- `pnpm --filter @aldilivery/web build` — bundle and service worker produced after the
  accessibility gate.
- The API was started with no database and exercised over HTTP: it seeded itself, health
  reported `dataBackend: memory` and `paymentsMode: rehearsal`, a search for wine returned
  nothing (Rule Six), and a basket of two pints of milk priced at £2.50 of shopping plus an
  £8.00 fee, with the fee stated in words before any confirmation.

**Two version pins worth recording.** `packages/web` uses Vite 5 rather than Vite 6, because
Vitest 2 brings Vite 5 with it and the two sets of plugin types do not agree. And
`@types/node` had to be added to `packages/core` explicitly, since pnpm's strict linking does
not hoist it.


---

## 2026-09-10 — Step 7: ready for DigitalOcean

Made the two deployable packages production ready and wrote the App Platform spec. Nothing
was built for Shoppers or Runners, and neither the fee engine nor the rules were touched:
`packages/core` has no change in it at all.

### The API

`GET /health` now answers `status: "ok"` and the git commit, alongside what it already
reported. The commit is worked out once at startup from three places in order — an
environment variable a platform or CI set, a `COMMIT` file a build may have written beside
the compiled code, and finally `git rev-parse` if a checkout is still there — and is `null`
rather than a guess when nothing can say. It is resolved once and cached, because a
liveness probe that spawns a process on every poll is a liveness problem of its own.

**One number for the port, in development and in production.** The API reads `PORT` first,
then `API_PORT` for anyone whose `.env` still has it, and falls back to **8080**. It binds
`0.0.0.0`. Development used to be 3001 while production would have been 8080; two numbers
for one thing is how a proxy ends up pointing at nothing, so `.env.example`, the Vite dev
proxy and the README all moved to 8080 together.

**The data backend follows `DATABASE_URL`.** Present, and it is Prisma against PostgreSQL;
absent, and it is the in-memory store with the warning it has always printed. There was a
latent bug here worth naming: `databaseUrl` was assigned from a conditional whose two
branches were identical, so a placeholder connection string counted as a real one. A `.env`
copied from `.env.example` and not filled in would have sent the API at a database that is
not there. It now resolves to nothing, the same as every other placeholder.

**One decision I made on Anthony's behalf.** The instruction was to fall back to the
in-memory store when `DATABASE_URL` is absent. In production I have made it refuse to start
instead, with a plain message. In-memory means every order, every Shopper and every Runner
is lost when the process restarts, and App Platform restarts a process for its own reasons —
a deploy, a failed health check, a machine move. An Aldilivery that silently forgets an
order is worse than one that will not start, and the second failure is the one you find out
about in ten seconds rather than three weeks. The development fallback is untouched, so
`pnpm run dev:api` still needs no database. If you would rather have it the other way, it is
the one `if` block at the top of `readEnv`.

**Fail fast, and say which one.** In production the server refuses to start without
`STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`, naming the missing one in a plain sentence
with no stack trace. `STRIPE_WEBHOOK_SECRET` was not checked before, which meant a
production server could have started, accepted a webhook, and been unable to prove it came
from Stripe. A value carrying one of the placeholder markers counts as missing, so
`.do/app.yaml` can ship obvious placeholders and the server still refuses to run on them.

**CORS is now `ALLOWED_ORIGIN`.** One origin, or several separated by commas, with a
trailing slash forgiven because a trailing slash is the single easiest way to get this
wrong. `WEB_ORIGIN` is still read as a fallback. `*` still means anything, which is what the
tests use and what nothing in production should.

**`prisma migrate deploy` before the server, always in that order.** `pnpm --filter
@aldilivery/api start` runs `scripts/start.mjs`, which applies migrations and only then
starts the server, because a server that binds before its schema exists gets the first thing
wrong in front of a Shopper. With no `DATABASE_URL` it skips the migration step and says so,
which is the only way it ever behaves on a developer's machine.

Two things this needed. There were **no migrations in the repository** — the local workflow
was `prisma db push`, which does not write any — so an initial migration was generated from
the schema with `prisma migrate diff` and committed as `20260909000000_init`. And **`prisma`
moved from devDependencies to dependencies**, because the CLI has to exist at run time, not
just at build time, and a platform that prunes development dependencies after a build would
otherwise take it away. The start script resolves the Prisma CLI as a module and runs it on
the same Node binary rather than through a `.bin` shim, so it needs no shell and behaves the
same on Windows as on the build machine.

### The web app

The API address is read from `VITE_API_URL` at build time. With nothing set it is
`http://localhost:8080` in development and `/api` in production, which is where the API sits
behind the App Platform routes. Trailing slashes are trimmed so `/api/` and `/api` cannot
become two different URLs for one route. `base` and the build output directory are now
explicit, and the manifest, the service worker and its scope all resolve from `/`, which a
build check confirmed: `dist` contains `index.html`, `manifest.webmanifest` with `start_url`
and `scope` both `/`, `sw.js`, and root-absolute asset paths.

### The App Platform spec

`.do/app.yaml` describes a service named `api`, a static site named `web`, and a development
PostgreSQL database named `aldilivery-db`, all from this repository's `main` branch with the
repository root as the source directory. The API is `basic-xxs`, one instance, HTTP port
8080, health checked on `/health` after a delay long enough for migrations to run. The web
app builds to `packages/web/dist` and serves at `/`; the API serves at `/api`. Because both
sit behind one hostname, the browser never makes a cross origin request in ordinary use.

**Two traps worth recording.**

`NODE_ENV` is scoped to run time only, never to build time. pnpm reads `NODE_ENV`, and at
build time `NODE_ENV=production` would skip devDependencies — taking away TypeScript, Vitest
and ESLint, which is to say the compiler and the entire accessibility gate. The build
command passes `--prod=false` as well, so it takes two mistakes rather than one to lose the
gate.

**The Node and pnpm versions are pinned rather than guessed**, as asked: `engines` in the
root `package.json` says `node: 24.x` and `pnpm: 9.x`, `.nvmrc` says `24.18.0`, and
`packageManager` already said `pnpm@9.15.9` exactly. I pinned Node to the line this machine
already runs rather than to an older one, so that what Anthony develops on and what
DigitalOcean builds on are the same thing. If the buildpack turns out not to have Node 24,
the fix is two lines and it is written down in `DEPLOY.md`.

The web build command deliberately runs `pnpm --filter @aldilivery/web build`, the full
gate, not `build:only`. Deploying is exactly when you want the accessibility tests to have
the last word: a screen with a violation fails the deployment instead of reaching a person
who depends on it.

`AUTH_TOKEN_SECRET` is in the spec as a third secret. It was not on the list, but the API
has always refused to start in production without it, so an app created without it would
have built successfully and then never come up.

### DEPLOY.md

Written for Anthony rather than for a developer, and written to be read aloud: no bullet
points, no headings marked with symbols, no backticks, no tables, no markdown syntax of any
kind. Continuous prose, one idea to a paragraph. It goes through the dashboard in the order
the screens appear, says which value is pasted where and where each one comes from, and ends
with the four fields to read back off `/health` — `status`, `commit`, `dataBackend` and
`paymentsMode` — and what it means if the last two say `memory` or `rehearsal` rather than
`postgres` and `stripe`.

It also says plainly that the first deploy will build and then fail to start, because the
Stripe webhook secret cannot exist until the app has an address to point the webhook at.
That is the sort of thing that reads as a disaster at half past eleven at night if nobody
warned you it was coming.

### Checked

- `pnpm lint` — clean, no errors and no warnings.
- `pnpm run typecheck` — clean across all three packages.
- `pnpm test` — **197 tests passing**: 43 in `core`, 127 in `api` (19 new), 27 in `web`.
- `pnpm --filter @aldilivery/web build` — the gate ran, and `dist` was checked by hand for
  the manifest, the service worker and root-absolute paths.
- The built server was started through the real start script and exercised over HTTP. It
  listened on `0.0.0.0:8080`, `/health` returned `status: "ok"` with the live commit,
  `access-control-allow-origin` came back for the allowed origin and was **absent** for
  another site, and the three production refusals were each provoked in turn and printed one
  plain sentence naming the missing variable.

**A defect the new tests found.** `gitCommit: options.gitCommit ?? gitCommit()` looked right
and was wrong: `null` is nullish, so pinning the commit to `null` in a test fell straight
through to the real lookup and the test read the actual commit off the working copy. Here
`null` is a deliberate answer meaning "nothing knows which commit this is", not an absent
one, so the option is now checked for presence instead. The same bug in the other direction
would have made `/health` shell out to git, on every single poll, on a machine where the
answer is genuinely nothing.

---

## 2026-09-11 — Step 8: the empty catalogue, and why the seed writes no people

A gap left by Step 7, found by reading it back rather than by a test failing.

`prisma migrate deploy` creates tables. It does not create rows. The API only ever seeded
itself on the in-memory path, so the first deployment would have come up with a catalogue of
nothing: search returning no results, no basket that could be filled, no fee to show. Working
exactly as designed, and indistinguishable from broken. Filling it needed `pnpm db:seed` from
a terminal with `DATABASE_URL` set, which is precisely what `DEPLOY.md` promises Anthony will
not need.

So an empty catalogue is now filled once, at startup, on the PostgreSQL path. Three
conditions have to agree, and the decision lives in `src/data/startup-seed.ts` rather than in
`index.ts`, so that it is testable instead of buried in a `main` function nothing can reach.

**The catalogue must be empty.** `seedRepository` already checked this and returns
`alreadySeeded`, so a restart cannot duplicate anything and cannot overwrite a catalogue
somebody has edited. That check was there from Step 4; it just had no caller on this path.

**The catalogue source must be `community`.** The seeded rows carry the configured source as
their provenance. In `partner_feed` mode these community price estimates would be labelled as
though a supermarket had supplied them, which is a false claim about where a price came from,
so it refuses and says so in the log instead.

**And the part that actually matters: no people, ever, in a real database.**

The development seed creates a Shopper called Margaret and two Runners, Tomasz and Ayesha,
and it marks both Runners as having their right to work and their criminal record check
verified. In memory that is harmless — nothing there is real and all of it is thrown away
when the process stops. Written into PostgreSQL it would be something else entirely: three
fabricated people, two of them carrying the exact two flags that decide who may be offered a
job, handle somebody else's shopping, and be paid five pounds for it. Those checks are made
by a person reading a document. Nothing automatic should ever be able to assert one, and a
seed script least of all.

`seedRepository` already took `withPeople: false`, so the fix was to use it. The startup path
writes groceries and nothing else, and the log line says so in as many words. A test asserts
that `listAvailable()` comes back empty afterwards, which is the strongest form of the claim:
not merely that no Runner row was written, but that nothing the allocation engine could offer
a job to exists.

`SEED_ON_START` turns the whole thing off for when the catalogue comes from somewhere real.
It defaults to on, because the failure it prevents is silent and the failure it could cause
is not.

One limit worth writing down. The emptiness check and the insert are not one transaction, so
two instances starting at the same moment could in principle both decide the catalogue is
empty. The spec runs one instance, so this cannot happen today. If `instance_count` ever goes
above one, this wants a unique constraint on the catalogue item name to make the race
harmless, and that is a schema change rather than a patch here.

### Checked

- `pnpm lint`, `pnpm run typecheck` — both clean.
- `pnpm test` — **204 tests passing**: 43 in `core`, 134 in `api` (7 new), 27 in `web`.
- `DEPLOY.md` now tells Anthony to search for milk after the health check, says the catalogue
  fills itself and only once, says plainly that no Runner is created and why, and adds the
  empty-catalogue case to the list of things that can go wrong. Still no lists, no headings
  with symbols and no markdown syntax anywhere in it.

---

## 2026-09-13 — Step 9: P3009, and getting out of it without deleting anything

The first DigitalOcean deployment failed. The managed database was still being provisioned
when the first `migrate deploy` ran, the attempt was interrupted part way through, and Prisma
wrote a row into `_prisma_migrations` recording `20260909000000_init` as failed. From then on
every later deploy refused to do anything at all and returned **P3009**.

That refusal is correct and I have not tried to talk it out of it. Prisma will not apply
migrations on top of a database whose state it cannot vouch for, because guessing there means
guessing about somebody's data. What it needed was a way out that is equally careful.

### What the start script does now

Before deploying, it runs `prisma migrate status` and reads the output. If any migration is
recorded as failed, it runs `prisma migrate resolve --rolled-back` for that migration by name,
says so in a plain sentence naming the migration, and then runs `prisma migrate deploy`. The
whole sequence — status, resolve, deploy — is wrapped in up to **five attempts with ten
seconds between them**, because a managed database is briefly unreachable while it is being
provisioned, promoted or moved, and a single failed connection at the wrong second should not
take the service down when waiting ten seconds would have fixed it.

**Nothing in it can delete data, and that is enforced rather than intended.** There is no
`migrate reset`, no `db push --force-reset` and no `DROP` anywhere in the file. `migrate
resolve --rolled-back` edits one row in Prisma's own bookkeeping table and touches no table of
ours. A test asserts over every command the script actually issued that none of them matches
`reset`, `--force`, `db push` or `drop`, and that a `resolve` is only ever `--rolled-back` and
never `--applied` — the latter would tell Prisma a migration had run when it had not, which is
the same class of lie as the failed record itself, pointing the other way.

`migrate reset` is the fix the Prisma documentation and every forum answer reaches for first.
It drops every table and everything in them. Today that would cost a seeded catalogue and
nothing else. The point of writing the test now is that it will not always be today.

### Where it lives, and why not in the script

The logic moved into `src/lib/migrations.ts` and the script keeps only the real ways of
running a command, writing a line and waiting. A `.mjs` file in `scripts/` is outside the
TypeScript project and outside the test suite: it is neither typechecked nor provable. The
same logic in `src/` is compiled, linted and covered like everything else, and `start.mjs`
imports it out of `dist` after it has already checked `dist` exists. Everything the outside
world does is injected, so the whole of P3009 recovery is proved with a scripted command
runner, no database, no Prisma and nothing that really waits ten seconds.

### Reading the output, which is the fiddly part

Prisma has worded "these migrations failed" differently across versions, and the same fact
appears both in `migrate status` and in the P3009 text from `migrate deploy`. Both wordings
are read: a heading followed by bare migration names on their own lines, and the inline form
that quotes the name in backticks. Anything not shaped like a migration folder name is
ignored, because acting on a misread name is worse than missing one — and a test covers
exactly that case.

Two details worth recording because both were wrong first:

**`migrate status` exits non-zero whenever anything is pending.** On a first deployment that
is the ordinary case, not an error, so only its output is read and never its exit code. A test
pins this.

**The first version reported the wrong reason.** Running it for real against an unreachable
database, the log said the migration failed because of a deprecation warning about
`package.json#prisma`. The failure line picker was taking the first non-empty line, and Prisma
prints the schema it loaded, a deprecation warning and sometimes a box advertising a new
version before it gets to the error. It now prefers the line carrying a Prisma error code, so
the log says `P1001: Can't reach database server` — which is the difference between a
deployment log that tells you what to fix and one that sends you to the wrong place entirely.

### A limit, recorded rather than papered over

If the interrupted attempt had got far enough to create part of the schema before it stopped,
rolling the record back and running the migration again will fail on the first `CREATE TABLE`
for something that already exists. The script cannot fix that safely on its own: the honest
options are a migration written for that exact half-built state, or dropping things, and only
one of those is allowed here. It retries, reports `P3009` or the "already exists" error
plainly, and refuses to start the server. `DEPLOY.md` now says so in as many words, and says
plainly not to follow the advice about resetting the database that the Prisma documentation
will offer.

### Checked

- `pnpm lint`, `pnpm run typecheck` — both clean.
- `pnpm test` — **227 tests passing**: 43 in `core`, 157 in `api` (23 new), 27 in `web`.
- Run for real against an unreachable database, with the built script and the real Prisma
  command line: five attempts, four ten second waits, `Error: P1001: Can't reach database
  server` reported each time, exit code 1, the server never started, and the closing line
  saying nothing has been deleted.
- `DEPLOY.md` now has the P3009 case in it: what it means, that a redeploy is usually the
  whole fix, that nothing is deleted, and what to do in the half-built case instead.

---

## What Anthony Should Check

This section is for you, Anthony, rather than for a developer. It says how to run what has
been built and what you will see, in the order I would look at it.

### Getting it going

You will need a terminal in the `aldilivery` folder. Everything below is already installed
on this machine.

Type `pnpm install` once, then `pnpm run build:core`. That second command builds the small
shared piece that works out the fee; the other two parts of the system read it, so it has to
exist before they will run.

Then open two terminals. In the first, type `pnpm run dev:api`. In the second, type
`pnpm run dev:web`. Leave both running and open a browser at http://localhost:5173.

You do not need a database for any of this. Docker is not installed on this machine, and I
have deliberately built the server so that it works without one: when it cannot find a
database it keeps everything in memory instead, fills itself with an everyday grocery list,
and prints a warning saying so. Nothing is saved when you stop it. If you later install
Docker Desktop, copy `.env.example` to a file called `.env`, then `pnpm run db:up`,
`pnpm run db:push` and `pnpm run db:seed` will give you a real one.

### What you will see, and what to look for

**The landing page.** Deep navy, one large gold microphone in the middle, and white text at
twenty pixels. Underneath, the line *Say it, Ozi shops it, a Runner brings it*. Press the
microphone: it will tell you plainly that talking to Ozi is not ready yet. That is correct.
You asked for no voice in this phase, so the button exists and is honest about itself rather
than being missing or, worse, being there and doing nothing.

Below it are the three doors: Shopper, Runner, and just looking. Below those, the telephone
number, with a line saying it is a placeholder and will not connect. When you have a real
number, it goes in `config/store.json` and nowhere else.

**Try it with the keyboard.** Press the Tab key from the top of the page. The very first
thing you reach is a link to skip past the navigation. Keep going and you will see a thick
white focus ring on everything you land on. This is the thing most sites get wrong, and it
is the thing a blind user relies on most.

**Try it very large.** In your browser, press Ctrl and the plus key several times, up to 200
percent. Nothing should be cut off and nothing should need scrolling sideways.

**Just looking.** This door explains the fee. There is a table showing every band. Note the
sentence saying the fee never goes up because it is raining or because it is Friday. That is
Rule Four written where a customer can read it.

**The Runner door.** The very first sentence gives the figure: five pounds for every order,
without exception. It also explains the cool bag deposit — a hundred pence held back from
each of the first ten payments, up to a thousand pence, and the whole lot paid back after
the twentieth delivery. I made that decision on your behalf and it is explained in the entry
for Step 4 above. The alternative was to take the whole deposit out of the first two
payments, which would mean a Runner works two deliveries for nothing.

**The shopping and the basket.** Go to *Shop*, add a couple of things, then go to the
basket. Look at where the fee appears: it is on the screen, in a table, with the sentence
"that is the only fee", *before* there is any way to go on. The only thing that takes you
forward from the basket is a link, not a button — nothing on the basket screen can charge
anybody.

**The confirmation screen.** This is the one I would most like you to look at. There is
exactly one button on it that could ever take a payment, it is the largest thing on the
page, and it says *Send my order*. Above it, in plain sentences, is what you are buying,
what it will cost, that five pounds of the fee goes to the Runner, and that pressing the
button is the only thing that will ever take a payment. Pressing it tells you nothing was
sent and nothing was charged, because sending real orders is not switched on yet.

**Search for wine.** Type "wine" into the shopping search. You will get nothing back. There
is a bottle of red wine in the catalogue, sitting there deliberately, and it is invisible to
search, invisible if you ask for it directly, and refused by name if it somehow reaches a
basket. That is Rule Six, and there is a test for each of those three doors.

### Checking the promises without reading any code

Type `pnpm run verify`. It runs the linter, the type checker, and all 227 tests, and takes
about half a minute. If it prints no errors, then all ten rules are being kept by the code as
it stands today, because each rule has tests attached to it. The table at the bottom of
`RULES.md` says which file and which test enforces each one.

The test worth knowing about is the one for Rule Three. It works out, for every possible
order total from one penny to three hundred pounds — thirty thousand separate sums — what
Aldilivery is left with after the Runner's five pounds and after the card processing costs.
It fails if any one of them falls below two pounds.

### The one thing I changed, and why

The fee bands you gave me do not survive that test. The first three are fine. The fourth,
"above 16500 pence, 1100 pence", was open ended, and an open ended flat fee cannot hold: the
card processor takes a percentage, so the larger the order the more it takes, while the fee
stays still. At a £300 shop, that band leaves Aldilivery with £1.13, which breaks Rule Three.

You told me not to lower the floor, so I did not. I closed that band at £240 of shopping,
where it still nets £2.03, and added a fifth band above it: up to £300 of shopping, a fee of
£12, which nets £2.12. I also set a ceiling: a basket above £300 of shopping is refused, with
a plain sentence asking the Shopper to split it into two orders. No flat fee can hold the
floor forever, so there has to be a ceiling somewhere, and a £300 grocery shop is far outside
what this product is for. All the arithmetic is written out in the Step 3 entry above.

If you would rather have different numbers, they are in `config/store.json` and you can
change them. The server will refuse to start if the ones you choose would lose money, and it
will tell you which band and by how many pence.

### What is deliberately not here

There is no voice, no speech and no telephone, as you asked. There is no real payment: the
server runs in a rehearsal mode that records what it *would* have asked Stripe to do and
moves nothing. Sign up does not save anybody yet. And the accessibility tests cannot measure
that a button really is forty eight pixels tall, because they run without a real browser —
they check that every control carries the styling that sets it, and the styling does set it.
A proper browser pass, including a check at 200 percent zoom, is the first thing I would add
next.

### Putting it on the internet

This is now ready to deploy, and there is a separate file for it: **[DEPLOY.md](DEPLOY.md)**.
That one is written in plain prose with no lists, no symbols and no markdown, so it reads
properly aloud from start to finish. It walks through the DigitalOcean dashboard in the order
the screens appear.

The short version. `.do/app.yaml` in this repository describes the whole thing — the API, the
web app and a PostgreSQL database — so DigitalOcean configures itself from it and you are not
typing build commands. There are four values you paste in by hand: your Stripe secret key,
your Stripe webhook signing secret, a long random string to sign sign-in tokens, and the
app's own web address, which does not exist until DigitalOcean has created the app. Expect
the very first deploy to build and then fail to start, because the webhook secret cannot
exist until there is an address to point the webhook at. That is written down in DEPLOY.md so
it is not a surprise at eleven at night.

When it is up, visit your app address with `/api/health` on the end. Four things in what
comes back tell you it is really working: `status` says `ok`, `commit` names the version that
is live, `dataBackend` says `postgres` rather than `memory`, and `paymentsMode` says `stripe`
rather than `rehearsal`. If the third says `memory`, the database is not attached and nothing
anybody orders would survive a restart.

One thing to know rather than to do. The database in that spec is a development database,
which is the smallest and cheapest managed PostgreSQL there is, and **it is not backed up**.
It is right for seeing Aldilivery running on the internet. It is not right for holding real
orders from real people, and moving to a proper database cluster is a two line change in
`.do/app.yaml` when you get there.

### What I would do next, in order

1. A real browser accessibility pass, measuring target sizes and zoom.
2. Wire the web shell to the API properly: real sign up, a real saved card through Stripe,
   and the confirmation screen actually creating an order.
3. Screen reader testing with real users — the people this is for, not us.
4. Then, and only then, the voice layer.
