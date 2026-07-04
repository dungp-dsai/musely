import type {
  Post,
  PostSummary,
  Version,
  Feedback,
  TaskThread,
  AiTaskChatMessage,
  UserTopics,
  FeedItem,
} from "./types";
import type { CronJob } from "./lib/cronTypes";

export type User = {
  id: number;
  email: string;
  name: string;
  picture: string | null;
  onboarded: boolean;
  topics: UserTopics;
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

export type WaitlistEntry = {
  id: number;
  email: string;
  approved: boolean;
  source: string;
  createdAt: string;
  approvedAt: string | null;
};

export const api = {
  joinWaitlist: (email: string): Promise<{ ok: boolean; alreadyJoined: boolean; emailed: boolean }> =>
    apiFetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(json),

  adminMe: (): Promise<{ authenticated: boolean; configured: boolean }> =>
    apiFetch("/api/admin/me").then(json),

  adminLogin: (username: string, password: string): Promise<{ ok: boolean }> =>
    apiFetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(json),

  adminLogout: (): Promise<{ ok: boolean }> =>
    apiFetch("/api/admin/logout", { method: "POST" }).then(json),

  adminListWaitlist: (): Promise<{ entries: WaitlistEntry[]; emailConfigured: boolean }> =>
    apiFetch("/api/admin/waitlist").then(json),

  adminApprove: (id: number): Promise<{ ok: boolean; emailed: boolean }> =>
    apiFetch(`/api/admin/waitlist/${id}/approve`, { method: "POST" }).then(json),

  adminRevoke: (id: number): Promise<{ ok: boolean }> =>
    apiFetch(`/api/admin/waitlist/${id}/revoke`, { method: "POST" }).then(json),

  adminListPlatformFiles: (): Promise<{
    root: string;
    files: string[];
    secrets: {
      entries: { key: string; masked: string | null; hasValue: boolean }[];
      note: string;
    };
  }> => apiFetch("/api/admin/musely-agent/platform/files").then(json),

  adminReadPlatformFile: (path: string): Promise<{ path: string; content: string }> =>
    apiFetch(`/api/admin/musely-agent/platform/file?path=${encodeURIComponent(path)}`).then(json),

  adminWritePlatformFile: (
    path: string,
    content: string
  ): Promise<{ path: string; bytes: number }> =>
    apiFetch("/api/admin/musely-agent/platform/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then(json),

  adminListPlatformSecrets: (): Promise<{
    entries: { key: string; masked: string | null; hasValue: boolean }[];
    note: string;
  }> => apiFetch("/api/admin/musely-agent/platform/secrets").then(json),

  adminSavePlatformSecrets: (
    secrets: { key: string; value?: string; delete?: boolean }[]
  ): Promise<{ ok: boolean; saved: { key: string; saved?: boolean; deleted?: boolean }[] }> =>
    apiFetch("/api/admin/musely-agent/platform/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets }),
    }).then(json),

  adminListPlatformSkills: (): Promise<{
    skills: { id: string; hasSkillMd: boolean }[];
  }> => apiFetch("/api/admin/musely-agent/platform/skills").then(json),

  adminReadPlatformSkill: (
    id: string
  ): Promise<{ id: string; path: string; content: string }> =>
    apiFetch(`/api/admin/musely-agent/platform/skills/${encodeURIComponent(id)}`).then(json),

  adminCreatePlatformSkill: (data: {
    id: string;
    content: string;
  }): Promise<{ id: string; path: string; content: string }> =>
    apiFetch("/api/admin/musely-agent/platform/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  adminUpdatePlatformSkill: (
    id: string,
    content: string
  ): Promise<{ id: string; path: string; bytes: number }> =>
    apiFetch(`/api/admin/musely-agent/platform/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).then(json),

  adminDeletePlatformSkill: (id: string): Promise<{ id: string }> =>
    apiFetch(`/api/admin/musely-agent/platform/skills/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(json),

  me: (): Promise<User> => apiFetch("/api/auth/me").then(json),

  completeOnboarding: (topics: UserTopics): Promise<User> =>
    apiFetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topics),
    }).then(json),

  getFeed: (): Promise<FeedItem[]> => apiFetch("/api/feed").then(json),

  ingestFeed: (): Promise<{ ok: boolean; source: string; items: FeedItem[] }> =>
    apiFetch("/api/feed/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace: true }),
    }).then(json),

  clearFeed: (): Promise<{ ok: boolean; count: number }> =>
    apiFetch("/api/feed/clear", { method: "POST" }).then(json),

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

  getConfig: (): Promise<{
    muselyAgentChatEnabled: boolean;
    muselyAgentCronEnabled: boolean;
    googleAuthEnabled: boolean;
    orchestratorEnabled: boolean;
  }> => apiFetch("/api/config").then(json),

  getMuselyAgentModels: (): Promise<{
    models: string[];
    defaultModel?: string | null;
    gatewayModel?: string;
    error: string | null;
  }> => apiFetch("/api/musely-agent/models").then(json),

  getCronMeta: (): Promise<{
    enabled: boolean;
    deliveryOptions: { value: string; label: string }[];
    scheduleExamples: string[];
  }> => apiFetch("/api/musely-agent/cron/meta").then(json),

  listCronJobs: (): Promise<{ jobs: CronJob[]; source?: string; raw?: string }> =>
    apiFetch("/api/musely-agent/cron").then(json),

  getCronStatus: (): Promise<{ status: string }> =>
    apiFetch("/api/musely-agent/cron/status").then(json),

  getInstanceStatus: (): Promise<{
    orchestrator: boolean;
    state?: string;
    settings?: { idleMinutes: number; memory: string; cpus: string };
  }> => apiFetch("/api/musely-agent/instance").then(json),

  ensureMuselyAgentInstance: (): Promise<{
    ready: boolean;
    state?: string;
    orchestrator?: boolean;
    containerName?: string;
    error?: string;
  }> =>
    apiFetch("/api/musely-agent/instance/ensure", { method: "POST" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.status === 202) return { ...body, ready: false };
      if (!res.ok) {
        return { ready: false, error: body.error || `Request failed: ${res.status}` };
      }
      return body;
    }),

  syncMuselyAgentPlatform: (options?: {
    sections: ("config" | "skills" | "secrets")[];
    restart?: boolean;
  }): Promise<{
    ok: boolean;
    sections: string[];
    total: number;
    synced: number;
    failed: number;
    results: { userId: number; email: string; ok: boolean; error?: string }[];
  }> =>
    apiFetch("/api/admin/musely-agent/sync-platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sections: options?.sections ?? ["config", "skills", "secrets"],
        restart: options?.restart !== false,
      }),
    }).then(json),

  createCronJob: (data: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> =>
    apiFetch("/api/musely-agent/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateCronJob: (
    id: string,
    data: Record<string, unknown>
  ): Promise<{ ok: boolean; message?: string }> =>
    apiFetch(`/api/musely-agent/cron/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  pauseCronJob: (id: string): Promise<{ ok: boolean; message?: string }> =>
    apiFetch(`/api/musely-agent/cron/${encodeURIComponent(id)}/pause`, { method: "POST" }).then(json),

  resumeCronJob: (id: string): Promise<{ ok: boolean; message?: string }> =>
    apiFetch(`/api/musely-agent/cron/${encodeURIComponent(id)}/resume`, { method: "POST" }).then(json),

  runCronJob: (id: string): Promise<{ ok: boolean; message?: string }> =>
    apiFetch(`/api/musely-agent/cron/${encodeURIComponent(id)}/run`, { method: "POST" }).then(json),

  deleteCronJob: (id: string): Promise<{ ok: boolean; message?: string }> =>
    apiFetch(`/api/musely-agent/cron/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json),
};

export { API_BASE };
