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

## How the AI works on your writing

See **`AGENT_GUIDE.md`**. In short, the agent runs:

```bash
node server/agent-cli.js tasks            # what to work on
node server/agent-cli.js post <id>        # full context
node server/agent-cli.js version <id> --content-file draft.md --resolves <feedbackId>
```
