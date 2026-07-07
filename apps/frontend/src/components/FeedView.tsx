import { useCallback, useEffect, useRef, useState } from "react";
import { api, type User } from "../api";
import type { MuselyAgentBootPhase } from "../hooks/useMuselyAgentBoot";
import { FEED_REFRESH_FAILED, toUserFacingError } from "../lib/userFacingErrors";
import type { FeedPost } from "../types";
import FeedCard from "./FeedCard";
import MuselyAgentBootScreen, { type BootScreenContent } from "./MuselyAgentBootScreen";

interface Props {
  user: User;
}

const FEED_BOOT_CONTENT: BootScreenContent = {
  title: "Building your feed",
  lead: "Your agent is finding stories matched to your interests.",
  sub: "This may take a minute.",
  statusChecking: "Connecting to your agent",
  statusPreparing: "Curating your feed",
  progressAriaLabel: "Feed refresh progress",
  errorTitle: "Couldn't refresh your feed",
};

export default function FeedView({ user }: Props) {
  const [items, setItems] = useState<FeedPost[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bootPhase, setBootPhase] = useState<MuselyAgentBootPhase>("checking");
  const [bootKey, setBootKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const res = await api.getFeedPosts({ limit: 50 });
    setItems(res.posts);
    return res.posts;
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRefreshing(true);
    setError(null);
    setBootPhase("checking");

    try {
      await api.refreshFeed({
        signal: controller.signal,
        onWarming: () => setBootPhase("preparing"),
      });
      const posts = await load();
      if (posts.length === 0) {
        setError(FEED_REFRESH_FAILED);
      }
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError" && !/aborted/i.test(err.message)) {
        setError(toUserFacingError(err.message, FEED_REFRESH_FAILED));
      }
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [load]);

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

  const retryRefresh = () => {
    setBootKey((k) => k + 1);
    void refresh();
  };

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

  const displayError = error ? toUserFacingError(error, FEED_REFRESH_FAILED) : null;

  if (refreshing) {
    return (
      <MuselyAgentBootScreen
        user={user}
        phase={bootPhase}
        bootMode="wakeup"
        error={displayError}
        onRetry={retryRefresh}
        bootKey={bootKey}
        content={FEED_BOOT_CONTENT}
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
              onClick={() => void refresh()}
            >
              <span className="feed-empty-cta-spark" aria-hidden>
                ✦
              </span>
              Find stories for me
            </button>

            <p className="feed-empty-hint">
              I&apos;ll research fresh, relevant posts tuned to your interests
              — this usually takes about a minute.
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

      <div className="feed-list">
        <div className="feed-toolbar">
          <div>
            <h2 className="feed-heading">Your feed</h2>
            <p className="feed-subheading">Personalized for {topicLabel}</p>
          </div>
          <div className="feed-actions">
            <button type="button" className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </div>
        {items.map((post) => (
          <FeedCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
