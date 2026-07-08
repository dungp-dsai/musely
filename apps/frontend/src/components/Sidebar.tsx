import { useState } from "react";
import type { PostSummary } from "../types";
import { relativeTime } from "../utils";

interface Props {
  posts: PostSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (data: { title: string; idea: string }) => void;
}

export default function Sidebar({ posts, selectedId, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    onCreate({ title: title.trim() || "Untitled", idea: "" });
    setTitle("");
    setOpen(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Your pieces</span>
        <button
          type="button"
          className={`sidebar-new-btn ${open ? "is-open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Cancel" : "New piece"}
          aria-label={open ? "Cancel" : "New piece"}
          aria-expanded={open}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="new-form">
          <input
            className="input"
            placeholder="Title for your piece"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={submit}>
            Create &amp; start writing
          </button>
        </div>
      )}

      <div className="post-list">
        {posts.length === 0 && <div className="empty-hint">No pieces yet. Start one above.</div>}
        {posts.map((p) => (
          <button
            key={p.id}
            className={`post-item ${selectedId === p.id ? "active" : ""}`}
            onClick={() => onSelect(p.id)}
          >
            <div className="post-item-title">{p.title}</div>
            <div className="post-item-meta">
              <span>v{p.version_count}</span>
              <span>·</span>
              <span>{relativeTime(p.updated_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
