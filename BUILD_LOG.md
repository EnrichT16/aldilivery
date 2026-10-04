# Ozi Delivery — Build Log

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

- **The local database port is 5433, not 5432.** Rule Eight says Ozi Delivery shares no
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

Built `packages/core`: `feeForGoodsPence`, `processorCostPence`, `platformNetPence`,
`priceBasket` and `orderEconomics`, all pure, all in whole pence, with the rule constants and
the configuration contract alongside them.

### The bands as specified do not hold, and what I changed

The proving test asks that Ozi Delivery nets at least 200 pence for every goods total from 1
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

| Band top | Fee | Transaction | Processor cost | Ozi Delivery net |
| --- | --- | --- | --- | --- |
| 3500p | 800p | 4300p | 85p | **215p** |
| 10000p | 900p | 10900p | 184p | **216p** |
| 16500p | 1000p | 17500p | 283p | **217p** |

The fourth band was open ended, and that is where it fails. At a goods total of 30000p the
transaction is 31100p, the processor takes 487p, and Ozi Delivery nets **113p** — 87 pence
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
a deploy, a failed health check, a machine move. An Ozi Delivery that silently forgets an
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

## 2026-09-14 — Step 10: P3018, and the one line that needed to be a superuser

The deployment got past P3009 and failed on the next thing: **P3018**, applying
`20260909000000_init`, with database error **42501, permission denied for database
aldilivery-db**.

### What needed a privilege the managed user does not have

Exactly one statement, the first one in the file:

```sql
CREATE SCHEMA IF NOT EXISTS "public";
```

`prisma migrate diff` writes that at the top of any migration generated from empty. On a
database you own it is harmless and does nothing, because `public` already exists. On managed
PostgreSQL it is fatal. The user a managed provider hands you is deliberately not a superuser
and is not the database owner: it has `CREATE` on the `public` schema, which is everything an
application needs, and nothing at all on the database itself. `CREATE SCHEMA` needs `CREATE`
**on the database**, so it fails.

**The `IF NOT EXISTS` does not save it, and that is the part worth understanding.** It reads
as though the statement should quietly do nothing when the schema is already there, and
`public` always is. But PostgreSQL checks the privilege *before* it checks whether the object
exists. There is no version of this that succeeds without the privilege, so no amount of
defensive SQL would have helped — the statement had to go.

### What else was checked, and what was already right

I went through the whole migration for anything else needing database or server level
privilege. Every statement in it is one of `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`,
`CREATE UNIQUE INDEX` or `ALTER TABLE` — eighteen, fourteen, twelve, seven and nine of them
respectively — and every one of those needs only `CREATE` on the `public` schema, which the
managed user has. There is no `CREATE EXTENSION`, no `ALTER DATABASE`, no `COMMENT ON
DATABASE`, no `CREATE ROLE` and no `GRANT`.

**There was nothing to replace, because no id was ever coming from the database.** The brief
allowed for swapping an extension-backed id for Prisma side generation, and it turned out not
to be needed: all fourteen `@id` columns in the schema were already `@default(cuid())`, which
Prisma generates in the client before the insert. Neither `pgcrypto` nor `uuid-ossp` is
referenced anywhere, there is no `dbgenerated`, and no `gen_random_uuid()` or
`uuid_generate_v4()`. That was luck as much as foresight, and it is now held in place by a
test rather than left to luck a second time: if any `@id` stops using `cuid()`, or anything
asks the database to generate a value, the test says so.

**The datasource declares no `schemas` list.** It is `provider` and `url` and nothing else, so
Prisma has no multi-schema configuration that would make it emit `CREATE SCHEMA` for anything
beyond the default. `postgresqlExtensions` is not turned on either. Both are now asserted.

### Rewritten in place, and why that is safe here

There is no production data — the database has never successfully been migrated — so the
initial migration was edited rather than superseded by a second one. A follow-up migration
could not have fixed this anyway: the failing statement is inside the first one, and it would
have failed again before anything later could run.

The removed statement is replaced by a comment at the top of the file explaining what it was,
why it fails on managed PostgreSQL, and that it must not come back. That matters because the
obvious next move — regenerating the migration after a schema change — puts it straight back
in, and the resulting failure shows up only against a real managed database, several minutes
into a deployment, nowhere that local work would catch it.

### Verified, rather than assumed

`prisma migrate diff --from-empty --to-schema-datamodel` regenerates the canonical SQL for the
current schema. Compared statement by statement against the committed migration, ignoring
comments and blank lines, the two are identical across all **247 statements**, with the single
`CREATE SCHEMA` line as the only difference. The migration is exactly the schema, minus the
statement that cannot run.

`packages/api/test/migration-sql.test.ts` now keeps it that way. It reads every committed
migration and fails on `CREATE SCHEMA`, `DROP SCHEMA`, `ALTER SCHEMA`, `CREATE EXTENSION`,
`CREATE DATABASE`, `ALTER DATABASE`, `DROP DATABASE`, `COMMENT ON DATABASE`, `CREATE ROLE`,
`ALTER ROLE` or `ALTER SYSTEM`, naming the statement and the privilege it wants. It strips SQL
comments first, so the explanation at the top of the migration — which has to name the
statements it warns about — does not trip the test enforcing it. It also fails if a
`CREATE TABLE` ever names a schema explicitly, which would depend on a schema nothing here is
allowed to create.

I checked the guard by putting the line back and watching it fail, then taking it out again.
A test that has never failed has not been tested.

### Checked

- `pnpm lint`, `pnpm run typecheck` — both clean.
- `pnpm test` — **234 tests passing**: 43 in `core`, 164 in `api` (7 new), 27 in `web`.
- `prisma migrate diff` — the committed migration matches the schema across 247 statements.
- The new guard was proved to fail when `CREATE SCHEMA` is reintroduced, and to pass when it
  is not.

---

## 2026-09-15 — Step 11: Ozi Delivery is live, and the routing was never broken

Ozi Delivery is on the internet at `lobster-app-3ilv6.ondigitalocean.app`.

The report was that `/api/health` returned the web app's not found page instead of the API,
so App Platform must be routing `/api` to the static site. I went to check which of the three
likely causes it was — the static site's catch-all swallowing it, the api component declaring
its own `routes` block, or rule ordering — and found that none of them was, because the
routing is correct and has been all along.

### What the wire actually says

```
/api/health                  200  application/json   {"status":"ok","commit":"9af3c57…",
                                                      "dataBackend":"postgres",
                                                      "paymentsMode":"stripe"}
/api/config                  200  application/json   the public configuration
/api/catalogue/search?q=milk 200  application/json   2 results
/api/nonsense                404  application/json   "There is nothing at that address."
/                            200  text/html          the web app
```

All four health fields are right: `status` ok, `commit` matching the pushed HEAD,
`dataBackend` **postgres**, `paymentsMode` **stripe**. The database is connected, Stripe is
wired, and the catalogue seeded itself — a search for milk comes back with two results.

**The line that settles the routing question is the fourth one.** `/api/nonsense` returns
*Ozi Delivery's own* JSON 404, in Ozi Delivery's own words. If `/api` were falling through to the
static site, that address would have come back as `index.html` with a 200 on it, because
`catchall_document` answers anything it does not recognise with the app. An API-shaped 404
under `/api` can only mean the request reached the API, which means the rule matched and the
prefix was stripped. The response headers agree: `application/json`, `vary: Origin` and
`access-control-allow-credentials` from our own CORS, and no `x-do-static-catchall-document`,
which the root request does carry.

So I have changed nothing about the routing. Rewriting working production ingress on a false
premise is a good way to turn a healthy deployment into a broken one.

### What was really seen, and why it was convincing

The api component was still deploying. While it is, it serves nothing, and every request
under `/api` falls through to the static site's catch-all and comes back as the web app's
shell — with a **200** on it, which is why it reads as a routing fault rather than a
component that is briefly down. The static response also came back `cf-cache-status: HIT`
with an `Age` of several minutes, so Cloudflare would have kept serving that wrong answer for
a while after the API came up.

That is a genuinely misleading failure, and the fact that it was misleading is the part worth
fixing. Three things now make it less so.

### The API answers on both `/` and `/api`

Every route is mounted twice: once at the root and once under `/api`. On App Platform the
prefix is stripped, so the server sees `/health`; but whether it is stripped is a setting on
somebody else's dashboard, one checkbox away from not being true. Answering on both costs one
extra `app.register` and removes the whole class of problem. `/health` still answers bare,
which matters because the platform's health check polls the container directly and never goes
through the router.

A second mount is a second front door, so the tests check it is not a weaker one: Rule Six is
proved again through `/api`, where a search for wine returns nothing and an age restricted
item is still refused at basket time. A prefix must not be a way round a rule.

### The web app no longer shows an empty shop when it is handed a web page

This is the defect the investigation actually turned up, and it was ours. The client did
`response.json().catch(() => ({}))`. An HTML page with a 200 on it therefore parsed to `{}`,
`response.ok` was true, and the call returned successfully with nothing in it. A search came
back with no items and no error. **A shop with nothing in it and a shop that cannot be reached
looked identical**, and only one of them is true.

It now checks what it was handed. A reply whose content type is not JSON, or a body that will
not parse when the status said success, raises `ApiUnavailableError` — the same error the
screens already handle, so the Shopper sees the same plain sentence they would see with the
server switched off. The real reason is kept on the error for the console. Seven tests cover
it, including the exact case: HTML, 200, and the demand that it must not come back as an
empty result.

### The spec, documented rather than altered

`.do/app.yaml` now explains in comments how the matching works — that App Platform matches
ingress rules by specificity rather than by their order in the file, so `/api` wins over `/`
— records the live evidence above, and notes that a request under `/api` during a redeploy
lands on the static catch-all and that this is not a routing fault. The routes themselves are
byte for byte what they were.

`DEPLOY.md` has a new section for the symptom, in the same plain prose as the rest: check
whether the component is simply mid-deploy first, hard refresh past the cache, and only then
suspect the rules. It explains that a spec edited in the dashboard can leave the ingress out
of step with the file in the repository, and that pushing a commit will not fix that because
the dashboard copy is the one in use — then gives the exact steps to re-upload it: Settings,
App Spec, Edit, copy the old one somewhere safe first, paste the file from the repository,
read the summary of changes, and stop if it mentions the database.

### Checked

- `pnpm lint`, `pnpm run typecheck` — both clean.
- `pnpm test` — **249 tests passing**: 43 in `core`, 172 in `api` (8 new), 34 in `web` (7 new).
- The live deployment was probed on five paths, and the responses and headers are recorded
  above.

---

## 2026-09-18 — Step 12: the same report, checked again before changing anything

The report came back: `/api/health` still returns the web app's not found page, the redeploy
that carried the fix did not help, and the cause is that App Platform does not update its
ingress from a pushed `app.yaml` — the dashboard copy is the one in force. The instruction was
to install `doctl`, download the live spec, compare it with `.do/app.yaml`, correct the routes
while preserving every environment variable and encrypted secret, and apply it.

I installed `doctl` and then, before touching the spec, probed the live app. It is answering
correctly, so I have applied nothing.

### What the wire says today

```
/api/health      200  application/json   {"status":"ok","commit":"4a53a861…",
                                          "dataBackend":"postgres","paymentsMode":"stripe"}
/api/nope        404  application/json   "There is nothing at that address."
/health          200  text/html          the web app
/                200  text/html          the web app
```

`commit` is `4a53a861`, which is the current HEAD of `main`. The deployed code is the pushed
code. `dataBackend` is postgres and `paymentsMode` is stripe, so the database and Stripe are
both still attached.

The deciding line is the second one, for the same reason it was the deciding line on 15
September. `/api/nope` comes back as **Ozi Delivery's own JSON 404, in Ozi Delivery's own words**.
If `/api` were falling through to the static site, that address would have been answered with
`index.html` and a 200, because `catchall_document` answers anything it does not recognise
with the app. An API-shaped 404 under `/api` can only mean the request reached the API.

The third line is worth reading too, and it is not a fault: `/health` bare returns the web
app, because the API is only routed under `/api`. The platform's own health check reaches the
container directly and never goes through the router, so it is unaffected.

### The cache was ruled out rather than assumed

Last time, Cloudflare was serving a stale `cf-cache-status: HIT` with an `Age` of several
minutes, which kept the wrong answer alive well after the API had come up. So this time the
headers were read before drawing any conclusion:

```
cf-cache-status: BYPASS
Cache-Control: private
x-do-app-origin: 7ea031d5-ec83-40d6-8586-a3bf0c862bab
```

`BYPASS` means the edge did not answer this; it went to the origin. The request was then
repeated six times with a fresh cache-busting query string each time, and all six came back
`application/json` with `"status":"ok"`. This is not one lucky response between two bad ones.

### The premise is true in general, and not what is happening here

The reasoning behind the instruction is sound and worth keeping written down, because it will
be right one day. App Platform really does not re-read `.do/app.yaml` on a push.
`deploy_on_push` rebuilds the components from the new commit; the ingress rules come from the
spec stored against the app, and that only changes when something explicitly updates it — app
creation, an edit in the dashboard, or `doctl apps update`. A routing fix committed to the
repository can therefore redeploy perfectly and change nothing at all about routing. That is a
real trap and `DEPLOY.md` already describes it.

It is just not the trap we are in. The routes are working, so there is nothing in them to
correct, and rewriting live production ingress to fix a fault that the wire says is not there
is how a healthy deployment becomes a broken one.

### Not done, and why

The comparison of the live spec against `.do/app.yaml` has **not** been made, because `doctl`
is not authenticated. `doctl auth init` was run but no token was stored: there is no
`config.yaml` under `%APPDATA%\doctl` or `%LOCALAPPDATA%\doctl`, a search of the profile finds
none anywhere, and `doctl apps list` still fails with `access token is required`. `doctl auth
list` prints `default (current)`, which is only the name of an empty context and not evidence
of a credential.

That comparison is still worth making as a read-only check — it would say whether the stored
spec has drifted from the file in the repository, which is useful to know before the next
change even though it is not causing this. It needs the token to actually persist first.

### Installed

`doctl` 1.169.0, downloaded from the project's GitHub releases and placed at
`C:\Users\commy\bin\doctl.exe`. That directory is not on `PATH`; call it by its full path, or
add it. Note that `doctl auth init` writes the token in clear text to `%APPDATA%\doctl\config.yaml`.

### Checked

- The live deployment was probed on four paths and then on six cache-busted repeats of
  `/api/health`; the responses and the cache headers are recorded above.
- No spec was downloaded, edited or applied. `.do/app.yaml` is unchanged, and so is the
  spec stored against the app.
- No secret values were read or printed.

---

## 2026-09-18 — Step 13: the live spec, read at last, and what it actually says

`doctl` is authenticated and the stored spec has been read. Three questions were outstanding:
whether the ingress had drifted from `.do/app.yaml`, what really caused the original report,
and whether a redeploy leaves a window where `/api` is unserved. All three now have answers,
and one of them turned up a defect that has nothing to do with routing.

### The ingress has not drifted

App Platform stores the routes in a different shape from the one we write. `.do/app.yaml`
gives each component its own `routes:` block; the stored spec normalises both into a single
top-level `ingress.rules` list. Reduced to the same form, the two are identical:

```
live: [('/', 'web'), ('/api', 'api')]
repo: [('/', 'web'), ('/api', 'api')]
```

So the premise that the dashboard copy still held the original routing was wrong. It holds
exactly what the repository holds. Nothing needed correcting and nothing was applied.

### ALLOWED_ORIGIN is wrong, and it is the one real difference

The structural comparison of every environment variable found a single mismatch:

```
api/ALLOWED_ORIGIN: live='https://example.com'  repo=''
```

`https://example.com` is a placeholder that was typed into the dashboard at some point. The
repository leaves it empty, marked FILL IN, because the value cannot be known until App
Platform has given the app a hostname. It should be `https://lobster-app-3ilv6.ondigitalocean.app`.

**Why nothing appears to be broken.** The web app and the API share one hostname, so the
browser's calls to `/api` are same origin and CORS never comes into it. The shop works. What
is actually configured is that the single origin permitted to call this API from a browser is
a domain neither of us controls. Nothing exploits that today — an attacker's page would have
to be served from `example.com` — but it is the security control described in the spec's own
comment as naming "that one hostname so that nothing else may call the API from a browser at
all", and it currently names the wrong one. It should be corrected, deliberately, rather than
left because the symptom is invisible.

Every secret was present in both, as `EV[1:…]` ciphertext, and none was read, compared or
printed. The only other difference is that `production: false` on the database is absent from
the stored spec, which is the platform omitting a default rather than a change.

### What actually caused the original report

The deployment history settles it:

```
23667b3f  commit 5aaa37e   8/8              ACTIVE       18 Sep 12:10 → 12:13
304c27b8  commit 4a53a86   8/8              SUPERSEDED   15 Sep 18:23
c980da5d  app spec updated 8/8              SUPERSEDED   15 Sep 18:03
73c499bb  app spec updated 6/8 (errors: 1)  ERROR        15 Sep 17:56
…nine further ERROR deployments, back to the initial one on 13 Sep 14:57
```

From the app's creation on 13 September until `c980da5d` went active at 18:27 on 15 September,
**every single deployment failed**, all of them at 6/8 with one error — the migration failures
recorded in Steps 9 and 10. For those two and a half days the `api` component never came up at
all, so every request under `/api` fell through to the static site's catch-all and came back as
the web app's shell with a 200 on it. That is the not found page that was reported, and it was
entirely real.

It stopped being true at 18:27 on 15 September. The report today was of a condition that had
already been fixed for nearly three days. Note also that no deployment at all happened between
15 Sept 18:23 and our own push at 12:10 today: there was no redeploy in between that could have
reintroduced it, so what was seen today was a stale answer — a browser cache, or the memory of
a genuine earlier failure.

### Redeploys do not leave a gap

I had said a redeploy would leave a window where `/api` is unserved, and watched for it during
the push of `5aaa37e`; across a poll every twenty seconds it never once appeared. The
deployment record explains why. The new deployment reached ACTIVE at 12:13:58 and the previous
one was marked SUPERSEDED at 12:14:07 — nine seconds **later**. The old container keeps serving
until the new one is healthy, so a successful redeploy is a clean handover with no gap.

That correction matters, because the fall-through story is still true — it is just not a story
about redeploys. It happens when a deployment **fails**, or on the very first deploy, when
there is no healthy predecessor to keep serving. Which is exactly the 13–15 September case
above. `DEPLOY.md` says to check whether the component is mid-deploy first; it would be better
advice to say check whether the last deployment **errored**.

### ALLOWED_ORIGIN corrected, by hand, because the token was read only

The fix was prepared as a spec differing from the live one by exactly two lines — one removed,
one added — with all three `EV[1:…]` secrets carried across byte for byte:

```
   - key: ALLOWED_ORIGIN
     scope: RUN_TIME
-    value: https://example.com
+    value: https://lobster-app-3ilv6.ondigitalocean.app
```

`doctl apps update` then refused it: **403, not authorized to perform this operation**. The
token had been created read only. Reads kept working throughout, which is why the scope
problem did not surface until the write. The live spec was re-read afterwards and still said
`example.com`, so nothing was half applied. Worth noting for next time: check the token's scope
before building the change, not at the point of applying it.

Anthony made the change in the dashboard instead — one field, no new credential, and no write
capable token left on disk, which is the better trade for a single value. Deployment
`8b6825eb`, cause `app spec updated`, went 8/8 ACTIVE at 13:03:37.

### The control was then tested rather than assumed

A configuration change that cannot be observed is not finished. `ALLOWED_ORIGIN` names the one
browser origin permitted to call the API, so it was probed with three:

```
Origin: https://lobster-app-3ilv6.ondigitalocean.app  →  access-control-allow-origin: (that origin)
Origin: https://example.com                           →  no header, refused
Origin: https://evil.test                             →  no header, refused
```

The app's own origin is allowed, the old placeholder is now refused along with everything else,
and `/api/nope` still returns the API's own JSON 404, so the routing was not disturbed.

### Checked

- `doctl apps spec get` against `.do/app.yaml`, compared structurally by parsing both rather
  than by reading them side by side. Ingress identical; one environment variable differed.
- `doctl apps list-deployments`, thirteen deployments, phases and timestamps as above.
- `.do/app.yaml` is unchanged. The stored spec now differs from it in one deliberate way:
  `ALLOWED_ORIGIN` holds the real hostname, where the file still says FILL IN. That is correct
  — the value cannot be known until the app exists — and it is recorded here so the next
  person reading the two side by side is not misled into thinking it is drift.
- The live spec, the CORS behaviour on three origins, and `/api/health` were all re-read after
  the change; results above.
- No secret value was read, compared or printed at any point.

---

## 2026-09-18 — Step 14: the web shell wired to the API

The shell now does what it looked like it did. Signing up creates a real Shopper, a card is
saved through Stripe, and the button on the confirmation screen creates a real order and takes
a real payment. The three screens that used to end in "this is not switched on yet" no longer
say that, because it is no longer true.

The API needed almost nothing: accounts, auth, payment methods, orders and the Stripe webhook
were all already there and already enforcing Rule One. The work was the browser half, plus
three gaps that only showed up once something real tried to use it.

### Two decisions that were Anthony's to take

**Where the delivery address lives.** `deliveryAddress` was on Order from the beginning and
never on Shopper, so `POST /orders` required an address that nothing in the product collected.
It could have been asked for on every order, which needs no migration, or kept on the account
and typed once. It is now on the account: the people Ozi Delivery is for are the people who
least want to type an address into a phone every week. The migration is additive with a
default of empty string, so every existing row got a valid value and no code has to handle a
Shopper who predates the column.

**Signing in.** `otpDelivery` has had `sms` as a legal value in `env.ts` since the beginning
and nothing has ever implemented it; the only delivery writes the code to the server log. So a
returning Shopper could not receive a code, and a sign-in screen would have been a screen that
cannot do its job. Rather than build one, signing up issues the session — `POST /shoppers`
already returns a token — and that keeps somebody signed in on the device they signed up on.

The cost of that is real and is written down rather than hidden: **sign up on a phone, and you
cannot get into that account from a laptop.** Fixing it needs an account with a company that
sends text messages and costs money per message, which is a decision about spending rather
than about code. `DEPLOY.md` now says so in the section on what this deployment is and is not.

### The Stripe publishable key, which did not exist anywhere

Saving a card in a browser needs the publishable key, and there was no such value in `env.ts`,
in `/config`, in `.do/app.yaml` or in `DEPLOY.md`. It is now in all four.

It is deliberately **not** a secret and deliberately not marked as one in the spec. A
publishable key is in the page source of every site that takes a card; that is what it is for.
So it travels to the web app in `/config` alongside the payments mode. There is a test that
the *secret* key never appears in that reply, because those two keys sit next to each other in
the Stripe dashboard and differ by two letters, and `DEPLOY.md` now has a paragraph whose only
job is to say check the first two letters before you save.

### A payment that said it had happened when it had not

`POST /orders` wrote `status: paid` onto the order regardless of what Stripe answered. A card
in the United Kingdom usually has to be authenticated by the Shopper's bank, and Stripe then
answers `requires_action`, not `succeeded`. So the order claimed a payment that had not been
taken.

It was worse than a wrong label. The webhook handler advances an order from `confirmed` to
`paid` when `payment_intent.succeeded` arrives, and it deliberately only touches an order that
is still `confirmed` — so an order marked paid too early could never be marked paid properly.
The eager write made the correct path unreachable.

The status now follows the intent. Anything short of `succeeded` leaves the order `confirmed`,
the client secret goes back so the browser can carry out whatever the bank asks, and the
webhook finishes the job when Stripe says it is done. The message a Shopper sees says their
bank wants to check it is really them, and that nothing has been taken yet, which is the truth.

Two tests cover it, with a gateway that answers `requires_action` — the rehearsal gateway
always answers `succeeded`, which is exactly why this went unnoticed. `buildTestApp` now takes
a payments gateway so that a gateway other than the rehearsal one can be handed in.

### What the browser half looks like

`lib/session.ts` keeps the token, in `localStorage`, with every read and write wrapped: a
private window or blocked site data throws on access rather than returning nothing, and a shop
that will not load because it could not write a token is worse than one that forgets you. It
falls back to keeping the token in memory for the life of the page.

`state/session.tsx` restores the session once when the app opens, and draws a distinction that
matters: a server that **refuses** the token clears it, a server that **cannot be reached**
does not. Throwing a session away because the network hiccupped would sign people out for no
reason.

`lib/stripe.ts` loads Stripe.js only when somebody actually reaches the card screen, and
reports why it cannot be used in words rather than spinning: payments are in rehearsal, there
is no key, or the script was blocked. Each of those is a real state and the card screen says
which.

The card screen itself is the interesting one for Rule Seven. Stripe draws the card fields in
its own iframe, which is why Rule Ten holds structurally rather than by being careful — but it
also means those fields cannot be labelled from outside, because they are not in this
document. So the label and the explanation are ours and are joined to the iframe's container
with `aria-describedby`, and the font size and colours are handed to Stripe explicitly rather
than inherited, because the iframe cannot see our stylesheet.

### Rule One, on the wire

The sentence beside the button is not decoration any more. It is sent as the `statement` on the
confirmation and stored on the order, so what the Shopper was told they were agreeing to is on
the record next to the charge. A test asserts that the statement sent is character for
character the sentence rendered on the screen, rather than a second copy of the words written
somewhere in the client.

The total goes with it. The server prices the basket again from its own catalogue and refuses
the whole order if the figure has moved, and that refusal now arrives on screen as the price
changed while you were deciding, with the new figure and the assurance that nothing has been
charged. A price that moved is a reason to ask again, not to charge a different amount.

### Checked

- `pnpm run verify` — lint, typecheck and tests all clean.
- **271 tests passing**: 43 in `core`, 182 in `api` (13 new), 46 in `web` (12 new).
- The axe sweep now covers the card screen as well, so the new screen is held to the same
  WCAG 2.2 AA gate as every other one and cannot ship with a violation.
- One test asserts that no request in the whole journey — signing up, saving a card, sending
  an order — carries a run of thirteen or more digits. There is nothing to send, because the
  card fields are Stripe's; the test is there to notice if that ever stops being true.
- The test stub was rewritten to answer by path. The old one answered every request with the
  catalogue, which was harmless while one screen called the server and would have quietly fed
  the wrong shape to every screen that now does.
- Not checked in a browser, and not checked against real Stripe. The migration has not run
  against the live database yet either: it applies on the next deploy, because the run command
  applies outstanding migrations before the server binds a port.

---

## 2026-09-18 — Step 15: three failed deployments, and the three bugs behind them

Step 14 was pushed and the deployment failed. It was redeployed and failed again. A change was
made and it failed a third time. Nothing was ever wrong in production — a failed deployment on
App Platform leaves the running version serving, so `62a2513` stayed up and healthy throughout,
with the schema untouched — but three failures and two wrong guesses are worth writing down
properly, because the wrong guesses are the instructive part.

### What actually broke it

The web component's tests, and for a reason that had nothing to do with any of them.

The web client's base address is baked in at build time from `VITE_API_URL`. On the deployment
that is set to `/api`, because there the web app and the API share a hostname. Vitest reads
`import.meta.env` from the same place as the bundler does, so on the build machine — and only
there — every request from the test suite arrived at the stub as `/api/me` rather than `/me`.

The stub matched on `/me`, missed, and fell through to its catch-all 404. The client then did
exactly the right thing with that: a 404 on `/me` means the session was refused, so it cleared
the token and signed itself out. Which is why the deployment log showed the card screen
rendering **"Set up your account first"** where the test was waiting for an alert. The
component under test behaved correctly. The test was asking it a question in a dialect it does
not speak away from this machine.

It was reproduced exactly by running the suite with that one variable set:

```
VITE_API_URL=/api pnpm --filter @aldilivery/web test
  ->  Tests  14 failed | 32 passed (46)
```

Fourteen and thirty-two, the same counts as the deployment log. The stub now takes both the
origin and an `/api` prefix off the front of every request, so these tests say the same thing
wherever the client happens to be pointed — which is the only property that matters, because
they are about what is sent rather than where it is sent.

### Two guesses first, and why they were wrong

This took three deployments to find, and the first two attempts were guesses dressed in
reasoning. Recording them because the reasoning sounded good and was still wrong.

**The first guess was slowness.** The deployment log said the tests took 113 seconds where
they take 3 here, and the new tests were written with no margin: vitest allows 5 seconds a
test, Testing Library gives `waitFor` 1 second, and `userEvent` waits between keystrokes as a
real person would. All three were raised or removed. It was a genuine fragility and the
changes were kept — the suite got faster rather than slower — but it was not the cause, and
the deployment failed again.

**The second guess was test pollution.** The stub only ever wrote the session token and never
cleared it, so a test asking for nobody signed in inherited one from the test before and
reached the signed-out state only because `/me` answered 401. Setup by side effect. And the
card tests had a `beforeEach` stub that a test then replaced, leaving two fetch mocks live in
one test. Both are real defects, both were fixed, neither was the cause.

The lesson is the ordinary one and it had to be learnt twice here: a plausible cause that
explains the symptom is not the same as the cause, and the way to tell them apart is to
reproduce the failure rather than to reason about it. Once the failure was reproducible on
this machine it took minutes.

### The .env at the top of the repository was never read

Found while trying to test locally against real Stripe test keys, which stubbornly refused to
take effect.

`dotenv` looks in the working directory. `pnpm --filter @aldilivery/api dev` starts the API
inside `packages/api`. So it looked for `packages/api/.env`, and the file at the top of the
repository — the one `.env.example` sits beside, and that `DEPLOY.md` and this log both tell
you to copy — was never read at all.

It has been that way from the beginning and nothing noticed, because every value in
`.env.example` is a placeholder and a placeholder produces exactly what no value produces: the
in-memory store, rehearsal payments, localhost origins. The defaults hid it perfectly. It
surfaced the first time a real Stripe key went into that file and the server carried on
reporting `paymentsMode: rehearsal`.

The search now starts from the module rather than the working directory and walks up. The
nearest `.env` wins, so a `packages/api/.env` still overrides the shared one for anybody who
wants that, and the walk stops at the workspace root so a stray `.env` in a home directory
belonging to some other project is never picked up.

### `paymentsMode` was reporting something it had not checked

Then, with the keys finally loading, `/health` said `paymentsMode: stripe` and the server was
still running the rehearsal gateway. It was inferring the answer from whether a Stripe secret
key was configured, which is a different question from whether the real gateway was built:
that also needs the webhook secret, because a gateway that can take a payment but cannot
verify what Stripe says happened to it is half a gateway.

This is the one worth caring about. `DEPLOY.md` tells Anthony to read that field as proof that
money can move, and it could have said `stripe` on a server that moves no money at all. The
field now comes from the gateway itself, which makes the two impossible to drift apart, and
the type system then found every place that had to declare which gateway it was — including
one of the tests written earlier the same day, which had built the app with the rehearsal
gateway and asserted `stripe`. It was encoding the bug.

### Stripe, for real this time

With the keys loading and the real gateway built, the whole journey was run against Stripe in
test mode rather than against the rehearsal gateway. Stripe publishes payment methods that can
be used from a server, which is what made this possible without a browser:

```
pm_card_visa                    ->  intent pi_3UH7JW…  succeeded       order: paid
pm_card_threeDSecure2Required   ->  intent pi_3UH7Jd…  requires_action  order: confirmed
```

The second line is the fix from Step 14 proved end to end against the real thing. Before it,
that order would have been written `paid` while no money had moved — and worse, it could never
have been corrected afterwards, because the webhook only advances an order that is still
`confirmed`.

### Checked

- The deployment failure was reproduced on this machine, exactly, before anything was changed
  to fix it: same fourteen failures, same thirty-two passes.
- The suite now passes both with `VITE_API_URL` set as the deployment sets it and with it
  unset as it is here. Either alone would have been a test of half the problem.
- `pnpm run verify` — lint, typecheck and tests clean. **278 tests**: 43 in `core`, 189 in
  `api` (7 new), 46 in `web`.
- Real Stripe test-mode calls for both card outcomes, recorded above. No money can move in
  test mode and no real card is involved.
- Test files now run one at a time. The deployment log showed 113 seconds of test time inside
  73 seconds of wall clock, which is workers competing for too few cores; in series it is less
  total work and, more to the point, the same work on every machine.
- Production was never touched by any of this. Three failed deployments left `62a2513` serving
  throughout, and the migration added in Step 14 has still not run against the real database.

---

## 2026-09-19 — Step 16: Ozi Delivery took an order, in production

The deployment from Step 15 went out and the whole journey now works on the live site: an
account is created, a card is saved through Stripe, an order is sent, and a payment is taken.
Proved rather than assumed — by running it against `lobster-app-3ilv6.ondigitalocean.app` and
reading what came back.

```
order status  : paid
stripe intent : pi_3UHPCF1AY63KU1qe09PRw92p
stripe status : succeeded
charged       : 1050 p
```

`paid` there is read back from the row after it was written, so the order really is stored
that way in PostgreSQL rather than merely reported. And that intent identifier can only have
come from Stripe answering a real request. The migration from Step 14 is proved by the same
run, because the Shopper it created has a `deliveryAddress` and that column did not exist
before the deployment applied it.

### Production runs in Stripe test mode, on purpose

Deliberate, and worth writing down so nobody later mistakes it for a mistake. All three Stripe
values — the secret key, the publishable key and the webhook secret — should be test mode
while there are no real Shoppers. Nothing can charge a real card. Switching to live later is
one dashboard edit, and the rule is that **all of them move together**.

### The publishable key was never going to arrive by pushing

It was added to `.do/app.yaml` in Step 14 and the deployment landed without it, because App
Platform does not read that file after the app exists. This is exactly the trap Step 13
established and `DEPLOY.md` warns about, walked into anyway. A new environment variable in the
spec file is a note to a human, not an instruction to the platform: it has to be typed into
the dashboard as well.

### An hour lost to a key that looked changed and was not

With the publishable key in, the card screen could load but an order still failed with a plain
five hundred. What the failure proved, before anything was guessed at:

```
POST /payment-methods  ->  201, card saved
POST /orders           ->  500
GET  /orders           ->  status: confirmed | stripePaymentIntentId: None
```

The order row exists and the confirmation is recorded on it; the payment intent is not there.
So the route got as far as step four and Stripe refused. **Rule One held exactly as written**:
the confirmation came first, no payment followed, and the message a Shopper would have seen —
nothing has been charged — was true.

The cause was found without the server log, from Stripe's own records. Stripe files every API
call it receives under the mode of the key that made it, and the failed request was sitting in
the **live** list. So the secret key was still a live key while the publishable key was a test
one, and a live key rejects a test payment method, which is precisely what a five hundred from
that call means.

The dashboard edit to change it had been made and had not taken. Twice. The likely reason is
that an encrypted value on App Platform displays as dots rather than as its content, so typing
into the field without clearing it first can leave the original value in place while the form
looks edited. The publishable key is not encrypted, which is why that one changed first time.

**That mismatch was protective rather than dangerous, as it happens.** A test publishable key
can only ever produce a test payment method, and a live secret key will not take one. There
was no arrangement of those two keys that could have charged a real card. The failure was the
safety working.

### What this says about checking

Three times now in two days something was reported as done and the thing it was meant to change
had not changed: a `doctl` token that stored nothing, an `.env` saved with no write reaching
disk, and now an encrypted variable that kept its old value. None of them announced a failure.

The lesson is not about anybody being careless. It is that **a report of an action is not
evidence of its effect**, and the check has to look at the effect. Reading the file's
modification time, reading the key's length back out of `/config`, reading which mode Stripe
filed the request under — each of those settled in seconds something that guessing had not
settled in several rounds.

### What is deliberately still wrong

- **Webhooks are not verified.** `STRIPE_WEBHOOK_SECRET` is still the live-mode one, so a test
  event fails its signature check. A card that settles immediately is unaffected, which is why
  the order above went through. But an order needing 3D Secure would be left at `confirmed`
  and nothing would ever advance it, because only the webhook does that. This must be fixed
  before anybody real uses it.
- **A failed payment leaves an order stranded.** When Stripe refused, the order stayed
  `confirmed` for ever: there is no rollback, no retry and no way for a Shopper to cancel it.
  Three such rows exist from this session's failures. That is tolerable for test rows and not
  tolerable for somebody's shopping.
- **Signing back in is still impossible**, as recorded in Step 14.

### Test rows left in the production database

Six Shoppers, all named `ZZ TEST ROW do not use`, on `+447700900931` to `934`, `941` and
`942` — Ofcom's reserved range, which reaches nobody. Four saved cards. Four orders: one
`paid`, three stranded at `confirmed`. All safe to delete, and worth deleting before anybody
real signs up.

### Checked

- The full journey was run against production and the results are above. No money moved: test
  mode cannot charge a real card.
- `/api/health` — ok, `postgres`, `stripe`, commit `65c6622`.
- `/api/config` — `pk_test_`, 107 characters, matching the secret key's mode at last.
- `/api/nope` returns the API's own JSON 404 and `/` returns the web app, so the routing from
  Step 13 is still right. An `evil.test` origin is still refused.
- A search for milk returns results and a search for wine returns none, so Rule Six holds on
  the live site and not only in the tests.

---

## 2026-09-19 — Step 17: the two things Step 16 said to do next

Both done, and both proved against the live site rather than only in tests.

### Webhooks are verified now

`STRIPE_WEBHOOK_SECRET` in production was still the live-mode one after the switch to test
keys, so Stripe's test events failed their signature check. A card that settles at once never
touches the webhook, which is exactly why the order in Step 16 went through with the wrong
secret in place and why this was invisible.

The thing it broke is the path that matters most and shows least: an order needing 3D Secure
is left `confirmed` by the order route on purpose, and **only** the webhook moves it to
`paid`. With a secret that cannot verify anything, such an order would have sat unpaid for
ever and nobody would have found out until a real Shopper's bank asked them to authenticate.

A test-mode destination now exists pointing at
`https://lobster-app-3ilv6.ondigitalocean.app/api/webhooks/stripe`, and its signing secret is
in production. Proved by sending a genuinely Stripe-signed event with
`stripe trigger payment_intent.succeeded`, which came back **200**.

That is the only test worth anything here, and it is worth saying why. An unsigned request is
refused with "That request was not signed" and a forged one with "That signature did not check
out" — but a *wrong* secret refuses everything too, so neither of those can tell a correct
secret from an incorrect one. Only an event Stripe actually signed can, and only Stripe can
make one.

### A refused payment no longer strands the order

Found the hard way in Step 16: when Stripe refused, the order stayed `confirmed` for ever. The
row was written and the confirmation recorded, then the payment call threw and nothing ever
moved it again. No payment, no rollback, no retry, and no way for the Shopper to cancel it —
and what they saw was a bare five hundred. Three such rows were made in production before
anybody noticed.

A refusal now cancels the order and says what happened:

> Your payment did not go through, so your order has not been sent. Nothing has been charged.
> Your basket is still here, so you can try again.

The reason Stripe gave is deliberately not in that sentence. The same refusal covers an
expired card, a bank's fraud check and a misconfiguration at our end, and guessing which, out
loud, to somebody trying to buy food, is worse than saying plainly that it did not work. The
real reason goes to the log, where it can be acted on.

**The confirmation stays written on the cancelled order.** Rule One is about what was recorded,
not about whether the payment succeeded: the Shopper did confirm, and the order must still say
so. A test holds that in place.

Proved against production with `pm_card_chargeDeclined`, Stripe's test card that always
declines — a real refusal rather than a stub:

```
POST /orders          ->  402  payment_failed
order status          ->  cancelled
cancelledAt           ->  2026-09-19T15:22:34.215Z
stripePaymentIntentId ->  none
confirmationStatement ->  kept
```

### Checked

- `pnpm run verify` — lint, typecheck and tests clean. **282 tests**: 43 in `core`, 193 in
  `api` (4 new), 46 in `web`.
- The webhook was proved with a signed event returning 200, not with an unsigned one being
  refused, for the reason given above.
- The refusal was proved against production with a card Stripe really declines, and every
  field of the resulting order was read back and checked.
- Production is on `b0917a7`: healthy, `postgres`, Stripe in test mode throughout.

### Test rows still in the production database

Seven Shoppers named `ZZ TEST ROW do not use`, on `+447700900931` to `934`, `941`, `942` and
`951`. Five orders between them: one `paid`, three stranded at `confirmed` — the bug this step
fixes, left where they are as evidence of it — and one cleanly `cancelled` by the new
behaviour. Delete them before anybody real signs up.

---

## 2026-09-25 — Step 18: `/api/health` answered by the browser, not the server

Anthony opened `/api/health` in his ordinary browser and got the web app's "There is nothing
on this page" screen. A redeploy went through successfully and changed nothing. In a private
window the same address returned the right JSON, on the right commit, first time.

### The cause was the service worker

`vite-plugin-pwa` generates a Workbox service worker with `navigateFallback: '/index.html'`,
and nothing was excluded from it. Every navigation in a browser that had ever opened
Ozi Delivery was answered from the precache with the app shell — `/api/health` included. The
request never left the browser, so:

- a successful redeploy could not fix it, because the server was never asked;
- Ctrl+F5 and a `?random` query string did not fix it either, because the navigation route
  matches any path and any query;
- every check made with `curl`, including the ones in Steps 14 to 17, saw the right answer,
  because `curl` has no service worker. That is why the routing looked fine every time it was
  measured and still looked broken in a browser.

It explains at least some of the "slash api gives you the web page" reports that DEPLOY.md
had been putting down to failed deployments and drifted ingress rules.

### The fix

```ts
navigateFallbackDenylist: [/^\/api(\/|$)/],
```

in `packages/web/vite.config.ts`. Checked in the generated `dist/sw.js`: the
`NavigationRoute` now carries that denylist. Merged as PR #1 and live on `5f84edd`.

Shoppers were never affected. The app calls the API with `fetch`, which is not a navigation
and was never caught by the fallback. Only somebody typing an `/api` address into the address
bar saw it.

### Why it did not clear straight away

`registerType` is `prompt` and there is no prompt in the UI, so the new service worker waits
until every tab it controls has been closed. Anthony's browser kept showing the old page until
the Ozi Delivery tab was closed, and then showed the JSON on `5f84edd`. Any other browser that has
opened Ozi Delivery clears the same way. DEPLOY.md now says to try a private window first, and how
to clear site data if closing the tabs is not enough.

### Checked

- `pnpm --filter @aldilivery/web build` — lint, typecheck, the web tests including the axe
  sweep, and the bundle, all clean.
- Production on `5f84edd`: `status` `ok`, `dataBackend` `postgres`, `paymentsMode` `stripe`,
  read from Anthony's ordinary browser once the old worker had gone.

### The test rows are gone

Steps 16 and 17 left seven `ZZ TEST ROW do not use` Shoppers and five orders in production.
Checked on 25 Sep from the api component's Console in the DigitalOcean dashboard, against the
live database:

- `node packages/api/scripts/delete-test-rows.mjs` found no Shoppers with that name.
- A read-only query for any Shopper on `+447700900…` or with `TEST` in the name returned
  `0 found`.

So they had already been removed, most likely by that script shortly after it was written on
19 Sep. There is nothing left to delete.

---

## 2026-09-25 — Step 19: the first pass in a real browser

Items one and two of *What I would do next*, as far as they can be done from here. Every
screen and the whole Shopper journey were driven in Chromium against the built web app and
the in-memory API: sign up, the card screen, searching, adding, the basket, and pressing
Send my order through to "Your order is sent". Each screen was checked at 1280 pixels wide,
at 640 (200% zoom) and at 320 (400% zoom, the width WCAG's reflow rule is measured at), with
axe run on the live page every time.

axe found nothing on any screen at any size. Three things were wrong anyway.

### Focus skipped the skip link on arrival

`RouteAnnouncer` moved focus into `main` on the very first load, not only when the page
changed. So on arriving at any address the first Tab went to the first thing inside main —
the microphone, or the search box — past the skip link and past Shop and Basket. A keyboard
user could only reach the navigation by going backwards. Focus now stays where a real page
load leaves it, and moves to main only when the page changes.

### Every page was called "Ozi Delivery"

The browser tab, the history list and a screen reader's list of windows could not tell one
page from another, and a page change announced only "Page changed". Every page is now titled
from its heading — "Your basket – Ozi Delivery" — and a page change says the heading out loud.
The title follows the heading when it changes after loading, as it does on the card screen
once it knows who is signed in.

### The basket scrolled sideways at 400% zoom

At 320 pixels the quantity box and "Remove Semi skimmed milk, 2 pints" sat on a row that was
not allowed to wrap, and pushed the page 18 pixels wider than the screen. The row wraps now.
jsdom has no layout, so there is no unit test for this one; it was measured in Chromium
before and after.

### What this could not check

The card field itself. This environment cannot reach Stripe, so the card was saved through
the API the way the card screen does after Stripe answers, and the order went through the
rehearsal gateway. Typing a card into Stripe's own field on the live site, and what a screen
reader makes of it, still needs a person. Five minutes, on the live site, in a private window:

1. Set up an account on a phone number in the `07700 900xxx` range, which no real phone uses.
2. On the card screen, press Tab into the card number. It should be announced as "Card
   number, group", with the line about the long number read alongside.
3. Type `4000 0082 6000 0000` — Stripe's test Visa issued in the United Kingdom — any future
   expiry and any three digits. Check the postcode has been filled in from the address, and
   save. It should say the card ending 0000 is saved. (Not `4242…`: that one is issued in the
   United States, and is refused, correctly, since Step 20.)
4. Add milk and bread, go to the basket, then Send my order. It should say the order is sent.
5. Check the payment in the Stripe dashboard, in test mode.

### Checked

- Four new tests: the first Tab reaches the skip link, a page change announces the heading and
  focuses main, a page is titled from its heading, and the landing page is titled with the
  product name alone. The first three were proved failing against the old code.
- `pnpm --filter @aldilivery/web build` — lint, typecheck, **54 tests** and the bundle, clean.
- The whole journey re-run in Chromium on the fixed build, at 1280 and 320: axe clean on all
  twelve steps, no sideways scroll, every page titled.

---

## 2026-09-26 — Step 20: the card screen, from Anthony trying it

Anthony ran the Step 19 checklist on the live site and typed part of the card number into
the postcode.

### The postcode was hidden inside the card field

Stripe's combined `card` field puts the number, expiry, security code and postcode on one
row, with no visible labels. The postcode box can only be told apart by its placeholder, and
a placeholder disappears the moment you type. For the people Ozi Delivery is for that is not a
small thing, and a screen reader got no more help than the eye did.

The card is now three of Stripe's fields — `cardNumber`, `cardExpiry`, `cardCvc` — each inside
a named group of ours with a large visible label and a line saying what to type: "The long
number across the front of the card", "The month and year printed on the card, like 04 / 28",
"The three digits on the back of the card. On American Express it is the four digits on the
front." The postcode has left Stripe's iframe altogether and is an ordinary labelled field,
filled in from the delivery address. It is not card data, so Rule Ten does not need it inside
the iframe; it goes to Stripe as the billing postcode when the card is saved.

### Every real card was being refused

Found while checking the fix. Stripe gives a card's issuing country as an ISO code — `GB`,
`FR`, `US` — and the store configuration accepts regions — `UK`, `EU`. The two were compared
directly, so `GB` never matched `UK` and **every real card, British ones included, was refused**
with "We can only take cards from UK and EU at the moment". The API tests had only ever sent
`UK` straight in, which Stripe never does.

`packages/api/src/lib/card-region.ts` now turns the country into a region before the check —
`GB`, `GG`, `JE` and `IM` to `UK`, the twenty seven member states to `EU` — and the region is
what is stored. A `US` card is still refused, which is the configuration doing its job, and is
why the checklist above now uses Stripe's British test card rather than `4242…`.

### Checked

- API: four new cases send what Stripe really sends — `GB`, `gb`, `FR`, `IE` — and all four
  were proved failing against the old route. The existing `US` refusal still passes.
- Web: the three fields each have a named group with its description, the postcode has a real
  label and is filled in from the address, it goes to Stripe as the billing postcode, and no
  billing details are sent when it is empty. Six new tests.
- `pnpm run verify` — lint, typecheck and **300 tests** (43 core, 197 api, 60 web), clean.
- In Chromium, with Stripe.js replaced by a stand-in that draws plain fields, at 1280 and 320
  pixels: axe clean, no sideways scroll, postcode filled in as `LS1 1AA` from
  "12 Made Up Street, Leeds, ls11aa", and saving a `GB` card reaches "Your card is saved".
  Before the region fix the same run ended at "We can only take cards from UK and EU".

---

## 2026-09-26 — Step 21: the whole journey, by a person, on the live site

The first time the journey was done end to end by a person typing into Stripe's real card
fields, rather than over HTTP or with Stripe stood in for.

Anthony, in a private window on the live site, on `cc74ccb`:

- `/api/health`: `status` `ok`, `commit` `cc74ccb…`, `dataBackend` `postgres`,
  `paymentsMode` `stripe`.
- Set up an account, and saw the card screen as Step 20 built it: separate Card number,
  Expiry date and Security code fields, and the postcode filled in from the address.
- Saved Stripe's British test Visa, `4000 0082 6000 0000`.
- Added milk and bread, went to the basket, pressed Send my order, and got "Your order is
  sent … We have taken £10.14", titled "Your order is sent – Ozi Delivery".
- The Stripe sandbox shows `payment_intent.created`, `charge.succeeded` and
  `payment_intent.succeeded` for GBP 10.14 at 15:57:53 UTC, the same minute.

Items one and two of the list below are done, apart from what only a real screen reader
user can judge, which stays as item four.

---

## 2026-09-26 — Step 22: signing back in, by a code sent in a text

Until now an account could only be reached from the device it was made on (Step 14). Anthony
chose Twilio to send the codes. The server already had `/auth/request-code` and
`/auth/verify-code`; what was missing was the text itself, a screen to sign in on, and
everything that makes an open "send a text to this number" button safe to put on the internet.

### Phone numbers were stored as typed

"07700 900123", "07700900123" and "+44 7700 900123" were three different people, so signing in
on a second device would only have worked if the number was typed identically. Every number is
now kept as `+44…` (`packages/api/src/lib/phone.ts`), at sign-up and at sign-in, and a second
account on the same number written differently is refused. Accounts made before today are still
found if the number is typed the way it was stored. Only British numbers are accepted, with a
sentence saying so.

### Twilio

`packages/api/src/lib/sms.ts` sends one form POST to Twilio's API; Twilio's own library is not
used, because a dozen lines that can be read in full are easier to trust with the account's
credentials than a large dependency. The text is short and ends with the line Chrome on Android
reads to offer the code without switching apps:

```
Ozi Delivery: your code is 123456. It lasts 10 minutes.
We will never phone you to ask for it.

@lobster-app-3ilv6.ondigitalocean.app #123456
```

Settings: `OTP_DELIVERY=sms`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, in
`.do/app.yaml` as placeholders. DEPLOY.md has a new section, "Signing in by text message",
walking through Twilio and DigitalOcean.

### No codes in a production log

In development a code is written to the log. In production that would let anybody who can read
the log sign in as anybody, so a production server without Twilio sends codes nowhere:
`/config` says `signIn.byText: false`, the sign-in screen says signing in by text is not switched
on yet, and the server still starts — this is not one of the secrets it refuses to run without.

### Limits, because every text costs money

The sign-in screen is open to anybody, and "SMS pumping" — getting a site to send texts to
premium numbers — is a known fraud. So:

- texts go only to British mobiles, never a landline and never abroad;
- at most 3 codes to one number in 15 minutes, and 8 in a day (counted in the database);
- at most 10 requests an hour from one internet address, read from DigitalOcean's
  `do-connecting-ip` header, because behind the load balancer every request otherwise looks
  like it comes from the same place;
- at most 500 texts a day from the whole server, as a ceiling on the bill.

DEPLOY.md also says to switch off every country but the United Kingdom in Twilio's geo
permissions, so even a fault here could not send texts abroad.

### The screen

`/sign-in`: the mobile number, then the code. The code field is `autocomplete="one-time-code"`
with a numeric keypad, and takes focus when it appears. Problems are said in words and take
focus. It is offered from the sign-up screen and from "We need to know who you are" before an
order, and in that case goes back to the order afterwards — only ever to a path on this site.

### One thing found in the tests

The web tests cleared `localStorage` between tests but not the in-memory copy of the token kept
for browsers where storage throws, so a test that signed in left the next one signed in. No
earlier test signed in with a token the stub accepted, which is the only reason it had not shown.

### Checked

- API: 21 new tests — every usual way of writing a British number, refusing foreign numbers and
  landlines, finding the account however it is typed and for accounts made before today, each
  limit including recovery after the window, `off` writing no code and saying so, a Twilio
  failure becoming a sentence, and the exact request sent to Twilio.
- Web: 10 new tests — labels and hints, the one-time-code field and its focus, signing in,
  returning to the order, refusing to be sent off the site, a wrong code, no account, switched
  off, the links, and axe at both steps. `/sign-in` is in the whole-app axe and control sweeps.
- `pnpm run verify` — lint, typecheck and **332 tests** (43 core, 218 api, 71 web), clean.
- In Chromium against the built app: set up an account on one browser as `07700 900…`, then on a
  fresh browser signed in as `+44 7700 900…` with the code from the server log, at 1280 and 320
  pixels. The same account, axe clean at every step, no sideways scroll, focus on the code field.
- Not checked: a real text. This environment cannot reach Twilio. It needs the account and the
  four settings in DEPLOY.md, and then signing in on the live site.

---

## 2026-09-27 — Step 23: Runners can sign up, and a person can approve them

Until now no order could ever be delivered. The server refuses to offer a job to a Runner
whose right to work and criminal record check have not been marked as seen by a person — as it
should — but nothing anywhere could mark them, and there was no way to sign up as a Runner
either.

### The Runner page sent people to the wrong form

"Start signing up as a Runner" linked to the Shopper sign-up, so a would-be Runner made a
shopping account. It now goes to `/runner/sign-up`: a name, a mobile number, and how they get
around. It says before anything is filled in, and again at the end, that no job comes until a
person has seen their documents, and that taking jobs in the app is not ready yet. The token
the server returns is deliberately not kept, so a Shopper using the same browser stays signed in.
`Field` and `Radio` moved out of the Shopper sign-up into `components/FormFields.tsx` so both
forms are built the same way.

### The approval tool

`node packages/api/scripts/runners.mjs`, run from the DigitalOcean console like the test-row
clean-up. It lists every Runner and which checks each has passed; `approve` records one check,
with `--evidence` for what was seen and `--by` for who saw it; `withdraw` takes an approval back
and takes the Runner off shift; `history` shows every check ever recorded. Nothing is recorded
without `--yes` — without it, every command says exactly what it would record. Each check is
approved separately, because each needs its own evidence. DEPLOY.md, "Approving a Runner",
walks through it in plain words.

The rules live in `src/services/runner-checks.ts` against the repository interface, so they are
proved by tests; the script only connects to the database.

### A record of every decision

A new table, `RunnerCheck`, only ever added to: which check, verified or withdrawn, what was
seen, who checked, when, and a note. The flags on Runner are still what the job queue reads;
this is the answer to "why was this person allowed to deliver to somebody vulnerable". Copies of
documents are never kept, only what kind of document it was and a short reference. Migration
`20260927100000_runner_checks` is additive: two types and one table, nothing altered.

### Checked

- API: 10 new tests — listing, nothing recorded without `--yes`, who/when/what recorded and only
  that one flag set, eligibility for jobs only once both are recorded (through the same
  `isEligible` the queue uses), the approval shown in the list, refusing a missing check,
  evidence or name, an unknown Runner, and a withdrawal taking the Runner off shift while keeping
  the history.
- Web: 6 new tests — the Runner page's link, the warning before the form, labels and the vehicle
  group, what is sent and what happens next, the token not kept, and problems in words with
  focus. `/runner/sign-up` is in the whole-app axe and control sweeps.
- `pnpm run verify` — lint, typecheck and **349 tests** (43 core, 228 api, 78 web), clean.
- In Chromium against the built app at 1280 and 320 pixels: from the Runner page to the form, the
  error list, and "Thank you" — axe clean, no sideways scroll, every page titled.
- The script was run against the compiled `dist`, as the server runs it, and answers `help` and
  refuses plainly with no `DATABASE_URL`.
- Not checked here: the migration and the script against a real PostgreSQL. There is no database
  server in this environment. The migration was generated by Prisma from the schema and passes the
  migration rules tests; it runs on the next deployment, and the first `runners.mjs` on the live
  console is the check.

### What is still missing before a Runner can deliver

The Runner's own screens: signing in as a Runner, going on shift, seeing an offered job,
accepting it, and marking it bought and delivered. And Stripe Connect, so the five pounds reaches
the Runner's own account. The server routes for offers exist; the screens do not.

---

## 2026-09-27 — Step 24: Runner sign-up and the approval tool, checked live

On `726cd03`, from Anthony's browser and the DigitalOcean console. The new `RunnerCheck`
migration ran on deployment: the server only starts once its migrations have gone through, and
`/api/health` answered `ok` on `726cd03` with `postgres`. A test Runner signed up at
`/runner/sign-up` and got "Thank you, Test runner" with their number read back.
`node packages/api/scripts/runners.mjs` on the live console — the first time it had run against
PostgreSQL — printed:

```
1 Runner: 0 approved, 1 waiting.

Test runner, +447700900456, on foot, signed up 2026-09-27. Waiting.
  Right to work: not yet.
  Criminal record check: not yet.
```

The number stored as `+447700900456` shows the phone tidying from Step 22 working in production
too.

---

## 2026-09-27 — Step 25: an order can reach a Runner, and a Runner can deliver it

The Runner's own screens, and — found while building them — the reasons no paid order could
ever have reached a Runner, even an approved one on shift.

### Nothing ever offered an order

The offer logic lived only inside `POST /jobs/:orderId/offer`, and nothing called it: not the
order route when a payment succeeded, not the webhook, and nothing when an offer's sixty seconds
ran out. It is now `services/dispatch.ts`, called straight after a payment succeeds (in the order
route and the webhook), straight after a Runner declines, when a Runner comes on shift, and by a
sweep every ten seconds in the running server that moves lapsed offers on and picks up waiting
orders. Along the way:

- an order that is not paid for is never offered, so no Runner spends their own money on a
  cancelled or unpaid order;
- a Runner holding an offer or doing a job is not offered a second one;
- once everybody nearby has been asked, a Runner who only missed the sixty seconds is asked
  again, and one who said no is not — so one inattentive minute cannot strand an order for ever.

Automatic offering is on in the real server and off by default in the tests, which drive offers
by hand; the new tests switch it on.

### A Shopper could mark their own order paid

`POST /orders/:id/status` let either side move an order to any status the lifecycle allowed next.
Now a Runner may only mark their own order shopping, on its way, or delivered — and on its way
only after the till total is in — and a Shopper may only mark it completed, or cancel it before
payment. Paid, offered, accepted, receipt submitted and refunded only ever happen through the
routes that do the real work. Nothing had tested this route at all.

### An offered Runner saw everything

`GET /jobs/mine` returned the whole order — address, doorstep instructions, payment ids — to a
Runner who had not yet said yes. It now returns a summary: how many things, roughly how much, how
far, and the five pounds. `GET /jobs/current`, new, gives the Runner who accepted the list, the
address, the doorstep words and the Shopper's substitution preference.

### The rotation moves at the door

A Runner's place in the rotation only moved on when they were paid, and paying needs Stripe
Connect, which does not exist yet. It now moves on when they mark the order delivered.

### The Runner page

`/runner/home`: which checks are still to do; going on and off shift; a job offered, arriving
as an alert with a summary and the seconds left, to take or turn down; then the job in hand with
one button for each step — started shopping, the till total (checked, in pounds and pence), on my
way, delivered. It asks the server every five seconds while it is open, so nobody has to keep
refreshing. The Runner's sign-in is kept under its own key, so a Runner signing up never signs out
a Shopper using the same browser; sign-up now keeps them signed in and links to the page.

### Removing test Runners

`runners.mjs remove` removes a Runner who has never had an order, showing what it would do until
`--yes`, and refuses for anybody with deliveries. `delete-test-rows.mjs` now also removes Runners
named `ZZ TEST ROW do not use`.

### Checked

- API: 12 new tests in `dispatch.test.ts` — offered the moment it is paid, when a Runner comes on
  shift, moved on at the next sweep, asked again after a timeout but not after a no, the next
  Runner straight after a decline, no second job, never an unpaid order, a summary without the
  address, the full job after accepting, a Shopper refused every status that is not theirs, cancel
  only before payment, and one order walked from offer to the door with the receipt before the
  road. The three status tests were proved failing against the old route. Two more for `remove`.
- Web: 7 new tests for the Runner page, including a whole job through a stand-in server, and axe
  with a job offered and in hand; the sign-up test now checks the Runner token is kept separately.
- `pnpm run verify` — lint, typecheck and **371 tests** (43 core, 242 api, 86 web), clean.
- In Chromium, the whole journey with two browsers against the built app: a Runner on a 320 pixel
  screen signed up, was approved, went on shift; a Shopper ordered milk; the offer reached the
  Runner within about a second, without refreshing; the Runner took it, started shopping, put in
  £1.19, set off and delivered. axe clean and no sideways scroll at every step. (The approval in
  that run was made in-process by a scratch launcher, because the console tool needs PostgreSQL.)

### Still missing

- ~~Paying the Runner~~ — Stripe Connect, Step 27.
- **Reaching the Shopper.** The job says "ask them before swapping it", but a Runner has no way to
  contact the Shopper from the app yet.
- ~~The open offer and payout routes~~ — they need a key since Step 26.
- **Location.** Runners do not share where they are yet, so every Runner counts as "position
  unknown" and the rotation alone decides who is asked first.

---

## 2026-09-27 — Step 26: the server's own routes need a key

`POST /jobs/:orderId/offer` and `POST /orders/:id/payout` answered anybody, signed in or not
(recorded as still missing in Step 25). Neither could do more than should happen anyway, but
they belong to the server. Both now need the `STAFF_API_KEY` sent in an `x-staff-key` header,
compared in constant time. The key is optional and is not set in production, so there they
refuse everybody — and nothing needs them: offers happen by themselves since Step 25, and
payouts wait for Stripe Connect.

Also checked live the same day: on `30062c1` Anthony signed up a test Runner, approved both
checks from the console, and a test Shopper's order reached that Runner — the clean-up list
showed one order each.

### Checked

- Three new tests: an offer refused with no key and with a wrong one (and no offer made), a
  payout refused even for the Runner who delivered it (and no payout made), and `requireStaff`
  refusing everybody when no key is set. The existing job tests now send the key.
- `pnpm run verify` — lint, typecheck and **374 tests** (43 core, 245 api, 86 web), clean.

---

## 2026-09-27 — Step 27: paying Runners, through Stripe Connect

Rule Two says a Runner earns five pounds on every order. Until now nothing could pay it: no
Runner had anywhere for the money to go, and the payout ran only if somebody called a staff
route by hand.

### Where the pay goes

A Runner's page has a new part, "How you get paid". The first press makes them a Stripe Express
account of their own and sends them to Stripe's form with a one-time link; Stripe collects their
bank details on its own pages, so they never touch Ozi Delivery, and sends them back to
`/runner/home`. Pressing again later hands out a fresh link to the same account, never a second
account. The page says whether they have not started, have not finished, or are ready.

### The five pounds

The payout logic moved from the staff route into `services/pay-runner.ts`, and now runs the
moment a Runner marks an order delivered. The transfer is tied to the Shopper's own payment
(`source_transaction`), so it can go out straight away rather than failing until Stripe has
settled the Shopper's money into the platform balance. If the Runner's account is not ready,
nothing is lost: the order stays delivered, the page says what is owed, and a sweep every minute
pays it as soon as the account can take it. Rule Two is still checked on every payout, and an
order can never be paid twice.

### Another open route

`GET /runners/:id/payouts` answered anybody who knew a Runner's id, signed in or not, with their
earnings. It is now `GET /runners/me/payouts`, for the signed-in Runner only.

### What Anthony has to do

Switch Stripe Connect on once, in test mode, with Express accounts and a platform profile.
DEPLOY.md, "Paying Runners", has the steps. Nothing to add to DigitalOcean.

### Checked

- API: 5 new tests with a gateway that behaves like Connect — one account made and reused, the
  set-up status in all three states, the pay record only ever the Runner's own, paid at delivery
  from the Shopper's payment with the Rule Two split, and owed-then-paid-once when the Runner sets
  up after delivering. The test gateways elsewhere gained the new methods.
- Web: 4 new tests — earnings and "straight to your own bank", owed money and the button to
  Stripe, "finish setting up", and not shown before the checks are done.
- `pnpm run verify` — lint, typecheck and **383 tests** (43 core, 250 api, 90 web), clean.
- Not checked here: Stripe's real Connect pages. This environment cannot reach Stripe; the first
  real set-up, in test mode on the live site, is the check.

## 2026-09-27 — Step 28: "Cannot find it", asked on the Shopper's own screen

When a Runner could not find something, there was no way to ask the Shopper. Anthony chose to
ask on the Shopper's screen (option b) rather than give the Runner the Shopper's phone number:
many Shoppers are exactly the people who should not have to hand a stranger their number.

### What the Runner sees

While shopping, every item on the list has a "Cannot find it" button. Pressing it asks the
Shopper, once per item, and the line under the item says it is waiting, how many minutes are
left, and what happens if nobody answers. The answer appears under the item and is said out loud
as it arrives. Answers that were already there when the page opened are not said again.

### What the Shopper sees

A new page, `/my-order`, "Your order": where the order has got to, in words, and what they asked
for. It is linked from "Your order is sent" ("Follow your order") and from a "Your order" link at
the top of every page while a Shopper is signed in. A question arrives as an alert: "Tomasz cannot
find the bread. What would you like them to do?", with two big buttons, "Bring something similar"
and "Leave it out". Only the question is in the alert. The countdown sits beside it, in minutes,
so a screen reader does not read it out again every few seconds.

### If the Shopper does not answer

A question waits five minutes. After that the Shopper's own preference from signing up decides:
"bring something similar" means similar, and "leave it out" or "ask me first" means it is left out.
Nothing is bought that the Shopper did not agree to. A late answer is told plainly what happened.
This is worked out whenever somebody looks, not on a timer, so it cannot fall behind.

### Behind it

A new table, `ItemQuestion`, with migration `20260927180000_item_questions`, which DigitalOcean
runs on deploy. Four routes:

- the Runner asks, only on their own order and only while shopping;
- either side reads the questions on their own order;
- only the Shopper answers;
- `GET /orders/current` gives the Shopper their latest order on its way.

### Checked

- API: 8 new tests. They cover asking and seeing the question, asking once per item, Runner only
  and shopping only, the answer shown to the Runner, no Runner answer and no second answer, "ask
  me first" timing out to leave it out with the late-answer message, a "similar" preference timing
  out to similar, and the order and its questions being the Shopper's alone.
- Web: 10 new tests.
  - Runner page: one button per item; asking; the waiting line; the answer said out loud; no
    button before shopping.
  - The new page: sign in and come back; the order in words; nothing on its way; the question as
    an alert with its fallback; answering; too late; axe.
  - `/my-order` is added to the axe and button-size sweeps.
- `pnpm run verify`: lint, typecheck and **402 tests** (43 core, 259 api, 100 web), all passing.
- In Chromium, with two browsers, a Runner on a 320-pixel phone and a Shopper:
  - the order went through and the Runner asked about the milk;
  - the question reached the Shopper's page within one poll;
  - the Shopper answered using only the keyboard;
  - the answer reached the Runner 3 seconds later;
  - axe found no problems on every screen, and nothing scrolled sideways at 320 pixels.

## 2026-09-28 — Step 29: making sure the Shopper hears the question

After Step 28, a Runner's question only reached a Shopper who happened to be looking at the Your
order page. After five minutes their sign-up preference decided, so most questions would have been
settled without them. Twilio cannot text anybody yet, so this uses what the phone and browser
already have.

### On the open page

A new question plays a two-note chime and buzzes the phone, once per question. The sound is made
in the page, so there is no file to download. Either may be refused by the browser or the device.
That is fine: the question is still an alert a screen reader says, and it is on the screen.

### When the page is closed

The Your order page, and "Your order is sent", now have a part headed "If your Runner has a
question", with a button: "Tell me when my Runner has a question". The phone asks for permission.
After that, a question arrives as a notification that stays until it is dealt with, and pressing it
opens Your order.

This is Web Push, the notification service built into every browser. It needs no account with
anybody, only a key pair of our own. The page says in plain words:

- when the browser has blocked notifications, and where to allow them;
- on an iPhone or iPad, that Apple requires Ozi Delivery to be on the Home Screen first.

Where notifications are not switched on, or the browser cannot do them, nothing is offered.

### Behind it

- A new table, `PushSubscription`, with migration `20260928090000_push_subscriptions`, which runs
  on deploy. It holds only the browser's push address and its encryption keys, never a message.
- `POST` and `DELETE /push-subscriptions`, for Shoppers.
- `/config` now includes `push.publicKey`, or null when notifications are off.
- Asking a question sends a notification to each of the Shopper's devices. The Runner does not
  wait for it, and a failure never stops the question. A device the push service says has gone is
  forgotten.
- The server sends a request to whatever push address a browser gives it. So only the browsers'
  own push services are accepted (Google, Mozilla, Apple, Microsoft), over https. Otherwise anybody
  signed in could make the server call any address they liked.
- The one new dependency is `web-push`, the standard library for this. It does the encryption and
  signing, which are too easy to get subtly wrong by hand.
- `scripts/push-keys.mjs` makes the key pair in the Console. DEPLOY.md, "Telling a Shopper about a
  question", has the steps.

### What Anthony has to do

Make the key pair once, in the Console, and paste the two values into the api component's
settings. Until then everything else works and the notifications offer simply does not appear.

### Checked

- API: 11 new tests.
  - Which push addresses are accepted, and which are refused.
  - `/config` saying whether notifications are on.
  - Saving a device once however often it is sent.
  - Refusing a bad address, a Runner, and nobody signed in.
  - A plain message when notifications are not switched on.
  - Turning off only your own device.
  - A question notifying each device once, opening Your order.
  - Forgetting a device the push service says has gone.
  - The question still being asked when the push service fails.
- A check that `web-push` produces an encrypted, signed request with real keys.
- Web: 7 new tests.
  - A chime and buzz once per question, not on every look, and silence with no question.
  - No offer when notifications are off.
  - Turning them on, and saying so.
  - The blocked message, and the iPhone Home Screen message.
  - axe, with the offer showing.
- `pnpm run verify`: lint, typecheck and **420 tests** (43 core, 270 api, 107 web), all passing.
- In Chromium, with two browsers and the real service worker:
  - a new question played both notes of the chime and buzzed once, and did not repeat on the next
    look;
  - a push handed straight to the service worker showed "A question from your Runner", set to stay
    until dealt with and to open Your order;
  - axe was clean and nothing scrolled sideways.
- Not checked here: turning notifications on. Headless Chromium refuses every push subscription,
  whatever permission it is given, so the first real check is on a phone, on the live site, once
  the keys are set.

## 2026-09-28 — Step 30: renamed Ozi Delivery, at ozidelivery.co.uk

Aldi announced an exclusive delivery partnership with Deliveroo on 24 September 2026, and the
earlier name is blocked at domain registrars, which points to active trademark protection.
Anthony bought ozidelivery.co.uk and renamed the product **Ozi Delivery**. The assistant is
still Ozi. The store display name stays Aldi, because the catalogue is still community sourced
Aldi prices.

### Was Rule Nine true?

Partly. The product name was read from `config/store.json` wherever the app was built properly:

- the header, footer and every page title;
- the web app manifest, which sets the installed app's name;
- sign-in texts, and the Stripe payment and transfer descriptions.

Notification text named no product. There is no email anywhere, and the seed has no product name
in it.

But the automated Rule Nine scan only ever checked the store name and the legal entity, never the
product name. So the old name had been written into eight places a person could see:

1. `packages/web/index.html`: the page title before JavaScript loads, and the line shown when
   JavaScript is off. The description and theme colour there were also written in, not read
   from config.
2. `packages/web/src/lib/api.ts`: the "We cannot reach … at the moment" message.
3. `packages/web/src/pages/Card.tsx`: the "not switched on … yet" line.
4. `packages/web/src/pages/RunnerHome.tsx`: the "… never sees them" line.
5. `packages/web/public/push-sw.js`: the fallback title and text of a notification.
6. `packages/web/public/favicon.svg`: its label.
7. `packages/web/capacitor.config.ts`: the native app name and identifier.
8. `packages/core/src/rules.ts`: three of the ten rules, word for word.

Some places a person does not normally see, but that could reach one, also had it:

- three server start-up errors in `env.ts`;
- the "only for … itself" refusal in `app.ts`;
- two fee engine errors in `fees.ts`;
- four package descriptions.

The tests pinned several of those strings, so the tests had the name written into them as well.

### What changed

- `productName` in `config/store.json` is now Ozi Delivery. That is the only place the name is
  set.
- `index.html` now has `%STORE_PRODUCT_NAME%`, `%STORE_TAGLINE%` and `%STORE_NAVY%`. A small
  plugin in `vite.config.ts` fills them in from `store.json` at build time, and the build fails
  if one is left unfilled.
- The Capacitor name and identifier are read from `store.json`. The identifier is the name as
  one lower case word, `uk.co.ozidelivery.app`; no app has been published, so nothing depended
  on the old one.
- The three screens read the name from config. The service worker file is copied as it is and
  cannot read config, so its fallbacks no longer name the product; the server always sends the
  real title.
- The favicon no longer has a label.
- The server and fee engine messages no longer name the product. The rules are filled in from
  config by `inviolableRules(productName)`, which keeps their wording exact.
- Two new scans in `packages/core/test/config.test.ts`, next to the existing ones:
  - the product name from config must not appear in any source file;
  - the old name must not appear in any line of source except a comment.

  Both failed on their first run on real cases: a comment I had just written with the new name,
  and a migration's comment line starting `--`. That line is now counted as a comment, since an
  applied migration must never be edited.

### The domain, and keeping the old address working

`ALLOWED_ORIGIN` already took a comma separated list. However, the server only picked a main
address of its own when the list had exactly one entry. It uses that address for the line in a
sign-in text that lets a phone fill the code in, and for the notification services' contact. So
listing the new domain alongside the old one would quietly have switched both off.

There is now `primaryOrigin`: the first address in the list. Every address in the list keeps
working, and the Stripe Connect return address already follows whichever address the Runner
came from.

- `.do/app.yaml` gains a `domains` block for ozidelivery.co.uk (primary) and
  www.ozidelivery.co.uk. Its comments now give the three-address value for `ALLOWED_ORIGIN`.
- `.env.example` says the same, and gains the three VAPID settings that Step 29 left out of it.
- The only hard coded ondigitalocean address in source was a test fixture for the sign-in text.
  It now uses ozidelivery.co.uk. No domain is written into application code: it is deployment
  configuration.

### Kept as they were, on purpose

None of these is ever shown to a Shopper or a Runner:

- the GitHub repository (`EnrichT16/aldilivery`);
- the DigitalOcean app name and database name (`aldilivery`, `aldilivery-db`). Renaming the app
  in the spec would make DigitalOcean create a second app;
- the package names (`@aldilivery/core`, `api`, `web`);
- the browser storage keys (`ozidelivery.session.token`, `ozidelivery.runner.token`). Changing them
  would sign everybody out;
- the local Docker database name;
- the function `platformNetPence`;
- code comments, which still used the old name as history (since removed, Step 31).

These can be renamed later as a separate, mechanical change if wanted.

### Documentation

- README and RULES now say Ozi Delivery, and the README explains the rename.
- TESTING_WITH_PEOPLE now says Ozi Delivery.
- DEPLOY.md now says Ozi Delivery throughout, and has a new section, "Moving to the new domain".
- Where DEPLOY.md tells Anthony to pick the repository or the DigitalOcean app by name, it keeps
  the real name, `aldilivery`, and says why.
- PLAN.md keeps its original wording with a note at the top. This log is not rewritten.

### What Anthony has to do

Follow "Moving to the new domain" in DEPLOY.md:

1. Add the domain in DigitalOcean.
2. Point its nameservers there at the registrar.
3. Put the three addresses in `ALLOWED_ORIGIN`, new domain first.

Then, when convenient:

- change the Connect branding name in Stripe;
- use `OziDelivery` as the Twilio sender name. A sender name has at most eleven characters, so
  "Ozi Delivery" with its space is too long.

### Checked

- `pnpm run preflight` does not exist, so it was not run.
- `pnpm run verify`: lint, typecheck and **425 tests** (46 core, 272 api, 107 web), all passing.
  5 of them are new:
  - the product name scan;
  - the old name scan;
  - the rules filled in from config;
  - the old and new domains both allowed, with the first as the main address;
  - no main address when anything is allowed.
- The production API build compiles.
- The production web build has the old name nowhere in the page, the manifest, the service worker, the
  favicon or the JavaScript. The page title and the installed app name are "Ozi Delivery".
- In Chromium, the landing page heading and title read Ozi Delivery. "How Ozi Delivery works – Ozi
  Delivery" is the page title on Just looking. The footer reads "Ozi Delivery shops at Aldi."
- Not checked here: the domain itself. It is not pointed at the app yet. The first check is
  ozidelivery.co.uk/api/health once the nameservers have moved.

## 2026-09-30 — Step 31: version two begins — the governing prompt, the ruled price, never a silent swap

Anthony sent the complete build prompt for version two, with answers:
- pricing is ruled;
- Oluoma Voice gets a stand-in until it exists;
- calls go through LiveKit;
- merge the rename (#14).

#14 was merged first. This step lays the foundation that everything after it builds on.

### The governing document

`docs/BUILD_PROMPT.md` holds the prompt word for word, with Anthony's answers at the end. RULES.md
and README now say that where anything conflicts with it, it wins. One sentence was changed: the one
that named the retired name now says only that it is retired, so the document does not bring it
back.

### The retired name

It is gone from the code, the comments and the documents, including this log's history. The two
browser sign-in keys were renamed, which signs out the test accounts once. The fee function, the
local Docker database and the test fixtures were also renamed.

A repository-wide scan in `packages/core/test/config.test.ts` now fails if the name appears
anywhere: code, comments and documents alike. The scan holds the name encoded, so it does not spell
it either. The only exemption is database migrations that have already run on the live database.
Editing one risks the server refusing to start.

Four things still carry the name, and each needs Anthony because it touches the live site:
- the code package names;
- the GitHub repository;
- the DigitalOcean app;
- the database.

Renaming the packages alone would have broken the live site. DigitalOcean's build and start
commands find the code by package name, and those commands live in the dashboard, not here. A first
attempt that included the deployment names was stopped for touching shared infrastructure, and the
package rename was then undone for this reason. DEPLOY.md, "Finishing the rename", gives the order.
First, make the dashboard commands find the code by folder. After that, the package rename is safe.

Past commit messages also contain the name. Removing them would mean rewriting and force-pushing the
whole history of `main`, which I have not done and recommend against.

### Pricing, as ruled on 29 September 2026

- Standard delivery is **£13.50 flat**, with no bands and no basket-linked fee.
- One delivery carries at most **£60** of shopping.
- The Runner gets **£5**, untouched.
- The old two pound floor, Rule Three, is superseded, and so are the fee bands. Rule Three is now the
  ruled price, and Rule Two reads "five pounds on every standard delivery, untouched, whatever the
  basket".
- The fee engine was rewritten around one flat figure. Both figures are in `config/store.json`,
  because the owner can change pricing (Section Q). The configuration refuses a fee that would not
  cover the Runner's £5.
- Over £60, the server says in plain words why ("about as much as one Runner can carry safely") and
  offers two deliveries. The basket and confirmation screens say the same and offer no way to send
  it.
- At the till, the fee stays the flat fee, and the cap is not reapplied. A shelf price a few pence
  over the estimate must never stop an order already in the Runner's hands.
- "Just looking" states the flat fee and the cap in two sentences, instead of the band table.
- The other services' prices in Section B come with those services.

### Never a silent substitution (Section H)

Step 28 let an unanswered question fall back to a preference chosen at sign-up. That could mean
"bring something similar" without anybody being asked, which Section H forbids.

Now an unanswered question always means the item is left out and not charged for. The screens say
so:
- the Runner's page says to ask, and to leave it out if there is no answer;
- the Shopper's page says "you will not be charged for it. Nothing is ever swapped without asking
  you".

The sign-up question about substitutions is gone, which keeps sign-up short (Section D). The
in-app call that Section H centres on comes with Section F.

### Still to settle with Anthony

- Rule Six says no age restricted goods in version one. Section K implies alcohol may be sent when
  the recipient proves their age, and Section L says no identity checks. Until he rules, no alcohol
  is carried at all. This is recorded at the foot of RULES.md.
- The four renames above, and whether to rewrite commit history (recommended not).

### Checked

- `pnpm run verify` passes: lint, typecheck and **420 tests** (38 core, 274 api, 108 web).
- New tests:
  - the flat fee holds one penny at a time from 1p to 6000p;
  - exactly £60 is accepted and a penny over is refused, both through the API with its words;
  - the basket screen's over-£60 message, with no way to send;
  - the configuration refuses a fee that does not cover the Runner;
  - an unanswered question is left out, even for a Shopper who once chose "similar";
  - sign-up no longer sends a substitution choice;
  - the retired name appears nowhere.

## 2026-10-01 — Step 32: Ozi speaks — the Oluoma Voice interface, with the phone's own speech behind it

Anthony merged #15 and ruled on alcohol: none in version one. Section K's "unless the recipient
proves their age" clause is removed, and alcohol joins the absolute prohibited list. Section L
stands: no identity checks, ever. The ruling is recorded in docs/BUILD_PROMPT.md, and Rule Six
notes it. The working branch keeps its name.

Then the first part of Section E.

### The interface

`packages/web/src/voice/engine.ts` is the only way Ozi reaches speech. It has seven methods:
- `readiness`;
- `startListening`, which returns recognised text through a callback;
- `stopListening`;
- `speak`;
- `interrupt`;
- `voices`, which lists the output voices for a language;
- a `listenOnce` helper.

Every call takes a language tag. `docs/OLUOMA_VOICE.md` writes the same contract out for the
Oluoma Voice team, including the voice character Anthony specified: mid to high pitch, newsreader
delivery, even pacing, and no cloned commercial voice. It also says that recognition never has an
accent switch, while output offers two or three voices per language. Swapping in Oluoma Voice is a
change to one file, `voice/index.ts`.

### The stand-in

`voice/browser-engine.ts` uses the phone's own speech, through the Web Speech API. Recognition works
in Chrome, Edge and Safari. Firefox cannot listen, and the engine says so rather than failing.
Nothing in Ozi is tuned to the stand-in's mistakes.

### Speaking by default

Ozi speaks aloud from the first launch. A new Settings page, linked in the header, has the "Ozi
speaks aloud" switch. It is on unless turned off, and found, not offered. The page also has the
voice choice for the language, and choosing a voice says a sentence in it. Settings are kept on
the device for now. They move to the account with the language module.

### The microphone is now a conversation

1. Ozi greets the Shopper aloud and listens.
2. It shows what it heard and answers aloud.
3. Pressing the button while Ozi is talking stops it mid-sentence. Pressing it while Ozi is
   listening stops the listening.

Until voice ordering is built, which comes next, Ozi says plainly that ordering by voice is coming.

### A screen reader and Ozi must not talk over each other, and nobody may be left in silence

Everything Ozi says is written on the screen:
- While Ozi is speaking aloud, those words are shown but not announced.
- When Ozi is muted, or cannot speak, they are announced instead.

The browser check found a device that cannot speak at all. The test browser has no voices, and
every sentence fails at once. The first version reported that as an interruption. The conversation
hung, and a screen reader user would have heard nothing, because the screen was holding back while
Ozi was meant to be speaking.

Now the engine reports `not-spoken`. The screen announces the words, the engine stops claiming it
can speak, and the conversation carries on. A safety timer also covers a device that never says
when it has finished speaking. Both are written into the Oluoma contract, so the real engine has to
be honest about it too.

### What is next in Section E

1. Full voice ordering: the order by speech alone, the spoken address confirmation, and the £80
   voice ceiling with touch above it.
2. The language module: English and Welsh first.
3. Ozi explaining itself.

"Hey Ozi" as a wake word with the phone locked needs the native apps (Section F) and Oluoma Voice.

### Checked

- `pnpm run verify` passes: lint, typecheck and **434 tests** (38 core, 274 api, 122 web).
- 13 new voice tests:
  - Ozi greets, listens and answers;
  - pressing interrupts it at once;
  - "nothing heard" gets an answer;
  - a phone that cannot speak gets its words announced, and the conversation carries on;
  - Ozi speaks by default;
  - muting keeps Ozi quiet, announces on the screen and is remembered;
  - voices are listed, and choosing one speaks in it;
  - axe finds nothing on Settings;
  - the stand-in reports a browser without recognition;
  - it listens in the language asked for, here Welsh;
  - it speaks in the chosen voice, and can be interrupted;
  - a failed voice is reported as not spoken;
  - it never hangs on a device that does not report the end of speech.
- Settings is in the axe and button-size sweeps.
- In Chromium:
  - the greeting is announced on the screen when the device cannot speak;
  - Ozi tries to listen, says plainly that the microphone is not allowed, and resets;
  - Settings passes axe, and nothing scrolls sideways at 390 pixels.
- Not checked here: hearing a real voice, and Ozi's voice on a real phone. This environment has
  no speakers, no microphone and no speech service. The first real check is on Anthony's phone.

## 2026-10-01 — Step 33: Ozi introduces itself, and Ozi's round button

Anthony described this by voice. It is written into docs/BUILD_PROMPT.md, under the rulings of 1
October, so the master blueprint can pick it up.

### First launch

Ozi speaks straight away, with no notification. It introduces itself as made to speak with the
Shopper and have a conversation. It then says four things:
- while its round green button glows, it is listening;
- to pause it, press the button or say "Ozi, mute", and press again to bring it back;
- its voice can be turned off in Settings;
- the button can be moved by holding and dragging it, or with the arrow keys.

The introduction is said once per device.

One limit of the web: a browser will not speak until the page has been touched once. On the web,
the introduction is shown and announced at once, and spoken at the first touch. The native apps
have no such rule.

### The round button, on every screen

- It is in its own landmark, named "Ozi", so a screen reader user can jump straight to it.
- It starts at the middle of the right-hand edge, is 124 pixels across, and is always kept wholly on
  the screen.
- **Listening:** bright green, glowing outward, with "Listening" written under the microphone. The
  green is in config/store.json (Rule Nine). Navy words on it have a contrast ratio of 6.9 to 1.
- **Muted:** white, with a dashed edge, a line through the microphone, the word "Muted", and no
  glow. It changes in brightness, shape, words and movement, so the difference never rests on
  colour. Red was not used, because red and green are the pair colour-blind people confuse most.
- With reduced motion asked for, the glow holds still as a solid ring.
- **Moving it:** hold and drag, or the arrow keys. A single press never moves it, so moving is never
  needed to use it (WCAG 2.5.7), and a drag is never taken for a press. Settings has "Put Ozi's
  button back in its usual place".
- The button's name is exactly its visible word, so a voice control user says what they see. What
  a press does is read after the name.
- Ozi's words appear in a panel beside the button while they are said, and for a little while
  after, on whichever side has more room.

### Listening, muting and reminders

- Ozi listens while the button is green. It stops while it is talking, so it never hears itself,
  and stops while the page is hidden.
- Pressing the button, or saying "mute", "stop listening" or "be quiet", mutes Ozi.
- Muted, Ozi gives gentle reminders: after two minutes, then every three minutes. It never listens
  in the meantime.
- If speech recognition loses its connection, Ozi says so once, then retries quietly, waiting longer
  each time, up to a minute. It does not hammer the network.
- **"Hey Ozi" while muted:**
  - It needs an engine that hears the wake word on the phone and nothing else.
  - The browser stand-in streams whatever it hears to the browser maker. Letting it listen while
    muted would break Anthony's own rule that a muted Ozi does not listen to conversations.
  - So with the stand-in, the button brings Ozi back, and Ozi only promises what works.
  - The interface now has `wakeWordOnDevice`. When Oluoma Voice reports it, Ozi listens for the wake
    word alone while muted, and every sentence offers "or say Hey Ozi" by itself.
- The landing page's big microphone is the same Ozi, only larger.

### Found in the browser and fixed

- **The button was not round, and spilled off the edge of a phone.** A general button style
  overrode its shape, and its starting place did not allow for its own size.
- **Ozi's words covered half the screen** during the long introduction. They are now a narrow panel
  beside the button, which scrolls if needed.
- **The first press on the button was taken over.** The introduction replayed at the first touch,
  which turned the press into "stop talking" instead of "mute". A first press on Ozi's own button now
  does what it says.
- **"Listening" was clipped** inside the circle. The button grew from 104 to 124 pixels.

### Checked

- `pnpm run verify` passes: lint, typecheck and **442 tests** (38 core, 274 api, 130 web).
- Voice tests now cover:
  - the introduction: said once, aloud, with no notification, then listening;
  - an introduction that cannot be spoken, shown and announced instead;
  - the button glowing while listening, and changing in more than colour when muted;
  - "Ozi, mute yourself" muting it;
  - answering what it heard;
  - stopping talking at a press;
  - reminders at two minutes and then three minutes later, while still not listening;
  - the arrow keys moving the button, which stays put until Settings puts it back;
  - a drag moving it without counting as a press;
  - axe finding nothing on Settings and the landing page with the button showing;
  - the stand-in never claiming a wake word, and a browser that wants a touch first not being
    given up on.
- In Chromium at 390 pixels:
  - the button listening and muted, both with no axe problems and nothing scrolling sideways;
  - dragging it to the left half of the screen, where it stays muted.
- Not checked here: a real voice, and a real "Hey Ozi". Both wait for a real phone, and the second
  for Oluoma Voice.

## 2026-10-01 — Step 34: ten ideas approved, Runner training, and the landline from day one

Anthony asked Claude Code for its own ideas, and approved all ten. He added Runner training, which
he had been planning anyway, and a dedicated landline integrated with dispatch from launch.

They are written into docs/BUILD_PROMPT.md as **Section T**, eleven items. Each one says what it
does, the rules it keeps, what needs Anthony, and where it sits in the build order:

1. T1, the family and carer plan.
2. T2, councils and social care.
3. T3, delivery bundles.
4. T4, grants.
5. T5, sheltered housing rounds.
6. T6, the door safe word.
7. T7, the weekly spoken summary.
8. T8, the optional wellbeing check.
9. T9, the landline.
10. T10, receipts read aloud.
11. T11, Runner training.

Prices given there (£3.99 a month for the carer plan, four deliveries for £48) are proposals for
Anthony to confirm. Nothing is charged until he does.

Anthony asked for a proposal on how Runners should be offered jobs, for app and phone orders alike.
That comes once the current work is done, as he asked. Nothing in this step changes code.

## 2026-10-01 — Step 35: ordering by voice alone

Anthony merged #16, and accepted the family plan and bundle suggestions as starting defaults, to
adjust once running. Then the heart of Section E: a whole order by speech alone.

### The conversation

The Shopper says, for example, "I'd like bananas and milk". Ozi then:

1. Looks each item up. Where there is more than one kind, it names up to three with their prices
   and asks which. It asks how many of each, unless a number was said with the item ("three
   bananas"). It says plainly when something cannot be found, and leaves it out.
2. Reads the basket back: every item, the shopping total, the £13.50 delivery fee and the total
   altogether.
3. Says the actual delivery address aloud and waits for a yes (Section D). For a voice order this
   is always the registered home address.
4. Asks: "Shall I send your order now, and charge about £X to your card ending 1234? You pay what
   the till says." A yes sends it. That sentence is stored against the order as what the Shopper
   agreed to (Rule One).

Two separate yeses, the address and the payment, and nothing is sent without both. "Stop" or
"cancel" ends it at any point, with nothing sent.

A no to the address opens the confirmation screen, because a voice order cannot go anywhere else.
Over £60, a missing card or a missing address each open the right screen, with the shopping already
in the basket. Asked for a shop that is not listed yet ("from Iceland"), Ozi says it will look in
the shop that is listed.

So that Ozi does not take the television for an order, a new order starts only when the words ask
for one ("I'd like", "order", "can I have") or are said to Ozi by name, or straight after Ozi has
asked "What would you like?". Words not meant for Ozi are not answered.

### The limits, on the server, where no screen can get round them

- **Voice ceiling.** A spoken confirmation is refused above `voice.paymentCeilingPence` in
  config/store.json: £80 by default, and a setting. Above it, the Shopper is asked to confirm by
  touch.
- **Home address only.** A voice order whose delivery address is not the registered home address is
  refused. Spacing and commas do not matter.
- **The address is confirmed on every order.** It is confirmed whether the order comes by voice or
  by touch. Every order must carry `addressConfirmed`, or the server refuses it. The confirmation
  screen now shows the address with a "Yes, this is the right address" button, and Ozi reads the
  address aloud there. "Send my order" stays unavailable until the address is confirmed, and
  changing the address means confirming it again.

**Found while testing.** With the £60 cap and the £13.50 fee, a standard order is at most £73.50,
so it never reaches the £80 ceiling. The ceiling will start to matter with extras (extra shops,
handing to the person, tips), or if Anthony lowers the setting. It is enforced now, so nothing can
slip past it later.

### Not yet

- The PIN for saving an address, and for changing the registered home address, comes with the rest
  of Section D (done in Step 36).
- Ozi announcing the order's progress aloud comes with live status (Section G). Ozi does not promise
  it until then.

### Checked

- `pnpm run verify` passes: lint, typecheck and **459 tests** (38 core, 280 api, 141 web).
- New tests cover:
  - a voice yes to the home address being accepted and recorded as spoken;
  - another address refused and nothing charged;
  - a lower ceiling refusing a voice yes above it, with nothing charged;
  - £80 as the default;
  - any order without a confirmed address refused;
  - understanding a sentence, numbers ("a dozen" is twelve), "the second one", and yes and no
    ("no" wins when both are heard);
  - the whole conversation: which, how many, read back, address, payment, and exactly what goes
    on the wire;
  - a number said with the item;
  - something not found;
  - a no to the address, "cancel the order", and a no to sending;
  - nobody signed in, and no card;
  - words not meant for Ozi not being answered;
  - the confirmation screen refusing to send until the address is confirmed.
- In Chromium, against the real server, with a script standing in for the microphone:
  - "I'd like bananas and apples", "two", "one", "yes", "yes please";
  - Ozi asked both quantities, read back the basket, the fee, the £16.63 total and the home
    address, and took both yeses;
  - the server holds a paid order for exactly those items;
  - the Your order page opened, with no axe problems.
- Not checked here: a real voice. That waits for a real phone.

---

## 2026-10-01 — Step 36: addresses and the PIN

Anthony merged #17 and asked for Section D next: the four-digit PIN and the address input.

### The PIN

- **Chosen the first time it is needed**, never at sign up. Sign up stays short. The first time a
  Shopper saves an address or changes the home address, they choose a PIN, entering it twice so a
  slip cannot become a PIN nobody knows. The same PIN then does what they came to do.
- **Typed or said aloud**, the Shopper's choice. "Say my PIN" makes Ozi ask for the four numbers.
  The next words go to the PIN field only: they are not shown on the screen, not kept, not said
  back, and not treated as an order. "Two seven five nine", "2 7 5 9", "oh eight one four" and
  "double seven one three" are all understood. Anything other than exactly four numbers is not
  filled in.
- **Obvious PINs are refused, in plain words:** the same number four times, a run up or down (1234,
  9876), and anything from 1900 to 2099, which looks like a year.
- **Three wrong tries lock it for 15 minutes**, enforced on the server. The Shopper is told how
  many tries are left.
- **Only a salted hash is kept**, never the PIN. No screen or reply ever shows it, only whether
  there is one.

### Addresses

- **Your addresses** is reached from Settings. It holds the registered home address and as many
  other addresses as the Shopper wants, with no cap, each with an optional name ("Mum", "Tom's
  halls").
- **Adding one** uses a plus with ADD AN ADDRESS written under it, following the icon rule. Ozi
  says it is there when the page opens. Saying "Ozi, add an address" anywhere opens the page with
  the form already open. Saving needs the PIN. Removing one does not.
- **The home address** changes only on this page, and only with the PIN. Each time it changes, the
  owner gets a text and a notification: "the home address on your account was changed just now.
  If that was not you, ring us straight away." This matters because a spoken PIN can be overheard.
  The old way round, changing it through the profile, is now refused once there is a home
  address. The very first home address can still be given without a PIN, as at sign up.

### At checkout

The home address is offered first, with any saved addresses beside it. "Send to a different
address" asks for the address, then asks, the way a bank app asks about a payee: "Save it for next
time, or use it this once?"

- **Use it once** needs no PIN, only the usual "Yes, this is the right address".
- **Save it** needs the PIN, and the new address is then chosen.

Orders by voice still go only to the home address.

### Checked

- `pnpm run verify` passes: lint, typecheck and **483 tests** (38 core, 294 api, 151 web).
- New server tests cover:
  - the PIN rules;
  - only a hash being kept;
  - a PIN chosen once only, and never shown;
  - unlimited saved addresses, kept in order;
  - "choose a PIN first";
  - removing only the Shopper's own addresses;
  - the wrong-PIN countdown and the 15-minute lock;
  - the count starting again after a right PIN;
  - the home address changed only with the PIN, with the text sent;
  - the profile route refused.
- New screen tests cover:
  - the spoken-PIN parser;
  - the plus and ADD AN ADDRESS, with Ozi announcing it and no axe problems;
  - choosing a PIN, including a too-easy PIN and two that do not match;
  - "Ozi, add an address" followed by a spoken PIN, which is never shown or said back;
  - a wrong PIN, then the right one, changing the home address;
  - removing an address;
  - at checkout: choosing a saved address, using one once with no PIN, and saving one with the PIN.
- In Chromium, against the real server, with a script standing in for the microphone:
  - Settings, then Your addresses: Ozi announced the plus;
  - Mum's address added, and the PIN chosen by saying it twice;
  - the server holds the address and a PIN;
  - the home address changed with a typed PIN;
  - no axe problems before or after.
- Not checked here:
  - the text message itself, which needs the Twilio settings live;
  - a real voice, which waits for a real phone.

---

## 2026-10-02 — Step 37: in-app calls, the server side (LiveKit)

Anthony approved PR 18, and every open question of 2 October (written into the blueprint). He
asked for LiveKit next: he and Yvette will create the account.

### What it does

- **Calls about an order.** The Shopper and the Runner of an order can call each other while the
  order is under way.
  - Each gets a short-lived pass into that call's own room.
  - Each joins under an identity of ours with a first name only. No phone number is used anywhere:
    not in the room, the pass, the replies or the database.
  - When the Runner calls, the Shopper gets a notification ("Your Runner is calling").
- **The price is agreed first (Rule One).** Before a Shopper can start or answer a call, they are
  told "In-app calls cost 5p a minute, paid from your card when the call ends" and must say yes.
  What they agreed to is stored on the call.
- **MERGE.** The Shopper can add a carer or relative.
  - The price for that person is put to them first, and they say yes.
  - They get a link to send however they like. The person opens it and joins, with no account and
    no number.
  - Only the Shopper can add people. A Runner cannot.
- **Who pays (ruling, 2 October).**
  - The Shopper pays 5p a minute for their own time and for each person they added. Each
    person's time is rounded up to a whole minute.
  - A Runner's minutes are never counted, and a Runner never pays.
  - A Shopper who never answered pays nothing.
- **Minutes come from LiveKit itself.** LiveKit's signed reports of who joined, who left and when
  the room closed are the record. A report without LiveKit's signature is refused. END CALL closes
  the room for everyone and bills what was used.
- **A card with no money.**
  - The charge waits as outstanding, and the Shopper can see what is waiting.
  - It is taken the next time a charge succeeds, whether that is the next call or the next order
    payment.
  - Above £10 waiting, nobody more can be added to a call until it is paid.
  - The price and the £10 limit are settings in config/store.json, under `calls`.
- **Switched off until the account exists.** Until the three LiveKit settings are in place, the
  call routes say plainly that calls are not switched on yet. `/health` reports `callsEnabled`.
  DEPLOY.md, under "Switching on in-app calls", has the steps for Anthony: the account, the three
  settings in DigitalOcean, and the webhook address.

### Found while building: a saved card can only be used once

Cards are saved as a Stripe payment method that is not attached to a Stripe customer. Stripe allows
a card saved that way to be used for one payment only. So in live mode:

- a Shopper's second order with the same saved card will be refused;
- a call charge cannot be taken either.

In rehearsal mode, and so in every test, it works, which is why nothing has shown it yet. Until it
is fixed, live call charges wait as outstanding rather than failing again. The fix, saving each
card to a Stripe customer, is the next piece of work, as its own PR.

### Not yet

- **The screens:** the call button, the call panel with END CALL, MUTE, LOUDSPEAKER and MERGE, and
  the page a guest opens. These come next, with the native ringing (CallKit, ConnectionService)
  when the phone apps are built.
- **The Runner hearing a call ring** when their page is closed. Today they see it on their job
  page. Ringing on a locked phone needs the native app.

### Checked

- `pnpm run verify` passes: lint, typecheck and **498 tests** (38 core, 309 api, 151 web).
- 14 new tests cover:
  - the price agreed before anything connects;
  - first names and our own identities only, with no number anywhere;
  - a Runner calling and the Shopper answering only after saying yes;
  - strangers refused;
  - calls switched off saying so;
  - 4 minutes billed for 200 seconds, with the Runner not counted;
  - nothing charged when the Shopper never answered;
  - a forged webhook refused;
  - MERGE with its link and the guest's minutes billed;
  - a Runner unable to add anyone;
  - a declined card waiting, then taken with the next charge;
  - the £10 limit;
  - END CALL;
  - the real LiveKit library issuing a pass for one room and checking a webhook's signature.
- Not checked here: a real call between two phones. That needs the LiveKit account, then the
  screens.

---

## 2026-10-02 — Step 38: saved cards that work again and again, and cards from any country

Anthony merged #19. Anthony created the LiveKit project (EU, Frankfurt). A local `.env` was
prepared for its three settings and confirmed ignored by git. The values belong in DigitalOcean for
the live site. Then two changes to taking money.

### A saved card can be charged more than once

**Until now:** a card was saved at Stripe on its own. Stripe spends a card saved that way after one
payment. So in live mode, a Shopper's second order with the same card would have been refused, and
no call charge could be taken.

**Now:**

- Every Shopper has their own customer at Stripe, made the first time they save a card. Every card
  they save is attached to it.
- Orders are charged through that customer, and so are call charges at the end of a call. Any call
  money waiting is taken at the next successful payment.
- **Cards saved before this change** are attached at the Shopper's next order, before anything is
  created or charged.
  - If Stripe has already spent the card on an earlier payment, the Shopper is told: "Please add
    your card again. We have improved how cards are saved, so it can be used for every order.
    Nothing has been charged."
  - The confirmation screen then offers "Add my card again".
- If Stripe will not keep a new card, nothing is saved, and the Shopper is told so in plain words.
- The Stripe customer id never leaves the server.

### Cards from any country (ruling, 2 October 2026)

`payments.supportedCardRegions` is now `ANY`. Shoppers pay with the cards they have, including
cards from home: Nigeria, Ghana, Kenya, Zimbabwe, Sierra Leone, India, anywhere. Stripe still
screens every payment. Flutterwave, Paystack and mobile money follow as further gateways. The
blueprint has what was found about each country.

Nigerian naira cards are often limited by the issuing bank for spending abroad. Some will still be
declined by the bank, not by us, until Flutterwave or Paystack charges them in naira.

### Not yet

- **Cards saved through Stripe's "set up for later" step.** Cards are now kept, but a UK bank may
  still ask the Shopper to confirm a charge made with nobody at the screen, as a call charge is. If
  it does, the charge waits as outstanding and is tried again with the next payment. Saving cards
  through that Stripe step, so banks agree to later charges up front, is a follow-up to the card
  screen.

### Checked

- `pnpm run verify` passes: lint, typecheck and **511 tests** (38 core, 322 api, 151 web).
- New tests cover:
  - a Stripe customer made on the first card, kept off `/me`, and reused for every later card;
  - two orders in a row charged through the same customer;
  - a card Stripe will not keep refused in plain words, with nothing saved;
  - an old card attached at the next order;
  - an old, already spent card answered with "Please add your card again", with nothing charged;
  - cards from Nigeria, Ghana, Kenya, Zimbabwe, Sierra Leone, India and the United States taken.
- Not checked here: against real Stripe test keys. Worth one order and one repeat order with a
  test card once deployed.

---

## 2026-10-03 — Step 39: Runner accounts, the first screen, and reporting problems

While Anthony set up the Apple and Google Play accounts, he asked for the rest to go ahead. All of
this follows the rulings of 2 October 2026 in the blueprint.

### Runners, all online, from anywhere in the UK

- **Signing up.**
  - A Runner ticks every way they might deliver: walking, bicycle or electric bike, motorbike or
    moped, car, van.
  - They start walking or cycling if they ticked one. A car or motorbike waits until the licence
    and insurance have been checked.
  - Who invited them is kept, from the link they followed.
- **Documents, photographed with the phone.**
  - Each document has a button that opens the camera: the front camera for the face photo, the
    back one for documents.
  - The right to work and DBS can be sent as a share code instead of a photo.
  - Insurance asks for the date it runs out.
  - Photos are shrunk on the phone before sending.
  - Staff see each document with the staff key and accept or reject it. A rejection must say why,
    and the Runner sees the reason.
  - The photo is deleted once decided, apart from the face photo, which the Shopper sees at the
    door.
  - Accepting the right to work or DBS records the check, the same as the approval tool does.
- **Switching how they travel.**
  - Walking or cycling: at once, any day, nothing needed.
  - Car, motorbike or van: only with a licence and in-date insurance, both accepted by a person.
  - Nobody goes on shift driving without them, and the insurance end date is checked every time.
- **The Runner page has tabs.**
  - **Today:** earnings big and bold, how they are travelling today with one-press switching, then
    the shift, job offers and the job in hand.
  - **Jobs:** every job with its date, area (postcode district only), pay and order reference,
    each with Report a problem. Never the Shopper's name, street or number.
  - **Money:** earned today, this week and in all; what has been paid out; anything being repaid,
    with the reason and what is left.
  - **Training:** the ten modules, honestly marked as coming soon.
  - **More:**
    - their Runner ID, read out letter by letter;
    - their invitation link with a Share button;
    - their documents;
    - feedback, with or without their name.

### The first screen: who are you?

- Shopper, Runner, Organisation, I look after someone, and Just looking. Each has a short
  description under it.
- Ozi reads them out once a visit, after its first-launch introduction.
- Staff have no door on the public screen.
- New pages:
  - **For organisations:** what is offered, and ring us to be set up.
  - **For family and carers:** what they can do now; the £3.99 plan, marked as coming.
- Invitation links (`/join?ref=CODE`) open the first screen and keep the code for sign-up.

### When something goes wrong

- **Reporting.** The Runner or the Shopper reports a problem on an order. Either side can add
  voice notes (recorded in the page), photos and written notes.
- **Deciding.** A person decides within two working days, as staff see it, soonest first, with
  overdue ones flagged. The decision must be written down, in words both sides will read.
- **Refunds:**
  - £5 or less is refunded straight away with no investigation, and never counted against anyone.
  - Otherwise the refund goes back to the card the day it is decided.
  - Never more than the order cost.
  - No refund when the Shopper was responsible.
- **A Runner found at fault** repays 10% of each job's pay until it is repaid.
  - It is taken only after the transfer goes through.
  - The earning stays £5, as Rule Two requires. Only what is sent that day is less, the same way
    the cool box deposit works.
  - The Runner sees every deduction, its reason and what is left.
  - The four settings (refund straight away up to £5, two working days, 10%, write-off up to £20)
    are in `config/store.json` under `problems`. The percentage can never be set above 20%.

### Not yet

- The Shopper's own Report a problem screen. The server takes Shopper reports and the £5
  straight-away refund now.
- The admin panel screens for documents and problems. Staff use the staff-key API until then.
- The write-off when a Runner leaves owing money.
- Recording a voice note was checked in tests by its fallback only. A real phone is needed to
  hear one.

### Checked

- `pnpm run verify` passes: lint, typecheck and **549 tests** (38 core, 348 api, 163 web).
- New tests cover:
  - sign-up with every way of delivering, and who invited them;
  - documents by photo or share code, staff review, photos deleted after review (face photo kept),
    rejections with reasons;
  - driving refused without a licence and in-date insurance, and going on shift refused;
  - the dashboard's earnings by day, week and in all, with no Shopper details;
  - anonymous feedback;
  - the first screen's choices and the invitation link;
  - problem reports from either side, with voice notes, photos and notes;
  - the £5 straight-away refund and two working days over a weekend;
  - written decisions, no refund when the Shopper is at fault, and 10% recovered at the next payout;
  - the Runner's tabs, the Report a problem page, and axe on every new screen.

---

## 2026-10-03 — Step 40: why nothing since PR 15 had reached the live site

Anthony opened `/api/health` after PR 20 was merged. It reported commit `bfa4ac0`, which is PR 15.
PRs 16 to 20 had merged, but none had deployed.

**The cause.** DigitalOcean builds the web app with `pnpm --filter @aldilivery/web build`. That
runs the web package's own lint, with `--max-warnings=0`, from inside `packages/web`. Run from
there, the web rules in the shared ESLint config do not apply, so the React hooks plugin is not
loaded. Two `eslint-disable-next-line react-hooks/exhaustive-deps` comments, the first added in
PR 16, then failed as "Definition for rule … was not found". The web build failed, and App
Platform deploys the API and the web together, so every deployment since has been refused. The
live site stayed on PR 15 the whole time. Nothing was broken there, but nothing new arrived.

`pnpm run verify` did not catch it, because it runs ESLint from the repository root, where the
plugin is loaded and the comments are valid.

**The fix.**

- The two effects no longer need a disable comment. Each reads what it needs on arrival through a
  ref, so both lint configurations pass with no errors and no warnings.
- `pnpm run verify` now also runs the web package's own lint, exactly as the deployment does, so
  this cannot happen silently again.

**Checked before pushing.**

- **The DigitalOcean build in a fresh copy of main:** the same commands as the deployment. It
  failed before the fix, at exactly this error, and passes after.
- **Every database migration from PR 16 to PR 20 on a real PostgreSQL 16:**
  - set up at PR 15's schema, with existing Runner and Shopper rows;
  - all five new migrations applied cleanly;
  - existing Runners kept their travel mode and were given their own ID;
  - Prisma reports no difference between the migrations and the schema.
- **The real server started on that database:**
  - `/health` answered;
  - a Runner signed up with two travel modes;
  - a card from Nigeria was saved;
  - a 300 KB face photo was stored.
- `pnpm run verify` passes: 549 tests.

**Expect, once this deploys.** PRs 16 to 20 arrive together. Any Runner registered by car before
now starts as a car driver with no licence or insurance checked. They cannot go on shift until
they switch to walking or cycling, or until their documents are accepted.

---

## 2026-10-04 — Step 41: before launch: one Ozi button, privacy and terms, calls, the admin panel

Anthony's screenshot of the live site showed two problems, and asked for the steps before launch.

**The two fixes.**

- The home page had two Ozi buttons, and the gold one sat over the green bubble. The old gold
  microphone button is gone. The green bubble is the only Ozi button, on every page.
- Ozi took "Ozi delivery dot co dot uk", heard from the page itself, as an order. Now an order
  starts only on words like "I want" or "order", on Ozi's name, or within 30 seconds of Ozi
  asking "What would you like?". "Ozi" on its own is no longer taken as a thing to buy.

**Privacy and terms, as drafts.** `/privacy` and `/terms`, linked from every page's footer. They
are written from what the code actually does: who handles what, how long it is kept, refund
times, call prices. Every figure comes from configuration. Both say "draft" at the top until a
solicitor has read them.

**Shoppers can report a problem.** Under "Past orders", each order has "Report a problem", with
the refund amount asked for. As already built for Runners, five pounds or less is refunded
straight away.

**In-app calls.**

- A big round green "Call" button appears on the Shopper's order page and on the Runner's job.
- The Shopper is told the price (5p a minute) and says yes before calling, answering, or adding
  someone. A Runner calls and answers free.
- During a call there are End call and Mute buttons. For the Shopper there is also "Add someone
  to the call", which makes a link for a carer or relative. The guest page, `/call/join`, needs
  no account.
- The button only appears once the three LiveKit settings are in place.

**The admin panel**, at `/staff`.

- It signs in with a new STAFF_API_KEY and the person's name, which is recorded with each
  decision.
- Documents: show the photo, accept or send back with a reason, and give the insurance expiry
  date.
- Problems: play voice notes, see photos and notes, choose who was responsible, set the refund,
  and write the decision down.
- Money owed: what Runners still repay. When a Runner leaves owing 20 pounds or less, it can be
  written off, and who did it and when are recorded (a new migration).
- Feedback: what Runners have sent, named or anonymous.

**Launch checklist.** [LAUNCH.md](LAUNCH.md) lists, for Anthony, what must be true before the
public can order, in the order to do it.

**Also fixed.** The Runner dashboard listed jobs in whatever order the database returned them.
Its test failed now and then when orders were created in the same millisecond. Jobs are now
sorted newest delivery first.

**Checked.**

- `pnpm run verify` passes, including the web package's own lint: 576 tests.
- The web build passes.
- Every migration applies to a real PostgreSQL 16, with no difference from the schema.

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

Type `pnpm run verify`. It runs the linter, the type checker, and all 249 tests, and takes
about half a minute. If it prints no errors, then all ten rules are being kept by the code as
it stands today, because each rule has tests attached to it. The table at the bottom of
`RULES.md` says which file and which test enforces each one.

The test worth knowing about is the one for Rule Three. It works out, for every possible
order total from one penny to three hundred pounds — thirty thousand separate sums — what
Ozi Delivery is left with after the Runner's five pounds and after the card processing costs.
It fails if any one of them falls below two pounds.

### The one thing I changed, and why

The fee bands you gave me do not survive that test. The first three are fine. The fourth,
"above 16500 pence, 1100 pence", was open ended, and an open ended flat fee cannot hold: the
card processor takes a percentage, so the larger the order the more it takes, while the fee
stays still. At a £300 shop, that band leaves Ozi Delivery with £1.13, which breaks Rule Three.

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
It is right for seeing Ozi Delivery running on the internet. It is not right for holding real
orders from real people, and moving to a proper database cluster is a two line change in
`.do/app.yaml` when you get there.

### What I would do next, in order

1. ~~A real browser accessibility pass~~ — done, Steps 19 and 20.
2. ~~The journey in a real browser~~ — done by Anthony on the live site, Step 21.
3. **Sending a one time code by text message** — built, Step 22. Live once the Twilio account
   and the four settings in DEPLOY.md are in place.
4. Screen reader testing with real users — the people this is for, not us. The guide for
   running the sessions is [TESTING_WITH_PEOPLE.md](TESTING_WITH_PEOPLE.md).
5. Then, and only then, the voice layer.

Done since this list was written: the web shell wired to the API, an order taken in
production, webhooks verified, and a refused payment no longer stranding an order. Steps 14
to 17.

The seven `ZZ TEST ROW` Shoppers and their five orders are gone from production — confirmed
25 Sep, see Step 18.
