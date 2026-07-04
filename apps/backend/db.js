// SQLite database layer for Musely (node:sqlite — built-in, Node 22.5+).
// All functions are wrapped in async for API compatibility, but the underlying
// SQLite operations are synchronous (no I/O event loop blocking in practice for
// small workloads; upgrade to better-sqlite3 if hot-path perf becomes a concern).

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DB_PATH = resolve(process.env.DB_PATH || "./data/musely.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

export { db };

export function initDb() {
  db.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(__dirname, "db", "schema.sql"), "utf8");
  db.exec(schema);
  runMigrations();
}

// Idempotent, additive migrations for databases created before a column existed.
function runMigrations() {
  const waitlistCols = db.prepare("PRAGMA table_info(waitlist)").all();
  const hasWaitlistCol = (name) => waitlistCols.some((c) => c.name === name);
  if (!hasWaitlistCol("approved")) {
    db.exec("ALTER TABLE waitlist ADD COLUMN approved INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasWaitlistCol("approved_at")) {
    db.exec("ALTER TABLE waitlist ADD COLUMN approved_at TEXT");
  }

  const userCols = db.prepare("PRAGMA table_info(users)").all();
  const hasUserCol = (name) => userCols.some((c) => c.name === name);
  if (!hasUserCol("onboarded")) {
    db.exec("ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasUserCol("topics")) {
    db.exec("ALTER TABLE users ADD COLUMN topics TEXT NOT NULL DEFAULT ''");
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- Users ----------

export async function upsertGoogleUser({ googleId, email, name, picture }) {
  const row = db
    .prepare(
      `INSERT INTO users (google_id, email, name, picture)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(google_id) DO UPDATE SET
         email    = excluded.email,
         name     = excluded.name,
         picture  = excluded.picture
       RETURNING *`
    )
    .get(googleId, email, name || "", picture || null);
  return row;
}

export async function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null;
}

// Parse the stored topics JSON into a stable { interests, write, read } shape.
// `interests` is the free-text description the user types during onboarding;
// write/read arrays are kept for backward compatibility with older records.
export function parseUserTopics(raw) {
  const empty = { interests: "", write: [], read: [] };
  if (!raw) return empty;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    const clean = (arr) =>
      Array.isArray(arr)
        ? arr.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 30)
        : [];
    return {
      interests: String(obj?.interests || "").trim().slice(0, 4000),
      write: clean(obj?.write),
      read: clean(obj?.read),
    };
  } catch {
    return empty;
  }
}

// Public-safe user view returned to the browser.
export function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    onboarded: Boolean(user.onboarded),
    topics: parseUserTopics(user.topics),
  };
}

// Persist the user's onboarding topic preferences and mark them onboarded.
export async function setUserOnboarding(userId, topics) {
  const payload = JSON.stringify(parseUserTopics(topics));
  const row = db
    .prepare(
      `UPDATE users SET onboarded = 1, topics = ? WHERE id = ? RETURNING *`
    )
    .get(payload, userId);
  return row ?? null;
}

// ---------- Waiting list ----------

// Returns { row, created }. created=false means the email was already on the list.
export async function addWaitlistEmail(email, source = "landing") {
  const normalized = String(email || "").trim().toLowerCase();
  const existing = db.prepare("SELECT * FROM waitlist WHERE email = ?").get(normalized);
  if (existing) return { row: existing, created: false };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO waitlist (email, source) VALUES (?, ?)")
    .run(normalized, source || "landing");
  const row = db.prepare("SELECT * FROM waitlist WHERE id = ?").get(Number(lastInsertRowid));
  return { row, created: true };
}

export async function countWaitlist() {
  return db.prepare("SELECT COUNT(*) AS n FROM waitlist").get()?.n ?? 0;
}

export async function listWaitlist() {
  return db
    .prepare("SELECT * FROM waitlist ORDER BY approved ASC, created_at DESC")
    .all();
}

export async function getWaitlistRow(id) {
  return db.prepare("SELECT * FROM waitlist WHERE id = ?").get(id) ?? null;
}

export async function setWaitlistApproval(id, approved) {
  const row = db
    .prepare(
      `UPDATE waitlist
       SET approved = ?, approved_at = ?
       WHERE id = ?
       RETURNING *`
    )
    .get(approved ? 1 : 0, approved ? nowIso() : null, id);
  return row ?? null;
}

// Emails listed in APPROVED_EMAILS are always allowed (owner/admin bootstrap),
// even if they never joined the waiting list.
function envApprovedEmails() {
  return new Set(
    String(process.env.APPROVED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function isEmailApproved(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  if (envApprovedEmails().has(normalized)) return true;
  const row = db.prepare("SELECT approved FROM waitlist WHERE email = ?").get(normalized);
  return Boolean(row?.approved);
}

// ---------- Hermes instances (Fly Machines orchestrator registry) ----------

export async function getInstance(userId) {
  return db.prepare("SELECT * FROM hermes_instances WHERE user_id = ?").get(userId) ?? null;
}

export async function createInstanceRecord({ userId, machineName, machineId, volumeId, apiKey }) {
  db.prepare(
    `INSERT INTO hermes_instances (user_id, machine_name, machine_id, volume_id, api_key, status)
     VALUES (?, ?, ?, ?, ?, 'stopped')
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, machineName, machineId ?? null, volumeId ?? null, apiKey);
  return getInstance(userId);
}

export async function updateInstanceMachineId(userId, machineId, machineName) {
  const row = db
    .prepare(
      `UPDATE hermes_instances
       SET machine_id = ?, machine_name = COALESCE(?, machine_name)
       WHERE user_id = ?
       RETURNING *`
    )
    .get(machineId, machineName ?? null, userId);
  return row ?? null;
}

export async function setInstanceStatus(userId, status) {
  const row = db
    .prepare(
      `UPDATE hermes_instances SET status = ? WHERE user_id = ? RETURNING *`
    )
    .get(status, userId);
  return row ?? null;
}

export async function touchInstance(userId) {
  db.prepare(
    `UPDATE hermes_instances
     SET last_active_at = ?, status = 'running'
     WHERE user_id = ?`
  ).run(nowIso(), userId);
}

export async function listInstances() {
  return db
    .prepare(
      `SELECT hi.*, u.email, u.name
       FROM hermes_instances hi
       JOIN users u ON u.id = hi.user_id
       ORDER BY hi.last_active_at DESC`
    )
    .all();
}

export async function listIdleInstances(idleMinutes) {
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM hermes_instances WHERE status = 'running' AND last_active_at < ?`
    )
    .all(cutoff);
}

// ---------- Posts ----------

function touchPost(postId) {
  db.prepare("UPDATE posts SET updated_at = ? WHERE id = ?").run(nowIso(), postId);
}

function assertPostAccess(postId, userId) {
  const row = db
    .prepare("SELECT id FROM posts WHERE id = ? AND user_id = ?")
    .get(postId, userId);
  if (!row) throw new Error("Not found");
}

function getPostRow(id, userId) {
  return (
    db.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").get(id, userId) ?? null
  );
}

export async function listPosts(userId) {
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM versions v WHERE v.post_id = p.id) AS version_count,
              (SELECT COUNT(*) FROM feedback f WHERE f.post_id = p.id AND f.status = 'pending') AS pending_feedback
       FROM posts p
       WHERE p.user_id = ?
       ORDER BY CASE WHEN p.status = 'in_progress' THEN 0 ELSE 1 END, p.updated_at DESC`
    )
    .all(userId);
}

export async function getPost(id, userId) {
  const post = getPostRow(id, userId);
  if (!post) return null;
  post.versions = db
    .prepare("SELECT * FROM versions WHERE post_id = ? ORDER BY version_number DESC")
    .all(id);
  post.feedback = db
    .prepare("SELECT * FROM feedback WHERE post_id = ? ORDER BY created_at DESC")
    .all(id);
  return post;
}

export async function createPost(userId, { title }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO posts (user_id, title, idea, status) VALUES (?, ?, '', 'pending')`
    )
    .run(userId, title?.trim() || "Untitled");
  return getPost(Number(lastInsertRowid), userId);
}

export async function setPostStatus(id, userId, status) {
  if (status !== "pending" && status !== "in_progress") {
    throw new Error("Status must be pending or in_progress");
  }
  const post = getPostRow(id, userId);
  if (!post) return null;

  if (status === "in_progress" && post.status !== "in_progress") {
    const conflict = db
      .prepare(
        `SELECT id, title FROM posts WHERE status = 'in_progress' AND user_id = ? AND id != ?`
      )
      .get(userId, id);
    if (conflict) {
      throw new Error(`Only one post can be In Progress. "${conflict.title}" is already active.`);
    }
  }

  db.prepare("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    nowIso(),
    id
  );
  return getPost(id, userId);
}

export async function updatePost(id, userId, { title, idea, status, draft_content }) {
  const post = getPostRow(id, userId);
  if (!post) return null;

  if (status !== undefined && status !== post.status) {
    await setPostStatus(id, userId, status);
  }

  const current = getPostRow(id, userId);
  db.prepare(
    "UPDATE posts SET title = ?, idea = ?, draft_content = ?, updated_at = ? WHERE id = ?"
  ).run(
    title !== undefined ? title : current.title,
    idea !== undefined ? idea : current.idea,
    draft_content !== undefined ? draft_content : current.draft_content ?? "",
    nowIso(),
    id
  );
  return getPost(id, userId);
}

export async function deletePost(id, userId) {
  assertPostAccess(id, userId);
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
}

export async function getPostForAgent(id) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) ?? null;
  if (!post) return null;
  post.versions = db
    .prepare("SELECT * FROM versions WHERE post_id = ? ORDER BY version_number DESC")
    .all(id);
  post.feedback = db
    .prepare("SELECT * FROM feedback WHERE post_id = ? ORDER BY created_at DESC")
    .all(id);
  return post;
}

export async function listPostsForAgent(userId) {
  if (userId) return listPosts(userId);
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM versions v WHERE v.post_id = p.id) AS version_count,
              (SELECT COUNT(*) FROM feedback f WHERE f.post_id = p.id AND f.status = 'pending') AS pending_feedback
       FROM posts p
       ORDER BY CASE WHEN p.status = 'in_progress' THEN 0 ELSE 1 END, p.updated_at DESC`
    )
    .all();
}

// ---------- Versions ----------

export async function addVersion(postId, userId, { title, content, note, source, resolvesFeedbackId }) {
  const post = userId ? getPostRow(postId, userId) : (await getPostForAgent(postId));
  if (!post) return null;

  const maxRow = db
    .prepare("SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE post_id = ?")
    .get(postId);
  const nextNumber = (maxRow?.n ?? 0) + 1;

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO versions (post_id, version_number, title, content, note, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      postId,
      nextNumber,
      title ?? post.title,
      content ?? "",
      note ?? "",
      source === "ai" ? "ai" : "user"
    );
  const versionId = Number(lastInsertRowid);
  const version = db.prepare("SELECT * FROM versions WHERE id = ?").get(versionId);

  if (resolvesFeedbackId) {
    db.prepare(
      `UPDATE feedback
       SET status = 'done', resolved_version_id = ?, resolved_at = ?
       WHERE id = ? AND post_id = ?`
    ).run(versionId, nowIso(), resolvesFeedbackId, postId);
  }

  touchPost(postId);
  return version;
}

// ---------- Feedback ----------

export async function addFeedback(postId, userId, { content, context, context_from, context_to, versionId }) {
  assertPostAccess(postId, userId);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO feedback (post_id, version_id, content, context, context_from, context_to)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(postId, versionId ?? null, content, context ?? "", context_from ?? null, context_to ?? null);
  touchPost(postId);
  return db.prepare("SELECT * FROM feedback WHERE id = ?").get(Number(lastInsertRowid));
}

export async function updateFeedbackStatus(feedbackId, status) {
  const row = db
    .prepare("UPDATE feedback SET status = ? WHERE id = ? RETURNING *")
    .get(status, feedbackId);
  return row ?? null;
}

export async function deleteFeedback(feedbackId, userId) {
  const row = db
    .prepare(
      `SELECT f.id FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE f.id = ? AND p.user_id = ?`
    )
    .get(feedbackId, userId);
  if (!row) throw new Error("Not found");
  db.prepare("DELETE FROM feedback WHERE id = ?").run(feedbackId);
}

export async function listPendingFeedback(userId) {
  return db
    .prepare(
      `SELECT f.*, p.title AS post_title
       FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE f.status = 'pending' AND p.user_id = ?
       ORDER BY f.created_at ASC`
    )
    .all(userId);
}

export async function listPendingFeedbackForAgent(userId) {
  if (userId) return listPendingFeedback(userId);
  return db
    .prepare(
      `SELECT f.*, p.title AS post_title
       FROM feedback f JOIN posts p ON p.id = f.post_id
       WHERE f.status = 'pending' ORDER BY f.created_at ASC`
    )
    .all();
}

// ---------- AI task work & reports ----------

function getFeedbackRow(taskId) {
  return db.prepare("SELECT * FROM feedback WHERE id = ?").get(taskId) ?? null;
}

export async function addAiTaskWork(taskId, result) {
  const task = getFeedbackRow(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO ai_task_work (task_id, result) VALUES (?, ?)")
    .run(taskId, result ?? "");
  return db.prepare("SELECT * FROM ai_task_work WHERE id = ?").get(Number(lastInsertRowid));
}

export async function listAiTaskWork(taskId) {
  return db
    .prepare("SELECT * FROM ai_task_work WHERE task_id = ? ORDER BY created_at DESC")
    .all(taskId);
}

export async function addAiJobReport(postId, versionNumber, summaryActionReport) {
  const postRow = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!postRow) throw new Error(`No post with id ${postId}`);

  const version = db
    .prepare("SELECT * FROM versions WHERE post_id = ? AND version_number = ?")
    .get(postId, versionNumber);
  if (!version) throw new Error(`No version ${versionNumber} for post ${postId}`);

  const existing = db
    .prepare("SELECT id FROM ai_job_reports WHERE post_id = ? AND version_number = ?")
    .get(postId, versionNumber);

  if (existing) {
    const row = db
      .prepare(
        `UPDATE ai_job_reports
         SET summary_action_report = ?, created_at = ?
         WHERE id = ?
         RETURNING *`
      )
      .get(summaryActionReport ?? "", nowIso(), existing.id);
    return row;
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO ai_job_reports (post_id, version_number, summary_action_report)
       VALUES (?, ?, ?)`
    )
    .run(postId, versionNumber, summaryActionReport ?? "");
  return db.prepare("SELECT * FROM ai_job_reports WHERE id = ?").get(Number(lastInsertRowid));
}

export async function listAiJobReports(postId) {
  return db
    .prepare(
      "SELECT * FROM ai_job_reports WHERE post_id = ? ORDER BY version_number DESC"
    )
    .all(postId);
}

export async function listAiTaskChat(taskId) {
  return db
    .prepare(
      `SELECT * FROM ai_task_chat
       WHERE task_id = ? AND role != 'system'
       ORDER BY created_at ASC`
    )
    .all(taskId);
}

export async function addAiTaskChatMessage(taskId, role, content) {
  const task = getFeedbackRow(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  if (!["user", "assistant", "system"].includes(role)) {
    throw new Error("role must be user, assistant, or system");
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO ai_task_chat (task_id, role, content) VALUES (?, ?, ?)")
    .run(taskId, role, content ?? "");
  return db.prepare("SELECT * FROM ai_task_chat WHERE id = ?").get(Number(lastInsertRowid));
}

export async function getTaskThread(taskId, userId) {
  const task = getFeedbackRow(taskId);
  if (!task) return null;

  if (userId) {
    const access = db
      .prepare("SELECT 1 FROM posts WHERE id = ? AND user_id = ?")
      .get(task.post_id, userId);
    if (!access) return null;
  }

  const work = await listAiTaskWork(taskId);
  const messages = await listAiTaskChat(taskId);

  let report = null;
  if (task.resolved_version_id) {
    const version = db
      .prepare("SELECT * FROM versions WHERE id = ?")
      .get(task.resolved_version_id);
    if (version) {
      report =
        db
          .prepare(
            "SELECT * FROM ai_job_reports WHERE post_id = ? AND version_number = ?"
          )
          .get(task.post_id, version.version_number) ?? null;
    }
  }

  const post = db
    .prepare("SELECT id, title, draft_content FROM posts WHERE id = ?")
    .get(task.post_id);

  return { task, post, work, report, messages };
}

// ---------- Home feed ----------

export async function listFeedItems(userId) {
  return db
    .prepare(
      "SELECT * FROM feed_items WHERE user_id = ? ORDER BY created_at DESC, id DESC"
    )
    .all(userId);
}

export async function countFeedItems(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM feed_items WHERE user_id = ?").get(userId)?.n ?? 0;
}

export async function addFeedItems(userId, items) {
  const insert = db.prepare(
    `INSERT INTO feed_items (user_id, topic, kind, title, summary, url)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const inserted = [];
  for (const item of items || []) {
    const title = String(item?.title || "").trim();
    if (!title) continue;
    const { lastInsertRowid } = insert.run(
      userId,
      String(item?.topic || "").trim(),
      item?.kind === "write" ? "write" : "read",
      title,
      String(item?.summary || "").trim(),
      item?.url ? String(item.url).trim() : null
    );
    inserted.push(db.prepare("SELECT * FROM feed_items WHERE id = ?").get(Number(lastInsertRowid)));
  }
  return inserted;
}

export async function clearFeedItems(userId) {
  db.prepare("DELETE FROM feed_items WHERE user_id = ?").run(userId);
}

export default db;
