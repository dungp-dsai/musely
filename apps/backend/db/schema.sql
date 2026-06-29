-- Musely SQLite schema (node:sqlite)
-- Timestamps are stored as ISO-8601 UTC strings for easy JSON serialization.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id   TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  picture     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  idea          TEXT NOT NULL DEFAULT '',
  draft_content TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id         INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'user',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id             INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version_id          INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  content             TEXT NOT NULL,
  context             TEXT NOT NULL DEFAULT '',
  context_from        INTEGER,
  context_to          INTEGER,
  status              TEXT NOT NULL DEFAULT 'pending',
  resolved_version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at         TEXT
);

CREATE TABLE IF NOT EXISTS ai_task_work (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  result      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_job_reports (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id                 INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL,
  summary_action_report   TEXT NOT NULL DEFAULT '',
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (post_id, version_number)
);

CREATE TABLE IF NOT EXISTS ai_task_chat (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-user Hermes agent instance registry (Fly Machines orchestrator).
-- machine_name keeps the historical "container_name" public API shape.
CREATE TABLE IF NOT EXISTS hermes_instances (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  machine_id      TEXT,
  machine_name    TEXT NOT NULL UNIQUE,
  volume_id       TEXT,
  api_key         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'stopped',
  last_active_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_post ON versions(post_id);
CREATE INDEX IF NOT EXISTS idx_feedback_post ON feedback(post_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_ai_task_work_task ON ai_task_work(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_job_reports_post ON ai_job_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_chat_task ON ai_task_chat(task_id);
CREATE INDEX IF NOT EXISTS idx_hermes_instances_active ON hermes_instances(last_active_at);
