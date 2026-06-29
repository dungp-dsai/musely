# Hermes Writer — Agent Guide

This file tells the **Hermes AI agent** how to collaborate on writing through the
Hermes Writer app. You (Hermes) and the human share one local database, so your
work appears live in the web UI.

## The shared data

- Database: `writer-app/data/hermes_writer.db` (SQLite, created on first run).
- Three core tables:
  - `posts` — a writing project: a `title` and an `idea` (the brief).
  - `versions` — the version history. Every revision is an immutable snapshot
    with `version_number`, `content`, a `note`, and `source` (`user` or `ai`).
  - `feedback` — **your task queue.** Each row has a `context` (highlighted text)
    and `content` (the task/instruction). `status` is `pending` → `in_progress` → `done`.
- AI audit tables:
  - `ai_task_work` — `{ task_id, result }` — research/findings for a task before
    or alongside a draft revision.
  - `ai_job_reports` — `{ post_id, version_number, summary_action_report }` — how
    you achieved the task when saving a version.
  - `ai_task_chat` — follow-up messages per task (`user` / `assistant`); shown in the
    Writer UI when the human clicks a highlighted passage.

## Your loop

Run these from `writer-app/` (Node 22.5+; no install needed for the CLI). The
`HERMES=node --no-warnings=ExperimentalWarning ...` alias just keeps stdout clean
JSON; plain `node server/agent-cli.js ...` works too (the SQLite "experimental"
notice only goes to stderr).

```bash
alias hw='node --no-warnings=ExperimentalWarning server/agent-cli.js'

# 1. Load the In Progress piece (draft + save state)
hw active
#    -> post_id, title, content (working draft), saved_version summary

# 2. Load tasks for that piece
hw active-tasks
#    -> post_id, title, tasks[] (context, task, status)

# (optional) See pending feedback across all pieces
hw tasks

# 3. (optional) Claim the item so the UI shows it's being worked on
hw claim <feedbackId>

# 4. Write a new version that addresses the feedback.
#    Put your draft in a file, then:
hw version <postId> \
  --content-file /tmp/draft.md \
  --note "Tightened the hook and cut to 200 words" \
  --resolves <feedbackId>

# 5. Store your research/output for the task (optional but recommended)
hw store-work <feedbackId> --result-file /tmp/research.md

# 6. Store a summary of how you completed the job (ties to the version you saved)
hw store-report <postId> --version <versionNumber> --summary "Found 3 sources on layoffs..."
```

`--resolves <feedbackId>` automatically marks that feedback `done` and links it
to the new version, so the human can click "view result" in the UI.

Read back stored AI work:

```bash
hw work <feedbackId>      # all ai_task_work rows for a task
hw reports <postId>       # all ai_job_reports for a post
```

Short revisions can skip the file:

```bash
node server/agent-cli.js version <postId> --content "inline draft text" --note "..." --resolves <id>
```

## Rules of good collaboration

- **Always read the latest version and pending feedback before writing.** Each
  feedback item has a `context` (the passage to focus on) and `content` (the task).
- **One feedback item → one new version.** Keep the history meaningful.
- Write the *full* new draft as `content` (versions are whole snapshots, not diffs).
- Use a clear `note` describing what changed and why — it becomes the version label.
- Honour `SOUL.md` (your persona) for tone and standards.
- Never delete the human's versions or feedback; only add.

## REST alternative

The same operations are available over HTTP while the server runs
(`http://localhost:5174`): `GET /api/feedback/pending`, `GET /api/posts/:id`,
`POST /api/posts/:id/versions`. The CLI is preferred because it works without the
server running.
