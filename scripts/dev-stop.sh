#!/usr/bin/env bash
# Stop local dev stack (frontend + backend container). Does not touch Docker Desktop.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

kill_user_node_on_port 5173
docker compose -f docker-compose.local.yml stop backend 2>/dev/null || true

echo "Stopped Musely local dev (frontend + backend container)."
echo "Per-user Musely agent containers are left running — stop with:"
echo "  docker ps --filter name=musely-agent- -q | xargs docker stop"
