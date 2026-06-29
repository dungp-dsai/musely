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
  const repeat = job.repeat;
  let repeatStr = "";
  if (typeof repeat === "number" || typeof repeat === "string") {
    repeatStr = String(repeat);
  } else if (repeat && typeof repeat === "object" && repeat.times != null) {
    repeatStr = String(repeat.times);
  }

  return {
    schedule: formatSchedule(job) === "—" ? "" : formatSchedule(job),
    prompt: job.prompt || "",
    name: job.name || "",
    deliver: job.deliver || "local",
    repeat: repeatStr,
    skills: (job.skills || []).join(", "),
    script: job.script || "",
    noAgent: Boolean(job.no_agent),
    workdir: job.workdir || "",
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

/** Normalize jobs from Hermes JSON for safe UI rendering. */
export function normalizeCronJob(job: Record<string, unknown>): CronJob {
  return job as CronJob;
}
