import { useEffect, useState } from "react";
import type { User } from "../api";
import {
  computeBootProgress,
  type MuselyAgentBootMode,
  type MuselyAgentBootPhase,
} from "../hooks/useMuselyAgentBoot";

export type BootScreenContent = {
  title: string;
  lead: string;
  sub: string;
  statusChecking: string;
  statusPreparing: string;
  progressAriaLabel: string;
  errorTitle?: string;
};

type Props = {
  user: User;
  phase?: MuselyAgentBootPhase;
  bootMode?: MuselyAgentBootMode;
  error?: string | null;
  onRetry?: () => void;
  bootKey?: number;
  content?: BootScreenContent;
};

export default function MuselyAgentBootScreen({
  user,
  phase = "preparing",
  bootMode = "first",
  error,
  onRetry,
  bootKey = 0,
  content,
}: Props) {
  const firstName = user.name?.split(/\s+/)[0]?.trim();
  const [progress, setProgress] = useState(0);
  const isWakeup = bootMode === "wakeup";

  useEffect(() => {
    if (error) return;
    const start = Date.now();
    const tick = () => setProgress(computeBootProgress(Date.now() - start, bootMode));
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [error, bootKey, bootMode]);

  if (error) {
    return (
      <div className="boot-page">
        <div className="boot-card boot-card-error">
          <div className="boot-mark" aria-hidden>
            M
          </div>
          <h1 className="boot-title">{content?.errorTitle ?? "Couldn't start your agent"}</h1>
          <p className="boot-error">{error}</p>
          {onRetry && (
            <button type="button" className="boot-retry admin-btn admin-btn-primary" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const statusLine = content
    ? phase === "checking"
      ? content.statusChecking
      : content.statusPreparing
    : isWakeup
      ? phase === "checking"
        ? "Checking your agent"
        : "Waking up your agent"
      : phase === "checking"
        ? "Checking your workspace"
        : "Provisioning your agent";

  const progressAriaLabel = content?.progressAriaLabel ?? "Agent setup progress";

  return (
    <div className="boot-page">
      <div className="boot-card" role="status" aria-live="polite" aria-busy="true">
        <div className="boot-mark boot-mark-pulse" aria-hidden>
          M
        </div>

        {content ? (
          <>
            <h1 className="boot-title">{content.title}</h1>
            <p className="boot-lead">{content.lead}</p>
            <p className="boot-sub">{content.sub}</p>
          </>
        ) : isWakeup ? (
          <>
            <h1 className="boot-title">Waking up your AI agent</h1>
            <p className="boot-lead">It&apos;s just sleeping.</p>
            <p className="boot-sub">It won&apos;t take long.</p>
          </>
        ) : (
          <>
            <h1 className="boot-title">
              {firstName ? `Just for you, ${firstName}.` : "Just for you."}
            </h1>
            <p className="boot-lead">We&apos;re setting up a Musely agent only for you.</p>
            <p className="boot-sub">It takes a while only the first time.</p>
          </>
        )}

        <div className="boot-status">
          <span className="boot-status-text">{statusLine}</span>
          <span className="boot-ellipsis" aria-hidden>
            <span className="boot-ellipsis-dot" />
            <span className="boot-ellipsis-dot" />
            <span className="boot-ellipsis-dot" />
          </span>
        </div>

        <p className="boot-progress-pct" aria-hidden>
          {progress}%
        </p>
        <div
          className="boot-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={progressAriaLabel}
        >
          <div className="boot-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
