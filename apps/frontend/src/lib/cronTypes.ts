/**
 * Cron schedule types + conversion between the simplified Musely UI model
 * and Hermes `hermes cron` CLI payloads.
 *
 * Users only set: name, pickup times, frequency, repeat, on/off.
 * Prompt / deliver / skills stay hidden and are filled by the product.
 */

/** Raw shape from Hermes ~/.hermes/cron/jobs.json */
export type CronJobSchedule =
  | string
  | {
      kind?: string;
      display?: string;
      minutes?: number;
      hours?: number;
      [key: string]: unknown;
    };

export type CronJobRepeat =
  | number
  | string
  | null
  | {
      times?: number;
      completed?: number;
      [key: string]: unknown;
    };

export type CronJob = {
  id: string;
  name?: string;
  schedule?: CronJobSchedule;
  schedule_display?: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  script?: string | null;
  no_agent?: boolean;
  workdir?: string | null;
  repeat?: CronJobRepeat;
  paused?: boolean;
  enabled?: boolean;
  state?: string;
  paused_at?: string | null;
  next_run_at?: string | number | null;
  last_run_at?: string | number | null;
  last_status?: string | null;
  provider?: string | null;
  model?: string | null;
  context_from?: string | string[] | null;
};

/** API payload for create / edit. */
export type CronApiPayload = {
  schedule: string;
  prompt: string;
  name?: string;
  deliver?: string;
  repeat?: string;
  skills?: string[];
  script?: string;
  noAgent?: boolean;
  workdir?: string;
  clearSkills?: boolean;
};

export type DayPreset = "every_day" | "weekdays" | "weekends" | "custom";
export type Cadence = "times_of_day" | "interval";
export type RepeatMode = "forever" | "count";

export type PickupTime = {
  id: string;
  /** Local time HH:MM (24h). */
  time: string;
  enabled: boolean;
};

/** User-facing schedule editor model. */
export type ScheduleDraft = {
  name: string;
  /** True once the user has typed a custom name (stops auto-renaming). */
  nameTouched: boolean;
  cadence: Cadence;
  times: PickupTime[];
  days: DayPreset;
  /** Sun=0 … Sat=6 — only used when days === "custom". */
  customDays: number[];
  everyHours: number;
  everyMinutes: number;
  repeatMode: RepeatMode;
  repeatCount: number;
  /** Master on/off — maps to Hermes pause / resume. */
  enabled: boolean;
  /** Hidden — agent instruction (seeded from queue / product defaults). */
  prompt: string;
  deliver: string;
  skills: string[];
};

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function newPickupId() {
  return `t_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultName(seed?: string | null) {
  const base = (seed || "").trim();
  if (base) return base.length > 60 ? `${base.slice(0, 57)}…` : base;
  const h = new Date().getHours();
  if (h < 12) return "Morning assist";
  if (h < 17) return "Afternoon assist";
  return "Evening assist";
}

export function emptyScheduleDraft(seed?: {
  name?: string;
  prompt?: string;
} | null): ScheduleDraft {
  return {
    name: defaultName(seed?.name),
    nameTouched: Boolean(seed?.name?.trim()),
    cadence: "times_of_day",
    times: [{ id: newPickupId(), time: "09:00", enabled: true }],
    days: "every_day",
    customDays: [1, 2, 3, 4, 5],
    everyHours: 2,
    everyMinutes: 0,
    repeatMode: "forever",
    repeatCount: 5,
    enabled: true,
    prompt:
      seed?.prompt?.trim() ||
      "Use the do-research skill. GET /api/active and /api/active/tasks, claim each pending task, research it, and POST findings to /api/feedback/:id/work. Do not rewrite the draft or touch the UI. Reply briefly when done.",
    deliver: "local",
    skills: [],
  };
}

export function isJobPaused(job: CronJob): boolean {
  if (job.paused === true) return true;
  if (job.enabled === false) return true;
  if (job.state === "paused") return true;
  if (job.paused_at) return true;
  return false;
}

export function formatWhen(value: CronJob["next_run_at"]): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return new Date(value * 1000).toLocaleString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

export function formatSchedule(job: CronJob): string {
  if (job.schedule_display) return job.schedule_display;
  const s = job.schedule;
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    if (typeof s.display === "string") return s.display;
    return JSON.stringify(s);
  }
  return "—";
}

export function formatRepeat(job: CronJob): string {
  const r = job.repeat;
  if (r == null || r === "") return "—";
  if (typeof r === "number" || typeof r === "string") return String(r);
  if (typeof r === "object") {
    const times = r.times;
    const completed = r.completed;
    if (times != null && completed != null) return `${completed}/${times}`;
    if (times != null) return String(times);
  }
  return "—";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseTime(value: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

export function formatTimeLabel(time: string): string {
  const p = parseTime(time);
  if (!p) return time;
  const ampm = p.h >= 12 ? "PM" : "AM";
  const h12 = p.h % 12 || 12;
  return `${h12}:${pad2(p.m)} ${ampm}`;
}

function dowCron(days: DayPreset, customDays: number[]): string {
  if (days === "every_day") return "*";
  if (days === "weekdays") return "1-5";
  if (days === "weekends") return "0,6";
  const sorted = [...new Set(customDays.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  return sorted.length ? sorted.join(",") : "*";
}

/**
 * Build a Hermes schedule string from the UI draft.
 * Prefer a single cron when all enabled times share the same minute;
 * otherwise fall back to one schedule for the first enabled time
 * (caller may expand to multiple jobs via `draftToHermesJobs`).
 */
export function buildScheduleString(draft: ScheduleDraft): string {
  if (draft.cadence === "interval") {
    if (draft.everyHours <= 0 && draft.everyMinutes > 0) {
      return `every ${draft.everyMinutes}m`;
    }
    if (draft.everyHours > 0 && draft.everyMinutes > 0) {
      const total = draft.everyHours * 60 + draft.everyMinutes;
      return `every ${total}m`;
    }
    const h = Math.max(1, draft.everyHours || 1);
    return `every ${h}h`;
  }

  const enabled = draft.times.filter((t) => t.enabled && parseTime(t.time));
  if (!enabled.length) return "0 9 * * *";

  const parsed = enabled
    .map((t) => ({ raw: t.time, ...parseTime(t.time)! }))
    .sort((a, b) => a.h - b.h || a.m - b.m);

  const minutes = [...new Set(parsed.map((p) => p.m))];
  const hours = [...new Set(parsed.map((p) => p.h))];
  const dow = dowCron(draft.days, draft.customDays);

  if (minutes.length === 1) {
    return `${minutes[0]} ${hours.join(",")} * * ${dow}`;
  }

  // Mixed minutes — Hermes gets one cron for the first slot; others become sibling jobs.
  const first = parsed[0];
  return `${first.m} ${first.h} * * ${dow}`;
}

export function draftToPayload(draft: ScheduleDraft, scheduleOverride?: string): CronApiPayload {
  const schedule = (scheduleOverride ?? buildScheduleString(draft)).trim();
  const prompt = draft.prompt.trim();
  if (!schedule) throw new Error("Add at least one pickup time");
  if (!prompt) throw new Error("Missing agent instruction");

  return {
    schedule,
    prompt,
    name: draft.name.trim() || defaultName(),
    deliver: draft.deliver.trim() || "local",
    repeat:
      draft.repeatMode === "count" && draft.repeatCount > 0
        ? String(Math.floor(draft.repeatCount))
        : undefined,
    skills: draft.skills.length ? draft.skills : undefined,
    noAgent: false,
  };
}

/**
 * Expand a draft into one or more Hermes jobs (one per pickup time when minutes differ).
 */
export function draftToHermesJobs(draft: ScheduleDraft): CronApiPayload[] {
  if (draft.cadence === "interval") {
    return [draftToPayload(draft)];
  }

  const enabled = draft.times.filter((t) => t.enabled && parseTime(t.time));
  if (!enabled.length) throw new Error("Turn on at least one pickup time");

  const parsed = enabled.map((t) => ({ ...parseTime(t.time)!, label: t.time }));
  const minutes = new Set(parsed.map((p) => p.m));
  const dow = dowCron(draft.days, draft.customDays);

  if (minutes.size === 1) {
    return [draftToPayload(draft)];
  }

  const baseName = draft.name.trim() || defaultName();
  return parsed
    .sort((a, b) => a.h - b.h || a.m - b.m)
    .map((p) =>
      draftToPayload(
        { ...draft, name: `${baseName} · ${formatTimeLabel(pad2(p.h) + ":" + pad2(p.m))}` },
        `${p.m} ${p.h} * * ${dow}`
      )
    );
}

function parseCronParts(schedule: string): {
  minute: string;
  hour: string;
  dow: string;
} | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return { minute: parts[0], hour: parts[1], dow: parts[4] };
}

function hoursFromCronField(field: string): number[] {
  if (field === "*") return [];
  const out: number[] = [];
  for (const bit of field.split(",")) {
    if (bit.includes("-")) {
      const [a, b] = bit.split("-").map(Number);
      for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d+$/.test(bit)) {
      out.push(Number(bit));
    }
  }
  return [...new Set(out)].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
}

function dowFromCronField(field: string): { days: DayPreset; customDays: number[] } {
  if (field === "*") return { days: "every_day", customDays: [1, 2, 3, 4, 5] };
  if (field === "1-5") return { days: "weekdays", customDays: [1, 2, 3, 4, 5] };
  if (field === "0,6" || field === "6,0") return { days: "weekends", customDays: [0, 6] };
  const customDays = hoursFromCronField(field); // same parser for ints
  return { days: "custom", customDays: customDays.length ? customDays : [1, 2, 3, 4, 5] };
}

/** Best-effort UI draft from an existing Hermes job. */
export function draftFromJob(job: CronJob): ScheduleDraft {
  const schedule = formatSchedule(job);
  const draft = emptyScheduleDraft({
    name: job.name || "Scheduled assist",
    prompt: job.prompt || "",
  });
  draft.nameTouched = true;
  draft.enabled = !isJobPaused(job);
  draft.deliver = job.deliver || "local";
  draft.skills = Array.isArray(job.skills) ? [...job.skills] : [];

  const repeat = job.repeat;
  if (typeof repeat === "number" && repeat > 0) {
    draft.repeatMode = "count";
    draft.repeatCount = repeat;
  } else if (typeof repeat === "string" && /^\d+$/.test(repeat)) {
    draft.repeatMode = "count";
    draft.repeatCount = Number(repeat);
  } else if (repeat && typeof repeat === "object" && repeat.times != null) {
    draft.repeatMode = "count";
    draft.repeatCount = Number(repeat.times) || 5;
  }

  const everyMatch = /^every\s+(\d+)\s*([hm]|hours?|minutes?|hrs?|mins?)$/i.exec(schedule);
  if (everyMatch) {
    draft.cadence = "interval";
    const n = Number(everyMatch[1]);
    const unit = everyMatch[2].toLowerCase();
    if (unit.startsWith("h")) {
      draft.everyHours = n;
      draft.everyMinutes = 0;
    } else {
      draft.everyHours = Math.floor(n / 60);
      draft.everyMinutes = n % 60 || n;
    }
    return draft;
  }

  const cron = parseCronParts(schedule);
  if (cron) {
    draft.cadence = "times_of_day";
    const minute = cron.minute === "*" ? 0 : Number(cron.minute.split(",")[0]) || 0;
    const hours = hoursFromCronField(cron.hour);
    const dow = dowFromCronField(cron.dow);
    draft.days = dow.days;
    draft.customDays = dow.customDays;
    draft.times = (hours.length ? hours : [9]).map((h) => ({
      id: newPickupId(),
      time: `${pad2(h)}:${pad2(minute)}`,
      enabled: true,
    }));
    return draft;
  }

  // Unknown schedule format — keep as a single time slot default, leave prompt intact.
  draft.cadence = "times_of_day";
  return draft;
}

/** Human-readable summary for job cards. */
export function summarizeDraft(draft: ScheduleDraft): string {
  if (draft.cadence === "interval") {
    if (draft.everyHours && draft.everyMinutes) {
      return `Every ${draft.everyHours}h ${draft.everyMinutes}m`;
    }
    if (draft.everyHours) return `Every ${draft.everyHours} hour${draft.everyHours === 1 ? "" : "s"}`;
    return `Every ${draft.everyMinutes} min`;
  }

  const enabled = draft.times.filter((t) => t.enabled);
  const times =
    enabled.length === 0
      ? "no times"
      : enabled.map((t) => formatTimeLabel(t.time)).join(", ");

  const day =
    draft.days === "every_day"
      ? "every day"
      : draft.days === "weekdays"
        ? "weekdays"
        : draft.days === "weekends"
          ? "weekends"
          : draft.customDays.map((d) => DAY_LABELS[d]).join(", ");

  return `${times} · ${day}`;
}

export function summarizeJob(job: CronJob): string {
  return summarizeDraft(draftFromJob(job));
}

/** @deprecated Legacy form shape — kept for any leftover imports. */
export type CronJobForm = {
  schedule: string;
  prompt: string;
  name: string;
  deliver: string;
  repeat: string;
  skills: string;
  script: string;
  noAgent: boolean;
  workdir: string;
};

export const emptyCronForm = (): CronJobForm => ({
  schedule: "",
  prompt: "",
  name: "",
  deliver: "local",
  repeat: "",
  skills: "",
  script: "",
  noAgent: false,
  workdir: "",
});

export function cronFormFromJob(job: CronJob): CronJobForm {
  const d = draftFromJob(job);
  return {
    schedule: buildScheduleString(d),
    prompt: d.prompt,
    name: d.name,
    deliver: d.deliver,
    repeat: d.repeatMode === "count" ? String(d.repeatCount) : "",
    skills: d.skills.join(", "),
    script: "",
    noAgent: false,
    workdir: "",
  };
}

export function formToPayload(form: CronJobForm) {
  const skills = form.skills
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    schedule: form.schedule.trim(),
    prompt: form.prompt.trim(),
    name: form.name.trim() || undefined,
    deliver: form.deliver.trim() || undefined,
    repeat: form.repeat.trim() || undefined,
    skills: skills.length ? skills : undefined,
    script: form.script.trim() || undefined,
    noAgent: form.noAgent,
    workdir: form.workdir.trim() || undefined,
  };
}

export function normalizeCronJob(job: Record<string, unknown>): CronJob {
  return job as CronJob;
}
