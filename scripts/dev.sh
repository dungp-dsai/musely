#!/usr/bin/env bash
# One-command local dev: build agent image, restart backend (Docker), start frontend (Vite).
#
# Usage:
#   ./scripts/dev.sh              # full restart
#   ./scripts/dev.sh --skip-agent   # skip musely-agent:local image rebuild
#
# Open http://localhost:5173 after startup.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Kill only the current user's node/vite listener — never blind `kill` on :8081
# (Docker Desktop owns that port forward; killing those PIDs crashes Docker Desktop).
kill_user_node_on_port() {
  local port="$1"
  local pid owner cmd
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    owner=$(ps -p "$pid" -o user= 2>/dev/null | tr -d ' ')
    [[ "$owner" == "$(whoami)" ]] || continue
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    [[ "$cmd" == *node* ]] || continue
    kill "$pid" 2>/dev/null || true
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

SKIP_AGENT=0
for arg in "$@"; do
  case "$arg" in
    --skip-agent) SKIP_AGENT=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-agent]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "Missing .env — run: cp .env.example .env" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local agent orchestration." >&2
  exit 1
fi

echo "==> Stopping stale dev processes"
# Backend: always via compose — do NOT kill :8081 PIDs (that hits Docker Desktop).
docker compose -f docker-compose.local.yml stop backend 2>/dev/null || true
# Host-run backend fallback (npm run dev:backend without Docker)
kill_user_node_on_port 8081
# Vite dev server
kill_user_node_on_port 5173

mkdir -p data musely-agent-platform

if [[ ! -f musely-agent-platform/config.yaml ]] && [[ -f musely-agent-platform/config.yaml.example ]]; then
  cp musely-agent-platform/config.yaml.example musely-agent-platform/config.yaml
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing npm dependencies (first run)"
  npm install
fi

echo "==> Ensuring Docker network musely-net"
docker network inspect musely-net >/dev/null 2>&1 || docker network create musely-net

if [[ "$SKIP_AGENT" -eq 0 ]]; then
  echo "==> Building agent image musely-agent:local (first run can take several minutes)"
  docker build -t musely-agent:local -f apps/agent/Dockerfile .
else
  echo "==> Skipping agent image build (--skip-agent)"
fi

export MUSELY_AGENT_PLATFORM_HOST_DIR="$ROOT/musely-agent-platform"

echo "==> Starting backend (Docker, hot reload via node --watch)"
docker compose -f docker-compose.local.yml up -d --build backend

echo "==> Waiting for backend health"
deadline=$((SECONDS + 60))
until curl -sf http://127.0.0.1:8081/api/health >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "Backend did not become healthy in time. Logs:" >&2
    docker compose -f docker-compose.local.yml logs --tail=40 backend >&2
    exit 1
  fi
  sleep 1
done

cfg=$(curl -sf http://127.0.0.1:8081/api/config || echo "{}")
echo "==> Backend ready — api/config: $cfg"

echo ""
echo "==> Starting frontend (Vite on http://localhost:5173)"
echo "    Press Ctrl+C to stop frontend only; backend keeps running in Docker."
echo "    Stop everything: ./scripts/dev-stop.sh"
echo ""

exec npm run dev:frontend
