const NEVER_SHOW_KEY = "musely-feed-feedback-never-show-v2";
const LEGACY_NEVER_SHOW_KEY = "musely-feed-feedback-never-show";

/** Drop old browser flag so dev/testing can see the prompt again. */
export function clearFeedFeedbackPreferences(): void {
  try {
    localStorage.removeItem(LEGACY_NEVER_SHOW_KEY);
    localStorage.removeItem(NEVER_SHOW_KEY);
  } catch {
    /* ignore */
  }
}

export function shouldShowFeedFeedbackPrompt(): boolean {
  try {
    return localStorage.getItem(NEVER_SHOW_KEY) !== "1";
  } catch {
    return true;
  }
}

export function setNeverShowFeedFeedbackPrompt(): void {
  try {
    localStorage.setItem(NEVER_SHOW_KEY, "1");
  } catch {
    /* ignore */
  }
}
