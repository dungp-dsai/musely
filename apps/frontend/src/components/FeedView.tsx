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
        const posts = await load();
        if (cancelled) return;
        if (posts.length === 0) {
          await refresh();
        }
      } catch (e) {
        if (!cancelled) setError(toUserFacingError((e as Error).message, FEED_REFRESH_FAILED));
        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load, refresh]);

  const retryRefresh = () => {
    setBootKey((k) => k + 1);
    void refresh();
  };

  const interests = (user.topics?.interests ?? "").trim();
  const readTopics = user.topics?.read ?? [];
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
            <p className="feed-subheading">
              {items.length === 0 ? (
                <>No posts yet for {topicLabel}</>
              ) : (
                <>Personalized for {topicLabel}</>
              )}
            </p>
          </div>
          <div className="feed-actions">
            <button type="button" className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="feed-empty">Your agent hasn&apos;t added any posts yet. Tap Refresh to try again.</p>
        ) : (
          items.map((post) => <FeedCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  );
}
