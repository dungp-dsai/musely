// Per-user Hermes cron management.
//
// Each user's scheduled jobs live inside their own Hermes container/volume.
// Mutations run via `docker exec <container> hermes cron …` (container must be
// running). Listing reads `/opt/data/cron/jobs.json` from the volume directly,
// so it works even while the instance is idle/stopped (no forced cold start).

import {
  orchestratorConfigured,
  execInContainer,
  runTransientReader,
  quickState,
  resolveContainerName,
} from "./hermes-orchestrator.js";

export function hermesCronConfigured() {
  if (process.env.HERMES_CRON_MODE === "disabled") return false;
  return orchestratorConfigured();
}

function pushFlag(args, flag, value) {
  if (value === undefined || value === null || value === "") return;
  args.push(flag, String(value));
}

function pushSkills(args, skills, { replace = true } = {}) {
  if (!skills?.length) return;
  for (const skill of skills) {
    if (!skill?.trim()) continue;
    args.push(replace ? "--skill" : "--add-skill", skill.trim());
  }
}

function buildCreateArgs(body) {
  const schedule = typeof body.schedule === "string" ? body.schedule.trim() : "";
  if (!schedule) throw new Error("schedule is required");

  const noAgent = Boolean(body.noAgent);
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (noAgent && !script) throw new Error("script is required when no-agent mode is enabled");
  if (!noAgent && !prompt && !script) throw new Error("prompt is required for agent jobs");

  const args = ["create", schedule];
  if (prompt) args.push(prompt);

  pushFlag(args, "--name", body.name?.trim());
  pushFlag(args, "--deliver", body.deliver?.trim());
  if (body.repeat != null && body.repeat !== "") pushFlag(args, "--repeat", body.repeat);
  pushSkills(args, body.skills);
  pushFlag(args, "--script", script);
  if (noAgent) args.push("--no-agent");
  pushFlag(args, "--workdir", body.workdir?.trim());

  return args;
}

function buildEditArgs(jobId, body) {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("job id is required");

  const args = ["edit", id];
  pushFlag(args, "--schedule", body.schedule?.trim());
  pushFlag(args, "--prompt", body.prompt);
  pushFlag(args, "--name", body.name?.trim());
  pushFlag(args, "--deliver", body.deliver?.trim());
  if (body.repeat != null && body.repeat !== "") pushFlag(args, "--repeat", body.repeat);

  if (body.clearSkills) args.push("--clear-skills");
  else if (body.skills?.length) pushSkills(args, body.skills, { replace: true });
  else if (body.addSkills?.length) pushSkills(args, body.addSkills, { replace: false });
  else if (body.removeSkills?.length) {
    for (const s of body.removeSkills) pushFlag(args, "--remove-skill", s);
  }

  if (body.script !== undefined) pushFlag(args, "--script", body.script);
  if (body.noAgent === true) args.push("--no-agent");
  if (body.noAgent === false) args.push("--agent");
  if (body.workdir !== undefined) pushFlag(args, "--workdir", body.workdir);

  const hasMutation = args.length > 2;
  if (!hasMutation) throw new Error("No fields to update");

  return args;
}

async function runCronInContainer(containerName, subcommand, extraArgs = []) {
  const stdout = await execInContainer(containerName, ["hermes", "cron", subcommand, ...extraArgs]);
  return { stdout: (stdout || "").trim() };
}

function normalizeJobs(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { jobs: [] };
  }
  const jobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : [];
  return {
    jobs: jobs.map((job) => ({
      ...job,
      schedule_display:
        job.schedule_display ||
        (typeof job.schedule === "object" && job.schedule?.display) ||
        (typeof job.schedule === "string" ? job.schedule : undefined),
    })),
  };
}

const JOBS_PATH = "/opt/data/cron/jobs.json";

/** List a user's cron jobs without forcing a cold start. */
export async function listCronJobsFor(userId) {
  const state = await quickState(userId);
  const containerName = await resolveContainerName(userId);
  try {
    if (state === "running") {
      const out = await execInContainer(containerName, ["cat", JOBS_PATH]);
      return { ...normalizeJobs(out), source: "exec" };
    }
    if (state === "missing") {
      return { jobs: [], source: "none" };
    }
    const out = await runTransientReader(userId, ["cat", JOBS_PATH]);
    return { ...normalizeJobs(out), source: "volume" };
  } catch {
    // jobs.json may not exist yet
    return { jobs: [], source: state };
  }
}

export async function cronSchedulerStatusFor(containerName) {
  const { stdout } = await runCronInContainer(containerName, "status");
  return { status: stdout };
}

export async function createCronJobFor(containerName, body) {
  const args = buildCreateArgs(body);
  const { stdout } = await runCronInContainer(containerName, "create", args.slice(1));
  return { ok: true, message: stdout };
}

export async function editCronJobFor(containerName, jobId, body) {
  const args = buildEditArgs(jobId, body);
  const { stdout } = await runCronInContainer(containerName, "edit", args.slice(1));
  return { ok: true, message: stdout };
}

export async function pauseCronJobFor(containerName, jobId) {
  const { stdout } = await runCronInContainer(containerName, "pause", [String(jobId)]);
  return { ok: true, message: stdout };
}

export async function resumeCronJobFor(containerName, jobId) {
  const { stdout } = await runCronInContainer(containerName, "resume", [String(jobId)]);
  return { ok: true, message: stdout };
}

export async function runCronJobFor(containerName, jobId) {
  const { stdout } = await runCronInContainer(containerName, "run", [String(jobId)]);
  return { ok: true, message: stdout };
}

export async function removeCronJobFor(containerName, jobId) {
  const { stdout } = await runCronInContainer(containerName, "remove", [String(jobId)]);
  return { ok: true, message: stdout };
}

export const CRON_DELIVERY_OPTIONS = [
  { value: "local", label: "Local files (~/.hermes/cron/output/)" },
  { value: "origin", label: "Origin chat" },
  { value: "telegram", label: "Telegram home channel" },
  { value: "discord", label: "Discord home channel" },
  { value: "slack", label: "Slack home channel" },
  { value: "whatsapp", label: "WhatsApp home" },
  { value: "signal", label: "Signal" },
  { value: "email", label: "Email" },
  { value: "all", label: "All connected channels" },
];

export const CRON_SCHEDULE_EXAMPLES = [
  "30m",
  "every 2h",
  "every 1d at 09:00",
  "0 9 * * *",
  "0 9 * * 1-5",
  "2026-03-15T09:00:00",
];
