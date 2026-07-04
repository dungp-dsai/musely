import { useState } from "react";
import { api, type User } from "../api";
import type { UserTopics } from "../types";

interface Props {
  user: User;
  onComplete: () => Promise<void> | void;
}

const EXAMPLES = [
  "Indie hacking, bootstrapped SaaS, and the psychology of pricing",
  "Longevity research, sleep science, and evidence-based nutrition",
  "Sci-fi worldbuilding, narrative craft, and the business of self-publishing",
  "Climate tech, energy grids, and policy that actually ships",
];

export default function OnboardingPage({ user, onComplete }: Props) {
  const firstName = user.name.trim().split(/\s+/)[0] || "there";
  const [interests, setInterests] = useState<string>(user.topics?.interests ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = interests.trim();

  const submit = async () => {
    if (saving || !value) return;
    setSaving(true);
    setError(null);
    try {
      const topics: UserTopics = { interests: value, write: [], read: [] };
      await api.completeOnboarding(topics);
      await onComplete();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="ob-page">
      <div className="ob-card">
        <div className="ob-header">
          <div className="login-mark">M</div>
          <span className="ob-eyebrow">Welcome to Musely</span>
          <h1 className="ob-title">Hi {firstName} — let&apos;s personalize your space</h1>
          <p className="ob-lede">
            In your own words, what do you want to read and write about? The more specific you
            are, the better we can tune your feed and set up your personal AI agent.
          </p>
        </div>

        <div className="ob-privacy" role="note">
          <span className="ob-privacy-icon" aria-hidden>🔒</span>
          <p>
            This is collected <strong>only to personalize Musely for you</strong>. We don&apos;t
            sell or share it, and you can change it anytime in settings.
          </p>
        </div>

        <div className="ob-section">
          <label className="ob-section-title" htmlFor="ob-interests">
            What do you want to read and write about?
          </label>
          <textarea
            id="ob-interests"
            className="ob-textarea"
            placeholder="e.g. I want to write essays about product design and read about behavioral economics, AI research papers, and how small teams ship fast…"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            rows={7}
            autoFocus
            maxLength={4000}
          />
          <div className="ob-examples">
            <span className="ob-examples-label">Need inspiration?</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="ob-example"
                onClick={() => setInterests((cur) => (cur.trim() ? `${cur.trim()}\n${ex}` : ex))}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="ob-error">{error}</p>}

        <div className="ob-footer">
          <span className="ob-count">
            {value ? `${value.length} characters` : "Tell us a little to continue"}
          </span>
          <button
            type="button"
            className="btn btn-primary ob-submit"
            onClick={submit}
            disabled={saving || !value}
          >
            {saving ? "Setting up your agent…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
