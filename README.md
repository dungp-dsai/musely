# Hermes Writer

A clean, simple writing workspace. You drop an idea and your thoughts; the
**Hermes AI agent** turns them into drafts. Every round of feedback produces a
new tracked **version**, and your instructions are stored as a queue the AI picks
up later.

```
You write an idea  ─►  leave feedback for AI  ─►  Hermes writes a new version  ─►  you review / give more feedback
        │                      │                          │
        └──────────────  PostgreSQL (per-user)  ───────────┘
```

## What's inside

- **`client/`** — React + Vite UI (separate dev server; nginx in Docker).
- **`server/`** — Express API on PostgreSQL (`pg`) with **Google sign-in**.
- **`AGENT_GUIDE.md`** — instructions for the Hermes agent.

## Features

- **Focused editor** — a clean editor always shows the latest version, ready to post.
- **Version tracking** — every save is an immutable snapshot tagged `you` or `AI`.
- **Google-Docs-style history** — pick any two versions and see an inline diff with
  additions highlighted and removals struck through; restore any version.
- **Feedback queue** — leave instructions for the AI; they persist as `pending`
  tasks the agent works through and marks `done`, linking the version it produced.
- **Live sync** — the UI polls, so versions the agent writes appear automatically.

## Run it

```bash
cd writer-app
cp .env.example .env   # PostgreSQL URL, Google OAuth, SESSION_SECRET
docker compose up -d postgres   # or use a local Postgres instance

npm run install:all
npm run dev           # API (:8081) and UI (:5173)
```

Then open http://localhost:5173 and sign in with Google.

Configure Google OAuth in [Google Cloud Console](https://console.cloud.google.com/) — redirect URI for local dev:  
`http://localhost:8081/api/auth/google/callback`

To run separately: `npm run dev:server` and `npm run dev:client`.

### Local test with Hermes chat

**Option A — Docker (postgres + api + web + per-user Hermes, recommended for VPS)**

```bash
cd writer-app
cp .env.docker.example .env   # SESSION_SECRET, Google OAuth, HERMES_API_SERVER_KEY
mkdir -p hermes-base
docker compose run --rm hermes-base-setup setup   # one-time Hermes template
docker compose up -d --build
# http://localhost:8080 — sign in with Google
```

Each user gets an isolated Hermes container, provisioned on demand from the
shared `./hermes-base` template and stopped after idle.

See **DOCKER.md** for full details.

**Option B — Native dev (faster UI iteration)**

**Terminal 1 — Hermes gateway** (requires [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started) installed):

```bash
# One-time: enable API server in ~/.hermes/.env
#   API_SERVER_ENABLED=true
#   API_SERVER_KEY=local-dev-key-min-8-chars

hermes gateway
# Should log: API server listening on http://127.0.0.1:8642
```

**Terminal 2 — writer-app:**

```bash
cd writer-app
npm run install:all
cp .env.example .env   # optional; Hermes keys are read from ~/.hermes/.env
npm run dev
```

Open http://localhost:5173 → sidebar **Chat with Hermes**.

Verify Hermes API: `curl -s http://127.0.0.1:8642/health`

## How the AI works on your writing

See **`AGENT_GUIDE.md`**. In short, the agent runs:

```bash
node server/agent-cli.js tasks            # what to work on
node server/agent-cli.js post <id>        # full context
node server/agent-cli.js version <id> --content-file draft.md --resolves <feedbackId>
```
