import { useEffect, useRef } from "react";
import type { Feedback } from "../types";
import { relativeTime } from "../utils";
import { TASK_COLORS } from "../extensions/taskHighlight";

interface Props {
  items: Feedback[];
  open: boolean;
  selectedId: number | null;
  onToggle: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onMarkDone: (id: number) => void;
}

export default function QueuePanel({
  items,
  open,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onMarkDone,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.(".queue-fab")) return;
      onToggle();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onToggle]);

  return (
    <div className="queue-wrap" ref={panelRef}>
      {open && (
        <div className="queue-panel">
          <div className="queue-panel-head">
            <span>AI queue</span>
            <button className="link-btn" onClick={onToggle}>
              close
            </button>
          </div>
          {items.length === 0 ? (
            <div className="empty-hint small">Nothing queued. Highlight text in the editor to add a task.</div>
          ) : (
            items.map((f) => {
              const color = TASK_COLORS[f.id % TASK_COLORS.length];
              const selected = selectedId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`queue-item ${f.status}${selected ? " selected" : ""}`}
                  onClick={() => onSelect(f.id)}
                >
                  <div className="queue-item-top">
                    <span
                      className="queue-color-dot"
                      style={{ background: color.bg, borderColor: color.border }}
                      title={color.label}
                    />
                    <span className={`status-pill ${f.status}`}>
                      {f.status === "in_progress" ? "in progress" : f.status}
                    </span>
                    <span className="muted tiny">{relativeTime(f.created_at)}</span>
                  </div>
                  <div className="queue-field">
                    <span className="queue-label">Context</span>
                    <div className="queue-context" style={{ borderLeftColor: color.border }}>
                      {f.context ? `"${f.context}"` : <span className="muted">(whole document)</span>}
                    </div>
                  </div>
                  <div className="queue-field">
                    <span className="queue-label">Task</span>
                    <div className="queue-task">{f.content}</div>
                  </div>
                  <div className="queue-foot" onClick={(e) => e.stopPropagation()}>
                    <button className="task-hover-btn cancel sm" title="Skip" onClick={() => onDelete(f.id)}>
                      ✕
                    </button>
                    <button className="task-hover-btn done sm" title="Mark done" onClick={() => onMarkDone(f.id)}>
                      ✓
                    </button>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
      <button className="queue-fab" onClick={onToggle} title="AI task queue">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </svg>
        {items.length > 0 && <span className="queue-badge">{items.length}</span>}
      </button>
    </div>
  );
}
