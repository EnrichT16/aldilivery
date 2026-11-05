#!/usr/bin/env bash
# Restore a database copy into a PostgreSQL database (docs/RESTORE.md, ruling 98).
#
#   db-restore.sh latest                                   newest copy in the bucket
#   db-restore.sh ozi-db-2026-11-05.sql.zst.gpg            that copy, from the bucket
#   db-restore.sh /path/to/ozi-db-2026-11-05.sql.zst.gpg   a copy already on this machine
#
# Reads:  RESTORE_DATABASE_URL  the EMPTY database to restore into (never production; never printed)
#         BACKUP_PASSPHRASE     the passphrase the copy was encrypted with
#         BACKUP_S3_*           the bucket, when the copy is fetched (see lib.sh)
#         RESTORE_ALLOW_NONEMPTY=1   go ahead even if the target already has tables (default: refuse)
#
# Afterwards it prints the row count of every table, and writes them to the GitHub job summary
# when there is one, so the weekly restore test shows what came back.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

need RESTORE_DATABASE_URL BACKUP_PASSPHRASE
have psql || fail "psql is not installed"
have gpg  || fail "gpg is not installed"
WHAT="${1:-latest}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The copy to restore.
if [[ -f "$WHAT" ]]; then
  NAME="$(basename "$WHAT")"
  cp "$WHAT" "$WORK/$NAME"
  if [[ -f "$WHAT.sha256" ]]; then cp "$WHAT.sha256" "$WORK/$NAME.sha256"; fi
  log "restoring the file $NAME"
else
  store_setup
  if [[ "$WHAT" == latest ]]; then
    NAME="$(store_latest_db_copy)"
    [[ -n "$NAME" ]] || fail "the bucket has no database copies in $BACKUP_PREFIX/"
  else
    NAME="$WHAT"
  fi
  log "fetching $NAME"
  store_get "$NAME" "$WORK/$NAME"
  store_get "$NAME.sha256" "$WORK/$NAME.sha256" 2>/dev/null || log "no .sha256 beside it; the copy is checked by decrypting it only"
fi
case "$NAME" in
  *.sql.zst.gpg) EXT=zst ;;
  *.sql.gz.gpg)  EXT=gz ;;
  *) fail "$NAME is not a copy made by db-backup.sh (expected .sql.zst.gpg or .sql.gz.gpg)" ;;
esac
SIZE="$(stat -c %s "$WORK/$NAME")"
SUM="$(sha256_of "$WORK/$NAME")"
if [[ -f "$WORK/$NAME.sha256" ]]; then
  EXPECTED="$(cut -d' ' -f1 < "$WORK/$NAME.sha256")"
  [[ "$SUM" == "$EXPECTED" ]] || fail "checksum mismatch: the copy is damaged or is not the one its .sha256 describes"
  log "checksum matches the .sha256 beside it"
fi

# 2. The target must be reachable and, unless told otherwise, empty.
psql "$RESTORE_DATABASE_URL" -X -q -c 'select 1' >/dev/null 2>&1 || fail "cannot connect to the target database (RESTORE_DATABASE_URL)"
TABLES_BEFORE="$(psql "$RESTORE_DATABASE_URL" -X -A -t -c "select count(*) from information_schema.tables where table_schema='public'")"
if [[ "$TABLES_BEFORE" != "0" && "${RESTORE_ALLOW_NONEMPTY:-0}" != "1" ]]; then
  fail "the target database already has $TABLES_BEFORE tables; restore only into an empty database (or set RESTORE_ALLOW_NONEMPTY=1 if you really mean it)"
fi

# 3. Decrypt, decompress and load, in one stream and one transaction. Any SQL error stops it.
log "decrypting, decompressing ($EXT) and loading into the target database"
decrypt_cmd < "$WORK/$NAME" | decompress_cmd "$EXT" \
  | psql "$RESTORE_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null

# 4. What came back.
TABLES_AFTER="$(psql "$RESTORE_DATABASE_URL" -X -A -t -c "select count(*) from information_schema.tables where table_schema='public'")"
[[ "$TABLES_AFTER" -gt 0 ]] || fail "the restore finished but the database has no tables"
MIGRATIONS="$(psql "$RESTORE_DATABASE_URL" -X -A -t -c 'select count(*) from "_prisma_migrations" where finished_at is not null' 2>/dev/null || echo 'no _prisma_migrations table')"
summary "Restored $NAME ($SIZE bytes, sha256 $SUM): $TABLES_AFTER tables, $MIGRATIONS applied migrations."
summary ""
summary "| Table | Rows |"
summary "| --- | ---: |"
# Exact counts for every table, biggest first; the key tables are named in docs/RESTORE.md.
psql "$RESTORE_DATABASE_URL" -X -A -t -F '|' -c "
  select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname = 'public'
  order by 2 desc, 1" \
| while IFS='|' read -r table rows; do summary "| $table | $rows |"; done
