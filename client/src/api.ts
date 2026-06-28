import type { Post, PostSummary, Version, Feedback, TaskThread, AiTaskChatMessage } from "./types";

export type User = {
  id: number;
  email: string;
  name: string;
  picture: string | null;
};

const API_BASE = import.meta.env.VITE_API_URL || "";

function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });
}

const json = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

export const api = {
  me: (): Promise<User> => apiFetch("/api/auth/me").then(json),

  logout: (): Promise<{ ok: boolean }> =>
    apiFetch("/api/auth/logout", { method: "POST" }).then(json),

  listPosts: (): Promise<PostSummary[]> => apiFetch("/api/posts").then(json),

  getPost: (id: number): Promise<Post> => apiFetch(`/api/posts/${id}`).then(json),

  createPost: (data: { title: string; idea: string }): Promise<Post> =>
    apiFetch("/api/posts", {
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
    return apiFetch(`/api/posts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json);
  },

  deletePost: (id: number): Promise<{ ok: boolean }> =>
    apiFetch(`/api/posts/${id}`, { method: "DELETE" }).then(json),

  addVersion: (
    postId: number,
    data: { content: string; note?: string; title?: string; source?: "user" | "ai"; resolvesFeedbackId?: number }
  ): Promise<Version> =>
    apiFetch(`/api/posts/${postId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  addFeedback: (
    postId: number,
    data: { task: string; context?: string; contextFrom?: number; contextTo?: number; versionId?: number }
  ): Promise<Feedback> =>
    apiFetch(`/api/posts/${postId}/feedback`, {
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
    apiFetch(`/api/feedback/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(json),

  deleteFeedback: (id: number): Promise<{ ok: boolean }> =>
    apiFetch(`/api/feedback/${id}`, { method: "DELETE" }).then(json),

  getTaskThread: (taskId: number): Promise<TaskThread> =>
    apiFetch(`/api/feedback/${taskId}/thread`).then(json),

  sendTaskChat: (
    taskId: number,
    message: string
  ): Promise<{ user: AiTaskChatMessage; assistant: AiTaskChatMessage; thread: TaskThread }> =>
    apiFetch(`/api/feedback/${taskId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).then(json),

  getConfig: (): Promise<{ hermesChatEnabled: boolean; googleAuthEnabled: boolean }> =>
    apiFetch("/api/config").then(json),

  getHermesModels: (): Promise<{ models: string[]; error: string | null }> =>
    apiFetch("/api/hermes/models").then(json),
};

export { API_BASE };
