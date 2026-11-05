#!/usr/bin/env bash
# Nightly copy of the product photos (DigitalOcean Spaces) to the off-site bucket, with rclone
# (docs/RESTORE.md, ruling 98). Both remotes are built from the environment at run time; no
# rclone.conf is written anywhere.
#
# Reads:  SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_ENDPOINT (SPACES_REGION optional)
#         BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET
#         BACKUP_PHOTOS_PREFIX   folder in the backup bucket (default photos)
#
# Files deleted from Spaces are moved under photos-deleted/YYYY-MM-DD in the backup bucket, so a
# mistaken deletion can be undone for as long as the bucket's lifecycle rule keeps them (30 days;
# docs/RESTORE.md says how to set that rule).
#
# Exits 0 with a plain message, doing nothing, when the Spaces variables are absent: there are
# no photos in Spaces to copy yet. (Today receipt photos are rows in the database, so the
# database copy already has them.)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

if [[ -z "${SPACES_BUCKET:-}" || -z "${SPACES_KEY:-}" || -z "${SPACES_SECRET:-}" || -z "${SPACES_ENDPOINT:-}" ]]; then
  summary "Photos: skipped. The SPACES_KEY, SPACES_SECRET, SPACES_BUCKET and SPACES_ENDPOINT secrets are not all set, so there is no Spaces bucket to copy yet. Add them in GitHub (Settings, Secrets and variables, Actions) when photos move to Spaces."
  exit 0
fi
need BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_SECRET
have rclone || fail "rclone is not installed"
have jq     || fail "jq is not installed"

with_scheme() { case "$1" in http://*|https://*) echo "$1" ;; *) echo "https://$1" ;; esac; }

# Source: the Spaces bucket.
export RCLONE_CONFIG_SRC_TYPE=s3
export RCLONE_CONFIG_SRC_PROVIDER=DigitalOcean
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$SPACES_KEY"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$SPACES_SECRET"
RCLONE_CONFIG_SRC_ENDPOINT="$(with_scheme "$SPACES_ENDPOINT")"; export RCLONE_CONFIG_SRC_ENDPOINT
export RCLONE_CONFIG_SRC_REGION="${SPACES_REGION:-}"
# Destination: the off-site bucket (any S3-compatible provider; "Other" suits Backblaze B2).
export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="$BACKUP_S3_KEY"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET"
RCLONE_CONFIG_DST_ENDPOINT="$(with_scheme "$BACKUP_S3_ENDPOINT")"; export RCLONE_CONFIG_DST_ENDPOINT
export RCLONE_CONFIG_DST_REGION="${BACKUP_S3_REGION:-}"

PREFIX="${BACKUP_PHOTOS_PREFIX:-photos}"
TODAY="$(date -u +%F)"
log "syncing Spaces bucket $SPACES_BUCKET to $BACKUP_S3_BUCKET/$PREFIX"
rclone sync "src:$SPACES_BUCKET" "dst:$BACKUP_S3_BUCKET/$PREFIX" \
  --backup-dir "dst:$BACKUP_S3_BUCKET/$PREFIX-deleted/$TODAY" \
  --checksum --fast-list --transfers 8 --checkers 16 --retries 3 --stats-one-line --stats 0 \
  || fail "rclone sync did not finish cleanly"

# Then prove the copy is complete: the same number of files and bytes, and a file-by-file check.
SRC="$(rclone size "src:$SPACES_BUCKET" --json)"
DST="$(rclone size "dst:$BACKUP_S3_BUCKET/$PREFIX" --json)"
SRC_COUNT="$(jq -r .count <<<"$SRC")"; SRC_BYTES="$(jq -r .bytes <<<"$SRC")"
DST_COUNT="$(jq -r .count <<<"$DST")"; DST_BYTES="$(jq -r .bytes <<<"$DST")"
[[ "$SRC_COUNT" == "$DST_COUNT" && "$SRC_BYTES" == "$DST_BYTES" ]] \
  || fail "after the sync the copy has $DST_COUNT files ($DST_BYTES bytes) but Spaces has $SRC_COUNT ($SRC_BYTES bytes)"
rclone check "src:$SPACES_BUCKET" "dst:$BACKUP_S3_BUCKET/$PREFIX" --one-way --size-only -q \
  || fail "rclone check found differences between Spaces and the copy"
summary "Photos: $DST_COUNT files, $DST_BYTES bytes, copied from Spaces and checked file by file."
