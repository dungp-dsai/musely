import { useState } from "react";
import { api, type User } from "../api";

interface Props {
  user: User;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export default function ProfilePage({
  user,
  onBack,
  onSaved,
  onOpenSettings,
  onLogout,
}: Props) {
  const [interests, setInterests] = useState(user.topics?.interests ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = interests.trim() !== (user.topics?.interests ?? "").trim();

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.completeOnboarding({ interests: interests.trim(), write: [], read: [] });
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-shell profile-shell">
      <header className="settings-header">
        <button type="button" className="settings-back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1>Profile</h1>
          <p className="settings-sub">Your account and personalization</p>
        </div>
      </header>

      <div className="profile-body">
        <section className="profile-section">
          <h2 className="profile-section-title">Account</h2>
          <div className="profile-card profile-account">
            <span className="home-avatar profile-avatar">
              {user.picture ? <img src={user.picture} alt="" /> : (user.name[0] || "?").toUpperCase()}
            </span>
            <div className="profile-account-text">
              <div className="profile-account-name">{user.name}</div>
              <div className="profile-account-email">{user.email}</div>
            </div>
          </div>
        </section>

        <section className="profile-section">
          <h2 className="profile-section-title">Personalization</h2>
          <div className="profile-card">
            <label className="profile-field-label" htmlFor="profile-interests">
              What do you want to read and write about?
            </label>
            <p className="profile-field-hint">
              Used only to personalize your feed and agent. Be as specific as you like.
            </p>
            <textarea
              id="profile-interests"
              className="ob-textarea"
              value={interests}
              onChange={(e) => {
                setInterests(e.target.value);
                setSaved(false);
              }}
              rows={6}
              maxLength={4000}
            />
            {error && <p className="ob-error">{error}</p>}
            <div className="profile-save-row">
              {saved && !dirty && <span className="profile-saved">Saved ✓</span>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </section>

        <section className="profile-section">
          <h2 className="profile-section-title">Your agent</h2>
          <div className="profile-card profile-links">
            <button type="button" className="profile-link" onClick={onOpenSettings}>
              <span>
                <span className="profile-link-title">Scheduled tasks</span>
                <span className="profile-link-sub">Automate recurring work with cron</span>
              </span>
              <span className="profile-link-arrow" aria-hidden>→</span>
            </button>
          </div>
        </section>

        <section className="profile-section">
          <button type="button" className="btn btn-ghost danger profile-signout" onClick={onLogout}>
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
