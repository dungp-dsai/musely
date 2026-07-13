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

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  focusedFeedJob: AppNotification | null;
  runningFeedJob: AppNotification | null;
  feedRevision: number;
  toast: NotificationToast | null;
  startFeedRefresh: (opts?: StartFeedOpts) => void;
  cancelFeedJob: (id: string) => void;
  retryFeedJob: (id: string) => void;
  backgroundFeedJob: (id: string) => void;
  focusFeedJob: (id: string) => void;
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

function loadStoredNotifications(): AppNotification[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    if (!Array.isArray(parsed)) return [];
    // A reload can't resume an in-flight agent stream — close those out.
    return parsed.map((n) =>
      n.status === "running"
        ? {
            ...n,
            status: "cancelled" as const,
            title: "Feed build interrupted",
            body: "This build stopped when the page reloaded.",
            focused: false,
            read: true,
            updatedAt: Date.now(),
          }
        : n
    );
  } catch {
    return [];
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadStoredNotifications);
  const [feedRevision, setFeedRevision] = useState(0);
  const [toast, setToast] = useState<NotificationToast | null>(null);
  const abortById = useRef<Map<string, AbortController>>(new Map());
  const inFlight = useRef(false);

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
      inFlight.current = true;

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
                body: line.length > 72 ? `${line.slice(0, 72)}…` : line,
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
          // If the running row was lost (remount/race), still record completion.
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
        inFlight.current = false;
        void topicLabel;
      }
    },
    [showToast]
  );

  const startFeedRefresh = useCallback(
    (opts?: StartFeedOpts) => {
      if (inFlight.current) return;
      inFlight.current = true;

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
        // Keep every prior notification. Only close out a stuck running row.
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
            : { ...n, focused: false }
        );
        return [next, ...kept.filter((n) => n.id !== id)].slice(0, MAX_NOTIFICATIONS);
      });

      void runFeedJob(id, topicLabel);
    },
    [runFeedJob]
  );

  const cancelFeedJob = useCallback((id: string) => {
    abortById.current.get(id)?.abort();
    abortById.current.delete(id);
    inFlight.current = false;
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

  const retryFeedJob = useCallback(
    (id: string) => {
      if (inFlight.current) return;
      // Retry = brand-new history row (don't overwrite the failed one).
      const existing = notifications.find((n) => n.id === id);
      startFeedRefresh({ topicLabel: existing?.topicLabel });
    },
    [notifications, startFeedRefresh]
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
      inFlight.current = false;
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setToast((t) => (t?.id === id ? null : t));
  }, []);

  const focusedFeedJob =
    notifications.find(
      (n) =>
        n.kind === "feed_build" &&
        n.focused &&
        (n.status === "running" || n.status === "error")
    ) ?? null;

  const runningFeedJob =
    notifications.find((n) => n.kind === "feed_build" && n.status === "running") ??
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
      feedRevision,
      toast,
      startFeedRefresh,
      cancelFeedJob,
      retryFeedJob,
      backgroundFeedJob,
      focusFeedJob,
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
      feedRevision,
      toast,
      startFeedRefresh,
      cancelFeedJob,
      retryFeedJob,
      backgroundFeedJob,
      focusFeedJob,
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
