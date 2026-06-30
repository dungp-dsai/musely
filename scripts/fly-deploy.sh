#!/usr/bin/env bash
# Deploy a Fly app from the monorepo root (correct Docker build context).
#
# fly.toml lives under fly-staging/ or fly-prod/. Paths in fly.toml (dockerfile)
# are relative to that fly.toml file. Docker COPY paths assume build context
# is the repo root — pass "." as the deploy working directory.
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

CONFIG_DIR="$(dirname "$CONFIG_PATH")"
DOCKERFILE_REL="$(grep -m1 'dockerfile = ' "$CONFIG_PATH" | sed -E 's/^[[:space:]]*dockerfile[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "$DOCKERFILE_REL" || "$DOCKERFILE_REL" == *dockerfile* ]]; then
  echo "error: could not read dockerfile from $CONFIG_PATH" >&2
  exit 1
fi

# fly.toml dockerfile paths are relative to the fly.toml directory.
DOCKERFILE_ABS="$(cd "$CONFIG_DIR" && cd "$(dirname "$DOCKERFILE_REL")" && echo "$(pwd)/$(basename "$DOCKERFILE_REL")")"
if [[ ! -f "$DOCKERFILE_ABS" ]]; then
  echo "error: dockerfile not found: $DOCKERFILE_ABS" >&2
  exit 1
fi

echo "Deploying with context=$ROOT dockerfile=$DOCKERFILE_ABS config=$CONFIG"

DEPLOY_ARGS=("$ROOT" --config "$CONFIG_PATH" --dockerfile "$DOCKERFILE_ABS")
# Agent app images are referenced as registry.fly.io/<app>:latest by the backend orchestrator.
if [[ "$CONFIG" == *"/agent/"* ]]; then
  DEPLOY_ARGS+=(--image-label latest)
fi

exec flyctl deploy "${DEPLOY_ARGS[@]}" "$@"
