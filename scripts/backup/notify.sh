#!/usr/bin/env bash
# Tell somebody a backup job failed (docs/RESTORE.md). Posts one JSON message to
# BACKUP_ALERT_WEBHOOK (a Slack, Discord, Teams or any webhook that accepts JSON; both "text"
# and "content" are sent so Slack and Discord each read it). Does nothing, quietly, when no
# webhook is set: GitHub still emails whoever owns the workflow when a scheduled run fails.
#
#   notify.sh "Database backup" "https://github.com/.../actions/runs/123"
set -euo pipefail
JOB="${1:-Backup}"
RUN_URL="${2:-}"
if [[ -z "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
  echo "No BACKUP_ALERT_WEBHOOK secret, so no message sent. GitHub emails the workflow's owner about failed scheduled runs."
  exit 0
fi
# The repository's name stands for the product here: the product's name is configuration
# (Rule Nine) and this script has no reason to read config/store.json.
TEXT="Off-site backup FAILED (${GITHUB_REPOSITORY:-the app}): $JOB, $(date -u '+%A %-d %B %Y at %H:%M UTC'). Open the run, then docs/RESTORE.md. $RUN_URL"
BODY="$(jq -nc --arg t "$TEXT" '{text: $t, content: $t}')"
curl -sS -m 20 -o /dev/null -w 'alert webhook answered %{http_code}\n' \
  -H 'Content-Type: application/json' -d "$BODY" "$BACKUP_ALERT_WEBHOOK"
