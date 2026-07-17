import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useNotifications } from "../notifications/NotificationContext";
import type { FeedDiscussionMessage, FeedPost } from "../types";
import { relativeTime } from "../utils";
import DiscussModal from "./discuss/DiscussModal";
import {
  DiscussComment,
  DiscussTypingDots,
  renderDiscussMarkdown,
} from "./discuss/DiscussPrimitives";

type Props = {
  post: FeedPost;
  onClose: () => void;
};

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
  const { startFeedDiscuss, runningDiscussJob, discussRevision } = useNotifications();
  const [messages, setMessages] = useState<FeedDiscussionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

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
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingUser, jobForPost?.streamingReply, sending, loading]);

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

  const showPending =
    pendingUser &&
    (!messages.length ||
      messages[messages.length - 1]?.role !== "user" ||
      messages[messages.length - 1]?.content !== pendingUser);

  const titleSnippet =
    post.title.length > 48 ? `${post.title.slice(0, 48)}…` : post.title;

  return (
    <DiscussModal
      title={titleSnippet}
      onClose={onClose}
      context={<PostPreview post={post} />}
      messageCount={messages.length}
      loading={loading}
      loadingLabel="Loading comments…"
      error={error}
      empty={
        !loading && messages.length === 0 && !pendingUser ? (
          <p className="feed-discuss-empty">
            Be the first to comment — your Musely agent will reply here.
          </p>
        ) : null
      }
      input={input}
      onInputChange={setInput}
      onSend={send}
      sending={sending}
      endRef={endRef}
    >
      {messages.map((m) => (
        <DiscussComment
          key={m.id}
          role={m.role}
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
          {jobForPost?.streamingReply ? (
            <div className="feed-discuss-text">
              {renderDiscussMarkdown(jobForPost.streamingReply)}
            </div>
          ) : (
            <DiscussTypingDots />
          )}
        </DiscussComment>
      )}
    </DiscussModal>
  );
}
