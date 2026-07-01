import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type WaitlistEntry } from "../api";

type Phase = "loading" | "login" | "ready" | "unconfigured";

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  // login form
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const loadList = useCallback(async () => {
    const { entries: list, emailConfigured: ec } = await api.adminListWaitlist();
    setEntries(list);
    setEmailConfigured(ec);
  }, []);

  const init = useCallback(async () => {
    try {
      const { authenticated, configured } = await api.adminMe();
      if (!configured) return setPhase("unconfigured");
      if (!authenticated) return setPhase("login");
      await loadList();
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("login");
    }
  }, [loadList]);

  useEffect(() => {
    init();
  }, [init]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoggingIn(true);
    try {
      await api.adminLogin(username.trim(), password);
      await loadList();
      setPhase("ready");
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await api.adminLogout().catch(() => {});
    setPhase("login");
    setEntries([]);
  };

  const toggle = async (entry: WaitlistEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      if (entry.approved) await api.adminRevoke(entry.id);
      else await api.adminApprove(entry.id);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (phase === "loading") {
    return (
      <div className="admin-page">
        <div className="admin-center">Loading…</div>
      </div>
    );
  }

  if (phase === "unconfigured") {
    return (
      <div className="admin-page">
        <div className="admin-login-card">
          <div className="admin-mark">M</div>
          <h1>Admin panel disabled</h1>
          <p className="admin-muted">
            Set <code>ADMIN_PASSWORD</code> in the backend environment to enable the admin panel.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="admin-page">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <div className="admin-mark">M</div>
          <h1>Admin sign in</h1>
          <p className="admin-muted">Manage the Musely waiting list.</p>
          {error && <div className="admin-error">{error}</div>}
          <label className="admin-label">
            Username
            <input
              className="admin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="admin-label">
            Password
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="admin-btn admin-btn-primary" type="submit" disabled={loggingIn}>
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  const approvedCount = entries.filter((e) => e.approved).length;
  const filtered = entries.filter((e) =>
    e.email.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <span className="admin-mark admin-mark-sm">M</span>
            <div>
              <h1 className="admin-title">Waiting list</h1>
              <p className="admin-sub">
                {entries.length} registered · {approvedCount} approved
              </p>
            </div>
          </div>
          <button className="admin-btn admin-btn-ghost" onClick={handleLogout}>
            Sign out
          </button>
        </header>

        {!emailConfigured && (
          <div className="admin-warn">
            Email sending is off (no <code>RESEND_API_KEY</code>). Approvals still work, but users
            won't be notified automatically.
          </div>
        )}
        {error && <div className="admin-error admin-error-bar">{error}</div>}

        <div className="admin-toolbar">
          <input
            className="admin-search"
            placeholder="Search email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="admin-btn admin-btn-ghost" onClick={() => loadList()}>
            Refresh
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="admin-empty">
            {entries.length === 0 ? "No signups yet." : "No emails match your search."}
          </div>
        ) : (
          <div className="admin-table">
            <div className="admin-row admin-row-head">
              <span>Email</span>
              <span>Joined</span>
              <span>Status</span>
              <span className="admin-cell-action">Action</span>
            </div>
            {filtered.map((entry) => (
              <div className="admin-row" key={entry.id}>
                <span className="admin-cell-email">{entry.email}</span>
                <span className="admin-cell-date">{formatDate(entry.createdAt)}</span>
                <span>
                  <span className={`admin-badge ${entry.approved ? "is-approved" : "is-pending"}`}>
                    {entry.approved ? "Approved" : "Pending"}
                  </span>
                </span>
                <span className="admin-cell-action">
                  <button
                    className={`admin-btn ${entry.approved ? "admin-btn-ghost" : "admin-btn-primary"}`}
                    onClick={() => toggle(entry)}
                    disabled={busyId === entry.id}
                  >
                    {busyId === entry.id ? "…" : entry.approved ? "Revoke" : "Approve"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
