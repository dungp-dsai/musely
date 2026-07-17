import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { FEED_REFRESH_FAILED, toUserFacingError } from "../lib/userFacingErrors";
import type { AppNotification, NotificationToast } from "./types";

type StartFeedOpts = {
  topicLabel?: string;
};

type StartWritingQueueOpts = {
  postId: number;
  postTitle: string;
  taskCount: number;
};

type StartFeedDiscussOpts = {
  postId: number;
  postTitle: string;
  message: string;
};

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  focusedFeedJob: AppNotification | null;
  runningFeedJob: AppNotification | null;
  focusedWritingJob: AppNotification | null;
  runningWritingJob: AppNotification | null;
  focusedDiscussJob: AppNotification | null;
  runningDiscussJob: AppNotification | null;
  feedRevision: number;
  writingRevision: number;
  discussRevision: number;
  toast: NotificationToast | null;
  startFeedRefresh: (opts?: StartFeedOpts) => void;
  startWritingQueue: (opts: StartWritingQueueOpts) => void;
  startFeedDiscuss: (opts: StartFeedDiscussOpts) => void;
  cancelFeedJob: (id: string) => void;
  cancelWritingQueueJob: (id: string) => void;
  cancelDiscussJob: (id: string) => void;
  retryFeedJob: (id: string) => void;
  retryWritingQueueJob: (id: string) => void;
  backgroundFeedJob: (id: string) => void;
  focusFeedJob: (id: string) => void;
  focusWritingQueueJob: (id: string) => void;
  focusDiscussJob: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  dismissToast: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const STORAGE_KEY = "musely.notifications.v1";
const MAX_NOTIFICATIONS = 40;

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `n_${crypto.randomUUID()}`;
  }
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function patchNotification(
  list: AppNotification[],
  id: string,
  patch: Partial<AppNotification>
): AppNotification[] {
  let found = false;
  const next = list.map((n) => {
    if (n.id !== id) return n;
    found = true;
    return { ...n, ...patch, updatedAt: Date.now() };
  });
  return found ? next : list;
}

function interruptedCopy(kind: AppNotification["kind"]) {
  if (kind === "writing_queue") {
    return {
      title: "Queue run interrupted",
      body: "This queue run stopped when the page reloaded.",
    };
  }
  if (kind === "feed_discuss") {
    return {
      title: "Discussion interrupted",
      body: "This discussion reply stopped when the page reloaded.",
    };
  }
  return {
    title: "Feed build interrupted",
    body: "This build stopped when the page reloaded.",
  };
}

function loadStoredNotifications(): AppNotification[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n) => {
      if (n.status !== "running") return n;
      const copy = interruptedCopy(n.kind);
      return {
        ...n,
        status: "cancelled" as const,
        title: copy.title,
        body: copy.body,
        focused: false,
        read: true,
        updatedAt: Date.now(),
      };
    });
  } catch {
    return [];
  }
}

function truncateBody(line: string, max = 72) {
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadStoredNotifications);
  const [feedRevision, setFeedRevision] = useState(0);
  const [writingRevision, setWritingRevision] = useState(0);
  const [discussRevision, setDiscussRevision] = useState(0);
  const [toast, setToast] = useState<NotificationToast | null>(null);
  const abortById = useRef<Map<string, AbortController>>(new Map());
  const feedInFlight = useRef(false);
  const writingInFlight = useRef(false);
  const discussInFlight = useRef(new Set<number>());

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    } catch {
      /* ignore quota / private mode */
    }
  }, [notifications]);

  const showToast = useCallback((next: NotificationToast) => {
    setToast(next);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const runFeedJob = useCallback(
    async (id: string, topicLabel?: string) => {
      abortById.current.get(id)?.abort();
      const controller = new AbortController();
      abortById.current.set(id, controller);
      feedInFlight.current = true;

      try {
        await api.refreshFeed({
          signal: controller.signal,
          onWarming: () =>
            setNotifications((prev) =>
              patchNotification(prev, id, {
                activity: ["Waking your agent"],
                body: "Waking your agent…",
              })
            ),
          onActivity: (line) =>
            setNotifications((prev) => {
              const current = prev.find((n) => n.id === id);
              if (!current || current.status !== "running") return prev;
              const activity = [...current.activity, line];
              return patchNotification(prev, id, {
                activity,
                body: truncateBody(line),
              });
            }),
        });

        const res = await api.getFeedPosts({ limit: 50 });
        const count = res.posts.length;
        if (count === 0) {
          const message = FEED_REFRESH_FAILED;
          setNotifications((prev) =>
            patchNotification(prev, id, {
              status: "error",
              title: "Couldn't build your feed",
              body: message,
              error: message,
              focused: true,
              read: false,
            })
          );
          showToast({
            id,
            title: "Feed build failed",
            body: message,
            tone: "error",
          });
          return;
        }

        const when = new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        const body =
          count === 1
            ? `1 story ready · ${when}`
            : `${count} stories ready · ${when}`;
        setNotifications((prev) => {
          const patched = patchNotification(prev, id, {
            status: "done",
            title: "Your feed is ready",
            body,
            error: null,
            focused: false,
            read: false,
            postCount: count,
            activity: [],
          });
          if (!patched.some((n) => n.id === id)) {
            return [
              {
                id,
                kind: "feed_build" as const,
                title: "Your feed is ready",
                body,
                status: "done" as const,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                read: false,
                focused: false,
                activity: [],
                topicLabel,
                runKey: 0,
                startedAt: Date.now(),
                error: null,
                postCount: count,
              },
              ...patched,
            ].slice(0, MAX_NOTIFICATIONS);
          }
          return patched;
        });
        setFeedRevision((n) => n + 1);
        showToast({
          id,
          title: "Your feed is ready",
          body,
          tone: "success",
        });
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError" || /aborted/i.test(err.message)) {
          setNotifications((prev) =>
            patchNotification(prev, id, {
              status: "cancelled",
              title: "Feed build cancelled",
              body: "You stopped this build.",
              focused: false,
              read: true,
            })
          );
          return;
        }
        const message = toUserFacingError(err.message, FEED_REFRESH_FAILED);
        setNotifications((prev) =>
          patchNotification(prev, id, {
            status: "error",
            title: "Couldn't build your feed",
            body: message,
            error: message,
            focused: true,
            read: false,
          })
        );
        showToast({
          id,
          title: "Feed build failed",
          body: message,
          tone: "error",
        });
      } finally {
        abortById.current.delete(id);
        feedInFlight.current = false;
        void topicLabel;
      }
    },
    [showToast]
  );

  const runWritingQueueJob = useCallback(
    async (id: string, opts: StartWritingQueueOpts) => {
      abortById.current.get(id)?.abort();
      const controller = new AbortController();
      abortById.current.set(id, controller);
      writingInFlight.current = true;

      try {
        const { freshFindings } = await api.runWritingQueue({
          postId: opts.postId,
          postTitle: opts.postTitle,
          taskCount: opts.taskCount,
          signal: controller.signal,
          onWarming: () =>
            setNotifications((prev) =>
              patchNotification(prev, id, {
                activity: ["Waking your agent"],
                body: "Waking your agent…",
              })
            ),
          onActivity: (line) =>
            setNotifications((prev) => {
              const current = prev.find((n) => n.id === id);
              if (!current || current.status !== "running") return prev;
              const activity = [...current.activity, line];
              return patchNotification(prev, id, {
                activity,
                body: truncateBody(line),
              });
            }),
        });

        const when = new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });

        if (freshFindings === 0) {
          const title = "No new findings";
          const body = `Agent finished, but nothing new was saved · ${when}`;
          setNotifications((prev) =>
            patchNotification(prev, id, {
              status: "done",
              title,
              body,
              error: null,
              focused: false,
              read: false,
              activity: [],
            })
          );
          setWritingRevision((v) => v + 1);
          showToast({ id, title, body, tone: "info" });
          return;
        }

        const body =
          freshFindings === 1
            ? `1 new finding saved · ${when}`
            : `${freshFindings} new findings saved · ${when}`;
        setNotifications((prev) =>
          patchNotification(prev, id, {
            status: "done",
            title: "Queue research done",
            body,
            error: null,
            focused: false,
            read: false,
            activity: [],
          })
        );
        setWritingRevision((v) => v + 1);
        showToast({
          id,
          title: "Queue research done",
          body,
          tone: "success",
        });
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError" || /aborted/i.test(err.message)) {
          setNotifications((prev) =>
            patchNotification(prev, id, {
              status: "cancelled",
              title: "Queue run cancelled",
              body: "You stopped this queue run.",
              focused: false,
              read: true,
            })
          );
          return;
        }
        const message = toUserFacingError(
          err.message,
          "Couldn't start your agent on the queue. Please try again."
        );
        setNotifications((prev) =>
          patchNotification(prev, id, {
            status: "error",
            title: "Couldn't finish the queue",
            body: message,
            error: message,
            focused: true,
            read: false,
          })
        );
        showToast({
          id,
          title: "Queue run failed",
          body: message,
          tone: "error",
        });
      } finally {
        abortById.current.delete(id);
        writingInFlight.current = false;
      }
    },
    [showToast]
  );

  const startFeedRefresh = useCallback(
    (opts?: StartFeedOpts) => {
      if (feedInFlight.current) return;
      feedInFlight.current = true;

      const id = makeId();
      const topicLabel = opts?.topicLabel?.trim() || undefined;
      const now = Date.now();
      const next: AppNotification = {
        id,
        kind: "feed_build",
        title: "Building your feed",
        body: topicLabel
          ? `Finding stories about ${topicLabel}`
          : "Finding stories matched to your interests",
        status: "running",
        createdAt: now,
        updatedAt: now,
        read: true,
        focused: true,
        activity: [],
        topicLabel,
        runKey: 0,
        startedAt: now,
        error: null,
      };

      setNotifications((prev) => {
        const kept = prev.map((n) =>
          n.kind === "feed_build" && n.status === "running"
            ? {
                ...n,
                status: "cancelled" as const,
                title: "Feed build cancelled",
                body: "Superseded by a newer build.",
                focused: false,
                read: true,
                updatedAt: now,
              }
            : n.kind === "feed_build"
              ? { ...n, focused: false }
              : n
        );
        return [next, ...kept.filter((n) => n.id !== id)].slice(0, MAX_NOTIFICATIONS);
      });

      void runFeedJob(id, topicLabel);
    },
    [runFeedJob]
  );

  const startWritingQueue = useCallback(
    (opts: StartWritingQueueOpts) => {
      if (writingInFlight.current) return;
      writingInFlight.current = true;

      const id = makeId();
      const now = Date.now();
      const titleSnippet =
        opts.postTitle.trim().length > 42
          ? `${opts.postTitle.trim().slice(0, 42)}…`
          : opts.postTitle.trim() || "Untitled";
      const n = opts.taskCount;
      const next: AppNotification = {
        id,
        kind: "writing_queue",
        title: "Researching your queue",
        body:
          n === 1
            ? `Working 1 task on “${titleSnippet}”`
            : `Working ${n} tasks on “${titleSnippet}”`,
        status: "running",
        createdAt: now,
        updatedAt: now,
        read: true,
        focused: true,
        activity: [],
        postId: opts.postId,
        postTitle: opts.postTitle,
        taskCount: opts.taskCount,
        runKey: 0,
        startedAt: now,
        error: null,
      };

      setNotifications((prev) => {
        const kept = prev.map((n) =>
          n.kind === "writing_queue" && n.status === "running"
            ? {
                ...n,
                status: "cancelled" as const,
                title: "Queue run cancelled",
                body: "Superseded by a newer queue run.",
                focused: false,
                read: true,
                updatedAt: now,
              }
            : n.kind === "writing_queue"
              ? { ...n, focused: false }
              : n
        );
        return [next, ...kept.filter((row) => row.id !== id)].slice(0, MAX_NOTIFICATIONS);
      });

      void runWritingQueueJob(id, opts);
    },
    [runWritingQueueJob]
  );

  const runDiscussJob = useCallback(
    async (id: string, opts: StartFeedDiscussOpts) => {
      abortById.current.get(id)?.abort();
      const controller = new AbortController();
      abortById.current.set(id, controller);
      discussInFlight.current.add(opts.postId);

      try {
        await api.sendFeedDiscuss({
          postId: opts.postId,
          message: opts.message,
          signal: controller.signal,
          onWarming: () =>
            setNotifications((prev) =>
              patchNotification(prev, id, {
                activity: ["Waking your agent"],
                body: "Waking your agent…",
                streamingReply: "",
              })
            ),
          onChunk: (_chunk, full) =>
            setNotifications((prev) =>
              patchNotification(prev, id, {
                streamingReply: full,
                body: "Musely agent is typing…",
                activity: ["Musely agent is typing…"],
              })
            ),
        });

        const when = new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        const titleSnippet =
          opts.postTitle.trim().length > 42
            ? `${opts.postTitle.trim().slice(0, 42)}…`
            : opts.postTitle.trim() || "this story";
        const title = "Your agent replied";
        const body = `About “${titleSnippet}” · ${when}`;
        setNotifications((prev) =>
          patchNotification(prev, id, {
            status: "done",
            title,
            body,
            error: null,
            focused: false,
            read: false,
            activity: [],
            streamingReply: "",
          })
        );
        setDiscussRevision((v) => v + 1);
        showToast({ id, title, body, tone: "success" });
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError" || /aborted/i.test(err.message)) {
          setNotifications((prev) =>
            patchNotification(prev, id, {
              status: "cancelled",
              title: "Discussion cancelled",
              body: "You stopped this reply.",
              focused: false,
              read: true,
              streamingReply: "",
            })
          );
          return;
        }
        const message = toUserFacingError(
          err.message,
          "Couldn't get a reply from your agent. Please try again."
        );
        setNotifications((prev) =>
          patchNotification(prev, id, {
            status: "error",
            title: "Discussion failed",
            body: message,
            error: message,
            focused: true,
            read: false,
            streamingReply: "",
          })
        );
        showToast({
          id,
          title: "Discussion failed",
          body: message,
          tone: "error",
        });
      } finally {
        abortById.current.delete(id);
        discussInFlight.current.delete(opts.postId);
      }
    },
    [showToast]
  );

  const startFeedDiscuss = useCallback(
    (opts: StartFeedDiscussOpts) => {
      const message = opts.message.trim();
      if (!message) return;
      if (discussInFlight.current.has(opts.postId)) return;

      const id = makeId();
      const now = Date.now();
      const titleSnippet =
        opts.postTitle.trim().length > 36
          ? `${opts.postTitle.trim().slice(0, 36)}…`
          : opts.postTitle.trim() || "Feed item";
      const next: AppNotification = {
        id,
        kind: "feed_discuss",
        title: "Discussing with your agent",
        body: `About “${titleSnippet}”`,
        status: "running",
        createdAt: now,
        updatedAt: now,
        read: true,
        focused: true,
        activity: ["Musely agent is typing…"],
        postId: opts.postId,
        postTitle: opts.postTitle,
        userMessage: message,
        streamingReply: "",
        runKey: 0,
        startedAt: now,
        error: null,
      };

      setNotifications((prev) => {
        const kept = prev.map((n) =>
          n.kind === "feed_discuss" &&
          n.status === "running" &&
          n.postId === opts.postId
            ? {
                ...n,
                status: "cancelled" as const,
                title: "Discussion cancelled",
                body: "Superseded by a newer comment.",
                focused: false,
                read: true,
                updatedAt: now,
                streamingReply: "",
              }
            : n.kind === "feed_discuss" && n.postId === opts.postId
              ? { ...n, focused: false }
              : n
        );
        return [next, ...kept.filter((row) => row.id !== id)].slice(0, MAX_NOTIFICATIONS);
      });

      void runDiscussJob(id, { ...opts, message });
    },
    [runDiscussJob]
  );

  const cancelFeedJob = useCallback((id: string) => {
    abortById.current.get(id)?.abort();
    abortById.current.delete(id);
    feedInFlight.current = false;
    setNotifications((prev) =>
      patchNotification(prev, id, {
        status: "cancelled",
        title: "Feed build cancelled",
        body: "You stopped this build.",
        focused: false,
        read: true,
      })
    );
  }, []);

  const cancelWritingQueueJob = useCallback((id: string) => {
    abortById.current.get(id)?.abort();
    abortById.current.delete(id);
    writingInFlight.current = false;
    setNotifications((prev) =>
      patchNotification(prev, id, {
        status: "cancelled",
        title: "Queue run cancelled",
        body: "You stopped this queue run.",
        focused: false,
        read: true,
      })
    );
  }, []);

  const cancelDiscussJob = useCallback((id: string) => {
    const item = notifications.find((n) => n.id === id);
    abortById.current.get(id)?.abort();
    abortById.current.delete(id);
    if (item?.postId != null) discussInFlight.current.delete(item.postId);
    setNotifications((prev) =>
      patchNotification(prev, id, {
        status: "cancelled",
        title: "Discussion cancelled",
        body: "You stopped this reply.",
        focused: false,
        read: true,
        streamingReply: "",
      })
    );
  }, [notifications]);

  const retryFeedJob = useCallback(
    (id: string) => {
      if (feedInFlight.current) return;
      const existing = notifications.find((n) => n.id === id);
      startFeedRefresh({ topicLabel: existing?.topicLabel });
    },
    [notifications, startFeedRefresh]
  );

  const retryWritingQueueJob = useCallback(
    (id: string) => {
      if (writingInFlight.current) return;
      const existing = notifications.find((n) => n.id === id);
      if (!existing?.postId) return;
      startWritingQueue({
        postId: existing.postId,
        postTitle: existing.postTitle || "Untitled",
        taskCount: existing.taskCount || 1,
      });
    },
    [notifications, startWritingQueue]
  );

  const backgroundFeedJob = useCallback((id: string) => {
    setNotifications((prev) =>
      patchNotification(prev, id, {
        focused: false,
        body: "Running in the background — we'll notify you when it's done.",
      })
    );
  }, []);

  const focusFeedJob = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, focused: true, updatedAt: Date.now() }
          : n.kind === "feed_build" && n.status === "running"
            ? { ...n, focused: false }
            : n
      )
    );
  }, []);

  const focusWritingQueueJob = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, focused: true, updatedAt: Date.now() }
          : n.kind === "writing_queue" && n.status === "running"
            ? { ...n, focused: false }
            : n
      )
    );
  }, []);

  const focusDiscussJob = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, focused: true, updatedAt: Date.now() }
          : n.kind === "feed_discuss" && n.status === "running"
            ? { ...n, focused: false }
            : n
      )
    );
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => patchNotification(prev, id, { read: true }));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((n) => (n.read ? n : { ...n, read: true, updatedAt: Date.now() }))
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    const job = abortById.current.get(id);
    if (job) {
      job.abort();
      abortById.current.delete(id);
      const item = notifications.find((n) => n.id === id);
      if (item?.kind === "writing_queue") writingInFlight.current = false;
      else if (item?.kind === "feed_discuss") {
        if (item.postId != null) discussInFlight.current.delete(item.postId);
      } else feedInFlight.current = false;
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setToast((t) => (t?.id === id ? null : t));
  }, [notifications]);

  const focusedFeedJob =
    notifications.find(
      (n) =>
        n.kind === "feed_build" &&
        n.focused &&
        (n.status === "running" || n.status === "error")
    ) ?? null;

  const runningFeedJob =
    notifications.find((n) => n.kind === "feed_build" && n.status === "running") ?? null;

  const focusedWritingJob =
    notifications.find(
      (n) =>
        n.kind === "writing_queue" &&
        n.focused &&
        (n.status === "running" || n.status === "error")
    ) ?? null;

  const runningWritingJob =
    notifications.find((n) => n.kind === "writing_queue" && n.status === "running") ??
    null;

  const focusedDiscussJob =
    notifications.find(
      (n) =>
        n.kind === "feed_discuss" &&
        n.focused &&
        (n.status === "running" || n.status === "error" || n.status === "done")
    ) ?? null;

  const runningDiscussJob =
    notifications.find((n) => n.kind === "feed_discuss" && n.status === "running") ??
    null;

  const unreadCount = notifications.filter(
    (n) => !n.read && (n.status === "done" || n.status === "error")
  ).length;

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      focusedFeedJob,
      runningFeedJob,
      focusedWritingJob,
      runningWritingJob,
      focusedDiscussJob,
      runningDiscussJob,
      feedRevision,
      writingRevision,
      discussRevision,
      toast,
      startFeedRefresh,
      startWritingQueue,
      startFeedDiscuss,
      cancelFeedJob,
      cancelWritingQueueJob,
      cancelDiscussJob,
      retryFeedJob,
      retryWritingQueueJob,
      backgroundFeedJob,
      focusFeedJob,
      focusWritingQueueJob,
      focusDiscussJob,
      markRead,
      markAllRead,
      dismiss,
      dismissToast,
    }),
    [
      notifications,
      unreadCount,
      focusedFeedJob,
      runningFeedJob,
      focusedWritingJob,
      runningWritingJob,
      focusedDiscussJob,
      runningDiscussJob,
      feedRevision,
      writingRevision,
      discussRevision,
      toast,
      startFeedRefresh,
      startWritingQueue,
      startFeedDiscuss,
      cancelFeedJob,
      cancelWritingQueueJob,
      cancelDiscussJob,
      retryFeedJob,
      retryWritingQueueJob,
      backgroundFeedJob,
      focusFeedJob,
      focusWritingQueueJob,
      focusDiscussJob,
      markRead,
      markAllRead,
      dismiss,
      dismissToast,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return ctx;
}
