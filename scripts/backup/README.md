# Off-site backup scripts

The scripts behind `.github/workflows/backup.yml` (nightly) and `.github/workflows/restore-test.yml`
(weekly). The guide for people is docs/RESTORE.md; this file is for whoever maintains the scripts.

| Script | Does |
| --- | --- |
| `db-backup.sh` | `pg_dump` the database named by `BACKUP_DATABASE_URL`, compress (zstd, or gzip where zstd is missing), encrypt with `gpg --symmetric` (AES-256) using `BACKUP_PASSPHRASE`, prove the result decrypts, upload it and a `.sha256` to the bucket, download it back and compare the checksum, then prune copies dated more than `BACKUP_KEEP_DAYS` (30) ago while keeping at least `BACKUP_KEEP_MIN` (7). |
| `db-restore.sh [latest\|NAME\|PATH]` | Fetch a copy (or take a local file), check its `.sha256`, decrypt, decompress and load it into `RESTORE_DATABASE_URL` in one transaction, refusing a database that already has tables, then print every table's row count (to the job summary too). |
| `photos-sync.sh` | `rclone sync` the Spaces bucket (`SPACES_*`) into the backup bucket's `photos/`, parking deleted files under `photos-deleted/YYYY-MM-DD/`, then compare counts and bytes and run `rclone check`. Exits 0 with a message when the `SPACES_*` variables are absent. |
| `notify.sh JOB RUN_URL` | POST a JSON message to `BACKUP_ALERT_WEBHOOK`; does nothing without it. |
| `lib.sh` | Shared: the store (S3 through `aws` with a custom endpoint, or a local folder when `BACKUP_LOCAL_DIR` is set), compression, gpg with the passphrase on a file descriptor, logging to the GitHub job summary. |

Rules the scripts keep:

- No secret is ever printed: not the connection strings, the keys or the passphrase. Error
  messages name the variable, never its value. There is no `set -x`.
- The plain SQL never touches a disk in the backup; the dump is piped straight through the
  compressor and gpg.
- `gpg --symmetric` rather than `age -p`: age can take a passphrase only from a terminal, and a
  nightly job has none. The files therefore end `.gpg`, not `.age`.
- Pruning goes by the date in the file name, never by upload time, and never below `BACKUP_KEEP_MIN`
  copies. A refused delete (Object Lock) is a warning, not a failure.
- `pg_dump` must be at least the server's major version; the workflows install
  `postgresql-client-<major>` from PGDG, with the major read from `databases[0].version` in
  `.do/app.yaml`.
- The restore test's target is a service container that lives only for the job. Nothing here can
  write to the live database: `BACKUP_DATABASE_URL` is meant to be a read-only user, and the
  backup only ever runs `pg_dump` and `show server_version` against it.

## Trying them without a bucket

Set `BACKUP_LOCAL_DIR` to any folder and the "bucket" becomes that folder. With a local Postgres:

```sh
export BACKUP_LOCAL_DIR=/tmp/ozi-store BACKUP_PASSPHRASE='try me'
BACKUP_DATABASE_URL=postgresql://ozi:ozi@localhost:5432/source bash scripts/backup/db-backup.sh
RESTORE_DATABASE_URL=postgresql://ozi:ozi@localhost:5432/empty  bash scripts/backup/db-restore.sh latest
BACKUP_DATE=2026-10-01 BACKUP_DATABASE_URL=... bash scripts/backup/db-backup.sh   # a back-dated copy, to see pruning
```

This is how the scripts were first checked (5 November 2026): a throwaway PostgreSQL 16, three
tables, 25,000 rows; back-dated copies pruned down to the floor; a restore into an empty database
with the exact counts back; a second restore into the same database refused; a wrong passphrase
refused with nothing written; `photos-sync.sh` skipping and `notify.sh` doing nothing without
their secrets; and the passphrase found nowhere in the output.
