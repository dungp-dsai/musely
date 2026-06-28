// PostgreSQL database for writer-app (async pg).

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://writer:writer@localhost:5432/writer";

const pool = new pg.Pool({ connectionString: DATABASE_URL });

export { pool };

export async function initDb() {
  const schema = readFileSync(join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
}

async function touchPost(client, postId) {
  await client.query(`UPDATE posts SET updated_at = NOW() WHERE id = $1`, [postId]);
}

async function assertPostAccess(postId, userId, client = pool) {
  const { rows } = await client.query(
    `SELECT id FROM posts WHERE id = $1 AND user_id = $2`,
    [postId, userId]
  );
  if (!rows[0]) throw new Error("Not found");
}

async function getPostRow(id, userId, client = pool) {
  const { rows } = await client.query(`SELECT * FROM posts WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] || null;
}

// ---------- Users ----------

export async function upsertGoogleUser({ googleId, email, name, picture }) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_id, email, name, picture)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       picture = EXCLUDED.picture
     RETURNING *`,
    [googleId, email, name || "", picture || null]
  );
  return rows[0];
}

export async function getUserById(id) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ---------- Hermes instances (orchestrator registry) ----------

export async function getInstance(userId) {
  const { rows } = await pool.query(`SELECT * FROM hermes_instances WHERE user_id = $1`, [userId]);
  return rows[0] || null;
}

export async function createInstanceRecord({ userId, containerName, apiKey }) {
  const existing = await getInstance(userId);
  if (existing) return existing;
  const { rows } = await pool.query(
    `INSERT INTO hermes_instances (user_id, container_name, api_key, status, last_active_at)
     VALUES ($1, $2, $3, 'stopped', NOW())
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId, containerName, apiKey]
  );
  return rows[0] || (await getInstance(userId));
}

export async function updateInstanceContainerName(userId, containerName) {
  const { rows } = await pool.query(
    `UPDATE hermes_instances SET container_name = $1 WHERE user_id = $2 RETURNING *`,
    [containerName, userId]
  );
  return rows[0] || null;
}

export async function setInstanceStatus(userId, status) {
  const { rows } = await pool.query(
    `UPDATE hermes_instances SET status = $1 WHERE user_id = $2 RETURNING *`,
    [status, userId]
  );
  return rows[0] || null;
}

export async function touchInstance(userId) {
  await pool.query(
    `UPDATE hermes_instances SET last_active_at = NOW(), status = 'running' WHERE user_id = $1`,
    [userId]
  );
}

export async function listInstances() {
  const { rows } = await pool.query(
    `SELECT hi.*, u.email, u.name
     FROM hermes_instances hi
     JOIN users u ON u.id = hi.user_id
     ORDER BY hi.last_active_at DESC`
  );
  return rows;
}

export async function listIdleInstances(idleMinutes) {
  const { rows } = await pool.query(
    `SELECT * FROM hermes_instances
     WHERE status = 'running' AND last_active_at < NOW() - ($1 || ' minutes')::interval`,
    [String(idleMinutes)]
  );
  return rows;
}

// ---------- Posts ----------

export async function listPosts(userId) {
  const { rows } = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM versions v WHERE v.post_id = p.id) AS version_count,
            (SELECT COUNT(*)::int FROM feedback f WHERE f.post_id = p.id AND f.status = 'pending') AS pending_feedback
     FROM posts p
     WHERE p.user_id = $1
     ORDER BY CASE WHEN p.status = 'in_progress' THEN 0 ELSE 1 END, p.updated_at DESC`,
    [userId]
  );
  return rows;
}

export async function getPost(id, userId) {
  const post = await getPostRow(id, userId);
  if (!post) return null;
  const [versions, feedback] = await Promise.all([
    pool.query(`SELECT * FROM versions WHERE post_id = $1 ORDER BY version_number DESC`, [id]),
    pool.query(`SELECT * FROM feedback WHERE post_id = $1 ORDER BY created_at DESC`, [id]),
  ]);
  post.versions = versions.rows;
  post.feedback = feedback.rows;
  return post;
}

export async function createPost(userId, { title }) {
  const { rows } = await pool.query(
    `INSERT INTO posts (user_id, title, idea, status) VALUES ($1, $2, '', 'pending') RETURNING id`,
    [userId, title?.trim() || "Untitled"]
  );
  return getPost(rows[0].id, userId);
}

export async function setPostStatus(id, userId, status) {
  if (status !== "pending" && status !== "in_progress") {
    throw new Error("Status must be pending or in_progress");
  }
  const post = await getPostRow(id, userId);
  if (!post) return null;

  if (status === "in_progress" && post.status !== "in_progress") {
    const { rows } = await pool.query(
      `SELECT id, title FROM posts WHERE status = 'in_progress' AND user_id = $1 AND id != $2`,
      [userId, id]
    );
    if (rows[0]) {
      throw new Error(`Only one post can be In Progress. "${rows[0].title}" is already active.`);
    }
  }

  await pool.query(`UPDATE posts SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
  return getPost(id, userId);
}

export async function updatePost(id, userId, { title, idea, status, draft_content }) {
  const post = await getPostRow(id, userId);
  if (!post) return null;

  if (status !== undefined && status !== post.status) {
    await setPostStatus(id, userId, status);
  }

  const current = await getPostRow(id, userId);
  await pool.query(
    `UPDATE posts SET title = $1, idea = $2, draft_content = $3, updated_at = NOW() WHERE id = $4`,
    [
      title !== undefined ? title : current.title,
      idea !== undefined ? idea : current.idea,
      draft_content !== undefined ? draft_content : current.draft_content ?? "",
      id,
    ]
  );
  return getPost(id, userId);
}

export async function deletePost(id, userId) {
  await assertPostAccess(id, userId);
  await pool.query(`DELETE FROM posts WHERE id = $1`, [id]);
}

// Agent: no user scoping (Hermes uses AGENT_USER_ID or all users' in_progress)
export async function getPostForAgent(id) {
  const { rows } = await pool.query(`SELECT * FROM posts WHERE id = $1`, [id]);
  const post = rows[0];
  if (!post) return null;
  const [versions, feedback] = await Promise.all([
    pool.query(`SELECT * FROM versions WHERE post_id = $1 ORDER BY version_number DESC`, [id]),
    pool.query(`SELECT * FROM feedback WHERE post_id = $1 ORDER BY created_at DESC`, [id]),
  ]);
  post.versions = versions.rows;
  post.feedback = feedback.rows;
  return post;
}

export async function listPostsForAgent(userId) {
  if (userId) return listPosts(userId);
  const { rows } = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM versions v WHERE v.post_id = p.id) AS version_count,
            (SELECT COUNT(*)::int FROM feedback f WHERE f.post_id = p.id AND f.status = 'pending') AS pending_feedback
     FROM posts p
     ORDER BY CASE WHEN p.status = 'in_progress' THEN 0 ELSE 1 END, p.updated_at DESC`
  );
  return rows;
}

// ---------- Versions ----------

export async function addVersion(postId, userId, { title, content, note, source, resolvesFeedbackId }) {
  const post = userId ? await getPostRow(postId, userId) : (await getPostForAgent(postId));
  if (!post) return null;

  const { rows: maxRows } = await pool.query(
    `SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE post_id = $1`,
    [postId]
  );
  const nextNumber = maxRows[0].n + 1;

  const { rows } = await pool.query(
    `INSERT INTO versions (post_id, version_number, title, content, note, source)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      postId,
      nextNumber,
      title ?? post.title,
      content ?? "",
      note ?? "",
      source === "ai" ? "ai" : "user",
    ]
  );
  const version = rows[0];

  if (resolvesFeedbackId) {
    await pool.query(
      `UPDATE feedback SET status = 'done', resolved_version_id = $1, resolved_at = NOW()
       WHERE id = $2 AND post_id = $3`,
      [version.id, resolvesFeedbackId, postId]
    );
  }

  await touchPost(pool, postId);
  return version;
}

// ---------- Feedback ----------

export async function addFeedback(postId, userId, { content, context, context_from, context_to, versionId }) {
  await assertPostAccess(postId, userId);
  const { rows } = await pool.query(
    `INSERT INTO feedback (post_id, version_id, content, context, context_from, context_to)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [postId, versionId ?? null, content, context ?? "", context_from ?? null, context_to ?? null]
  );
  await touchPost(pool, postId);
  return rows[0];
}

export async function updateFeedbackStatus(feedbackId, status) {
  const { rows } = await pool.query(
    `UPDATE feedback SET status = $1 WHERE id = $2 RETURNING *`,
    [status, feedbackId]
  );
  return rows[0] || null;
}

export async function deleteFeedback(feedbackId, userId) {
  const { rows } = await pool.query(
    `SELECT f.id FROM feedback f JOIN posts p ON p.id = f.post_id WHERE f.id = $1 AND p.user_id = $2`,
    [feedbackId, userId]
  );
  if (!rows[0]) throw new Error("Not found");
  await pool.query(`DELETE FROM feedback WHERE id = $1`, [feedbackId]);
}

export async function listPendingFeedback(userId) {
  const { rows } = await pool.query(
    `SELECT f.*, p.title AS post_title
     FROM feedback f
     JOIN posts p ON p.id = f.post_id
     WHERE f.status = 'pending' AND p.user_id = $1
     ORDER BY f.created_at ASC`,
    [userId]
  );
  return rows;
}

export async function listPendingFeedbackForAgent(userId) {
  if (userId) return listPendingFeedback(userId);
  const { rows } = await pool.query(
    `SELECT f.*, p.title AS post_title
     FROM feedback f JOIN posts p ON p.id = f.post_id
     WHERE f.status = 'pending' ORDER BY f.created_at ASC`
  );
  return rows;
}

// ---------- AI task work & reports ----------

async function getFeedbackRow(taskId) {
  const { rows } = await pool.query(`SELECT * FROM feedback WHERE id = $1`, [taskId]);
  return rows[0] || null;
}

async function getVersionByNumber(postId, versionNumber) {
  const { rows } = await pool.query(
    `SELECT * FROM versions WHERE post_id = $1 AND version_number = $2`,
    [postId, versionNumber]
  );
  return rows[0] || null;
}

export async function addAiTaskWork(taskId, result) {
  const task = await getFeedbackRow(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  const { rows } = await pool.query(
    `INSERT INTO ai_task_work (task_id, result) VALUES ($1, $2) RETURNING *`,
    [taskId, result ?? ""]
  );
  return rows[0];
}

export async function listAiTaskWork(taskId) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_task_work WHERE task_id = $1 ORDER BY created_at DESC`,
    [taskId]
  );
  return rows;
}

export async function addAiJobReport(postId, versionNumber, summaryActionReport) {
  const { rows: postRows } = await pool.query(`SELECT id FROM posts WHERE id = $1`, [postId]);
  if (!postRows[0]) throw new Error(`No post with id ${postId}`);
  const version = await getVersionByNumber(postId, versionNumber);
  if (!version) throw new Error(`No version ${versionNumber} for post ${postId}`);

  const { rows: existing } = await pool.query(
    `SELECT id FROM ai_job_reports WHERE post_id = $1 AND version_number = $2`,
    [postId, versionNumber]
  );

  if (existing[0]) {
    const { rows } = await pool.query(
      `UPDATE ai_job_reports SET summary_action_report = $1, created_at = NOW() WHERE id = $2 RETURNING *`,
      [summaryActionReport ?? "", existing[0].id]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO ai_job_reports (post_id, version_number, summary_action_report) VALUES ($1, $2, $3) RETURNING *`,
    [postId, versionNumber, summaryActionReport ?? ""]
  );
  return rows[0];
}

export async function listAiJobReports(postId) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_job_reports WHERE post_id = $1 ORDER BY version_number DESC`,
    [postId]
  );
  return rows;
}

export async function listAiTaskChat(taskId) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_task_chat WHERE task_id = $1 AND role != 'system' ORDER BY created_at ASC`,
    [taskId]
  );
  return rows;
}

export async function addAiTaskChatMessage(taskId, role, content) {
  const task = await getFeedbackRow(taskId);
  if (!task) throw new Error(`No task with id ${taskId}`);
  if (!["user", "assistant", "system"].includes(role)) {
    throw new Error("role must be user, assistant, or system");
  }
  const { rows } = await pool.query(
    `INSERT INTO ai_task_chat (task_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
    [taskId, role, content ?? ""]
  );
  return rows[0];
}

export async function getTaskThread(taskId, userId) {
  const task = await getFeedbackRow(taskId);
  if (!task) return null;

  if (userId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM posts WHERE id = $1 AND user_id = $2`,
      [task.post_id, userId]
    );
    if (!rows[0]) return null;
  }

  const work = await listAiTaskWork(taskId);
  const messages = await listAiTaskChat(taskId);

  let report = null;
  if (task.resolved_version_id) {
    const { rows: versionRows } = await pool.query(`SELECT * FROM versions WHERE id = $1`, [
      task.resolved_version_id,
    ]);
    const version = versionRows[0];
    if (version) {
      const { rows: reportRows } = await pool.query(
        `SELECT * FROM ai_job_reports WHERE post_id = $1 AND version_number = $2`,
        [task.post_id, version.version_number]
      );
      report = reportRows[0] || null;
    }
  }

  const { rows: postRows } = await pool.query(
    `SELECT id, title, draft_content FROM posts WHERE id = $1`,
    [task.post_id]
  );

  return { task, post: postRows[0], work, report, messages };
}

export default pool;
