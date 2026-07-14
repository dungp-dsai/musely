import { useEffect, useRef, useState } from "react";
import { computeFeedTimeline } from "../lib/feedActivity";
import { computeWritingQueueTimeline } from "../lib/writingQueueActivity";
import { useNotifications } from "../notifications/NotificationContext";
import type { AppNotification } from "../notifications/types";
import { relativeTime } from "../utils";

type Props = {
  onOpenFeed?: () => void;
  onOpenWriting?: (postId?: number) => void;
};

function BellIcon({ active }: { active?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={active ? "noti-bell-icon is-ringing" : "noti-bell-icon"}
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
      <path d="M10.3 20a1.7 1.7 0 0 0 3.4 0" />
    </svg>
  );
}

function StatusDot({ status }: { status: AppNotification["status"] }) {
  return <span className={`noti-dot noti-dot-${status}`} aria-hidden />;
}

function NotificationRow({
  item,
  onSelect,
  onDismiss,
}: {
  item: AppNotification;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (item.status !== "running") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 800);
    return () => window.clearInterval(t);
  }, [item.status, item.id]);

  const elapsed =
    item.status === "running"
      ? Date.now() - (item.startedAt || item.createdAt)
      : 0;
  const timeline =
    item.status === "running"
      ? item.kind === "writing_queue"
        ? computeWritingQueueTimeline(item.activity, elapsed, false)
        : computeFeedTimeline(item.activity, elapsed, false)
      : null;
  const activeLabel =
    timeline?.steps.find((s) => s.status === "active")?.label ?? null;

  return (
    <div
      className={`noti-item ${item.read ? "" : "is-unread"} ${
        item.status === "running" ? "is-running" : ""
      }`}
    >
      <button type="button" className="noti-item-main" onClick={onSelect}>
        <StatusDot status={item.status} />
        <div className="noti-item-copy">
          <div className="noti-item-title-row">
            <span className="noti-item-title">{item.title}</span>
            <span className="noti-item-time">
              {relativeTime(new Date(item.updatedAt).toISOString())}
            </span>
          </div>
          <p className="noti-item-body">
            {item.status === "running" && activeLabel
              ? activeLabel
              : item.body}
          </p>
          {item.status === "running" && (
            <div className="noti-item-progress" aria-hidden>
              <span className="noti-item-progress-fill" />
            </div>
          )}
        </div>
      </button>
      <button
        type="button"
        className="noti-item-dismiss"
        title="Dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

function openNotificationDestination(
  item: AppNotification,
  opts: {
    onOpenFeed?: () => void;
    onOpenWriting?: (postId?: number) => void;
  }
) {
  if (item.kind === "writing_queue") {
    opts.onOpenWriting?.(item.postId);
    return;
  }
  opts.onOpenFeed?.();
}

export function NotificationToastHost({ onOpenFeed, onOpenWriting }: Props) {
  const {
    notifications,
    toast,
    dismissToast,
    markRead,
    focusFeedJob,
    focusWritingQueueJob,
  } = useNotifications();

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => dismissToast(), 6500);
    return () => window.clearTimeout(t);
  }, [toast, dismissToast]);

  if (!toast) return null;

  const handleToastClick = () => {
    const item = notifications.find((n) => n.id === toast.id);
    dismissToast();
    if (!item) {
      onOpenFeed?.();
      return;
    }
    markRead(item.id);
    openNotificationDestination(item, { onOpenFeed, onOpenWriting });
    if (item.status === "running" || item.status === "error") {
      if (item.kind === "writing_queue") focusWritingQueueJob(item.id);
      else focusFeedJob(item.id);
    }
  };

  return (
    <div className={`noti-toast tone-${toast.tone}`} role="status">
      <button type="button" className="noti-toast-main" onClick={handleToastClick}>
        <StatusDot
          status={
            toast.tone === "success"
              ? "done"
              : toast.tone === "info"
                ? "cancelled"
                : "error"
          }
        />
        <div>
          <div className="noti-toast-title">{toast.title}</div>
          <div className="noti-toast-body">{toast.body}</div>
        </div>
      </button>
      <button
        type="button"
        className="noti-toast-close"
        aria-label="Dismiss"
        onClick={dismissToast}
      >
        ×
      </button>
    </div>
  );
}

export default function NotificationCenter({ onOpenFeed, onOpenWriting }: Props) {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    focusFeedJob,
    focusWritingQueueJob,
    cancelFeedJob,
    cancelWritingQueueJob,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSelect = (item: AppNotification) => {
    markRead(item.id);
    openNotificationDestination(item, { onOpenFeed, onOpenWriting });
    if (item.status === "running" || item.status === "error") {
      if (item.kind === "writing_queue") focusWritingQueueJob(item.id);
      else focusFeedJob(item.id);
    }
    setOpen(false);
  };

  return (
    <div className="noti-center" ref={ref}>
      <button
        type="button"
        className={`noti-bell ${open ? "open" : ""} ${
          unreadCount > 0 ? "has-unread" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
      >
        <BellIcon active={Boolean(notifications.some((n) => n.status === "running"))} />
        {unreadCount > 0 && (
          <span className="noti-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="noti-panel" role="dialog" aria-label="Notifications">
          <div className="noti-panel-head">
            <span className="noti-panel-title">Notifications</span>
            {notifications.length > 0 && (
              <button
                type="button"
                className="noti-panel-action"
                onClick={markAllRead}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="noti-empty">
              <p className="noti-empty-title">You&apos;re all caught up</p>
              <p className="noti-empty-body">
                Long-running tasks like building your feed or researching the
                writing queue will show up here.
              </p>
            </div>
          ) : (
            <div className="noti-list">
              {notifications.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onSelect={() => handleSelect(item)}
                  onDismiss={() => {
                    if (item.status === "running") {
                      if (item.kind === "writing_queue") {
                        cancelWritingQueueJob(item.id);
                      } else {
                        cancelFeedJob(item.id);
                      }
                    } else {
                      dismiss(item.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
