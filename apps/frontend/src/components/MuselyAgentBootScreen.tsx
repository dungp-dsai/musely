import type { User } from "../api";

type Props = {
  user: User;
  error?: string | null;
  onRetry?: () => void;
};

export default function MuselyAgentBootScreen({ user, error, onRetry }: Props) {
  const firstName = user.name?.split(/\s+/)[0];
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">M</div>
        <h1>Starting your Musely agent</h1>
        <p className="login-loading">
          {error ||
            (firstName
              ? `Setting up Musely Agent for ${firstName}.`
              : "Setting up your personal Musely agent.")}
        </p>
        {error && onRetry && (
          <button type="button" className="admin-btn admin-btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
