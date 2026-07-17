import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { useNotifications } from "../notifications/NotificationContext";
import type { FeedDiscussionMessage, FeedPost } from "../types";
import { relativeTime } from "../utils";

type Props = {
  post: FeedPost;
  onClose: () => void;
};

function renderSimpleMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const linked = line.replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    const bold = linked.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^#{1,3}\s/.test(line)) {
      return (
        <div
          key={i}
          className="feed-discuss-md-h"
          dangerouslySetInnerHTML={{ __html: bold.replace(/^#{1,3}\s/, "") }}
        />
      );
    }
    if (!line.trim()) return <div key={i} className="feed-discuss-md-gap" />;
    return (
      <p key={i} className="feed-discuss-md-p" dangerouslySetInnerHTML={{ __html: bold }} />
    );
  });
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.8L15 12 3.5 13.8z" />
    </svg>
  );
}

function CommentRow({
  role,
  name,
  time,
  timeDateTime,
  children,
  typing,
}: {
  role: "user" | "assistant";
  name: string;
  time?: string;
  timeDateTime?: string;
  children: ReactNode;
  typing?: boolean;
}) {
  return (
    <div className={`feed-discuss-msg ${role}`}>
      <div className="feed-discuss-avatar" aria-hidden>
        {role === "user" ? "You" : "M"}
      </div>
      <div className="feed-discuss-msg-body">
        <div className={`feed-discuss-bubble${typing && !children ? " typing-only" : ""}`}>
          <div className="feed-discuss-meta">
            <span className="feed-discuss-name">{name}</span>
            {typing ? (
              <span className="feed-discuss-typing-label">typing…</span>
            ) : time ? (
              <time dateTime={timeDateTime}>{time}</time>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function PostPreview({ post }: { post: FeedPost }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const hasWhy = Boolean(post.why_it_matters?.trim());
  const hasExtraSources = post.sources.length > 2;

  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [expanded]);

  useEffect(() => {
    measure();
  }, [measure, post.whats_new]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const showToggle = expanded || clamped || hasWhy || hasExtraSources;

  return (
    <article className="feed-discuss-post">
      <div className="feed-discuss-post-meta">
        <span className="feed-discuss-post-topic">{post.topic || "Feed"}</span>
        <span aria-hidden>·</span>
        <time dateTime={post.created_at}>{relativeTime(post.created_at)}</time>
      </div>
      <h3 className="feed-discuss-post-title">{post.title}</h3>

      {post.whats_new ? (
        <p
          ref={textRef}
          className={`feed-discuss-post-text${expanded ? " is-expanded" : ""}`}
        >
          {post.whats_new}
        </p>
      ) : null}

      {expanded && hasWhy ? (
        <div className="feed-discuss-post-why">
          <h4 className="feed-discuss-post-why-label">Why it matters to you</h4>
          <p className="feed-discuss-post-text is-expanded">{post.why_it_matters}</p>
        </div>
      ) : null}

      {showToggle ? (
        <button
          type="button"
          className="feed-discuss-see-more"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}

      {post.sources.length > 0 ? (
        <ul className="feed-discuss-post-sources">
          {(expanded ? post.sources : post.sources.slice(0, 2)).map((source, i) => (
            <li key={`${source.url || source.label}-${i}`}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.label}
              </a>
            </li>
          ))}
          {!expanded && hasExtraSources ? (
            <li className="feed-discuss-post-sources-more">
              +{post.sources.length - 2} more sources
            </li>
          ) : null}
        </ul>
      ) : null}
    </article>
  );
}

export default function FeedDiscussPanel({ post, onClose }: Props) {
  const {
    startFeedDiscuss,
    runningDiscussJob,
    discussRevision,
  } = useNotifications();
  const [messages, setMessages] = useState<FeedDiscussionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const jobForPost =
    runningDiscussJob?.postId === post.id ? runningDiscussJob : null;
  const sending = Boolean(jobForPost);
  const canSend = Boolean(input.trim()) && !sending;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const thread = await api.getFeedDiscuss(post.id);
      setMessages(thread.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load discussion");
    } finally {
      setLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (discussRevision === 0) return;
    void load().then(() => setPendingUser(null));
  }, [discussRevision, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingUser, jobForPost?.streamingReply, sending, loading]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setPendingUser(text);
    setError(null);
    startFeedDiscuss({
      postId: post.id,
      postTitle: post.title,
      message: text,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const showPending =
    pendingUser &&
    (!messages.length ||
      messages[messages.length - 1]?.role !== "user" ||
      messages[messages.length - 1]?.content !== pendingUser);

  const titleSnippet =
    post.title.length > 48 ? `${post.title.slice(0, 48)}…` : post.title;

  return (
    <div className="feed-discuss-overlay" onClick={onClose} role="presentation">
      <div
        className="feed-discuss-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-discuss-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="feed-discuss-head">
          <h2 id="feed-discuss-title" className="feed-discuss-head-title">
            {titleSnippet}
          </h2>
          <button
            type="button"
            className="feed-discuss-close"
            onClick={onClose}
            aria-label="Close discussion"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="feed-discuss-scroll" ref={scrollRef}>
          <PostPreview post={post} />

          <div className="feed-discuss-section-label">
            Discussion
            {messages.length > 0 ? (
              <span className="feed-discuss-count">{messages.length}</span>
            ) : null}
          </div>

          {loading && <p className="feed-discuss-status">Loading comments…</p>}
          {error && <p className="feed-discuss-error">{error}</p>}

          {!loading && messages.length === 0 && !pendingUser && (
            <p className="feed-discuss-empty">
              Be the first to comment — your Musely agent will reply here.
            </p>
          )}

          <div className="feed-discuss-thread">
            {messages.map((m) => (
              <CommentRow
                key={m.id}
                role={m.role}
                name={m.role === "user" ? "You" : "Musely Agent"}
                time={relativeTime(m.created_at)}
                timeDateTime={m.created_at}
              >
                <div className="feed-discuss-text">{renderSimpleMarkdown(m.content)}</div>
              </CommentRow>
            ))}

            {showPending && (
              <CommentRow role="user" name="You" time="just now">
                <div className="feed-discuss-text">
                  <p className="feed-discuss-md-p">{pendingUser}</p>
                </div>
              </CommentRow>
            )}

            {sending && (
              <CommentRow role="assistant" name="Musely Agent" typing>
                {jobForPost?.streamingReply ? (
                  <div className="feed-discuss-text">
                    {renderSimpleMarkdown(jobForPost.streamingReply)}
                  </div>
                ) : (
                  <div className="feed-discuss-typing" aria-label="Musely agent is typing">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </CommentRow>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <footer className="feed-discuss-composer">
          <div className="feed-discuss-avatar feed-discuss-composer-avatar" aria-hidden>
            You
          </div>
          <div className="feed-discuss-composer-shell">
            <textarea
              ref={inputRef}
              className="feed-discuss-input"
              rows={1}
              placeholder="Write a comment…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <button
              type="button"
              className="feed-discuss-send"
              onClick={send}
              disabled={!canSend}
              aria-label="Post comment"
            >
              <SendIcon />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
