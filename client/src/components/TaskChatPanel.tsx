import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feedback, TaskThread } from "../types";
import { api } from "../api";
import { TASK_COLORS } from "../extensions/taskHighlight";
import { relativeTime } from "../utils";

interface Props {
  taskId: number;
  feedback: Feedback;
  onClose: () => void;
  onMarkDone: (id: number) => void;
  onCancel: (id: number) => void;
}

function renderSimpleMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const linked = line.replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    const bold = linked.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const isHeading = /^#{1,3}\s/.test(line);
    if (isHeading) {
      return (
        <div
          key={i}
          className="tc-md-h"
          dangerouslySetInnerHTML={{ __html: bold.replace(/^#{1,3}\s/, "") }}
        />
      );
    }
    if (!line.trim()) return <div key={i} className="tc-md-gap" />;
    return (
      <p key={i} className="tc-md-p" dangerouslySetInnerHTML={{ __html: bold }} />
    );
  });
}

export default function TaskChatPanel({ taskId, feedback, onClose, onMarkDone, onCancel }: Props) {
  const [thread, setThread] = useState<TaskThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const color = TASK_COLORS[feedback.id % TASK_COLORS.length];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTaskThread(taskId);
      setThread(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load thread");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread?.messages, thread?.work, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError(null);

    const optimistic: TaskThread = thread
      ? {
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: -Date.now(),
              task_id: taskId,
              role: "user",
              content: text,
              created_at: new Date().toISOString(),
            },
          ],
        }
      : thread!;
    setThread(optimistic);

    try {
      const res = await api.sendTaskChat(taskId, text);
      setThread(res.thread);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
      await load();
    } finally {
      setSending(false);
    }
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return createPortal(
    <div className="task-chat-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="task-chat-modal" style={{ borderTopColor: color.border }}>
        <header className="task-chat-head">
          <div className="task-chat-head-main">
            <span className="task-chat-badge" style={{ background: color.bg, color: color.border }}>
              Task #{feedback.id}
            </span>
            <span className={`status-pill ${feedback.status}`}>
              {feedback.status === "in_progress" ? "in progress" : feedback.status}
            </span>
          </div>
          <div className="task-chat-head-actions">
            <button className="task-hover-btn cancel" title="Remove task" onClick={() => onCancel(feedback.id)}>
              ✕
            </button>
            <button className="task-hover-btn done" title="Mark done" onClick={() => onMarkDone(feedback.id)}>
              ✓
            </button>
            <button className="task-chat-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className="task-chat-context-block">
          <div className="task-chat-field">
            <span className="task-hover-label">Context</span>
            <div className="task-chat-context">"{feedback.context}"</div>
          </div>
          <div className="task-chat-field">
            <span className="task-hover-label">Task</span>
            <div className="task-chat-task">{feedback.content}</div>
          </div>
        </div>

        <div className="task-chat-body" ref={scrollRef}>
          {loading && <div className="task-chat-status">Loading AI work…</div>}
          {error && <div className="task-chat-error">{error}</div>}

          {!loading && thread && (
            <>
              {thread.work.length === 0 && thread.messages.length === 0 && !thread.report && (
                <div className="task-chat-empty">
                  <div className="task-chat-empty-icon">🔍</div>
                  <p>No AI findings yet.</p>
                  <p className="muted small">
                    Run <code>assist-dungpham</code> or ask Hermes to research this task. You can still chat below
                    to request work.
                  </p>
                </div>
              )}

              {thread.work.map((w) => (
                <div key={w.id} className="task-chat-findings">
                  <div className="task-chat-findings-head">
                    <span className="task-chat-avatar ai">H</span>
                    <div>
                      <div className="task-chat-msg-name">Hermes · Findings</div>
                      <div className="muted tiny">{relativeTime(w.created_at)}</div>
                    </div>
                  </div>
                  <div className="task-chat-findings-body">{renderSimpleMarkdown(w.result)}</div>
                </div>
              ))}

              {thread.report && (
                <div className="task-chat-report">
                  <div className="task-chat-findings-head">
                    <span className="task-chat-avatar ai">H</span>
                    <div>
                      <div className="task-chat-msg-name">
                        Hermes · Action report (v{thread.report.version_number})
                      </div>
                      <div className="muted tiny">{relativeTime(thread.report.created_at)}</div>
                    </div>
                  </div>
                  <div className="task-chat-findings-body">{renderSimpleMarkdown(thread.report.summary_action_report)}</div>
                </div>
              )}

              {thread.messages.map((m) => (
                <div key={m.id} className={`task-chat-msg ${m.role}`}>
                  <span className={`task-chat-avatar ${m.role}`}>{m.role === "user" ? "You" : "H"}</span>
                  <div className="task-chat-msg-bubble">
                    <div className="task-chat-msg-name">{m.role === "user" ? "You" : "Hermes"}</div>
                    <div className="task-chat-msg-text">{renderSimpleMarkdown(m.content)}</div>
                  </div>
                </div>
              ))}

              {sending && (
                <div className="task-chat-msg assistant">
                  <span className="task-chat-avatar ai">H</span>
                  <div className="task-chat-msg-bubble typing">
                    <div className="task-chat-msg-name">Hermes</div>
                    <div className="task-chat-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="task-chat-foot">
          <textarea
            ref={inputRef}
            className="task-chat-input"
            rows={2}
            placeholder="Ask a follow-up, request more sources, or suggest edits…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKey}
            disabled={sending || loading}
          />
          <button className="btn btn-primary task-chat-send" onClick={send} disabled={!input.trim() || sending || loading}>
            {sending ? "…" : "Send"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
