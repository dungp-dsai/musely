#!/usr/bin/env bash
# Deploy a Fly app from the monorepo root (correct Docker build context).
#
# fly.toml lives under fly-staging/ or fly-prod/, but Dockerfiles COPY from
# apps/* paths relative to the repo root. Always deploy with context = root.
#
# Usage (from repo root):
#   ./scripts/fly-deploy.sh fly-staging/backend/fly.toml --remote-only

set -euo pipefail

CONFIG="${1:?usage: $0 <path/to/fly.toml> [extra flyctl deploy flags...]}"
shift

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="$ROOT/$CONFIG"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "error: fly.toml not found: $CONFIG" >&2
  exit 1
fi

DOCKERFILE="$(grep -m1 'dockerfile = ' "$CONFIG_PATH" | sed -E 's/^[[:space:]]*dockerfile[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "$DOCKERFILE" || "$DOCKERFILE" == *dockerfile* ]]; then
  echo "error: could not read dockerfile from $CONFIG_PATH" >&2
  exit 1
fi

if [[ ! -f "$ROOT/$DOCKERFILE" ]]; then
  echo "error: dockerfile not found: $ROOT/$DOCKERFILE" >&2
  exit 1
fi

echo "Deploying with context=$ROOT dockerfile=$DOCKERFILE config=$CONFIG"
exec flyctl deploy "$ROOT" --config "$CONFIG_PATH" --dockerfile "$DOCKERFILE" "$@"
