import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeFeedTimeline,
  type FeedPhaseId,
  type FeedStepStatus,
} from "../lib/feedActivity";

type Props = {
  /** Raw breadcrumb lines streamed from the agent while it works. */
  activity: string[];
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  topicLabel?: string;
  /** Bumping this remounts the timer/animation (used on retry). */
  runKey?: number;
};

function PhaseIcon({ id }: { id: FeedPhaseId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "connect":
      return (
        <svg {...common} aria-hidden>
          <path d="M5 12.5a10 10 0 0 1 14 0" />
          <path d="M8.5 15.8a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      );
    case "preferences":
      return (
        <svg {...common} aria-hidden>
          <path d="M20.8 8.6a5 5 0 0 0-8.8-3 5 5 0 0 0-8.8 3c0 4.5 5.5 8 8.8 10 3.3-2 8.8-5.5 8.8-10Z" />
        </svg>
      );
    case "research":
      return (
        <svg {...common} aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "curate":
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3v4M12 17v4M4.2 7.2l2.8 2.8M17 14l2.8 2.8M3 12h4M17 12h4M4.2 16.8 7 14M17 10l2.8-2.8" />
        </svg>
      );
    case "save":
      return (
        <svg {...common} aria-hidden>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
      );
  }
}

function NodeMark({ status, id }: { status: FeedStepStatus; id: FeedPhaseId }) {
  if (status === "done") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="m5 12.5 4.5 4.5L19 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <PhaseIcon id={id} />;
}

export default function FeedBuildingScreen({
  activity,
  error,
  onRetry,
  onCancel,
  topicLabel,
  runKey = 0,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (error) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [error, runKey]);

  const timeline = useMemo(
    () => computeFeedTimeline(activity, elapsed, false),
    [activity, elapsed]
  );

  if (error) {
    return (
      <div className="feed-build">
        <div className="feed-build-inner feed-build-inner-error">
          <div className="feed-build-mark feed-build-mark-error" aria-hidden>
            <span className="feed-build-mark-glyph">!</span>
          </div>
          <h1 className="feed-build-title">Couldn&apos;t build your feed</h1>
          <p className="feed-build-sub">{error}</p>
          {onRetry && (
            <button type="button" className="feed-build-retry" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="feed-build">
      <div className="feed-build-inner" role="status" aria-live="polite" aria-busy="true">
        <div className="feed-build-head">
          <div className="feed-build-mark" aria-hidden>
            <span className="feed-build-mark-glyph">M</span>
            <span className="feed-build-mark-ring" />
            <span className="feed-build-mark-ring" />
          </div>
          <div>
            <h1 className="feed-build-title">Building your feed</h1>
            <p className="feed-build-sub">
              {topicLabel
                ? `Finding stories about ${topicLabel}`
                : "Finding stories matched to your interests"}
            </p>
          </div>
        </div>

        <ol className="feed-build-steps">
          {timeline.steps.map((step) => (
            <li key={step.id} className={`feed-build-step is-${step.status}`}>
              <span className="feed-build-node">
                <NodeMark status={step.status} id={step.id} />
              </span>
              <span className="feed-build-step-body">
                <span
                  className={`feed-build-step-label ${
                    step.status === "active" ? "feed-build-shimmer" : ""
                  }`}
                >
                  {step.label}
                </span>
                {step.status === "active" && (
                  <span className="feed-build-step-detail">
                    {timeline.detail || step.hint}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>

        <div className="feed-build-foot">
          <div className="feed-build-bar" aria-hidden>
            <div className="feed-build-bar-fill" />
          </div>
          <div className="feed-build-foot-row">
            <span className="feed-build-elapsed">
              {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`} ·
              usually about a minute
            </span>
            {onCancel && (
              <button type="button" className="feed-build-cancel" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
