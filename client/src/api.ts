import type { Post, PostSummary, Version, Feedback, TaskThread, AiTaskChatMessage } from "./types";

const json = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

export const api = {
  listPosts: (): Promise<PostSummary[]> => fetch("/api/posts").then(json),

  getPost: (id: number): Promise<Post> => fetch(`/api/posts/${id}`).then(json),

  createPost: (data: { title: string; idea: string }): Promise<Post> =>
    fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updatePost: (
    id: number,
    data: Partial<Pick<Post, "title" | "idea" | "status">> & { draftContent?: string }
  ): Promise<Post> => {
    const body: Record<string, string> = {};
    if (data.title !== undefined) body.title = data.title;
    if (data.idea !== undefined) body.idea = data.idea;
    if (data.status !== undefined) body.status = data.status;
    if (data.draftContent !== undefined) body.draft_content = data.draftContent;
    return fetch(`/api/posts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json);
  },

  deletePost: (id: number): Promise<{ ok: boolean }> =>
    fetch(`/api/posts/${id}`, { method: "DELETE" }).then(json),

  addVersion: (
    postId: number,
    data: { content: string; note?: string; title?: string; source?: "user" | "ai"; resolvesFeedbackId?: number }
  ): Promise<Version> =>
    fetch(`/api/posts/${postId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  addFeedback: (
    postId: number,
    data: { task: string; context?: string; contextFrom?: number; contextTo?: number; versionId?: number }
  ): Promise<Feedback> =>
    fetch(`/api/posts/${postId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: data.task,
        context: data.context ?? "",
        context_from: data.contextFrom ?? null,
        context_to: data.contextTo ?? null,
        versionId: data.versionId,
      }),
    }).then(json),

  setFeedbackStatus: (id: number, status: Feedback["status"]): Promise<Feedback> =>
    fetch(`/api/feedback/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(json),

  deleteFeedback: (id: number): Promise<{ ok: boolean }> =>
    fetch(`/api/feedback/${id}`, { method: "DELETE" }).then(json),

  getTaskThread: (taskId: number): Promise<TaskThread> =>
    fetch(`/api/feedback/${taskId}/thread`).then(json),

  sendTaskChat: (
    taskId: number,
    message: string
  ): Promise<{ user: AiTaskChatMessage; assistant: AiTaskChatMessage; thread: TaskThread }> =>
    fetch(`/api/feedback/${taskId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).then(json),

  getConfig: (): Promise<{ hermesChatEnabled: boolean }> => fetch("/api/config").then(json),

  getHermesModels: (): Promise<{ models: string[]; error: string | null }> =>
    fetch("/api/hermes/models").then(json),
};
