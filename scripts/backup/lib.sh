#!/usr/bin/env bash
# Shared pieces for the off-site backup scripts (docs/RESTORE.md, ruling 98).
#
# Where the copies go is one of two "stores":
#   s3     an S3-compatible bucket (Backblaze B2, or any other) reached with the aws CLI and a
#          custom endpoint. Needs BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY and
#          BACKUP_S3_SECRET.
#   local  a folder on this machine (BACKUP_LOCAL_DIR). Only for trying the scripts out; it is
#          not off-site. Chosen automatically when BACKUP_LOCAL_DIR is set.
#
# Nothing here ever prints a connection string, a key or a passphrase. The scripts run with
# `set -euo pipefail` and never with `set -x`.

set -euo pipefail

BACKUP_PREFIX="${BACKUP_PREFIX:-db}"           # folder inside the bucket for database copies
BACKUP_NAME_STEM="${BACKUP_NAME_STEM:-ozi-db}" # files are <stem>-YYYY-MM-DD.sql.zst.gpg

log()  { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf 'BACKUP FAILED: %s\n' "$*" >&2; exit 1; }

need() {
  # need VAR [VAR...]  — refuse to run without each named variable, naming only the variable.
  local v
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || fail "the environment variable $v is not set"
  done
}

have() { command -v "$1" >/dev/null 2>&1; }

store_kind() {
  if [[ -n "${BACKUP_LOCAL_DIR:-}" ]]; then echo local; else echo s3; fi
}

store_setup() {
  case "$(store_kind)" in
    local)
      mkdir -p "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX"
      log "store: local folder (not off-site; for trying the scripts only)"
      ;;
    s3)
      need BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_SECRET
      have aws || fail "the aws command is not installed"
      export AWS_ACCESS_KEY_ID="$BACKUP_S3_KEY"
      export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET"
      export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"
      export AWS_EC2_METADATA_DISABLED=true
      # aws CLI 2.23 and later add CRC checksums that some S3-compatible providers (Backblaze B2
      # among them) reject. "when_required" sends them only where S3 itself insists.
      export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
      export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
      S3_ENDPOINT="$BACKUP_S3_ENDPOINT"
      case "$S3_ENDPOINT" in http://*|https://*) ;; *) S3_ENDPOINT="https://$S3_ENDPOINT" ;; esac
      log "store: bucket $BACKUP_S3_BUCKET at $S3_ENDPOINT"
      ;;
  esac
}

s3() { aws --endpoint-url "$S3_ENDPOINT" "$@"; }

# store_put LOCAL_FILE NAME [sha256]  — upload one file into the prefix.
store_put() {
  local file="$1" name="$2" sum="${3:-}"
  case "$(store_kind)" in
    local) cp -f "$file" "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX/$name" ;;
    s3)
      if [[ -n "$sum" ]]; then
        s3 s3 cp --only-show-errors --metadata "sha256=$sum" "$file" "s3://$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$name"
      else
        s3 s3 cp --only-show-errors "$file" "s3://$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$name"
      fi
      ;;
  esac
}

# store_size NAME  — the stored object's size in bytes, or nothing if it is not there.
store_size() {
  local name="$1"
  case "$(store_kind)" in
    local)
      if [[ -f "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX/$name" ]]; then stat -c %s "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX/$name"; fi
      ;;
    s3) s3 s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$BACKUP_PREFIX/$name" --query ContentLength --output text 2>/dev/null || true ;;
  esac
}

# store_get NAME LOCAL_FILE  — download one object.
store_get() {
  local name="$1" file="$2"
  case "$(store_kind)" in
    local) cp -f "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX/$name" "$file" ;;
    s3) s3 s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$name" "$file" ;;
  esac
}

# store_list  — the names in the prefix, one a line, sorted.
store_list() {
  case "$(store_kind)" in
    local) ls -1 "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX" 2>/dev/null | sort ;;
    s3) s3 s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$BACKUP_PREFIX/" --query 'Contents[].Key' --output text 2>/dev/null \
          | tr '\t' '\n' | sed -e '/^None$/d' -e "s#^$BACKUP_PREFIX/##" | sed '/^$/d' | sort ;;
  esac
}

# store_delete NAME
store_delete() {
  local name="$1"
  case "$(store_kind)" in
    local) rm -f "$BACKUP_LOCAL_DIR/$BACKUP_PREFIX/$name" ;;
    s3) s3 s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$name" ;;
  esac
}

# The newest database copy in the store, by the date in its name (not by upload time).
store_latest_db_copy() {
  store_list | grep -E "^${BACKUP_NAME_STEM}-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.(zst|gz)\.gpg$" | sort | tail -n 1
}

# Compression: zstd where it exists, gzip otherwise; the file extension says which was used.
compress_ext()   { if have zstd; then echo zst; else echo gz; fi; }
compress_cmd()   { case "$1" in zst) zstd -q -T0 -10 ;; gz) gzip -6 ;; *) fail "unknown compression $1" ;; esac; }
decompress_cmd() { case "$1" in zst) zstd -q -d ;; gz) gzip -d ;; *) fail "unknown compression $1" ;; esac; }

# Symmetric encryption with the passphrase in BACKUP_PASSPHRASE. gpg is used rather than age
# because age can only take a passphrase from a terminal, and a nightly job has none. AES-256,
# the passphrase stretched with gpg's slowest s2k setting; the passphrase itself goes to gpg over
# a file descriptor, never on the command line, so `ps` cannot see it.
encrypt_cmd() {
  need BACKUP_PASSPHRASE
  gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 \
      --s2k-digest-algo SHA512 --compress-algo none --pinentry-mode loopback \
      --passphrase-fd 3 --output - 3< <(printf '%s' "$BACKUP_PASSPHRASE")
}
decrypt_cmd() {
  need BACKUP_PASSPHRASE
  gpg --batch --yes --quiet --decrypt --pinentry-mode loopback \
      --passphrase-fd 3 --output - 3< <(printf '%s' "$BACKUP_PASSPHRASE")
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Write a line to the GitHub Actions job summary when there is one, and to the log always.
summary() {
  log "$*"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi
}
