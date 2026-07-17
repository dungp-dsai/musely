import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useNotifications } from "../notifications/NotificationContext";
import type { FeedDiscussionMessage, FeedPost } from "../types";
import { relativeTime } from "../utils";

type Props = {
  post: FeedPost;
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

export default function FeedDiscussPanel({ post }: Props) {
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

  const jobForPost =
    runningDiscussJob?.postId === post.id ? runningDiscussJob : null;
  const sending = Boolean(jobForPost);

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
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pendingUser, jobForPost?.streamingReply, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [loading]);

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

  return (
    <div className="feed-discuss">
      <div className="feed-discuss-thread" ref={scrollRef}>
        {loading && <p className="feed-discuss-status">Loading discussion…</p>}
        {error && <p className="feed-discuss-error">{error}</p>}

        {!loading && messages.length === 0 && !pendingUser && (
          <p className="feed-discuss-empty">
            Share what you think — your Musely agent will reply in this thread.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`feed-discuss-msg ${m.role}`}>
            <div className="feed-discuss-avatar" aria-hidden>
              {m.role === "user" ? "You" : "M"}
            </div>
            <div className="feed-discuss-bubble">
              <div className="feed-discuss-meta">
                <span className="feed-discuss-name">
                  {m.role === "user" ? "You" : "Musely Agent"}
                </span>
                <time dateTime={m.created_at}>{relativeTime(m.created_at)}</time>
              </div>
              <div className="feed-discuss-text">{renderSimpleMarkdown(m.content)}</div>
            </div>
          </div>
        ))}

        {showPending && (
          <div className="feed-discuss-msg user">
            <div className="feed-discuss-avatar" aria-hidden>
              You
            </div>
            <div className="feed-discuss-bubble">
              <div className="feed-discuss-meta">
                <span className="feed-discuss-name">You</span>
                <span>just now</span>
              </div>
              <div className="feed-discuss-text">
                <p className="feed-discuss-md-p">{pendingUser}</p>
              </div>
            </div>
          </div>
        )}

        {sending && (
          <div className="feed-discuss-msg assistant">
            <div className="feed-discuss-avatar" aria-hidden>
              M
            </div>
            <div className="feed-discuss-bubble">
              <div className="feed-discuss-meta">
                <span className="feed-discuss-name">Musely Agent</span>
                <span className="feed-discuss-typing-label">typing…</span>
              </div>
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
            </div>
          </div>
        )}
      </div>

      <div className="feed-discuss-composer">
        <textarea
          ref={inputRef}
          className="feed-discuss-input"
          rows={2}
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
          disabled={!input.trim() || sending}
        >
          {sending ? "…" : "Post"}
        </button>
      </div>
    </div>
  );
}
