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

app_exists() {
  flyctl apps show "$APP" >/dev/null 2>&1
}

volume_exists() {
  local vol="$1"
  flyctl volumes list -a "$APP" --json 2>/dev/null \
    | grep -q "\"name\":\"${vol}\""
}

if app_exists; then
  echo "Fly app exists: $APP"
else
  echo "Creating Fly app: $APP"
  CREATE_ARGS=(apps create "$APP" --yes)
  if [[ -n "${FLY_ORG:-}" ]]; then
    CREATE_ARGS+=(--org "$FLY_ORG")
  fi
  flyctl "${CREATE_ARGS[@]}"
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
