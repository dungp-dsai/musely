import { useCallback, useEffect, useState } from "react";
import { api, type User } from "../api";
import type { FeedItem } from "../types";
import { relativeTime } from "../utils";

interface Props {
  user: User;
  onGoWrite: () => void;
}

export default function FeedView({ user, onGoWrite }: Props) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.getFeed());
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const interests = (user.topics?.interests ?? "").trim();
  const readTopics = user.topics?.read ?? [];
  const topicLabel = interests
    ? interests.length > 90
      ? `${interests.slice(0, 90)}…`
      : interests
      : readTopics.length
        ? readTopics.join(", ")
        : "your interests";

  const ingest = async () => {
    if (ingesting) return;
    setIngesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.ingestFeed();
      setItems(res.items);
      setNotice(
        res.source === "agent"
          ? "Your agent ingested fresh material for your topics."
          : "Added starter items. Connect an LLM key for richer, live ingestion."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  const clear = async () => {
    try {
      await api.clearFeed();
      setItems([]);
      setNotice(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (items === null) {
    return (
      <div className="feed-wrap">
        <div className="feed-loading">Loading your feed…</div>
      </div>
    );
  }

  return (
    <div className="feed-wrap">
      {error && (
        <div className="error-bar" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="feed-empty">
          <div className="feed-empty-mark" aria-hidden>📰</div>
          <h2>Your feed is empty</h2>
          <p className="feed-empty-lede">
            Do you want to ask your AI agent to ingest things in{" "}
            <strong>{topicLabel}</strong>?
          </p>
          <button
            type="button"
            className="btn btn-primary feed-ingest-btn"
            onClick={ingest}
            disabled={ingesting}
          >
            {ingesting ? "Ingesting…" : "Ask my agent to ingest my topics"}
          </button>
          {notice && <p className="feed-notice">{notice}</p>}
          <p className="feed-empty-hint">
            Or head to the <button type="button" className="link-btn" onClick={onGoWrite}>Write</button> tab to start a piece.
          </p>
        </div>
      ) : (
        <div className="feed-list">
          <div className="feed-toolbar">
            <div>
              <h2 className="feed-heading">Your feed</h2>
              <p className="feed-subheading">Personalized for {topicLabel}</p>
            </div>
            <div className="feed-actions">
              <button type="button" className="btn" onClick={ingest} disabled={ingesting}>
                {ingesting ? "Refreshing…" : "Refresh"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={clear}>
                Clear
              </button>
            </div>
          </div>
          {notice && <p className="feed-notice">{notice}</p>}
          {items.map((item) => (
            <article key={item.id} className={`feed-card ${item.kind}`}>
              <div className="feed-card-top">
                <span className={`feed-tag ${item.kind}`}>
                  {item.kind === "write" ? "Write" : "Read"}
                </span>
                {item.topic && <span className="feed-topic">{item.topic}</span>}
                <span className="feed-time">{relativeTime(item.created_at)}</span>
              </div>
              <h3 className="feed-card-title">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h3>
              {item.summary && <p className="feed-card-summary">{item.summary}</p>}
              {item.kind === "write" && (
                <button type="button" className="link-btn feed-card-cta" onClick={onGoWrite}>
                  Start writing →
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
