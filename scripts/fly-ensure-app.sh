#!/usr/bin/env bash
# Ensure the Fly app (and optional volumes from fly.toml) exist before deploy.
#
# Usage (from repo root):
#   ./scripts/fly-ensure-app.sh fly-staging/backend/fly.toml
#
# Env:
#   FLY_API_TOKEN  required
#   FLY_ORG        optional org slug (org token usually infers org)

set -euo pipefail

CONFIG="${1:?usage: $0 <path/to/fly.toml>}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="$ROOT/$CONFIG"
if [[ ! -f "$CONFIG_PATH" ]]; then
  CONFIG_PATH="$CONFIG"
fi
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "error: fly.toml not found: $CONFIG" >&2
  exit 1
fi

APP="$(grep -m1 '^app = ' "$CONFIG_PATH" | sed -E 's/^app = ["'\'']([^"'\'']+)["'\''].*/\1/')"
REGION="$(grep -m1 '^primary_region = ' "$CONFIG_PATH" | sed -E 's/^primary_region = ["'\'']([^"'\'']+)["'\''].*/\1/' || true)"
REGION="${REGION:-sin}"

if [[ -z "$APP" ]]; then
  echo "error: could not read app name from $CONFIG_PATH" >&2
  exit 1
fi

# flyctl apps show is NOT a valid command (it prints help and exits 0).
# Use status -a or apps list to check existence.
app_exists() {
  flyctl status -a "$APP" >/dev/null 2>&1
}

app_listed() {
  flyctl apps list --json 2>/dev/null \
    | grep -qE "\"Name\"[[:space:]]*:[[:space:]]*\"${APP}\""
}

wait_for_app() {
  local attempt
  for attempt in $(seq 1 24); do
    if app_exists || app_listed; then
      echo "Fly app ready: $APP"
      return 0
    fi
    echo "Waiting for app $APP to appear ($attempt/24)..."
    sleep 5
  done
  echo "error: app $APP not visible after create" >&2
  exit 1
}

volume_exists() {
  local vol="$1"
  flyctl volumes list -a "$APP" --json 2>/dev/null \
    | grep -qE "\"name\"[[:space:]]*:[[:space:]]*\"${vol}\""
}

if app_exists || app_listed; then
  echo "Fly app exists: $APP"
else
  echo "Creating Fly app: $APP"
  CREATE_ARGS=(apps create "$APP" --yes)
  if [[ -n "${FLY_ORG:-}" ]]; then
    CREATE_ARGS+=(--org "$FLY_ORG")
  fi
  flyctl "${CREATE_ARGS[@]}" || {
    if ! app_exists && ! app_listed; then
      echo "error: failed to create app $APP" >&2
      exit 1
    fi
    echo "Fly app $APP already exists (parallel create)"
  }
  wait_for_app
fi

# Create any [[mounts]] volumes declared in fly.toml (e.g. backend SQLite volume).
while IFS= read -r vol; do
  [[ -n "$vol" ]] || continue
  if volume_exists "$vol"; then
    echo "Volume exists: $vol (app=$APP)"
  else
    echo "Creating volume: $vol (app=$APP, region=$REGION)"
    flyctl volumes create "$vol" --region "$REGION" --size 1 -a "$APP" --yes
  fi
done < <(awk '
  /^\[\[mounts\]\]/ { in_mount=1; next }
  /^\[/ { in_mount=0 }
  in_mount && /^[[:space:]]*source[[:space:]]*=/ {
    gsub(/.*source[[:space:]]*=[[:space:]]*"/, "")
    gsub(/".*/, "")
    print
  }
' "$CONFIG_PATH")

echo "Ready: $APP"
