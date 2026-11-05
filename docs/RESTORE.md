# Getting Ozi Delivery back if DigitalOcean fails

Written for Yvette, 5 November 2026 (ruling 98 in docs/BUILD_PROMPT.md). Plain English, step by
step. Nothing in here needs a programmer, but keep a programmer's number to hand for the day you
need it, and read this once now, calmly, rather than for the first time on that day.

Everything the business runs on sits in one place, DigitalOcean: the app, the database of
Shoppers, Runners, orders and payments, and (soon) the bucket of product photos. If DigitalOcean
has a bad day, is hacked, closes our account by mistake or loses a data centre, we would have
nothing. So every night a copy of the database, and of the photos, is sent to a different
company's storage, encrypted, and kept for thirty days. Every Sunday one of those copies is
restored into a scratch database to prove it still works. This document says how it is set up,
how to get a copy back, and how to bring the whole service up again somewhere else.

Three things to know before anything else:

1. **The passphrase.** Every copy is encrypted with one passphrase, `BACKUP_PASSPHRASE`. Without
   it the copies are random bytes to everybody, including us. It must live in the company
   password manager and on paper in a sealed envelope in the office safe. It must never be in
   this repository, in an email or in a chat.
2. **Never restore over the live database.** A restore goes into a new, empty database, and the
   app is then pointed at it. The scripts refuse to load into a database that already has
   tables.
3. **The money is safe anyway.** Card payments and Runner payouts live at Stripe, not with us
   (Rule Ten). Losing our database would lose who ordered what, not the money.

---

## 1. What is copied, where, and when

| What | How | When | Kept |
| --- | --- | --- | --- |
| The database (every table) | `pg_dump`, compressed, encrypted, uploaded, downloaded back and checked | Nightly, 02:17 UTC | 30 days, never fewer than 7 copies |
| The product photos (DigitalOcean Spaces) | `rclone sync`, file by file, then checked | Nightly, after the database | Mirror of today, plus anything deleted kept 30 days |
| Proof that a copy restores | Restore the newest copy into a scratch database, count every table | Weekly, Sunday 03:17 UTC | The report is in the Actions run |

The copies go to a bucket at a storage company that is not DigitalOcean. We recommend Backblaze
B2 (section 3.1); any S3-compatible provider works. Each database copy is a file named
`ozi-db-YYYY-MM-DD.sql.zst.gpg` in the bucket's `db/` folder, with a `.sha256` file beside it that
holds its checksum. Photos are in `photos/`, and files deleted from Spaces are moved to
`photos-deleted/YYYY-MM-DD/`.

The jobs run on GitHub Actions, in this repository:

- `.github/workflows/backup.yml`, "Off-site backup": the nightly copies.
- `.github/workflows/restore-test.yml`, "Restore test": the weekly proof.
- `scripts/backup/`: the scripts both of them run, which you can also run on your own computer.

If a run fails, the job turns red in the Actions tab, GitHub emails whoever last touched the
workflow, and, when the `BACKUP_ALERT_WEBHOOK` secret is set, a message goes to that Slack,
Discord or Teams channel too. A red backup is urgent the same day: until it is green again we are
one failure from losing everything after the last good copy.

Today receipt photos are rows in the database (`ReceiptPhoto`), so the database copy already has
them. The photos job is for the Spaces bucket the product photos are moving to; until the
`SPACES_*` secrets exist it says so and skips.

---

## 2. Where to look, week to week

Open the repository on GitHub, then the **Actions** tab, then **Off-site backup** on the left.
Every run shows a short summary like

> Database copy ozi-db-2026-11-05.sql.zst.gpg uploaded and verified: 2,314,881 bytes, sha256 7c1f…
> Copies in the bucket: 30 (pruned 1 dated before 2026-10-06; keeping 30 days, never fewer than 7 copies).
> Photos: 1,204 files, 318,220,114 bytes, copied from Spaces and checked file by file.

Under **Restore test**, each Sunday's run lists every table with its row count. The numbers that
matter are `Shopper`, `Runner`, `Order`, `OrderItem`, `CatalogueItem`, `RunnerPayout` and
`StaffMember`. They should match, roughly, what the admin panel shows for the day the copy was
made, and they should never fall from one week to the next unless accounts were closed.

Once a month, glance at the bucket itself in the storage company's own website: it should hold
about thirty `ozi-db-` files with yesterday's at the top.

---

## 3. Setting it up (once)

Secrets are added in GitHub: open the repository, **Settings**, **Secrets and variables**,
**Actions**, **New repository secret**. Type the name exactly as written here. Nobody can read a
secret back once it is saved, only replace it, so keep each value in the password manager as well.

| Secret | What it is | Made in step |
| --- | --- | --- |
| `BACKUP_S3_ENDPOINT` | The bucket's S3 address, such as `s3.eu-central-003.backblazeb2.com` | 3.1 |
| `BACKUP_S3_BUCKET` | The bucket's name, such as `ozi-offsite-backups` | 3.1 |
| `BACKUP_S3_KEY` | The access key ("keyID") that may use only that bucket | 3.1 |
| `BACKUP_S3_SECRET` | That key's secret ("applicationKey") | 3.1 |
| `BACKUP_S3_REGION` | Optional. The region in the endpoint, such as `eu-central-003` | 3.1 |
| `BACKUP_DATABASE_URL` | A read-only connection string for the live database | 3.2 |
| `BACKUP_PASSPHRASE` | The passphrase every copy is encrypted with | 3.3 |
| `BACKUP_ALERT_WEBHOOK` | Optional. A chat webhook to tell when a run fails | 3.5 |
| `SPACES_KEY`, `SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_ENDPOINT`, `SPACES_REGION` | Optional until photos move to Spaces. The same values the app has for its photos bucket (a key that can only read is enough) | 3.6 |

### 3.1 A bucket at Backblaze B2 (about twenty minutes)

Backblaze B2 is cheap, in Europe, and speaks the same S3 language as DigitalOcean, so the same
tools work. Any other S3-compatible provider (Wasabi, Scaleway, Cloudflare R2, Amazon S3) works
the same way; only the endpoint and the console differ.

1. Go to backblaze.com, choose **B2 Cloud Storage**, and open an account in the company's name
   with the company card. When it asks for a region, choose **EU Central** (Amsterdam), so the
   data stays in Europe for UK GDPR purposes. Switch on two-factor sign-in for the account.
2. **Buckets**, **Create a Bucket**. Name: `ozi-offsite-backups` (names are global, so add a
   word if it is taken). Files in bucket: **Private**. Default encryption: **Enable**. Object
   lock: **Enable**. Create. Then on the bucket's settings, under **Object Lock**, set a
   **default retention of 30 days** (governance mode). This is what stops anybody, including a
   thief with our keys, deleting or replacing a copy for thirty days. The backup script only
   ever deletes copies older than thirty days, whose lock has run out, and if a delete is
   refused it says so as a warning and carries on.
3. On the bucket, **Lifecycle Settings**, choose **Use custom lifecycle rules** and add two:
   - prefix empty (the whole bucket): **Days till hide: blank**, **Days till delete: 1**. When a
     file is deleted or replaced, B2 only hides the old version; this removes hidden versions a
     day later, so nothing lingers past its lock.
   - prefix `photos-deleted/`: **Days till hide: 30**, **Days till delete: 1**. Photos removed
     from Spaces are parked here by the nightly mirror and vanish after thirty days.

   Database copies in `db/` are pruned by the backup script itself after `BACKUP_KEEP_DAYS`
   (30), always keeping at least 7, so the bucket holds about a month of copies.
4. Note the bucket's **Endpoint** shown on the Buckets page, such as
   `s3.eu-central-003.backblazeb2.com`. That is `BACKUP_S3_ENDPOINT`; the part between `s3.` and
   `.backblazeb2.com` is `BACKUP_S3_REGION`.
5. **Application Keys**, **Add a New Application Key**. Name: `github-actions-backup`. Allow
   access to bucket: **only `ozi-offsite-backups`**. Type of access: **Read and Write**. Leave
   file name prefix and duration empty. Create. The page shows the **keyID** and
   **applicationKey** once only: put them straight into the password manager, then into GitHub
   as `BACKUP_S3_KEY` and `BACKUP_S3_SECRET`.
6. Make a second key the same way named `restore-laptop`, **Read Only**, for the day you
   download a copy by hand (section 4). Keep it in the password manager only.

Cost: Backblaze charges about $6 per terabyte a month, with the first 10 GB free, and downloads
free up to three times what is stored. Thirty database copies of a few megabytes each are inside
the free allowance; a few gigabytes of photos cost pennies. Expect **under £1 a month now, and
£1 to £3 a month** once the photo library is tens of gigabytes. GitHub Actions minutes for the
jobs are inside the repository's free allowance.

### 3.2 A read-only database user on DigitalOcean

The backup needs to read the whole database and must not be able to change it, so it gets a
user of its own that can only read.

**If the database is a managed cluster** (the plan in LAUNCH.md and docs/SECURITY_PROPOSAL.md):

1. In DigitalOcean, **Databases**, open the cluster, **Users & Databases**, **Add a user**, name
   `ozi_backup`. DigitalOcean shows its password; copy it to the password manager.
2. Open the cluster's **Connection details**, choose the `doadmin` user, and copy the connection
   string. On your computer, with `psql` installed (section 4 says how), run
   `psql "<that connection string>"` and then, one line at a time:

   ```sql
   GRANT CONNECT ON DATABASE defaultdb TO ozi_backup;
   GRANT USAGE ON SCHEMA public TO ozi_backup;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO ozi_backup;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ozi_backup;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ozi_backup;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ozi_backup;
   ```

   The two `ALTER DEFAULT PRIVILEGES` lines mean tables the app adds later are readable too. If
   the database is not called `defaultdb`, the connection string says what it is called.
3. Back in **Connection details**, choose the user `ozi_backup`, the database `defaultdb` and
   **Connection string**. It looks like
   `postgresql://ozi_backup:PASSWORD@host:25060/defaultdb?sslmode=require`. That whole line is
   `BACKUP_DATABASE_URL`.
4. **Trusted sources.** GitHub's computers have no fixed address, so the cluster must accept
   connections from anywhere (with the password and SSL it is still private). On the cluster's
   **Settings** tab, **Trusted sources** must be empty, or must include the App Platform app
   *and* "all". If the list is restricted, the backup fails at "could not connect" and the fix
   is here.

**If the database is still the development database inside the app** (`production: false` in
`.do/app.yaml`, which is how it is today): App Platform's development databases allow no extra
users and no settings. Until the database moves to a cluster (which SECURITY_PROPOSAL already
asks for before real orders), use the app's own `DATABASE_URL` as `BACKUP_DATABASE_URL`:
open the app, **Settings**, the **api** component, **Environment Variables**, and copy the value of
`DATABASE_URL` (press the eye to reveal it). It has full rights, which is more than the backup
needs, so make the read-only user the day the database moves, and replace the secret then. Note
also that a development database is not backed up by DigitalOcean at all, which makes this
nightly copy the only one.

### 3.3 The passphrase

Make a long one. On a Mac or Linux computer, `openssl rand -base64 36` prints a good one; or use
the password manager's generator at 40 or more characters, letters and digits only (no spaces or
quotes, so it is easy to type on the bad day). Save it in the password manager as "Ozi off-site
backup passphrase", write it on paper for the sealed envelope in the safe, and add it to GitHub
as `BACKUP_PASSPHRASE`.

Changing it later is allowed, but copies made before the change open only with the old one, so
keep the old passphrase for thirty days after any change.

### 3.4 The first run, by hand

Actions tab, **Off-site backup**, **Run workflow**, keep "30" and ticked "photos", **Run
workflow**. It takes two to five minutes. Green means: the live database was read, the copy
decrypted back correctly before upload, the bucket holds the same bytes, and the bucket's listing
was tidied. Open the run and read the summary. Then run **Restore test** the same way and read
its table of row counts. Both green: the backups are working. From then on they run themselves.

If the first run is red, open the failed step; the last line starting `BACKUP FAILED:` says in
plain words which secret or setting is wrong. The scripts never print a connection string, a key
or the passphrase, so the log is safe to screenshot.

### 3.5 Being told when it fails (optional, recommended)

GitHub emails the account that last edited the workflow when a scheduled run fails. For a
message where the team will see it, make an incoming webhook in Slack (an app, "Incoming
Webhooks", choose the channel), Discord (channel settings, Integrations, Webhooks) or Teams, and
save its address as the secret `BACKUP_ALERT_WEBHOOK`. The message names the job and links to the
run.

### 3.6 When the photos move to Spaces

The builder adding Spaces for product photos gives the app five settings: `SPACES_KEY`,
`SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_REGION` and `SPACES_ENDPOINT`. Add the same five as
GitHub secrets (a Spaces key that can only read is better; DigitalOcean, **Spaces**, **Access
Keys**, limited to that bucket, read only). The next night's run mirrors the whole bucket and
checks every file.

---

## 4. Getting a copy back on your own computer

You will need three ordinary free tools on a Mac or Linux computer (on Windows, use WSL and the
same commands):

- `gpg` (on a Mac `brew install gnupg`; on Ubuntu `sudo apt install gnupg`) to decrypt;
- `zstd` (`brew install zstd` / `sudo apt install zstd`) to decompress;
- the PostgreSQL client tools, `psql` and `pg_dump`, **major version 16** to match the live
  database (`brew install postgresql@16` / `sudo apt install postgresql-client-16`). The number
  to match is `databases[0].version` in `.do/app.yaml`; if that changes, so does this.

**Download.** Easiest: sign in to Backblaze, **Browse Files**, open `ozi-offsite-backups`, then
`db/`, click the newest `ozi-db-….sql.zst.gpg` and **Download**, and the `.sha256` beside it. Or
with the AWS command line tool (`brew install awscli`) and the read-only `restore-laptop` key:

```sh
export AWS_ACCESS_KEY_ID=<keyID>  AWS_SECRET_ACCESS_KEY=<applicationKey>  AWS_DEFAULT_REGION=eu-central-003
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws --endpoint-url https://s3.eu-central-003.backblazeb2.com s3 ls s3://ozi-offsite-backups/db/
aws --endpoint-url https://s3.eu-central-003.backblazeb2.com s3 cp s3://ozi-offsite-backups/db/ozi-db-2026-11-05.sql.zst.gpg .
aws --endpoint-url https://s3.eu-central-003.backblazeb2.com s3 cp s3://ozi-offsite-backups/db/ozi-db-2026-11-05.sql.zst.gpg.sha256 .
```

**Check it is whole:** `sha256sum -c ozi-db-2026-11-05.sql.zst.gpg.sha256` must say `OK`.

**Decrypt and decompress** into a plain SQL file (gpg asks for the passphrase):

```sh
gpg --decrypt ozi-db-2026-11-05.sql.zst.gpg | zstd -d > ozi-db-2026-11-05.sql
head -n 5 ozi-db-2026-11-05.sql      # should begin "-- PostgreSQL database dump"
```

If gpg says `Bad session key`, the passphrase was wrong. (A copy ending `.sql.gz.gpg` was made
on a machine without zstd; use `gunzip` in place of `zstd -d`.)

That `.sql` file is the whole business in plain text. Keep it only as long as you need it and
delete it afterwards (`rm`); never email it or put it in a shared folder.

---

## 5. Restoring the database into a new home

### 5.1 Make the new database

In DigitalOcean (if it is DigitalOcean that is fine and only the data was lost), or at another
provider (section 8), create a **PostgreSQL 16** database in **London**. On DigitalOcean:
**Databases**, **Create Database Cluster**, PostgreSQL, version 16, London, the smallest size
(about $15 a month; it includes daily backups and point-in-time recovery, which the development
database lacks). Wait for it to be ready, then copy the **Connection string** for the `doadmin`
user and the `defaultdb` database. Call it `NEW_URL` below.

Any Postgres 16 works: a Hetzner or Fly.io machine with Postgres installed, Supabase, Neon,
Crunchy Bridge. Only the connection string differs.

### 5.2 Load the copy

The script does the download, the checksum, the decrypt, the load and the counts in one go,
and refuses a database that is not empty:

```sh
git clone https://github.com/EnrichT16/aldilivery.git && cd aldilivery
export BACKUP_PASSPHRASE='<the passphrase>'
export BACKUP_S3_ENDPOINT=s3.eu-central-003.backblazeb2.com BACKUP_S3_BUCKET=ozi-offsite-backups
export BACKUP_S3_KEY=<keyID> BACKUP_S3_SECRET=<applicationKey> BACKUP_S3_REGION=eu-central-003
export RESTORE_DATABASE_URL='<NEW_URL>'
bash scripts/backup/db-restore.sh latest           # or a file name, or a path to a downloaded copy
```

It ends with a table of every table's row count. Compare `Shopper`, `Runner`, `Order` and
`OrderItem` with the last Sunday's Restore test and with what you remember of the business.

Without the script, after section 4:

```sh
psql "<NEW_URL>" -v ON_ERROR_STOP=1 --single-transaction -f ozi-db-2026-11-05.sql
psql "<NEW_URL>" -c 'select count(*) from "Order"' -c 'select count(*) from "Shopper"'
```

### 5.3 Point the app at it

The app finds its database through one setting, `DATABASE_URL`.

- **Same DigitalOcean app, new database:** open the app, **Settings**, the **api** component,
  **Environment Variables**, **Edit**. `DATABASE_URL` today reads `${aldilivery-db.DATABASE_URL}`,
  which means "the development database attached to this app". Replace the value with `NEW_URL`,
  tick **Encrypt**, **Save**. The app redeploys by itself in a few minutes. (In `.do/app.yaml`
  the same change is the `DATABASE_URL` entry under the api service; the `databases:` block at the
  bottom can then be removed or left.)
- **A new app anywhere:** set `DATABASE_URL` to `NEW_URL` in that app's environment, with the
  rest of the settings (section 7).

Orders placed between the copy and the failure are lost; the copy is from 02:17 that morning at
the latest. Stripe's dashboard shows every payment taken, so the team can see who paid in the
gap and ring them.

---

## 6. Restoring the photos

Make a new Spaces bucket (DigitalOcean, **Spaces**, **Create**, London, private) or any S3
bucket, and a key for it. Then, with `rclone` installed (`brew install rclone`):

```sh
export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other
export RCLONE_CONFIG_BK_ACCESS_KEY_ID=<keyID> RCLONE_CONFIG_BK_SECRET_ACCESS_KEY=<applicationKey>
export RCLONE_CONFIG_BK_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
export RCLONE_CONFIG_NEW_TYPE=s3 RCLONE_CONFIG_NEW_PROVIDER=DigitalOcean
export RCLONE_CONFIG_NEW_ACCESS_KEY_ID=<new Spaces key> RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=<its secret>
export RCLONE_CONFIG_NEW_ENDPOINT=https://lon1.digitaloceanspaces.com
rclone copy bk:ozi-offsite-backups/photos new:<new-bucket-name> --progress
rclone check bk:ozi-offsite-backups/photos new:<new-bucket-name> --one-way
```

Then set the app's `SPACES_BUCKET`, `SPACES_ENDPOINT`, `SPACES_REGION`, `SPACES_KEY` and
`SPACES_SECRET` to the new bucket. If a photo was deleted by mistake in the last thirty days, it is
under `photos-deleted/<date>/` in the backup bucket.

---

## 7. Bringing the whole service up somewhere new

If DigitalOcean itself is gone, the order is:

1. **The code** is on GitHub, which is not DigitalOcean. `.do/app.yaml` describes the two parts:
   `api` (Node 24, `pnpm --filter @aldilivery/api build`, start `pnpm --filter @aldilivery/api start`,
   health at `/health`) and `web` (a static site built with `pnpm --filter @aldilivery/web build`,
   served at `/`, with `/api` routed to the api). Any host that runs Node and serves static files
   can run it: a DigitalOcean app in another account, Render, Railway, Fly.io, or a plain Ubuntu
   machine at Hetzner with nginx in front.
2. **The database**: section 5.
3. **The settings**: every `key:` under the api service in `.do/app.yaml` is a setting the app
   needs, and DEPLOY.md says where each value comes from (Stripe, Twilio, LiveKit, the language
   model, the mailboxes). The values themselves are secrets and live only in DigitalOcean's
   dashboard today, so **keep an export of them in the password manager, updated whenever one
   changes**: a restore without them means re-creating keys at each provider, which takes hours.
   `ALLOWED_ORIGIN` must name the new address; DEPLOY.md "Moving to the new domain" explains it.
4. **The photos**: section 6.
5. **The address**: section 7.1.
6. **Stripe**: in the Stripe dashboard, **Developers**, **Webhooks**, edit the existing endpoint's
   address to the new host (edit, do not add; a new endpoint has a new signing secret).
   Twilio's webhook addresses (voice and SMS) likewise point at the new host.

### 7.1 Switching the address at the registrar

The domain `ozidelivery.co.uk` is registered at Namecheap. Today the bare address
(`ozidelivery.co.uk`) answers with a permanent redirect (301) to `www.ozidelivery.co.uk`, set up
as a Namecheap URL Redirect record, and `www` is a CNAME record pointing at the DigitalOcean app's
own address (the one ending `.ondigitalocean.app`). So the switch is one record:

1. Sign in to Namecheap, **Domain List**, **Manage** beside ozidelivery.co.uk, **Advanced DNS**.
2. **Before the switch, if there is time:** change the `www` CNAME record's **TTL** from
   Automatic to **1 min** and wait an hour. TTL is how long the world may remember the old answer;
   lowering it first makes the switch take a minute instead of up to a day.
3. Add the domain on the new host first (it tells you the address to point at, and issues the
   https certificate once the record is live). On a DigitalOcean app that is **Settings**,
   **Domains**, **Add Domain**, `www.ozidelivery.co.uk`, "You manage your domain"; it shows the
   CNAME target.
4. Edit the `www` CNAME record's **Value** to the new host's address. Save. Leave the URL
   Redirect record for the bare address alone: it already points at `https://www.ozidelivery.co.uk`.
5. Check: `dig +short www.ozidelivery.co.uk` on a computer should show the new address within a
   few minutes; then section 7.2.
6. A week later, put the TTL back to Automatic.

If the registrar were ever lost too, the domain's **auth code** and the Namecheap sign-in belong
in the password manager with the rest.

### 7.2 What to check afterwards

1. `https://www.ozidelivery.co.uk/api/health` answers a small piece of JSON with `"ok": true`
   and a `commit` (the Live check workflow in Actions does this and more from outside).
2. `https://ozidelivery.co.uk` redirects to the www address and shows the landing page headed
   Ozi Delivery, with the version in the footer.
3. Sign in to `/staff` as the owner; the dashboard shows today's orders and the staff list.
4. A Shopper signs in by text message (Twilio reaches the new host), sees their past orders and
   saved addresses, and the catalogue search answers (`/api/catalogue/search?q=banana`).
5. A test order for a penny item goes through to "Send my order and pay"; Stripe's dashboard shows
   the webhook delivered (green) to the new address.
6. Ozi speaks: "Tap to talk to Ozi" answers "what version is this".
7. Tell the Runners, by the company inbox, that the service is back and any job they were on
   must be re-sent by the office.
8. Set up the backups again for the new home (section 3): a new `BACKUP_DATABASE_URL`, and the
   same bucket.

---

## 8. The standby server, later

The backups above get us back in an afternoon. A **standby** gets us back in minutes, at a price.
The plan, for when there are enough real orders to justify it:

1. **A second provider**, not DigitalOcean, in or near London: for example a Hetzner Cloud
   machine (about €5 a month for the app) with a managed Postgres from a specialist (Neon,
   Supabase or Crunchy Bridge, from about £15 to £25 a month for a small always-on database),
   or Fly.io for both. The app is deployed there from the same GitHub repository, with the same
   settings, but **switched off from the public**: it has a test address only, and its Twilio and
   Stripe webhooks are not registered, so it never texts a real Shopper or takes a real payment
   while standing by.
2. **A warm copy of the data.** Every night, right after the backup, the Restore test's own steps
   run against the standby database instead of a scratch one: drop and re-create it, restore the
   night's copy. The standby is then never more than a day behind. Live replication (seconds
   behind) is possible but needs a managed cluster at DigitalOcean with a replica at the other
   provider, and roughly doubles the database cost; it is not worth it until the order book is.
3. **Photos**: the standby reads photos straight from the backup bucket (set its `SPACES_*` to
   the backup bucket's `photos/` folder, read-only), so nothing extra is copied.
4. **The switch** is section 7.1 with the TTL kept at 5 minutes permanently: edit the `www`
   CNAME to the standby's address, set the standby's `ALLOWED_ORIGIN`, re-point the Stripe and
   Twilio webhooks, and turn on the standby's scheduled jobs. A drill for this takes an hour,
   twice a year.
5. **Honest cost.** Roughly **£20 to £35 a month** for the standby (the machine, the database,
   a little bandwidth), against under £3 for the backups alone, and a few hours of a
   programmer's time to set up and two hours a year to drill. The benefit is going from "back
   tomorrow with yesterday's orders" to "back in half an hour with yesterday's orders". Do it
   when an afternoon off the air would cost more than £400 a year in lost orders and trust.

---

## 9. The quarterly restore drill

Once a quarter (first week of January, April, July, October), one person, two hours, nothing
touched on the live service. Tick each line and keep the ticked list in the company drive.

- [ ] Open the Actions tab. Every **Off-site backup** run in the last two weeks is green. Note the
      newest copy's name and size from the summary.
- [ ] Open the bucket in the storage company's website. About thirty `ozi-db-` files are there,
      the newest from last night. The lifecycle rule still says 30 days.
- [ ] The passphrase in the password manager matches the one in the sealed envelope (open it,
      compare, reseal and date the new envelope).
- [ ] On your own computer, download last night's copy and its `.sha256`, check the checksum,
      decrypt and decompress it (section 4). The file begins "PostgreSQL database dump".
- [ ] Create a throwaway database (a free Neon or Supabase project is fine, or a local Postgres)
      and restore into it with `scripts/backup/db-restore.sh` (section 5.2). Every key table is
      listed with a sensible count. Write the `Shopper`, `Runner` and `Order` counts on the list.
- [ ] Delete the throwaway database and the plain `.sql` file. Empty the bin.
- [ ] Read section 7.1 and check, at Namecheap, that the `www` CNAME and the redirect for the bare
      address are as described, and that the Namecheap sign-in and the domain auth code are in
      the password manager.
- [ ] Check the password manager holds a current export of the app's environment variables
      (section 7, step 3), dated within the quarter. If not, make one.
- [ ] Run **Restore test** by hand and confirm it is green.
- [ ] Note anything that was unclear in this document and tell whoever maintains the repository,
      so it is fixed before the next drill.

Time the drill. If it takes more than two hours, something needs simplifying.

---

## 10. What this does not cover, honestly

- **The last few hours.** Copies are nightly. Orders between 02:17 and a failure are lost from
  our database (not from Stripe). Point-in-time recovery on a DigitalOcean managed cluster
  covers the gap for a DigitalOcean *data* loss, but not for a DigitalOcean *account* loss. The
  standby plan narrows it to a day; only live replication closes it.
- **Secrets.** The app's keys for Stripe, Twilio, LiveKit, the language model and the mailboxes
  live in DigitalOcean's dashboard. This document asks for an export in the password manager
  because without it a restore means re-issuing every key. The repository itself must never hold
  one (RULES, Rule Nine's spirit and docs/SECURITY_PROPOSAL.md).
- **GitHub failing on the same day.** The code is also on every developer's computer; the
  workflows would not run, so the backup would be a day late. Acceptable.
- **The backup key being stolen.** It can read every copy, but the copies are encrypted with the
  passphrase, which is stored separately. The key can delete copies, but Object Lock (3.1) stops
  that for 30 days. Rotate the key at once if it leaks: a new one in Backblaze, the secrets
  replaced in GitHub, the old one deleted.
