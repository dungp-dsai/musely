import type { User } from "../api";

interface Props {
  user: User;
  error?: string | null;
  onRetry?: () => void;
}

export default function HermesBootScreen({ user, error, onRetry }: Props) {
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <div className="login-page">
      <div className="login-card boot-card">
        <div className="login-mark">H</div>
        {error ? (
          <>
            <h1>Couldn&apos;t start your assistant</h1>
            <p className="boot-error">{error}</p>
            {onRetry && (
              <button type="button" className="btn btn-primary boot-retry" onClick={onRetry}>
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <h1>Preparing your assistant</h1>
            <p>
              {firstName ? `Setting up Hermes for ${firstName}.` : "Setting up your personal Hermes."}
              {" "}First launch can take up to a minute.
            </p>
            <div className="boot-spinner" aria-hidden />
            <p className="login-loading">This only happens once per session.</p>
          </>
        )}
      </div>
    </div>
  );
}
