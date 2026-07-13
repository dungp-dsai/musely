import { useEffect, useRef, useState } from "react";
import { computeFeedTimeline } from "../lib/feedActivity";
import { useNotifications } from "../notifications/NotificationContext";
import type { AppNotification } from "../notifications/types";
import { relativeTime } from "../utils";

type Props = {
  onOpenFeed?: () => void;
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
  const elapsed =
    item.status === "running"
      ? Date.now() - (item.startedAt || item.createdAt)
      : 0;
  const timeline =
    item.status === "running"
      ? computeFeedTimeline(item.activity, elapsed, false)
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

export function NotificationToastHost({ onOpenFeed }: Props) {
  const { notifications, toast, dismissToast, markRead, focusFeedJob } =
    useNotifications();

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => dismissToast(), 6500);
    return () => window.clearTimeout(t);
  }, [toast, dismissToast]);

  if (!toast) return null;

  const handleToastClick = () => {
    const item = notifications.find((n) => n.id === toast.id);
    dismissToast();
    onOpenFeed?.();
    if (!item) return;
    markRead(item.id);
    if (item.status === "running" || item.status === "error") {
      focusFeedJob(item.id);
    }
  };

  return (
    <div className={`noti-toast tone-${toast.tone}`} role="status">
      <button type="button" className="noti-toast-main" onClick={handleToastClick}>
        <StatusDot status={toast.tone === "success" ? "done" : "error"} />
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

export default function NotificationCenter({ onOpenFeed }: Props) {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    focusFeedJob,
    cancelFeedJob,
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
    if (item.status === "running") {
      focusFeedJob(item.id);
      onOpenFeed?.();
      setOpen(false);
      return;
    }
    if (item.status === "done" || item.status === "error") {
      onOpenFeed?.();
      if (item.status === "error") focusFeedJob(item.id);
      setOpen(false);
    }
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
                Long-running tasks like building your feed will show up here.
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
                    if (item.status === "running") cancelFeedJob(item.id);
                    else dismiss(item.id);
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
