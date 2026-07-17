import { useCallback, useEffect, useState } from "react";
import { api, type User } from "../api";
import { FEED_REFRESH_FAILED, toUserFacingError } from "../lib/userFacingErrors";
import { useNotifications } from "../notifications/NotificationContext";
import type { FeedPost } from "../types";
import FeedCard from "./FeedCard";
import FeedBuildingScreen from "./FeedBuildingScreen";

interface Props {
  user: User;
  /** Open discuss for this feed post (from notification deep-link). */
  discussPostId?: number | null;
  onDiscussPostHandled?: () => void;
}

export default function FeedView({ user, discussPostId, onDiscussPostHandled }: Props) {
  const [items, setItems] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiscussPostId, setOpenDiscussPostId] = useState<number | null>(null);
  const [discussOpenNonce, setDiscussOpenNonce] = useState(0);
  const {
    focusedFeedJob,
    runningFeedJob,
    feedRevision,
    startFeedRefresh,
    cancelFeedJob,
    retryFeedJob,
    backgroundFeedJob,
    focusFeedJob,
  } = useNotifications();

  const load = useCallback(async () => {
    const res = await api.getFeedPosts({ limit: 50 });
    setItems(res.posts);
    return res.posts;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(toUserFacingError((e as Error).message, FEED_REFRESH_FAILED));
        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (feedRevision === 0) return;
    void load().catch(() => {
      /* keep current list */
    });
  }, [feedRevision, load]);

  // Explicit deep-link only (notification click). Do not open from persisted
  // focusedDiscussJob — that auto-popped the modal on every refresh.
  useEffect(() => {
    if (discussPostId == null) return;
    setOpenDiscussPostId(discussPostId);
    setDiscussOpenNonce((n) => n + 1);
    onDiscussPostHandled?.();
  }, [discussPostId, onDiscussPostHandled]);

  useEffect(() => {
    if (openDiscussPostId == null || !items?.length) return;
    const el = document.getElementById(`feed-post-${openDiscussPostId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [openDiscussPostId, discussOpenNonce, items]);

  const closeDiscuss = useCallback(() => {
    setOpenDiscussPostId(null);
  }, []);

  const firstName = user.name?.split(/\s+/)[0]?.trim();
  const interests = (user.topics?.interests ?? "").trim();
  const readTopics = user.topics?.read ?? [];
  const writeTopics = user.topics?.write ?? [];
  const topicChips = Array.from(
    new Set([...readTopics, ...writeTopics].map((t) => t.trim()).filter(Boolean))
  ).slice(0, 6);
  const topicLabel = interests
    ? interests.length > 90
      ? `${interests.slice(0, 90)}…`
      : interests
    : readTopics.length
      ? readTopics.join(", ")
      : "your interests";

  const startRefresh = () => {
    setError(null);
    startFeedRefresh({ topicLabel });
  };

  const displayError = error ? toUserFacingError(error, FEED_REFRESH_FAILED) : null;

  const backgroundBanner =
    runningFeedJob && !focusedFeedJob ? (
      <div className="feed-bg-banner" role="status">
        <div className="feed-bg-banner-copy">
          <span className="feed-bg-banner-pulse" aria-hidden />
          <div>
            <strong>Building your feed in the background</strong>
            <p>{runningFeedJob.body}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={() => focusFeedJob(runningFeedJob.id)}
        >
          View progress
        </button>
      </div>
    ) : null;

  if (focusedFeedJob) {
    return (
      <FeedBuildingScreen
        activity={focusedFeedJob.activity}
        error={focusedFeedJob.error ?? null}
        onRetry={() => retryFeedJob(focusedFeedJob.id)}
        onCancel={() => cancelFeedJob(focusedFeedJob.id)}
        onBackground={
          focusedFeedJob.status === "running"
            ? () => backgroundFeedJob(focusedFeedJob.id)
            : undefined
        }
        topicLabel={focusedFeedJob.topicLabel ?? topicLabel}
        runKey={focusedFeedJob.runKey}
        startedAt={focusedFeedJob.startedAt}
      />
    );
  }

  if (items === null) {
    return (
      <div className="feed-wrap">
        <div className="feed-loading">Loading your feed…</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="feed-wrap">
        {displayError && (
          <div className="error-bar" onClick={() => setError(null)}>
            {displayError}
          </div>
        )}
        {backgroundBanner}
        <div className="feed-empty">
          <div className="feed-empty-inner">
            <div className="feed-empty-mark" aria-hidden>
              <span className="feed-empty-mark-glyph">M</span>
              <span className="feed-empty-mark-ring" />
              <span className="feed-empty-mark-ring" />
            </div>

            <p className="feed-empty-eyebrow">
              {firstName ? `Welcome, ${firstName}` : "Welcome to Musely"}
            </p>
            <h1 className="feed-empty-title">Your feed is a blank page.</h1>
            <p className="feed-empty-lede">
              {topicChips.length > 0 ? (
                <>Would you like me to find stories about the topics you love?</>
              ) : (
                <>
                  Would you like me to find stories about{" "}
                  <strong>{topicLabel}</strong>?
                </>
              )}
            </p>

            {topicChips.length > 0 && (
              <div className="feed-empty-topics">
                {topicChips.map((topic, i) => (
                  <span
                    key={topic}
                    className="feed-empty-topic"
                    style={{ animationDelay: `${0.15 + i * 0.06}s` }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              className="feed-empty-cta"
              onClick={startRefresh}
              disabled={Boolean(runningFeedJob)}
            >
              <span className="feed-empty-cta-spark" aria-hidden>
                ✦
              </span>
              {runningFeedJob ? "Building…" : "Find stories for me"}
            </button>

            <p className="feed-empty-hint">
              I&apos;ll research fresh, relevant posts tuned to your interests
              — this usually takes about a minute. You can keep browsing while
              it runs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="feed-wrap">
      {displayError && (
        <div className="error-bar" onClick={() => setError(null)}>
          {displayError}
        </div>
      )}
      {backgroundBanner}

      <div className="feed-list">
        <div className="feed-toolbar">
          <div>
            <h2 className="feed-heading">Your feed</h2>
            <p className="feed-subheading">Personalized for {topicLabel}</p>
          </div>
          <div className="feed-actions">
            <button
              type="button"
              className="btn"
              onClick={startRefresh}
              disabled={Boolean(runningFeedJob)}
            >
              {runningFeedJob ? "Building…" : "Refresh"}
            </button>
          </div>
        </div>
        {items.map((post) => (
          <FeedCard
            key={post.id}
            post={post}
            discussOpenRequest={
              openDiscussPostId === post.id ? discussOpenNonce : 0
            }
            onDiscussClosed={
              openDiscussPostId === post.id ? closeDiscuss : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
