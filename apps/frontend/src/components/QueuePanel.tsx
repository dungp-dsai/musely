import { useEffect, useRef, useState } from "react";
import type { Feedback } from "../types";
import { relativeTime } from "../utils";
import { TASK_COLORS } from "../extensions/taskHighlight";
import { computeWritingQueueTimeline } from "../lib/writingQueueActivity";

export type QueueStartState = "idle" | "starting" | "working" | "error";

interface Props {
  items: Feedback[];
  open: boolean;
  selectedId: number | null;
  startState?: QueueStartState;
  startError?: string | null;
  /** Live activity lines from the notification-owned agent run. */
  progressActivity?: string[];
  progressStartedAt?: number;
  onToggle: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onMarkDone: (id: number) => void;
  onStartNow: () => void;
  onScheduleLater: () => void;
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.1-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function QueuePanel({
  items,
  open,
  selectedId,
  startState = "idle",
  startError = null,
  progressActivity = [],
  progressStartedAt,
  onToggle,
  onSelect,
  onDelete,
  onMarkDone,
  onStartNow,
  onScheduleLater,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showScheduleHint, setShowScheduleHint] = useState(false);
  const [, setTick] = useState(0);
  const busy = startState === "starting" || startState === "working";
  const pendingCount = items.filter((f) => f.status === "pending").length;

  useEffect(() => {
    if (!busy || !open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 800);
    return () => window.clearInterval(t);
  }, [busy, open]);

  const elapsed = busy ? Date.now() - (progressStartedAt || Date.now()) : 0;
  const timeline = busy
    ? computeWritingQueueTimeline(progressActivity, elapsed, false)
    : null;
  const activeLabel =
    timeline?.steps.find((s) => s.status === "active")?.label ?? null;
  const detail = timeline?.detail || null;

  useEffect(() => {
    if (!open) {
      setShowScheduleHint(false);
      return;
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.(".queue-fab")) return;
      onToggle();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onToggle]);

  useEffect(() => {
    if (items.length === 0) setShowScheduleHint(false);
  }, [items.length]);

  const startLabel =
    startState === "starting"
      ? "Waking agent…"
      : startState === "working"
        ? "Agent is on it"
        : pendingCount > 1
          ? `Start · ${pendingCount} tasks`
          : "Start agent";

  return (
    <div className="queue-wrap" ref={panelRef}>
      {open && (
        <div className="queue-panel" role="dialog" aria-label="AI queue">
          <div className="queue-panel-head">
            <div className="queue-panel-title">
              <span className="queue-panel-heading">AI queue</span>
              {items.length > 0 && (
                <span className="queue-panel-count">
                  {items.length} {items.length === 1 ? "task" : "tasks"}
                </span>
              )}
            </div>
            <button type="button" className="queue-close" onClick={onToggle}>
              close
            </button>
          </div>

          <div className="queue-panel-body">
            {items.length === 0 ? (
              <div className="queue-empty">
                <p className="queue-empty-title">Nothing queued</p>
                <p className="queue-empty-lede">
                  Highlight text in the editor and leave a task — Musely will pick it up here.
                </p>
              </div>
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
                        {f.context ? (
                          `"${f.context}"`
                        ) : (
                          <span className="muted">(whole document)</span>
                        )}
                      </div>
                    </div>
                    <div className="queue-field">
                      <span className="queue-label">Task</span>
                      <div className="queue-task">{f.content}</div>
                    </div>
                    <div className="queue-foot" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="task-hover-btn cancel sm"
                        title="Discard"
                        onClick={() => onDelete(f.id)}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className="task-hover-btn done sm"
                        title="Mark done"
                        onClick={() => onMarkDone(f.id)}
                      >
                        ✓
                      </button>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {items.length > 0 && (
            <div className="queue-panel-footer">
              {busy && (
                <div className="queue-progress" role="status" aria-live="polite">
                  <div className="queue-progress-label">
                    <span className="queue-progress-pulse" aria-hidden />
                    <strong>{activeLabel || startLabel}</strong>
                  </div>
                  {detail && <p className="queue-progress-detail">{detail}</p>}
                  <div className="queue-progress-bar" aria-hidden>
                    <span className="queue-progress-fill" />
                  </div>
                  {timeline && (
                    <ol className="queue-progress-steps">
                      {timeline.steps.map((step) => (
                        <li
                          key={step.id}
                          className={`queue-progress-step is-${step.status}`}
                        >
                          {step.label}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {startError && <p className="queue-start-error">{startError}</p>}

              {showScheduleHint ? (
                <div className="queue-schedule-hint">
                  <div className="queue-schedule-hint-top">
                    <ClockIcon />
                    <strong>Come back later</strong>
                  </div>
                  <p>
                    Set a recurring schedule and Musely Agent will work through your queue on its
                    own — then open Write when you&apos;re ready to review.
                  </p>
                  <div className="queue-schedule-hint-actions">
                    <button
                      type="button"
                      className="queue-schedule-back"
                      onClick={() => setShowScheduleHint(false)}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="queue-cta-primary"
                      onClick={() => {
                        setShowScheduleHint(false);
                        onScheduleLater();
                      }}
                    >
                      Set a schedule
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={`queue-cta-primary ${busy ? "is-busy" : ""}`}
                    onClick={onStartNow}
                    disabled={busy}
                  >
                    {busy ? (
                      <span className="queue-cta-pulse" aria-hidden />
                    ) : (
                      <PlayIcon />
                    )}
                    {startLabel}
                  </button>
                  <button
                    type="button"
                    className="queue-cta-later"
                    onClick={() => setShowScheduleHint(true)}
                    disabled={busy}
                  >
                    <ClockIcon />
                    Or schedule for later
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`queue-fab ${open ? "is-open" : ""}`}
        onClick={onToggle}
        title="AI task queue"
        aria-expanded={open}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
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
