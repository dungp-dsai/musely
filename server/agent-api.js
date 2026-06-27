// Shared agent surface — used by agent-cli.js and REST routes in index.js.

import {
  listPosts,
  getPost,
  updateFeedbackStatus,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
} from "./db.js";

export function latestVersion(post) {
  return post.versions && post.versions.length ? post.versions[0] : null;
}

export function getActivePostId() {
  const active = listPosts().filter((p) => p.status === "in_progress");
  if (active.length === 0) return null;
  return active[0].id;
}

export function slimActivePost(post) {
  const latest = latestVersion(post);
  const draft = post.draft_content || latest?.content || "";

  return {
    post_id: post.id,
    title: post.title,
    status: post.status,
    content: draft,
    saved_version: latest
      ? {
          id: latest.id,
          version_number: latest.version_number,
          source: latest.source,
          note: latest.note,
          saved_at: latest.created_at,
        }
      : null,
    unsaved_changes: !!(latest && post.draft_content && post.draft_content !== latest.content),
  };
}

export function slimActiveTasks(post) {
  const tasks = (post.feedback || [])
    .filter((f) => f.status !== "done")
    .map((f) => ({
      id: f.id,
      context: f.context,
      task: f.content,
      status: f.status,
    }));

  return {
    post_id: post.id,
    title: post.title,
    tasks,
  };
}

export function getActivePostPayload() {
  const postId = getActivePostId();
  if (!postId) return { post_id: null, title: null, content: null };
  return slimActivePost(getPost(postId));
}

export function getActiveTasksPayload() {
  const postId = getActivePostId();
  if (!postId) return { post_id: null, title: null, tasks: [] };
  return slimActiveTasks(getPost(postId));
}

export {
  updateFeedbackStatus,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
  getPost,
};
