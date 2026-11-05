# Off-site backups and the way back, 5 November 2026

Decided by Anthony on 5 November 2026, recorded as ruling 98 in docs/BUILD_PROMPT.md: Ozi
Delivery must survive DigitalOcean failing. Copies of the database and the product photos go to
another company's storage every night, kept thirty days, and a written, tested procedure brings
the service back. The runbook for Yvette is docs/RESTORE.md. No database migration; no change to
the app's code.

## Why

Everything runs in one place: the app, the database and (soon) the photo bucket are all on
DigitalOcean, and the development database the app uses today is not backed up by DigitalOcean
at all. An account mistake, a breach or a lost data centre would leave nothing but the code on
GitHub. docs/SECURITY_PROPOSAL.md asked for "a locked weekly backup elsewhere"; this is that,
nightly.

## 1. The nightly copy (`.github/workflows/backup.yml`)

- At 02:17 UTC, and from the Actions tab's "Run workflow" (with the days to keep and whether to
  do the photos as inputs). One run at a time.
- `scripts/backup/db-backup.sh`: installs `postgresql-client-<major>` from PGDG, the major read
  from `databases[0].version` in `.do/app.yaml` so `pg_dump` matches the live server; dumps
  through `BACKUP_DATABASE_URL` (a read-only user; see the runbook for today's development
  database, which allows none); compresses with zstd; encrypts with `gpg --symmetric`
  (AES-256, passphrase over a file descriptor) under `BACKUP_PASSPHRASE`; proves the fresh file
  decrypts and decompresses back into a PostgreSQL dump; uploads it as
  `db/ozi-db-YYYY-MM-DD.sql.zst.gpg` plus a `.sha256`, with `aws s3 cp` and a custom endpoint;
  verifies the object's size, downloads it back and compares the checksum; prunes copies dated
  more than `BACKUP_KEEP_DAYS` ago (30), never below seven, treating a delete refused by Object
  Lock as a warning.
- Why gpg and not age: `age -p` reads its passphrase only from a terminal, so it cannot run in a
  nightly job; the file names therefore end `.gpg`.
- The job fails loudly on any step; GitHub emails the workflow's owner about failed scheduled
  runs; `scripts/backup/notify.sh` posts to `BACKUP_ALERT_WEBHOOK` (Slack, Discord or Teams)
  when it is set. Nothing secret is printed: errors name the variable, never the value.
- Aws CLI 2.23+ sends CRC checksums that Backblaze rejects; `lib.sh` sets
  `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` and its response twin.

## 2. The photos (`photos` job in the same workflow)

- `scripts/backup/photos-sync.sh` mirrors the Space named by `SPACES_BUCKET` (with `SPACES_KEY`,
  `SPACES_SECRET`, `SPACES_ENDPOINT`, `SPACES_REGION`, the same names the app will use) into the
  backup bucket's `photos/` with `rclone sync`, both remotes configured from environment variables
  at run time (no rclone.conf). Files deleted from Spaces are moved to `photos-deleted/YYYY-MM-DD/`
  and a lifecycle rule removes them after thirty days. Afterwards it compares file counts and
  bytes and runs `rclone check`.
- Without the `SPACES_*` secrets the job writes "Photos: skipped …" to the summary and succeeds.
  Receipt photos are rows in the database today (`ReceiptPhoto`), so they are already in the
  database copy.

## 3. The weekly proof (`.github/workflows/restore-test.yml`)

- Sundays at 03:17 UTC, and on demand with an optional copy name. A first job reads the
  PostgreSQL major from `.do/app.yaml`; the second runs `postgres:<major>` as a service container
  that lives only for the job.
- `scripts/backup/db-restore.sh latest` downloads the newest copy, checks its `.sha256`, decrypts
  and decompresses it, refuses a target that already has tables, loads it in one transaction with
  `ON_ERROR_STOP`, and writes every table's row count to the job summary.
- The job then fails unless `Shopper`, `Runner`, `Order`, `OrderItem`, `CatalogueItem`,
  `PaymentMethod`, `RunnerPayout`, `StaffMember` and `_prisma_migrations` exist, and unless
  `PaymentMethod` has no column whose name contains "number" (Rule Ten on the copy too); then
  runs `prisma migrate status` for information (a migration merged but not yet deployed is not a
  bad backup, so that step cannot fail the job).
- It never touches the live database or the live app, and writes nothing to the bucket.

## 4. The runbook, docs/RESTORE.md

Plain English for Yvette: what is copied where; where to look each week; setting up (Backblaze
B2 account, bucket with Object Lock and the two lifecycle rules, restricted application keys; the
read-only database user with its `GRANT` lines and the trusted-sources note; the passphrase; the
first run; the webhook; the Spaces secrets); the exact list of GitHub secrets; downloading,
checking and decrypting a copy by hand; a fresh DigitalOcean cluster or any PostgreSQL 16 and
`db-restore.sh`; pointing the app at it through `DATABASE_URL`; restoring photos with rclone;
bringing the whole service up elsewhere (code, database, settings export, photos, Stripe and
Twilio webhooks); switching the `www` CNAME at Namecheap with the TTL lowered first (the bare
address already 301s to www there); what to check afterwards, starting with `/api/health`; the
standby-server plan (a second provider, a warm copy restored nightly, a permanently low TTL,
honestly £20 to £35 a month); a quarterly restore drill checklist; and what is not covered.

## 5. What Yvette has to do

Sections 3.1 to 3.4 of docs/RESTORE.md: open the Backblaze account and bucket, make the two keys,
create the read-only database user (or, on today's development database, copy the app's
`DATABASE_URL`), generate the passphrase and seal a paper copy, add the secrets
`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`,
`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` (and optionally `BACKUP_S3_REGION`,
`BACKUP_ALERT_WEBHOOK`, the `SPACES_*` five) in GitHub under Settings, Secrets and variables,
Actions, then run "Off-site backup" and "Restore test" once by hand and read their summaries.

## 6. How it was checked

- Both workflows parse as YAML; every script passes `bash -n`.
- The scripts ran end to end against a throwaway PostgreSQL 16 on the build machine with
  `BACKUP_LOCAL_DIR` standing in for the bucket (there is no docker there, and no bucket yet):
  backup of three tables and 25,000 rows; back-dated copies pruned to the floor and no further;
  restore into an empty database with the exact counts back; a second restore into the same
  database refused; a wrong passphrase refused with nothing written; the photos job skipping and
  the notifier doing nothing without their secrets; the passphrase absent from every line of
  output. The S3 path (`aws s3 cp`, `head-object`, `list-objects-v2`), the PGDG install, the
  service container and rclone could only be exercised in GitHub Actions, so the first manual
  run of each workflow (runbook, section 3.4) is the test of those; a failure names the step and
  the variable.
- Not changed: anything in packages/. The app has no new setting.
