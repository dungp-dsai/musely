import type { User } from "../api";
import type { MuselyAgentBootPhase } from "../hooks/useMuselyAgentBoot";

type Props = {
  user: User;
  phase?: MuselyAgentBootPhase;
  error?: string | null;
  onRetry?: () => void;
};

export default function MuselyAgentBootScreen({
  user,
  phase = "preparing",
  error,
  onRetry,
}: Props) {
  const firstName = user.name?.split(/\s+/)[0]?.trim();

  if (error) {
    return (
      <div className="boot-page">
        <div className="boot-card boot-card-error">
          <div className="boot-mark" aria-hidden>
            M
          </div>
          <h1 className="boot-title">Couldn&apos;t start your agent</h1>
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

  const statusLine =
    phase === "checking" ? "Checking your workspace" : "Provisioning your agent";

  return (
    <div className="boot-page">
      <div className="boot-card" role="status" aria-live="polite" aria-busy="true">
        <div className="boot-mark boot-mark-pulse" aria-hidden>
          M
        </div>

        <h1 className="boot-title">
          {firstName ? `Just for you, ${firstName}.` : "Just for you."}
        </h1>

        <p className="boot-lead">
          We&apos;re setting up a Musely agent only for you.
        </p>
        <p className="boot-sub">It takes a while only the first time.</p>

        <div className="boot-status">
          <span className="boot-status-text">{statusLine}</span>
          <span className="boot-ellipsis" aria-hidden>
            <span className="boot-ellipsis-dot" />
            <span className="boot-ellipsis-dot" />
            <span className="boot-ellipsis-dot" />
          </span>
        </div>

        <div className="boot-progress-track" aria-hidden>
          <div className="boot-progress-fill" />
        </div>
      </div>
    </div>
  );
}
