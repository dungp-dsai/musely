#!/usr/bin/env bash
# Import secrets.env into a Fly app.
#
# Usage (from repo root):
#   ./scripts/fly-secrets-import.sh fly-staging/backend
#   ./scripts/fly-secrets-import.sh fly-prod/agent
#
# Requires: flyctl, secrets.env next to fly.toml (copy from secrets.env.example).

set -euo pipefail

APP_DIR="${1:?usage: $0 <fly-staging/backend|fly-prod/agent|...>}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/$APP_DIR"
SECRETS="$DIR/secrets.env"
CONFIG="$DIR/fly.toml"

if [[ ! -f "$CONFIG" ]]; then
  echo "error: missing $CONFIG" >&2
  exit 1
fi

if [[ ! -f "$SECRETS" ]]; then
  echo "error: missing $SECRETS" >&2
  echo "  cp $DIR/secrets.env.example $SECRETS" >&2
  exit 1
fi

# Strip comments and blank lines before import.
grep -v '^\s*#' "$SECRETS" | grep -v '^\s*$' | fly secrets import --config "$CONFIG"

echo "Secrets imported for $APP_DIR"
