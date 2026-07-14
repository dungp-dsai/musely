// Shared agent surface — used by agent-cli.js and REST routes in index.js.

import {
  listPostsForAgent,
  getPostForAgent,
  updateFeedbackStatus,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
} from "./db.js";

export function latestVersion(post) {
  return post.versions && post.versions.length ? post.versions[0] : null;
}

export async function getActivePostId(userId) {
  const posts = await listPostsForAgent(userId);
  if (!posts.length) return null;

  // Prefer the piece explicitly marked In Progress (Start / schedule sets this).
  const inProgress = posts.find((p) => p.status === "in_progress");
  if (inProgress) return inProgress.id;

  // Otherwise a piece with unfinished feedback; else most recently updated.
  const withQueue = posts.find(
    (p) => Number(p.open_feedback || p.pending_feedback) > 0
  );
  if (withQueue) return withQueue.id;
  return posts[0].id;
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

export async function getActivePostPayload(userId) {
  const postId = await getActivePostId(userId);
  if (!postId) return { post_id: null, title: null, content: null };
  const post = await getPostForAgent(postId);
  return slimActivePost(post);
}

export async function getActiveTasksPayload(userId) {
  const postId = await getActivePostId(userId);
  if (!postId) return { post_id: null, title: null, tasks: [] };
  const post = await getPostForAgent(postId);
  return slimActiveTasks(post);
}

export {
  updateFeedbackStatus,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
  getPostForAgent as getPost,
};
