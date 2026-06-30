import { useState, type FormEvent } from "react";
import { api, API_BASE } from "../api";

const FEATURES = [
  {
    title: "Beat the blank page",
    body: "Turn a half-formed idea into a first draft in seconds, so you start instead of stall.",
  },
  {
    title: "Stay in flow",
    body: "Sharpen sentences, restructure, and get feedback inline — without breaking your rhythm.",
  },
  {
    title: "Write more, finish more",
    body: "Track every version and let Musely carry the busywork so you keep moving forward.",
  },
];

type Status = "idle" | "loading" | "success" | "error";

type WaitlistPageProps = {
  notice?: string | null;
  onDismissNotice?: () => void;
};

export default function WaitlistPage({ notice, onDismissNotice }: WaitlistPageProps) {
  const loginUrl = `${API_BASE}/api/auth/google`;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [alreadyJoined, setAlreadyJoined] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;
    const value = email.trim();
    if (!value) {
      setStatus("error");
      setMessage("Please enter your email address.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await api.joinWaitlist(value);
      setAlreadyJoined(res.alreadyJoined);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message || "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="wl-page">
      <div className="wl-glow" aria-hidden />
      <header className="wl-topbar">
        <div className="wl-brand">
          <span className="wl-brand-mark">M</span>
          <span className="wl-brand-name">Musely</span>
        </div>
        <a className="wl-signin" href={loginUrl}>
          Sign in
        </a>
      </header>

      {notice && (
        <div className="wl-notice" role="alert">
          <span>{notice}</span>
          {onDismissNotice && (
            <button type="button" className="wl-notice-close" onClick={onDismissNotice} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      )}

      <main className="wl-main">
        <span className="wl-eyebrow">Now in private beta</span>
        <h1 className="wl-title">
          Write more,<br />
          <span className="wl-title-accent">with a little help.</span>
        </h1>
        <p className="wl-lede">
          Musely is your writing companion — it helps you beat the blank page, stay in flow,
          and actually finish what you start. Join the waiting list to get early access.
        </p>

        {status === "success" ? (
          <div className="wl-success" role="status">
            <div className="wl-success-check" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div>
              <h2 className="wl-success-title">
                {alreadyJoined ? "You're already on the list" : "You're on the list!"}
              </h2>
              <p className="wl-success-body">
                {alreadyJoined
                  ? "Good news — this email is already saved. We'll reach out the moment your spot is ready."
                  : "We just sent a confirmation to your inbox. We'll email you the moment your spot opens up."}
              </p>
            </div>
          </div>
        ) : (
          <form className="wl-form" onSubmit={submit} noValidate>
            <div className={`wl-field ${status === "error" ? "wl-field-error" : ""}`}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                className="wl-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                aria-label="Email address"
                disabled={status === "loading"}
              />
              <button type="submit" className="wl-submit" disabled={status === "loading"}>
                {status === "loading" ? "Joining…" : "Join the waiting list"}
              </button>
            </div>
            {status === "error" && <p className="wl-error">{message}</p>}
            <p className="wl-hint">No spam. One email when it's your turn.</p>
          </form>
        )}

        <ul className="wl-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="wl-feature">
              <h3 className="wl-feature-title">{f.title}</h3>
              <p className="wl-feature-body">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="wl-footer">
        <span>© {new Date().getFullYear()} Musely</span>
        <a href="mailto:support@musely.tech">support@musely.tech</a>
      </footer>
    </div>
  );
}
