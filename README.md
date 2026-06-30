# Musely

A focused writing workspace where you drop ideas and an AI agent (Hermes) turns them into versioned drafts.

## What it does

- **Editor** — rich-text editing with version history and diff view
- **Feedback queue** — highlight any passage, leave a note, let Hermes act on it
- **Per-user AI agent** — each user gets an isolated Hermes instance that reads tasks, writes new versions, and reports what changed
- **Cron jobs** — schedule recurring Hermes tasks (daily review, morning brief, etc.)
- **Task chat** — have a threaded conversation about any feedback item before the agent acts on it

---

## Monorepo layout

```
apps/
  frontend/    React + Vite + TipTap editor (nginx on Fly)
  backend/     Express API + SQLite (single Fly machine with volume)
  agent/       Per-user Hermes agent image (Dockerfile only — machines spawned via Fly API)

fly-staging/   Fly.io configs for staging (one file per service)
  backend/fly.toml
  frontend/fly.toml
  agent/fly.toml

fly-prod/      Same structure for production
  backend/fly.toml
  frontend/fly.toml
  agent/fly.toml

.github/workflows/
  deploy-staging.yml   Auto-deploy on push to main
  deploy-prod.yml      Manual trigger or git tag (v*)
```

---

## Local development

```bash
# 1. Prerequisites: Node 22.5+
node -v   # must be >= 22.5 (for built-in node:sqlite)

# 2. Install dependencies
npm install          # installs all workspaces

# 3. Configure environment
cp .env.example .env
# Edit .env: fill in SESSION_SECRET, Google OAuth creds.
# Leave FLY_API_TOKEN blank — orchestrator is disabled in local dev.

# 4. Start dev servers (backend :8081, frontend :5173 with /api proxy)
npm run dev
```

The backend reads `.env` via `--env-file-if-exists=../../.env`. SQLite data lands in `data/musely.db` (git-ignored).

### Google OAuth (local)

1. [Google Cloud Console](https://console.cloud.google.com/) → Credentials → **Create OAuth 2.0 Client ID** (Web application)
2. Authorised redirect URI: `http://localhost:8081/api/auth/google/callback`
3. Copy client ID + secret into `.env`

---

## Fly.io deployment

### One-time setup (do this once per environment)

```bash
# Install flyctl
brew install flyctl
fly auth login

# Create the six Fly apps (staging)
fly apps create musely-staging-backend
fly apps create musely-staging-frontend
fly apps create musely-staging-agent

# Create the SQLite volume (1 GB is plenty to start)
fly volumes create musely_data --region sin --size 1 \
  --config fly-staging/backend/fly.toml

# Set secrets (one secrets.env per Fly app — see secrets.env.example in each folder)
cp fly-staging/backend/secrets.env.example fly-staging/backend/secrets.env
cp fly-staging/agent/secrets.env.example   fly-staging/agent/secrets.env
# Edit secrets.env files (git-ignored). AGENT_API_KEY must match on backend + agent.

./scripts/fly-secrets-import.sh fly-staging/backend
./scripts/fly-secrets-import.sh fly-staging/agent
# frontend usually has no secrets (BACKEND_URL is in fly.toml)

# First deploy
fly deploy --config fly-staging/backend/fly.toml --remote-only
fly deploy --config fly-staging/agent/fly.toml   --remote-only
fly deploy --config fly-staging/frontend/fly.toml --remote-only
```

Repeat with `fly-prod/` configs and `musely-prod-*` app names for production.

### Continuous deployment (GitHub Actions)

Use **one org-scoped token per environment** — it can deploy and manage all apps in that Fly org (backend, frontend, agent):

```bash
# Staging org token → GitHub secret FLY_API_TOKEN_STAGING
fly tokens create org -o <your-org-slug> -n "musely-staging-ci" -x 720h

# Production org token → GitHub secret FLY_API_TOKEN_PROD
fly tokens create org -o <your-org-slug> -n "musely-prod-ci" -x 720h
```

Add these repository secrets in **Settings → Secrets → Actions**:

| GitHub secret | Scope |
|---------------|-------|
| `FLY_API_TOKEN_STAGING` | Org deploy token — all staging apps |
| `FLY_API_TOKEN_PROD` | Org deploy token — all prod apps |

The same org token can be reused as `FLY_API_TOKEN` in `fly-staging/backend/secrets.env` so the backend orchestrator can create/start machines in the agent app.

- **Push to `staging`** → auto-deploys staging
- **Create a `v*` tag** or click **Run workflow** → deploys production

### Architecture on Fly

```
Browser
  └─▶ musely-{env}-frontend  (nginx, Fly HTTP)
        └─▶ /api/* proxied via internal network (6PN)
              └─▶ musely-{env}-backend  (Express + SQLite on /data volume)
                    └─▶ Fly Machines API
                          └─▶ musely-{env}-agent  (per-user Hermes machines)
                                each machine has its own /opt/data volume
```

Key design decisions:
- **Single backend instance + one volume** — SQLite has one writer; Fly's volume is attached to a single machine. This avoids write conflicts and is entirely sufficient for this workload.
- **Per-user agent machines** — instead of Docker containers on a single host, each user's Hermes instance is a real Fly Machine created on demand via the Fly Machines API and stopped after `HERMES_IDLE_MINUTES` of inactivity.
- **Internal network only for agent** — user machines are not exposed via Fly's HTTP proxy; the backend reaches them over Fly's private WireGuard (6PN) at `<machine-id>.vm.<agent-app>.internal:8642`.

---

## Agent API (Hermes integration)

Hermes machines call back into the backend using `X-Agent-Key: <AGENT_API_KEY>`. The key endpoints:

```
GET  /api/active              Active post + pending feedback
GET  /api/active/tasks        Pending feedback items
POST /api/feedback/:id/claim  Mark a task in_progress
POST /api/feedback/:id/work   Store research/work notes
POST /api/posts/:id/versions  Submit a new AI-written version
POST /api/posts/:id/reports   Submit a job summary report
```

---

## Environment variables reference

| Variable | Default | Required in prod |
|----------|---------|-----------------|
| `PORT` | `8081` | — |
| `DB_PATH` | `./data/musely.db` | Set to `/data/musely.db` |
| `SESSION_SECRET` | — | ✓ |
| `GOOGLE_CLIENT_ID` | — | ✓ |
| `GOOGLE_CLIENT_SECRET` | — | ✓ |
| `GOOGLE_CALLBACK_URL` | — | ✓ |
| `CLIENT_URL` | `http://localhost:5173` | ✓ |
| `AGENT_API_KEY` | — | ✓ |
| `FLY_API_TOKEN` | — | ✓ (backend) |
| `FLY_AGENT_APP` | — | ✓ (backend) |
| `FLY_AGENT_IMAGE` | — | ✓ (backend) |
| `FLY_AGENT_REGION` | `sin` | — |
| `HERMES_IDLE_MINUTES` | `15` | — |
| `HERMES_USER_MEMORY_MB` | `2048` | — |
| `HERMES_USER_CPUS` | `1` | — |
| `OPENROUTER_API_KEY` | — | for task chat |
| `BACKEND_URL` | — | frontend fly.toml |
