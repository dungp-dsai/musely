import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feedback, TaskThread } from "../types";
import { api } from "../api";
import { relativeTime } from "../utils";
import DiscussModal from "./discuss/DiscussModal";
import {
  DiscussComment,
  DiscussTypingDots,
  renderDiscussMarkdown,
} from "./discuss/DiscussPrimitives";

interface Props {
  taskId: number;
  feedback: Feedback;
  /** Bumps when a writing-queue job finishes so open panels refetch findings. */
  refreshKey?: number;
  onClose: () => void;
  onMarkDone: (id: number) => void;
  onCancel: (id: number) => void;
}

/** Top box: task + highlighted context only (findings live in the thread). */
function TaskContextPreview({
  thread,
  feedback,
  onMarkDone,
  onCancel,
}: {
  thread: TaskThread | null;
  feedback: Feedback;
  onMarkDone: () => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const context = feedback.context?.trim() || "";

  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [expanded]);

  useEffect(() => {
    measure();
  }, [measure, context]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <article className="feed-discuss-post">
      <div className="feed-discuss-post-meta">
        <span className="feed-discuss-post-topic">Task #{feedback.id}</span>
        <span aria-hidden>·</span>
        <span className={`feed-discuss-status-pill ${feedback.status}`}>
          {feedback.status === "in_progress" ? "in progress" : feedback.status}
        </span>
        {thread?.post?.title ? (
          <>
            <span aria-hidden>·</span>
            <span className="feed-discuss-post-meta-muted">{thread.post.title}</span>
          </>
        ) : null}
      </div>

      <h3 className="feed-discuss-post-title">{feedback.content}</h3>

      {context ? (
        <p
          ref={textRef}
          className={`feed-discuss-task-quote feed-discuss-post-text${
            expanded ? " is-expanded" : ""
          }`}
        >
          “{context}”
        </p>
      ) : null}

      {(clamped || expanded) && context ? (
        <button
          type="button"
          className="feed-discuss-see-more"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}

      {feedback.status !== "done" ? (
        <div className="feed-discuss-task-actions">
          <button
            type="button"
            className="feed-discuss-task-action done"
            onClick={onMarkDone}
          >
            Mark done
          </button>
          <button
            type="button"
            className="feed-discuss-task-action remove"
            onClick={onCancel}
          >
            Remove task
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function TaskChatPanel({
  taskId,
  feedback,
  refreshKey = 0,
  onClose,
  onMarkDone,
  onCancel,
}: Props) {
  const [thread, setThread] = useState<TaskThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTaskThread(taskId);
      setThread(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load discussion");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages, thread?.work, pendingUser, streamingReply, sending, loading]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setPendingUser(text);
    setStreamingReply("");
    setSending(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.sendTaskChat({
        taskId,
        message: text,
        signal: controller.signal,
        onChunk: (_chunk, full) => setStreamingReply(full),
      });
      setPendingUser(null);
      setStreamingReply("");
      await load();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to send message");
      await load();
      setPendingUser(null);
      setStreamingReply("");
    } finally {
      setSending(false);
    }
  };

  const work = thread?.work ?? [];
  const report = thread?.report;
  const messages = thread?.messages ?? [];
  const workCount = work.length + (report ? 1 : 0);
  const threadCount = workCount + messages.length;

  const showPending =
    pendingUser &&
    (!messages.length ||
      messages[messages.length - 1]?.role !== "user" ||
      messages[messages.length - 1]?.content !== pendingUser);

  const isEmpty =
    !loading && threadCount === 0 && !pendingUser && !sending;

  return createPortal(
    <DiscussModal
      title={`Task #${feedback.id}`}
      onClose={onClose}
      context={
        <TaskContextPreview
          thread={thread}
          feedback={feedback}
          onMarkDone={() => onMarkDone(feedback.id)}
          onCancel={() => onCancel(feedback.id)}
        />
      }
      sectionLabel="Discussion"
      messageCount={threadCount}
      loading={loading}
      loadingLabel="Loading discussion…"
      error={error}
      empty={
        isEmpty ? (
          <p className="feed-discuss-empty">
            No AI findings yet. Run the writing queue, or ask Musely to research
            this task — results will show up here as agent messages.
          </p>
        ) : null
      }
      input={input}
      onInputChange={setInput}
      onSend={() => void send()}
      sending={sending}
      placeholder="Ask a follow-up, request more sources, or suggest edits…"
      endRef={endRef}
    >
      {work.map((w, i) => (
        <DiscussComment
          key={`work-${w.id}`}
          role="assistant"
          name={
            work.length > 1
              ? `Musely Agent · Findings ${i + 1}`
              : "Musely Agent · Findings"
          }
          time={relativeTime(w.created_at)}
          timeDateTime={w.created_at}
        >
          <div className="feed-discuss-text">{renderDiscussMarkdown(w.result)}</div>
        </DiscussComment>
      ))}

      {report?.summary_action_report ? (
        <DiscussComment
          key={`report-${report.id}`}
          role="assistant"
          name={`Musely Agent · Action report (v${report.version_number})`}
          time={relativeTime(report.created_at)}
          timeDateTime={report.created_at}
        >
          <div className="feed-discuss-text">
            {renderDiscussMarkdown(report.summary_action_report)}
          </div>
        </DiscussComment>
      ) : null}

      {messages.map((m) => (
        <DiscussComment
          key={m.id}
          role={m.role === "user" ? "user" : "assistant"}
          name={m.role === "user" ? "You" : "Musely Agent"}
          time={relativeTime(m.created_at)}
          timeDateTime={m.created_at}
        >
          <div className="feed-discuss-text">{renderDiscussMarkdown(m.content)}</div>
        </DiscussComment>
      ))}

      {showPending && (
        <DiscussComment role="user" name="You" time="just now">
          <div className="feed-discuss-text">
            <p className="feed-discuss-md-p">{pendingUser}</p>
          </div>
        </DiscussComment>
      )}

      {sending && (
        <DiscussComment role="assistant" name="Musely Agent" typing>
          {streamingReply ? (
            <div className="feed-discuss-text">{renderDiscussMarkdown(streamingReply)}</div>
          ) : (
            <DiscussTypingDots />
          )}
        </DiscussComment>
      )}
    </DiscussModal>,
    document.body
  );
}
