#!/usr/bin/env bash
# Starts the fake model, the API (memory backend) and the web dev server for the end-to-end run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
pkill -f "fake-model.mjs" 2>/dev/null || true
pkill -f "packages/api/dist/index.js" 2>/dev/null || true
pkill -f "vite --port 5173" 2>/dev/null || true
sleep 1

node "$HERE/fake-model.mjs" 9797 "$HERE/requests.jsonl" > "$HERE/fake-model.log" 2>&1 &

cd "$REPO"
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=development HOST=0.0.0.0 PORT=8080 DATA_BACKEND=memory \
  ALLOWED_ORIGIN=http://localhost:5173 STORE_CONFIG_PATH=./config/store.json SEED_ON_START=true \
  AUTH_TOKEN_SECRET=e2e-only-secret-value-that-is-long-enough-0123456789 \
  STAFF_API_KEY=e2e-staff-key-0123456789 \
  OTP_DELIVERY=log \
  LANGUAGE_MODEL_KEY=fake-key-for-e2e ANTHROPIC_BASE_URL=http://127.0.0.1:9797 \
  node packages/api/dist/index.js > "$HERE/api.log" 2>&1 &

cd "$REPO/packages/web"
npx vite --port 5173 --strictPort --host localhost > "$HERE/web.log" 2>&1 &

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1 && curl -sf http://127.0.0.1:5173/ > /dev/null 2>&1; then
    echo "api and web are up"; exit 0
  fi
  sleep 1
done
echo "did not come up"; tail -20 "$HERE/api.log"; tail -10 "$HERE/web.log"; exit 1
