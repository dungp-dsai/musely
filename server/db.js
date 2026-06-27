// Shared local database for the Hermes Writer app.
//
// This uses Node's built-in `node:sqlite` (Node >= 22.5) so there are no native
// dependencies to compile. The single file `data/hermes_writer.db` is the shared
// surface between the React web app and the Hermes AI agent: both read and write
// the same tables.
//
// Tables
//   posts           - one writing project: an idea/brief and its metadata
//   versions        - immutable snapshots of a post's content (the version history)
//   feedback        - your instructions/notes for the AI; the agent's task queue
//   ai_task_work    - AI output per task (research, notes, findings)
//   ai_job_reports  - summary of what the AI did when completing a version
//   ai_task_chat    - follow-up chat messages per task (user ↔ assistant)
//
// See AGENT_GUIDE.md for how the Hermes agent is expected to use this.

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.HERMES_WRITER_DB || join(DATA_DIR, "hermes_writer.db");

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    idea        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id         INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'ai'
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id             INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    version_id          INTEGER REFERENCES versions(id) ON DELETE SET NULL,
    content             TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'done'
    resolved_version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_versions_post ON versions(post_id);
  CREATE INDEX IF NOT EXISTS idx_feedback_post ON feedback(post_id);
  CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

  CREATE TABLE IF NOT EXISTS ai_task_work (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    result      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_job_reports (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id                 INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    version_number          INTEGER NOT NULL,
    summary_action_report   TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (post_id, version_number)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_task_work_task ON ai_task_work(task_id);
  CREATE INDEX IF NOT EXISTS idx_ai_job_reports_post ON ai_job_reports(post_id);

  CREATE TABLE IF NOT EXISTS ai_task_chat (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ai_task_chat_task ON ai_task_chat(task_id);
`);

// Migration: add context column for highlighted text on feedback items.
const feedbackCols = db.prepare(`PRAGMA table_info(feedback)`).all();
if (!feedbackCols.some((c) => c.name === "context")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN context TEXT NOT NULL DEFAULT ''`);
}

// Migration: working draft on posts (autosaved, not a version).
const postCols = db.prepare(`PRAGMA table_info(posts)`).all();
if (!postCols.some((c) => c.name === "draft_content")) {
  db.exec(`ALTER TABLE posts ADD COLUMN draft_content TEXT NOT NULL DEFAULT ''`);
}

// Migration: store selection range for persistent task highlights.
const feedbackCols2 = db.prepare(`PRAGMA table_info(feedback)`).all();
if (!feedbackCols2.some((c) => c.name === "context_from")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN context_from INTEGER`);
  db.exec(`ALTER TABLE feedback ADD COLUMN context_to INTEGER`);
}

// Normalize legacy status values.
db.exec(`UPDATE posts SET status = 'pending' WHERE status NOT IN ('pending', 'in_progress')`);

const touchPost = db.prepare(`UPDATE posts SET updated_at = datetime('now') WHERE id = ?`);

// ---------- Posts ----------

export function listPosts() {
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM versions v WHERE v.post_id = p.id) AS version_count,
              (SELECT COUNT(*) FROM feedback f WHERE f.post_id = p.id AND f.status = 'pending') AS pending_feedback
       FROM posts p
       ORDER BY CASE WHEN p.status = 'in_progress' THEN 0 ELSE 1 END, p.updated_at DESC`
    )
    .all();
  return rows;
}

export function getPost(id) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  if (!post) return null;
  post.versions = db
    .prepare(`SELECT * FROM versions WHERE post_id = ? ORDER BY version_number DESC`)
    .all(id);
  post.feedback = db
    .prepare(`SELECT * FROM feedback WHERE post_id = ? ORDER BY created_at DESC`)
    .all(id);
  return post;
}

export function createPost({ title }) {
  const info = db
    .prepare(`INSERT INTO posts (title, idea, status) VALUES (?, '', 'pending')`)
    .run(title?.trim() || "Untitled");
  const postId = info.lastInsertRowid;
  // Start empty: the first save in the editor becomes version 1.
  return getPost(postId);
}

export function setPostStatus(id, status) {
  if (status !== "pending" && status !== "in_progress") {
    throw new Error("Status must be pending or in_progress");
  }
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  if (!post) return null;

  if (status === "in_progress" && post.status !== "in_progress") {
    const other = db
      .prepare(`SELECT id, title FROM posts WHERE status = 'in_progress' AND id != ?`)
      .get(id);
    if (other) {
      throw new Error(
        `Only one post can be In Progress. "${other.title}" is already active.`
      );
    }
  }

  db.prepare(`UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return getPost(id);
}

export function updatePost(id, { title, idea, status, draft_content }) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  if (!post) return null;

  if (status !== undefined && status !== post.status) {
    setPostStatus(id, status);
  }

  const current = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  db.prepare(
    `UPDATE posts SET title = ?, idea = ?, draft_content = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    title !== undefined ? title : current.title,
    idea !== undefined ? idea : current.idea,
    draft_content !== undefined ? draft_content : current.draft_content ?? "",
    id
  );
  return getPost(id);
}

export function deletePost(id) {
  db.prepare(`DELETE FROM posts WHERE id = ?`).run(id);
}

// ---------- Versions ----------

export function addVersion(postId, { title, content, note, source, resolvesFeedbackId }) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(postId);
  if (!post) return null;

  const max = db
    .prepare(`SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE post_id = ?`)
    .get(postId);
  const nextNumber = max.n + 1;

  const info = db
    .prepare(
      `INSERT INTO versions (post_id, version_number, title, content, note, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(postId, nextNumber, title ?? post.title, content ?? "", note ?? "", source === "ai" ? "ai" : "user");

  const versionId = info.lastInsertRowid;

  if (resolvesFeedbackId) {
    db.prepare(
      `UPDATE feedback
       SET status = 'done', resolved_version_id = ?, resolved_at = datetime('now')
       WHERE id = ? AND post_id = ?`
    ).run(versionId, resolvesFeedbackId, postId);
  }

  touchPost.run(postId);
  return db.prepare(`SELECT * FROM versions WHERE id = ?`).get(versionId);
}

// ---------- Feedback (the AI task queue) ----------

export function addFeedback(postId, { content, context, context_from, context_to, versionId }) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(postId);
  if (!post) return null;
  const info = db
    .prepare(
      `INSERT INTO feedback (post_id, version_id, content, context, context_from, context_to)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(postId, versionId ?? null, content, context ?? "", context_from ?? null, context_to ?? null);
  touchPost.run(postId);
  return db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(info.lastInsertRowid);
}

export function updateFeedbackStatus(feedbackId, status) {
  db.prepare(`UPDATE feedback SET status = ? WHERE id = ?`).run(status, feedbackId);
  return db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(feedbackId);
}

export function deleteFeedback(feedbackId) {
  db.prepare(`DELETE FROM feedback WHERE id = ?`).run(feedbackId);
}

export function listPendingFeedback() {
  return db
    .prepare(
      `SELECT f.*, p.title AS post_title
       FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE f.status = 'pending'
       ORDER BY f.created_at ASC`
    )
    .all();
}

// ---------- AI task work & job reports ----------

function getFeedback(taskId) {
  return db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(taskId);
}

function getVersionByNumber(postId, versionNumber) {
  return db
    .prepare(`SELECT * FROM versions WHERE post_id = ? AND version_number = ?`)
    .get(postId, versionNumber);
}

export function addAiTaskWork(taskId, result) {
  const task = getFeedback(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  const info = db
    .prepare(`INSERT INTO ai_task_work (task_id, result) VALUES (?, ?)`)
    .run(taskId, result ?? "");
  return db.prepare(`SELECT * FROM ai_task_work WHERE id = ?`).get(info.lastInsertRowid);
}

export function listAiTaskWork(taskId) {
  return db
    .prepare(`SELECT * FROM ai_task_work WHERE task_id = ? ORDER BY created_at DESC`)
    .all(taskId);
}

export function addAiJobReport(postId, versionNumber, summaryActionReport) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(postId);
  if (!post) throw new Error(`No post with id ${postId}`);
  const version = getVersionByNumber(postId, versionNumber);
  if (!version) {
    throw new Error(`No version ${versionNumber} for post ${postId}`);
  }

  const existing = db
    .prepare(`SELECT id FROM ai_job_reports WHERE post_id = ? AND version_number = ?`)
    .get(postId, versionNumber);

  if (existing) {
    db.prepare(
      `UPDATE ai_job_reports
       SET summary_action_report = ?, created_at = datetime('now')
       WHERE id = ?`
    ).run(summaryActionReport ?? "", existing.id);
    return db.prepare(`SELECT * FROM ai_job_reports WHERE id = ?`).get(existing.id);
  }

  const info = db
    .prepare(
      `INSERT INTO ai_job_reports (post_id, version_number, summary_action_report)
       VALUES (?, ?, ?)`
    )
    .run(postId, versionNumber, summaryActionReport ?? "");
  return db.prepare(`SELECT * FROM ai_job_reports WHERE id = ?`).get(info.lastInsertRowid);
}

export function listAiJobReports(postId) {
  return db
    .prepare(
      `SELECT * FROM ai_job_reports
       WHERE post_id = ?
       ORDER BY version_number DESC`
    )
    .all(postId);
}

export function listAiTaskChat(taskId) {
  return db
    .prepare(
      `SELECT * FROM ai_task_chat
       WHERE task_id = ? AND role != 'system'
       ORDER BY created_at ASC`
    )
    .all(taskId);
}

export function addAiTaskChatMessage(taskId, role, content) {
  const task = getFeedback(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  if (!["user", "assistant", "system"].includes(role)) {
    throw new Error("role must be user, assistant, or system");
  }
  const info = db
    .prepare(`INSERT INTO ai_task_chat (task_id, role, content) VALUES (?, ?, ?)`)
    .run(taskId, role, content ?? "");
  return db.prepare(`SELECT * FROM ai_task_chat WHERE id = ?`).get(info.lastInsertRowid);
}

/** Full thread for the task chat UI: task, work, report, messages. */
export function getTaskThread(taskId) {
  const task = getFeedback(taskId);
  if (!task) return null;

  const work = listAiTaskWork(taskId);
  const messages = listAiTaskChat(taskId);

  let report = null;
  if (task.resolved_version_id) {
    const version = db.prepare(`SELECT * FROM versions WHERE id = ?`).get(task.resolved_version_id);
    if (version) {
      report = db
        .prepare(
          `SELECT * FROM ai_job_reports
           WHERE post_id = ? AND version_number = ?`
        )
        .get(task.post_id, version.version_number);
    }
  }

  const post = db.prepare(`SELECT id, title, draft_content FROM posts WHERE id = ?`).get(task.post_id);

  return { task, post, work, report, messages };
}

export default db;
