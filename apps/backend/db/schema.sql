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
  -- First-run onboarding: 0 until the user picks their topic preferences.
  onboarded   INTEGER NOT NULL DEFAULT 0,
  -- JSON blob of the user's topic preferences: { "write": [...], "read": [...] }.
  -- Collected only to personalize their feed and agent; never shared.
  topics      TEXT NOT NULL DEFAULT '',
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

-- Pre-launch waiting list signups. `approved` gates Google sign-in: only
-- admin-approved emails can establish a session.
CREATE TABLE IF NOT EXISTS waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL DEFAULT 'landing',
  approved    INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Personalized home feed posts (news-style cards for the Feed tab).
-- Populated by the user's Musely agent via POST /api/feed/posts.
CREATE TABLE IF NOT EXISTS feed_posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  whats_new       TEXT NOT NULL DEFAULT '',
  why_it_matters  TEXT NOT NULL DEFAULT '',
  -- JSON array: [{ "label": string, "url": string }]
  sources         TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feed_post_reactions (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL CHECK (reaction IN ('up', 'down')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS feed_post_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feed_user_prefs (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skip_feedback_prompt INTEGER NOT NULL DEFAULT 0,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-user discussion thread on a feed post (one Hermes session per post).
CREATE TABLE IF NOT EXISTS feed_discussions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id             INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  hermes_session_id   TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS feed_discussion_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id   INTEGER NOT NULL REFERENCES feed_discussions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_feed_discussions_user_post
  ON feed_discussions(user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_feed_discussion_messages_disc
  ON feed_discussion_messages(discussion_id, created_at ASC);

-- Legacy table (pre–feed-posts migration). Kept so existing DBs upgrade cleanly.
CREATE TABLE IF NOT EXISTS feed_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'read',
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  url         TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-user Musely agent instance registry (Fly Machines / Docker orchestrator).
-- machine_name keeps the historical container_name public API shape.
CREATE TABLE IF NOT EXISTS musely_agent_instances (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  machine_id      TEXT,
  machine_name    TEXT NOT NULL UNIQUE,
  volume_id       TEXT,
  api_key         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'stopped',
  last_active_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_musely_agent_instances_active ON musely_agent_instances(last_active_at);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_post ON versions(post_id);
CREATE INDEX IF NOT EXISTS idx_feedback_post ON feedback(post_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_ai_task_work_task ON ai_task_work(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_job_reports_post ON ai_job_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_chat_task ON ai_task_chat(task_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_user ON feed_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_post_feedback_post ON feed_post_feedback(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_user ON feed_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);

-- Admin-managed env vars synced into every user agent /opt/data/.env
CREATE TABLE IF NOT EXISTS platform_secrets (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
