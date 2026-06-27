# writer-app — Docker & VPS Setup

One `docker-compose.yml` runs **writer-app** + **Hermes Agent** together, following the [official Hermes Docker guide](https://hermes-agent.nousresearch.com/docs/user-guide/docker).

| Service | URL | Role |
|---|---|---|
| **writer-app** | http://localhost:8080 | Writing UI + built-in Hermes chat |
| **hermes-agent** | http://localhost:8642 | Gateway + OpenAI-compatible API |

Writer and Hermes share the same SQLite database (`writer-data` volume) so `AGENT_GUIDE.md` / `agent-cli.js` keep working.

---

## Local test (first time)

```bash
cd writer-app

cp .env.docker.example .env
# Set HERMES_API_SERVER_KEY — generate with: openssl rand -hex 32

mkdir -p hermes-data

# One-time Hermes setup wizard (writes LLM keys to ./hermes-data/.env)
docker compose run --rm hermes-agent setup

# Start both services
docker compose up -d --build
```

Open **http://localhost:8080** → sidebar **Chat with Hermes**.

Verify Hermes API:

```bash
curl -s http://localhost:8642/health
curl -s -H "Authorization: Bearer YOUR_KEY" http://localhost:8642/v1/models
```

Verify writer → Hermes (inside Docker network):

```bash
docker exec writer-app node -e "fetch('http://hermes-agent:8642/health').then(r=>r.json()).then(console.log)"
```

---

## Use existing ~/.hermes (optional)

If you already ran Hermes locally and have `~/.hermes/` configured:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
docker compose up -d --build
```

**Warning:** never run two Hermes gateway containers against the same data directory at once. Stop any standalone `hermes-agent` container first:

```bash
docker stop hermes-agent 2>/dev/null; docker rm hermes-agent 2>/dev/null
```

---

## Architecture

```
┌─────────────────┐     Docker network (writer-net)     ┌──────────────────┐
│   writer-app    │ ──► http://hermes-agent:8642/v1 ──► │  hermes-agent    │
│   :8080         │                                     │  gateway run     │
│   UI + API      │                                     │  API_SERVER      │
└────────┬────────┘                                     └────────┬─────────┘
         │                                                       │
         └──────────── writer-data (SQLite) ◄───────────────────┘
                    ./hermes-data → /opt/data (Hermes config)
```

- **Built-in chat** — browser → writer `/api/hermes/chat` → Hermes `/v1/chat/completions` (API key stays on server).
- **Writer collaboration** — Hermes uses `agent-cli.js` against `/app/data/hermes_writer.db`.

---

## Hermes API server (from official docs)

The API is **off by default** inside Hermes. This compose enables it via env vars (same as the docs' `docker run -e API_SERVER_*` example):

| Variable | Value |
|---|---|
| `API_SERVER_ENABLED` | `true` |
| `API_SERVER_HOST` | `0.0.0.0` (reachable from writer container) |
| `API_SERVER_KEY` | min **16 chars** when bound to `0.0.0.0` — set `HERMES_API_SERVER_KEY` in `.env` |

---

## VPS deploy

```bash
rsync -avz --exclude node_modules --exclude 'data/*.db*' --exclude hermes-data \
  ~/Documents/writer-app/ user@YOUR_VPS_IP:~/writer-app/

ssh user@YOUR_VPS_IP
cd ~/writer-app
cp .env.docker.example .env
nano .env

mkdir -p hermes-data
docker compose run --rm hermes-agent setup
docker compose up -d --build
```

Visit `http://YOUR_VPS_IP:8080`.

Updates:

```bash
docker compose pull hermes-agent
docker compose up -d --build
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WRITER_PORT` | `8080` | Host port for writer-app |
| `HERMES_API_PORT` | `8642` | Host port for Hermes API |
| `HERMES_API_SERVER_KEY` | — | Bearer token (writer + Hermes must match) |
| `HERMES_API_MODEL_NAME` | `Hermes Agent` | Model name on `/v1/models` |
| `OPENROUTER_API_KEY` | — | Task chat on highlighted passages |
| `HERMES_MEMORY_LIMIT` | `4G` | Hermes container memory cap |
| `HERMES_CPU_LIMIT` | `2.0` | Hermes container CPU cap |

---

## Troubleshooting

**Hermes exits immediately** — `docker compose logs hermes-agent`. Run setup first: `docker compose run --rm hermes-agent setup`.

**Hermes chat fails / empty reply on `:8642/health`** — Hermes **refuses to start** the API server if `API_SERVER_KEY` is under 16 characters when bound to `0.0.0.0`. Check logs:

```bash
docker compose logs hermes-agent | grep -i api_server
# "Refusing to start: API_SERVER_KEY is a placeholder or too short (<16 chars)"
```

Fix: generate a strong key and restart:

```bash
openssl rand -hex 32   # paste into .env as HERMES_API_SERVER_KEY
docker compose up -d
curl -s http://localhost:8642/health
```

**Hermes chat fails in UI** — keys must match; test from writer container:

```bash
docker exec writer-app node -e "fetch(process.env.HERMES_API_BASE_URL+'/models',{headers:{Authorization:'Bearer '+process.env.HERMES_API_SERVER_KEY}}).then(r=>r.text()).then(console.log)"
```

**Port 8642 or 8080 in use** — change `HERMES_API_PORT` / `WRITER_PORT` in `.env`.

**Browser tools OOM** — Hermes docs recommend 2–4 GB RAM; already set via `HERMES_MEMORY_LIMIT`.

**Old standalone containers** — remove before starting compose:

```bash
docker rm -f hermes-agent writer-app open-webui 2>/dev/null
docker compose up -d --build
```

**Logs**

```bash
docker compose logs -f hermes-agent
docker compose logs -f writer
tail -F hermes-data/logs/gateways/default/current   # per-profile gateway log on host
```

---

## Agent CLI inside Hermes container

```bash
docker exec hermes-agent hermes -h
docker exec -w /app hermes-agent node --no-warnings=ExperimentalWarning server/agent-cli.js active
```
