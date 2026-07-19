import type {
  Post,
  PostSummary,
  Version,
  Feedback,
  TaskThread,
  UserTopics,
  UserPreferences,
  FeedPost,
  FeedListResponse,
  FeedUserPrefs,
  FeedDiscussThread,
  ResearchSession,
  ResearchThread,
} from "./types";
import type { CronJob } from "./lib/cronTypes";
import { streamMuselyAgentRequest } from "./lib/muselyAgentRequest";
import {
  FEED_REFRESH_FAILED,
  isAgentFailureResponse,
} from "./lib/userFacingErrors";

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

  adminCreatePlatformFile: (
    path: string,
    content?: string
  ): Promise<{ path: string; bytes: number }> =>
    apiFetch("/api/admin/musely-agent/platform/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: content ?? "" }),
    }).then(json),

  adminDeletePlatformFile: (path: string): Promise<{ path: string; deleted: boolean }> =>
    apiFetch(`/api/admin/musely-agent/platform/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
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

  getUserPreferences: (): Promise<UserPreferences> =>
    apiFetch("/api/user/preferences").then(json),

  updateUserPreferences: (topics: UserTopics): Promise<UserPreferences> =>
    apiFetch("/api/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topics),
    }).then(json),

  getFeedPosts: (params?: { limit?: number; offset?: number }): Promise<FeedListResponse> => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return apiFetch(`/api/feed/posts${qs ? `?${qs}` : ""}`).then(json);
  },

  getFeedPost: (id: number): Promise<FeedPost> => apiFetch(`/api/feed/posts/${id}`).then(json),

  setFeedPostReaction: (id: number, reaction: "up" | "down" | null): Promise<FeedPost> =>
    apiFetch(`/api/feed/posts/${id}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    }).then(json),

  submitFeedPostFeedback: (id: number, content: string): Promise<{ id: number; content: string }> =>
    apiFetch(`/api/feed/posts/${id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).then(json),

  getFeedDiscuss: (postId: number): Promise<FeedDiscussThread> =>
    apiFetch(`/api/feed/posts/${postId}/discuss`).then(json),

  sendFeedDiscuss: async (opts: {
    postId: number;
    message: string;
    signal?: AbortSignal;
    onWarming?: () => void;
    onActivity?: (line: string) => void;
    onChunk?: (chunk: string, full: string) => void;
  }): Promise<string> => {
    const text = await streamMuselyAgentRequest({
      apiBase: API_BASE,
      path: `/api/feed/posts/${opts.postId}/discuss`,
      body: { message: opts.message },
      signal: opts.signal,
      onWarming: opts.onWarming,
      onLine: opts.onActivity,
      onChunk: opts.onChunk,
    });
    if (!text.trim()) {
      throw new Error("Your agent didn't reply. Please try again.");
    }
    return text.trim();
  },

  listResearchSessions: (): Promise<{ sessions: ResearchSession[] }> =>
    apiFetch("/api/research/sessions").then(json),

  createResearchSession: (title?: string): Promise<{ session: ResearchSession }> =>
    apiFetch("/api/research/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "New research" }),
    }).then(json),

  getResearchThread: (sessionId: number): Promise<ResearchThread> =>
    apiFetch(`/api/research/sessions/${sessionId}`).then(json),

  deleteResearchSession: (sessionId: number): Promise<{ ok: boolean }> =>
    apiFetch(`/api/research/sessions/${sessionId}`, { method: "DELETE" }).then(json),

  sendResearchChat: async (opts: {
    sessionId: number;
    message: string;
    signal?: AbortSignal;
    onWarming?: () => void;
    onChunk?: (chunk: string, full: string) => void;
  }): Promise<string> => {
    const text = await streamMuselyAgentRequest({
      apiBase: API_BASE,
      path: `/api/research/sessions/${opts.sessionId}/chat`,
      body: { message: opts.message },
      signal: opts.signal,
      onWarming: opts.onWarming,
      onChunk: opts.onChunk,
    });
    if (!text.trim()) {
      throw new Error("Your agent didn't reply. Please try again.");
    }
    return text.trim();
  },

  getFeedPrefs: (): Promise<FeedUserPrefs> => apiFetch("/api/feed/prefs").then(json),

  updateFeedPrefs: (prefs: { skip_feedback_prompt: boolean }): Promise<FeedUserPrefs> =>
    apiFetch("/api/feed/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }).then(json),

  /** @deprecated Use getFeedPosts */
  getFeed: (): Promise<FeedPost[]> =>
    apiFetch("/api/feed").then(json),

  refreshFeed: async (opts?: {
    signal?: AbortSignal;
    onWarming?: () => void;
    onActivity?: (line: string) => void;
  }): Promise<void> => {
    const text = await streamMuselyAgentRequest({
      apiBase: API_BASE,
      path: "/api/feed/refresh",
      body: {},
      signal: opts?.signal,
      onWarming: opts?.onWarming,
      onLine: opts?.onActivity,
    });
    if (isAgentFailureResponse(text)) {
      throw new Error(FEED_REFRESH_FAILED);
    }
  },

  /**
   * Hot-pickup: wake the agent (if needed) and ask it to research the writing
   * queue for the In Progress piece via the do-research skill.
   * Returns how many new findings rows were stored (0 = agent ran but nothing new).
   */
  runWritingQueue: async (opts: {
    postId: number;
    postTitle: string;
    taskCount: number;
    signal?: AbortSignal;
    onWarming?: () => void;
    onActivity?: (line: string) => void;
  }): Promise<{ freshFindings: number }> => {
    // Make this piece the active one before waking the agent — /api/active
    // prefers status=in_progress so the skill doesn't hit the wrong draft.
    await api.updatePost(opts.postId, { status: "in_progress" });

    const postBefore = await api.getPost(opts.postId);
    const openTasks = postBefore.feedback.filter((f) => f.status !== "done");
    const beforeIds = new Set<number>();
    await Promise.all(
      openTasks.map(async (f) => {
        try {
          const thread = await api.getTaskThread(f.id);
          for (const w of thread.work) beforeIds.add(w.id);
        } catch {
          /* ignore — treat missing as empty */
        }
      })
    );

    const n = opts.taskCount;
    const label = n === 1 ? "1 queued task" : `${n} queued tasks`;
    const messages = [
      {
        role: "user",
        content: [
          `The user just hit Start on the AI writing queue.`,
          ``,
          `Piece: "${opts.postTitle}" (post_id ${opts.postId}) — already set to In Progress.`,
          `There ${n === 1 ? "is" : "are"} ${label} waiting.`,
          ``,
          `Use the do-research skill to do this correctly (API only):`,
          `1. GET /api/active and GET /api/active/tasks — they must match this post_id.`,
          `2. For each task: claim it if needed, then do a FRESH research pass and POST new findings to /api/feedback/:id/work.`,
          `3. Do NOT skip because older findings already exist — Start means refresh. Leave prior findings in place; always append a new result.`,
          `4. Do not rewrite the draft or touch the UI.`,
          `5. Reply with one short confirmation only.`,
        ].join("\n"),
      },
    ];
    const text = await streamMuselyAgentRequest({
      apiBase: API_BASE,
      path: "/api/musely-agent/chat",
      body: { messages },
      signal: opts.signal,
      onWarming: opts.onWarming,
      onLine: opts.onActivity,
    });
    if (isAgentFailureResponse(text)) {
      throw new Error("Couldn't start your agent on the queue. Please try again.");
    }

    const postAfter = await api.getPost(opts.postId);
    const afterTasks = postAfter.feedback.filter((f) => f.status !== "done");
    let freshFindings = 0;
    await Promise.all(
      afterTasks.map(async (f) => {
        try {
          const thread = await api.getTaskThread(f.id);
          for (const w of thread.work) {
            if (!beforeIds.has(w.id)) freshFindings += 1;
          }
        } catch {
          /* ignore */
        }
      })
    );

    // Agent may claim "done" while skipping POSTs — treat that as no new work.
    if (
      freshFindings === 0 &&
      /already (saved|stored|exist)|no re-research|findings (are|already) in place|no new/i.test(
        text
      )
    ) {
      return { freshFindings: 0 };
    }

    return { freshFindings };
  },

  /** @deprecated Use refreshFeed */
  ingestFeed: (): Promise<{ ok: boolean; source: string; posts: FeedPost[] }> =>
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

  sendTaskChat: async (opts: {
    taskId: number;
    message: string;
    signal?: AbortSignal;
    onWarming?: () => void;
    onChunk?: (chunk: string, full: string) => void;
  }): Promise<string> => {
    const text = await streamMuselyAgentRequest({
      apiBase: API_BASE,
      path: `/api/feedback/${opts.taskId}/chat`,
      body: { message: opts.message },
      signal: opts.signal,
      onWarming: opts.onWarming,
      onChunk: opts.onChunk,
    });
    if (!text.trim()) {
      throw new Error("Your agent didn't reply. Please try again.");
    }
    return text.trim();
  },

  getConfig: (): Promise<{
    muselyAgentChatEnabled: boolean;
    muselyAgentCronEnabled: boolean;
    googleAuthEnabled: boolean;
    orchestratorEnabled: boolean;
  }> => apiFetch("/api/config").then(json),

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
