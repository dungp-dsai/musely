# Hermes Writer

A clean, simple writing workspace. You drop an idea and your thoughts; the
**Hermes AI agent** turns them into drafts. Every round of feedback produces a
new tracked **version**, and your instructions are stored as a queue the AI picks
up later.

```
You write an idea  ─►  leave feedback for AI  ─►  Hermes writes a new version  ─►  you review / give more feedback
        │                      │                          │
        └──────────────  shared SQLite database  ─────────┘
```

## What's inside

- **`client/`** — React + Vite UI (clean, distraction-free).
- **`server/`** — tiny Express API over a local SQLite file (`node:sqlite`, no
  native deps). `agent-cli.js` is how the Hermes agent reads/writes the same data.
- **`data/hermes_writer.db`** — the shared database (created on first run).
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
npm run install:all   # installs root + server + client deps
npm run dev           # starts API (:5174) and UI (:5173)
```

Then open http://localhost:5173.

To run separately: `npm run dev:server` and `npm run dev:client`.

### Local test with Hermes chat

**Option A — Docker (writer + Hermes in one compose, recommended for VPS parity)**

```bash
cd writer-app
cp .env.docker.example .env   # set HERMES_API_SERVER_KEY
mkdir -p hermes-data
docker compose run --rm hermes-agent setup
docker compose up -d --build
# http://localhost:8080
```

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
