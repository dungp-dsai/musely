/**
 * Maps agent stream breadcrumbs for the do-research / writing-queue run into
 * a phased timeline (same idea as feedActivity.ts).
 */

export type WritingPhaseId =
  | "connect"
  | "load"
  | "research"
  | "store"
  | "finish";

export interface WritingPhase {
  id: WritingPhaseId;
  label: string;
  hint: string;
}

export type WritingStepStatus = "done" | "active" | "pending";

export interface WritingTimelineStep extends WritingPhase {
  status: WritingStepStatus;
}

export interface WritingTimeline {
  steps: WritingTimelineStep[];
  activeIndex: number;
  detail: string;
}

export const WRITING_PHASES: WritingPhase[] = [
  { id: "connect", label: "Waking your agent", hint: "Starting your private Musely agent" },
  { id: "load", label: "Loading your queue", hint: "Reading the piece and pending tasks" },
  { id: "research", label: "Researching tasks", hint: "Claiming tasks and gathering sources" },
  { id: "store", label: "Saving findings", hint: "Writing research back to each task" },
  { id: "finish", label: "Wrapping up", hint: "Finishing the queue run" },
];

const PHASE_INDEX: Record<WritingPhaseId, number> = {
  connect: 0,
  load: 1,
  research: 2,
  store: 3,
  finish: 4,
};

const RULES: { id: WritingPhaseId; re: RegExp }[] = [
  { id: "finish", re: /(done|finish|complet|wrap|all tasks|queue (is )?clear)/i },
  {
    id: "store",
    re: /(sav|stor|persist|feedback\/\d+\/work|post(ing|ed)? findings|write.?back)/i,
  },
  {
    id: "research",
    re: /(research|search|claim|web|source|extract|brows|look(ing)?\s*up|tavily)/i,
  },
  {
    id: "load",
    re: /(\/api\/active|queue|pending task|in progress|load(ing)? (piece|draft|tasks))/i,
  },
  { id: "connect", re: /(connect|start|wak|provision|boot|spin|warm|initial|ready)/i },
];

export function classifyWritingActivity(line: string): WritingPhaseId | null {
  const text = line.trim();
  if (!text) return null;
  let best: WritingPhaseId | null = null;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (best === null || PHASE_INDEX[rule.id] > PHASE_INDEX[best]) best = rule.id;
    }
  }
  return best;
}

export function cleanWritingActivityText(line: string): string {
  return line
    .replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\u2000-\u2BFF•·\-–—>*]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function computeWritingQueueTimeline(
  activity: string[],
  elapsedMs: number,
  done = false
): WritingTimeline {
  let reached = 0;
  let detail = "";
  let detailPhase: WritingPhaseId | null = null;

  for (const raw of activity) {
    const id = classifyWritingActivity(raw);
    if (id) reached = Math.max(reached, PHASE_INDEX[id]);
    const clean = cleanWritingActivityText(raw);
    if (clean) {
      detail = clean;
      detailPhase = id;
    }
  }

  const timeFloor =
    elapsedMs > 40_000 ? 3 : elapsedMs > 18_000 ? 2 : elapsedMs > 6_000 ? 1 : 0;
  reached = Math.max(reached, Math.min(timeFloor, 3));

  const activeIndex = done
    ? WRITING_PHASES.length
    : Math.min(reached, WRITING_PHASES.length - 1);

  if (detail && detailPhase != null && PHASE_INDEX[detailPhase] < activeIndex) {
    detail = "";
  }

  const steps: WritingTimelineStep[] = WRITING_PHASES.map((phase, i) => ({
    ...phase,
    status: done || i < activeIndex ? "done" : i === activeIndex ? "active" : "pending",
  }));

  return { steps, activeIndex, detail };
}
