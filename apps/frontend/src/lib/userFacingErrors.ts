/** Short, user-safe copy — never expose agent or infra details in the UI. */

export const FEED_REFRESH_FAILED =
  "We couldn't update your feed right now. Please try again in a moment.";

export const AGENT_START_TIMEOUT =
  "Your Musely agent is taking too long to start. Please try again.";

export const AGENT_TASK_INCOMPLETE =
  "Your agent didn't finish the task. Please try again.";

const TECHNICAL_PATTERN =
  /environment variable|CLIENT_URL|AGENT_API_KEY|AGENT_USER_ID|\.env\b|provision|orchestrator|api key|llm api|request failed:\s*\d{3}|fetch failed|network error|musely agent returned/i;

const FAILURE_LANGUAGE =
  /can't proceed|cannot proceed|aren't set|not set anywhere|missing environment|couldn't proceed|couldn't research(?: the queue)?|skill requires|no inference provider|primary provider auth failed/i;

/**
 * Detect agent replies that are clearly blocked/misconfigured failures.
 * Do NOT use reply length — successful queue/feed runs often end with a long
 * confirmation after tools finish (we logged response_len=728 on a good run).
 */
export function isAgentFailureResponse(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (TECHNICAL_PATTERN.test(t)) return true;
  if (FAILURE_LANGUAGE.test(t)) return true;
  return false;
}

/** Map any error string to something safe to show end users. */
export function toUserFacingError(
  message: string | undefined | null,
  fallback = "Something went wrong. Please try again."
): string {
  const m = String(message || "").trim();
  if (!m) return fallback;
  if (m === FEED_REFRESH_FAILED || m === AGENT_START_TIMEOUT || m === AGENT_TASK_INCOMPLETE) {
    return m;
  }
  if (TECHNICAL_PATTERN.test(m)) return fallback;
  if (m.length > 160) return fallback;
  if (m.length > 80 && FAILURE_LANGUAGE.test(m)) return fallback;
  return m;
}
