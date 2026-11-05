#!/usr/bin/env bash
# Nightly off-site copy of the database (docs/RESTORE.md, ruling 98).
#
#   pg_dump  ->  zstd  ->  gpg --symmetric  ->  upload  ->  verify  ->  prune old copies
#
# Reads:  BACKUP_DATABASE_URL   a read-only connection string (never printed)
#         BACKUP_PASSPHRASE     the passphrase the copy is encrypted with (never printed)
#         BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET   the bucket
#         BACKUP_KEEP_DAYS      how many days of copies to keep (default 30)
#         BACKUP_KEEP_MIN       never prune below this many copies, whatever their age (default 7)
#         BACKUP_DATE           the date in the file name (default today, UTC)
#         BACKUP_LOCAL_DIR      set to a folder to try the script without a bucket (not off-site)
#
# Writes: <stem>-YYYY-MM-DD.sql.zst.gpg and a .sha256 beside it, both in the bucket's db/ folder.
# Exits non-zero, with "BACKUP FAILED" on stderr, when any step goes wrong, so the Actions job
# fails and the alert step runs.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

need BACKUP_DATABASE_URL BACKUP_PASSPHRASE
have pg_dump || fail "pg_dump is not installed"
have psql    || fail "psql is not installed"
have gpg     || fail "gpg is not installed"

KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_KEEP_DAYS must be a whole number of days"
[[ "$KEEP_MIN"  =~ ^[0-9]+$ ]] || fail "BACKUP_KEEP_MIN must be a whole number"
DATE="${BACKUP_DATE:-$(date -u +%F)}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "BACKUP_DATE must look like 2026-11-05"

EXT="$(compress_ext)"
NAME="${BACKUP_NAME_STEM}-${DATE}.sql.${EXT}.gpg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

store_setup

# 1. The server's version, so a mismatch with pg_dump is seen before the dump, not inside it.
SERVER_VERSION="$(psql "$BACKUP_DATABASE_URL" -X -A -t -c 'show server_version' 2>/dev/null || true)"
[[ -n "$SERVER_VERSION" ]] || fail "could not connect to the database (is BACKUP_DATABASE_URL right, and does the database allow this machine in its trusted sources?)"
DUMP_VERSION="$(pg_dump --version | grep -oE '[0-9]+(\.[0-9]+)?' | head -n1)"
log "server PostgreSQL ${SERVER_VERSION%% *}; pg_dump ${DUMP_VERSION}"
if [[ "${SERVER_VERSION%%.*}" -gt "${DUMP_VERSION%%.*}" ]]; then
  fail "pg_dump ${DUMP_VERSION} is older than the server (${SERVER_VERSION}); install postgresql-client-${SERVER_VERSION%%.*}"
fi

# 2. Dump, compress, encrypt, in one stream, so the plain SQL never touches the disk.
log "dumping, compressing ($EXT) and encrypting to $NAME"
pg_dump "$BACKUP_DATABASE_URL" --format=plain --no-owner --no-privileges --no-publications --no-subscriptions \
  | compress_cmd "$EXT" | encrypt_cmd > "$WORK/$NAME"
SIZE="$(stat -c %s "$WORK/$NAME")"
[[ "$SIZE" -gt 1024 ]] || fail "the encrypted copy is only $SIZE bytes, which cannot be a real database"
SUM="$(sha256_of "$WORK/$NAME")"
printf '%s  %s\n' "$SUM" "$NAME" > "$WORK/$NAME.sha256"
log "copy is $SIZE bytes, sha256 $SUM"

# 3. The copy must open with the passphrase before it is sent anywhere. The whole stream is
#    read (the rest to /dev/null), so this proves every byte decrypts and decompresses.
decrypt_cmd < "$WORK/$NAME" | decompress_cmd "$EXT" | { head -c 65536 > "$WORK/head.sql"; cat > /dev/null; } \
  || fail "the fresh copy did not decrypt and decompress"
grep -q 'PostgreSQL database dump' "$WORK/head.sql" || fail "the fresh copy did not decrypt back into a PostgreSQL dump"
rm -f "$WORK/head.sql"
log "decrypts and decompresses back into a PostgreSQL dump"

# 4. Upload, then verify what the bucket holds: size, and the checksum from a fresh download.
store_put "$WORK/$NAME" "$NAME" "$SUM"
store_put "$WORK/$NAME.sha256" "$NAME.sha256"
REMOTE_SIZE="$(store_size "$NAME")"
[[ "$REMOTE_SIZE" == "$SIZE" ]] || fail "the bucket holds '$REMOTE_SIZE' bytes for $NAME, not $SIZE"
store_get "$NAME" "$WORK/verify.bin"
[[ "$(sha256_of "$WORK/verify.bin")" == "$SUM" ]] || fail "the copy downloaded back from the bucket has a different checksum"
summary "Database copy $NAME uploaded and verified: $SIZE bytes, sha256 $SUM."

# 5. Prune copies older than KEEP_DAYS by the date in their name, keeping at least KEEP_MIN.
CUTOFF="$(date -u -d "$DATE - $KEEP_DAYS days" +%F)"
mapfile -t COPIES < <(store_list | grep -E "^${BACKUP_NAME_STEM}-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.(zst|gz)\.gpg$" | sort)
TOTAL="${#COPIES[@]}"
PRUNED=0
for copy in "${COPIES[@]}"; do
  copy_date="${copy#"${BACKUP_NAME_STEM}"-}"; copy_date="${copy_date:0:10}"
  if [[ "$copy_date" < "$CUTOFF" && $((TOTAL - PRUNED)) -gt "$KEEP_MIN" ]]; then
    log "pruning $copy (older than $KEEP_DAYS days)"
    # Housekeeping only: the night's copy is already safe. A bucket with Object Lock refuses to
    # delete a copy whose lock has not run out, which is the lock doing its job, not a failure.
    if store_delete "$copy" && { store_delete "$copy.sha256" || true; }; then
      PRUNED=$((PRUNED + 1))
    else
      NOT_PRUNED=$((${NOT_PRUNED:-0} + 1))
      log "::warning::could not delete $copy (Object Lock, or the key may not delete); the bucket's lifecycle rule will remove it"
    fi
  fi
done
summary "Copies in the bucket: $((TOTAL - PRUNED)) (pruned $PRUNED dated before $CUTOFF${NOT_PRUNED:+, $NOT_PRUNED could not be deleted}; keeping $KEEP_DAYS days, never fewer than $KEEP_MIN copies)."
