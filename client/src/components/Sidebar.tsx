import { useState } from "react";
import type { PostSummary, PostStatus } from "../types";
import type { User } from "../api";
import { relativeTime } from "../utils";

interface Props {
  posts: PostSummary[];
  selectedId: number | null;
  user: User;
  onSelect: (id: number) => void;
  onCreate: (data: { title: string; idea: string }) => void;
  onStatusChange: (id: number, status: PostStatus) => void;
  onOpenChat: () => void;
  onLogout: () => void;
}

function normalizeStatus(status: string): PostStatus {
  return status === "in_progress" ? "in_progress" : "pending";
}

export default function Sidebar({
  posts,
  selectedId,
  user,
  onSelect,
  onCreate,
  onStatusChange,
  onOpenChat,
  onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const inProgressId = posts.find((p) => normalizeStatus(p.status) === "in_progress")?.id ?? null;

  const submit = () => {
    onCreate({ title: title.trim() || "Untitled", idea: "" });
    setTitle("");
    setOpen(false);
  };

  const toggleStatus = (e: React.MouseEvent, post: PostSummary) => {
    e.stopPropagation();
    const current = normalizeStatus(post.status);
    const next: PostStatus = current === "in_progress" ? "pending" : "in_progress";
    onStatusChange(post.id, next);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">{user.picture ? <img src={user.picture} alt="" /> : "H"}</div>
        <div className="brand-text">
          <div className="brand-name">{user.name}</div>
          <div className="brand-sub">{user.email}</div>
        </div>
        <button type="button" className="btn-logout" onClick={onLogout} title="Sign out">
          Sign out
        </button>
      </div>

      <button type="button" className="hermes-chat-link" onClick={onOpenChat}>
        Chat with Hermes
      </button>

      <button className="btn btn-primary new-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ New piece"}
      </button>

      {open && (
        <div className="new-form">
          <input
            className="input"
            placeholder="Title for your piece"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <button className="btn btn-primary" onClick={submit}>
            Create &amp; start writing
          </button>
        </div>
      )}

      <div className="post-list">
        {posts.length === 0 && <div className="empty-hint">No pieces yet. Start one above.</div>}
        {posts.map((p) => {
          const status = normalizeStatus(p.status);
          const blocked =
            status === "pending" && inProgressId != null && inProgressId !== p.id;
          return (
            <button
              key={p.id}
              className={`post-item ${selectedId === p.id ? "active" : ""} ${status === "in_progress" ? "in-progress" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              <div className="post-item-row">
                <div className="post-item-title">{p.title}</div>
                <span
                  role="button"
                  tabIndex={0}
                  className={`post-status-flag ${status}${blocked ? " blocked" : ""}`}
                  title={
                    blocked
                      ? "Another piece is already In Progress"
                      : status === "in_progress"
                        ? "Click to set Pending"
                        : "Click to set In Progress"
                  }
                  onClick={(e) => toggleStatus(e, p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleStatus(e as unknown as React.MouseEvent, p);
                    }
                  }}
                >
                  {status === "in_progress" ? "In Progress" : "Pending"}
                </span>
              </div>
              <div className="post-item-meta">
                <span>v{p.version_count}</span>
                <span>·</span>
                <span>{relativeTime(p.updated_at)}</span>
                {p.pending_feedback > 0 && <span className="dot-badge">{p.pending_feedback} queued</span>}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
