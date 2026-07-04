#!/bin/sh
# Merge Musely platform config into a user agent data dir (/opt/data).
# Platform dir: /opt/musely/platform (baked in image). Keys merged from container env.
set -eu

DATA="${MUSELY_AGENT_DATA_DIR:-/opt/data}"
PLATFORM="${MUSELY_AGENT_PLATFORM_DIR:-/opt/musely/platform}"

mkdir -p "$DATA/skills" "$DATA/sessions" "$DATA/memories"

if [ -f "$PLATFORM/config.yaml" ]; then
  cp "$PLATFORM/config.yaml" "$DATA/config.yaml"
fi
if [ -f "$PLATFORM/SOUL.md" ]; then
  cp "$PLATFORM/SOUL.md" "$DATA/SOUL.md"
fi
if [ -d "$PLATFORM/skills/musely" ]; then
  rm -rf "$DATA/skills/musely"
  cp -a "$PLATFORM/skills/musely" "$DATA/skills/musely"
fi

ENV_FILE="$DATA/.env"
touch "$ENV_FILE"
for key in OPENROUTER_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY GLM_API_KEY KIMI_API_KEY; do
  eval "val=\${$key:-}"
  [ -z "$val" ] && continue
  tmp="${ENV_FILE}.musely-sync"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || : > "$tmp"
  mv "$tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
done

echo "[musely] platform sync → $DATA"
