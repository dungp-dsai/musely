import { useEffect, useState } from "react";
import { api } from "../api";
import { shouldShowFeedFeedbackPrompt } from "../lib/feedFeedbackStorage";
import type { FeedPost } from "../types";
import { relativeTime } from "../utils";
import FeedDiscussPanel from "./FeedDiscussPanel";
import FeedFeedbackModal from "./FeedFeedbackModal";

type Reaction = "up" | "down" | null;

interface Props {
  post: FeedPost;
  /** Open discuss when navigating from a discussion notification. */
  forceDiscussOpen?: boolean;
}

function ThumbUpIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function ThumbDownIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function FeedCard({ post, forceDiscussOpen }: Props) {
  const [reaction, setReaction] = useState<Reaction>(post.reaction);
  const [discussOpen, setDiscussOpen] = useState(Boolean(forceDiscussOpen));
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    if (forceDiscussOpen) setDiscussOpen(true);
  }, [forceDiscussOpen]);

  const setReactionRemote = async (next: Reaction) => {
    const prev = reaction;
    setReaction(next);
    try {
      await api.setFeedPostReaction(post.id, next);
    } catch {
      setReaction(prev);
    }
  };

  const toggleUp = () => {
    setFeedbackOpen(false);
    void setReactionRemote(reaction === "up" ? null : "up");
  };

  const toggleDown = () => {
    if (reaction === "down") {
      void setReactionRemote(null);
      setFeedbackOpen(false);
      return;
    }
    void setReactionRemote("down");
    if (shouldShowFeedFeedbackPrompt()) {
      setFeedbackOpen(true);
    }
  };

  const submitFeedback = (text: string) => {
    if (text) {
      void api.submitFeedPostFeedback(post.id, text).catch((e) => {
        console.error("[feed feedback]", e);
      });
    }
  };

  return (
    <article
      className="feed-card"
      id={`feed-post-${post.id}`}
      data-feed-post-id={post.id}
    >
      <header className="feed-card-header">
        <div className="feed-card-meta">
          <span className="feed-card-topic">{post.topic}</span>
          <span className="feed-card-dot" aria-hidden>·</span>
          <time className="feed-card-time" dateTime={post.created_at}>
            {relativeTime(post.created_at)}
          </time>
        </div>
        <h3 className="feed-card-title">{post.title}</h3>
      </header>

      <div className="feed-card-body">
        <section className="feed-card-section">
          <h4 className="feed-card-section-label">What&apos;s new</h4>
          <p className="feed-card-section-text">{post.whats_new}</p>
        </section>

        <section className="feed-card-section">
          <h4 className="feed-card-section-label">Why it matters to you</h4>
          <p className="feed-card-section-text">{post.why_it_matters}</p>
        </section>

        <section className="feed-card-section">
          <h4 className="feed-card-section-label">Sources</h4>
          <ul className="feed-card-sources">
            {post.sources.map((source, i) => (
              <li key={`${source.url || source.label}-${i}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="feed-card-footer">
        <button
          type="button"
          className={`feed-card-action ${reaction === "up" ? "active" : ""}`}
          aria-pressed={reaction === "up"}
          aria-label="Helpful"
          onClick={toggleUp}
        >
          <ThumbUpIcon active={reaction === "up"} />
          <span>Helpful</span>
        </button>
        <button
          type="button"
          className={`feed-card-action ${reaction === "down" ? "active" : ""}`}
          aria-pressed={reaction === "down"}
          aria-label="Not helpful"
          onClick={toggleDown}
        >
          <ThumbDownIcon active={reaction === "down"} />
          <span>Not helpful</span>
        </button>
        <button
          type="button"
          className={`feed-card-action ${discussOpen ? "active" : ""}`}
          aria-expanded={discussOpen}
          aria-label="Discuss"
          onClick={() => setDiscussOpen((open) => !open)}
        >
          <CommentIcon />
          <span>Discuss</span>
        </button>
      </footer>

      {discussOpen && (
        <div className="feed-card-discuss">
          <FeedDiscussPanel post={post} />
        </div>
      )}

      {feedbackOpen && (
        <FeedFeedbackModal
          postTitle={post.title}
          onClose={() => setFeedbackOpen(false)}
          onSubmit={submitFeedback}
        />
      )}
    </article>
  );
}
