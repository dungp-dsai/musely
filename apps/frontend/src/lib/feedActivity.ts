/**
 * Turns the raw text breadcrumbs the Musely agent streams while it works
 * (e.g. "🔍 Searching the web for …", "📝 Curating posts…") into a structured,
 * ordered timeline the UI can render. Pattern inspired by Open WebUI's
 * status-history: keep an ordered set of steps, shimmer the active one.
 */

export type FeedPhaseId =
  | "connect"
  | "preferences"
  | "research"
  | "curate"
  | "save";

export interface FeedPhase {
  id: FeedPhaseId;
  label: string;
  hint: string;
}

export type FeedStepStatus = "done" | "active" | "pending";

export interface FeedTimelineStep extends FeedPhase {
  status: FeedStepStatus;
}

export interface FeedTimeline {
  steps: FeedTimelineStep[];
  activeIndex: number;
  detail: string;
}

// The build-feed workflow, in order. Kept in sync with the build-feed skill.
export const FEED_PHASES: FeedPhase[] = [
  { id: "connect", label: "Waking your agent", hint: "Spinning up your private Musely agent" },
  { id: "preferences", label: "Reading your interests", hint: "Understanding what you care about" },
  { id: "research", label: "Researching the web", hint: "Scanning fresh, credible sources" },
  { id: "curate", label: "Curating the best stories", hint: "Choosing and summarizing what matters" },
  { id: "save", label: "Saving to your feed", hint: "Publishing your personalized posts" },
];

const PHASE_INDEX: Record<FeedPhaseId, number> = {
  connect: 0,
  preferences: 1,
  research: 2,
  curate: 3,
  save: 4,
};

// Ordered high-phase-first so an ambiguous line resolves to the furthest step.
const RULES: { id: FeedPhaseId; re: RegExp }[] = [
  { id: "save", re: /(sav|stor|persist|publish|upload|post(ing|ed)|feed\/posts|updat)/i },
  { id: "curate", re: /(curat|draft|compos|summar|writ|select|rank|choos|generat|prepar)/i },
  {
    id: "research",
    re: /(search|research|web|brows|fetch|crawl|scan|look(ing)?\s*up|google|article|source|read)/i,
  },
  { id: "preferences", re: /(preferen|interest|profile|topic|what you)/i },
  { id: "connect", re: /(connect|start|wak|provision|boot|spin|warm|initial|ready)/i },
];

/** Classify a breadcrumb line into the furthest workflow phase it implies. */
export function classifyActivity(line: string): FeedPhaseId | null {
  const text = line.trim();
  if (!text) return null;
  let best: FeedPhaseId | null = null;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (best === null || PHASE_INDEX[rule.id] > PHASE_INDEX[best]) best = rule.id;
    }
  }
  return best;
}

/** Strip leading emoji / symbols and tidy a breadcrumb for display. */
export function cleanActivityText(line: string): string {
  return line
    .replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\u2000-\u2BFF•·\-–—>*]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** A line short enough and shaped like a status breadcrumb, not prose. */
export function looksLikeActivity(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 160) return false;
  const startsWithEmoji = /^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(text);
  return startsWithEmoji || classifyActivity(text) !== null;
}

/**
 * Derive the timeline from the breadcrumbs seen so far plus elapsed time.
 * Real events drive progress; a gentle time-based floor keeps it alive when the
 * agent is quiet, but never fakes the final "save" step.
 */
export function computeFeedTimeline(
  activity: string[],
  elapsedMs: number,
  done = false
): FeedTimeline {
  let reached = 0;
  let detail = "";

  for (const raw of activity) {
    const id = classifyActivity(raw);
    if (id) reached = Math.max(reached, PHASE_INDEX[id]);
    const clean = cleanActivityText(raw);
    if (clean) detail = clean;
  }

  // Time floor advances only up to "curate" (index 3) so we never fake saving.
  const timeFloor =
    elapsedMs > 24_000 ? 3 : elapsedMs > 9_000 ? 2 : elapsedMs > 3_000 ? 1 : 0;
  reached = Math.max(reached, Math.min(timeFloor, 3));

  const activeIndex = done ? FEED_PHASES.length : Math.min(reached, FEED_PHASES.length - 1);

  const steps: FeedTimelineStep[] = FEED_PHASES.map((phase, i) => ({
    ...phase,
    status: done || i < activeIndex ? "done" : i === activeIndex ? "active" : "pending",
  }));

  return { steps, activeIndex, detail };
}
