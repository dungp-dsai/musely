// On-demand per-user Hermes orchestration (single host, Docker CLI).
//
// Each user gets an isolated Hermes gateway container named from their Google
// display name (e.g. hermes-jane-smith-3) with its own volume seeded from the
// shared base template. Containers are started on activity and stopped after idle.

import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getInstance,
  getUserById,
  createInstanceRecord,
  updateInstanceContainerName,
  setInstanceStatus,
  touchInstance,
  listIdleInstances,
} from "./db.js";

const HERMES_IMAGE = process.env.HERMES_IMAGE || "nousresearch/hermes-agent:latest";
const HERMES_NETWORK = process.env.HERMES_NETWORK || "writer-net";
const HERMES_BASE_DIR = process.env.HERMES_BASE_DIR || "/opt/hermes-base";
const HERMES_DATA_DIR = process.env.HERMES_DATA_DIR || "/opt/hermes-data";
const IDLE_MINUTES = Number(process.env.HERMES_IDLE_MINUTES) || 15;
const USER_MEMORY = process.env.HERMES_USER_MEMORY || "4g";
const USER_CPUS = process.env.HERMES_USER_CPUS || "2.0";
const HEALTH_TIMEOUT_MS = Number(process.env.HERMES_HEALTH_TIMEOUT_MS) || 45_000;
const HERMES_PORT = "8642";
/** Bump to force container recreate (image/env layout changes). Config sync uses content hash. */
const PROVISION_VERSION = "6";

const VOLUME_MOUNT = "/opt/data";
const TEMPLATE_SYNC_FILE = ".writer-template-sync";

// in-flight ensure() promises keyed by userId to coalesce concurrent starts
const inflight = new Map();

export function orchestratorConfigured() {
  if (process.env.HERMES_ORCHESTRATOR === "disabled") return false;
  return existsSync("/var/run/docker.sock");
}

/** Prefer ./hermes-data when it has a configured .env; fall back to ./hermes-base. */
function resolveTemplateDir() {
  if (existsSync(join(HERMES_DATA_DIR, ".env"))) return HERMES_DATA_DIR;
  if (existsSync(join(HERMES_BASE_DIR, ".env"))) return HERMES_BASE_DIR;
  if (existsSync(HERMES_DATA_DIR)) return HERMES_DATA_DIR;
  return HERMES_BASE_DIR;
}

export function templateConfigured() {
  return existsSync(join(resolveTemplateDir(), ".env"));
}

function templateConfigFingerprint() {
  const dir = resolveTemplateDir();
  const parts = [];
  for (const name of ["config.yaml", ".env"]) {
    const path = join(dir, name);
    if (existsSync(path)) parts.push(readFileSync(path));
  }
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

async function readVolumeSyncHash(volumeName) {
  try {
    return await runDocker([
      "run",
      "--rm",
      "-v",
      `${volumeName}:${VOLUME_MOUNT}:ro`,
      "alpine:3.20",
      "cat",
      `${VOLUME_MOUNT}/${TEMPLATE_SYNC_FILE}`,
    ]);
  } catch {
    return "";
  }
}

async function writeVolumeSyncHash(volumeName, hash) {
  await runDocker(
    [
      "run",
      "--rm",
      "-i",
      "-v",
      `${volumeName}:${VOLUME_MOUNT}:rw`,
      "alpine:3.20",
      "sh",
      "-c",
      `cat > ${VOLUME_MOUNT}/${TEMPLATE_SYNC_FILE}`,
    ],
    { input: hash, timeoutMs: 15_000 }
  );
}

async function volumeNeedsTemplateSync(volumeName) {
  const expected = templateConfigFingerprint();
  const current = await readVolumeSyncHash(volumeName);
  return current !== expected;
}

/** Docker-safe container name derived from the user's Google display name. */
export function containerNameForUser(userId, userName) {
  if (userName) {
    const slug = userName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (slug) return `hermes-${slug}-${userId}`;
  }
  return `hermes-user-${userId}`;
}

/** Resolve the container name from the registry, or derive one if not provisioned yet. */
export async function resolveContainerName(userId) {
  const instance = await getInstance(userId);
  if (instance?.container_name) return instance.container_name;
  const user = await getUserById(userId);
  return containerNameForUser(userId, user?.name);
}

export function volumeNameForUser(userId) {
  return `hermes-user-${userId}`;
}

function baseUrlForContainer(containerName) {
  return `http://${containerName}:${HERMES_PORT}/v1`;
}

function newApiKey() {
  return randomBytes(32).toString("hex");
}

function appendRuntimeEnv(args) {
  args.push("-e", `HERMES_PROVISION_VERSION=${PROVISION_VERSION}`);
  args.push("-e", "GATEWAY_ALLOW_ALL_USERS=true");
}

function runDocker(args, { timeoutMs = 60_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const stdio = input != null ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
    const child = spawn("docker", args, { stdio });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`docker ${args[0]} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || `docker exit ${code}`).trim()));
    });

    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/** Pipe a tar stream from a local dir (inside this container) into a Docker volume. */
function pipeTarToVolume(templateDir, volumeName, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tar.kill("SIGTERM");
      docker.kill("SIGTERM");
      reject(new Error("seedVolume timed out"));
    }, timeoutMs);

    const tar = spawn("tar", ["cf", "-", "-C", templateDir, "."], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const docker = spawn(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "-v",
        `${volumeName}:${VOLUME_MOUNT}`,
        "alpine:3.20",
        "sh",
        "-c",
        `cd ${VOLUME_MOUNT} && tar xf -`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let tarErr = "";
    let dockerErr = "";
    tar.stderr.on("data", (d) => (tarErr += d.toString()));
    docker.stderr.on("data", (d) => (dockerErr += d.toString()));

    tar.stdout.pipe(docker.stdin);
    tar.stdout.on("end", () => docker.stdin.end());
    docker.stdin.on("error", () => {});

    let tarCode = null;
    let dockerCode = null;
    const finish = () => {
      if (tarCode === null || dockerCode === null) return;
      clearTimeout(timer);
      if (tarCode !== 0) reject(new Error(tarErr.trim() || `tar exit ${tarCode}`));
      else if (dockerCode !== 0) reject(new Error(dockerErr.trim() || `docker exit ${dockerCode}`));
      else resolve();
    };

    tar.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    docker.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    tar.on("close", (code) => {
      tarCode = code;
      finish();
    });
    docker.on("close", (code) => {
      dockerCode = code;
      finish();
    });
  });
}

async function containerState(containerName) {
  try {
    const out = await runDocker([
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerName,
    ]);
    return out === "true" ? "running" : "stopped";
  } catch {
    return "missing";
  }
}

async function containerProvisionVersion(containerName) {
  try {
    const out = await runDocker([
      "inspect",
      "-f",
      "{{range .Config.Env}}{{println .}}{{end}}",
      containerName,
    ]);
    const line = out.split("\n").find((l) => l.startsWith("HERMES_PROVISION_VERSION="));
    return line?.split("=")[1] || null;
  } catch {
    return null;
  }
}

async function removeContainer(containerName) {
  try {
    await runDocker(["stop", containerName], { timeoutMs: 30_000 });
  } catch {
    /* already stopped */
  }
  try {
    await runDocker(["rm", containerName], { timeoutMs: 30_000 });
  } catch {
    /* already gone */
  }
}

/** Quick container state for a user without touching the DB or starting it. */
export async function quickState(userId) {
  return containerState(await resolveContainerName(userId));
}

/** Run a command inside the user's running container. */
export async function execInContainer(containerName, argv, opts = {}) {
  return runDocker(["exec", containerName, ...argv], opts);
}

/**
 * Run a one-shot command against the user's volume without starting the
 * gateway (read-only mount). Used for listing cron jobs while idle.
 */
export async function runTransientReader(userId, argv, opts = {}) {
  const volumeName = volumeNameForUser(userId);
  return runDocker(
    ["run", "--rm", "-v", `${volumeName}:/opt/data:ro`, "alpine:3.20", ...argv],
    opts
  );
}

async function volumeExists(volumeName) {
  try {
    await runDocker(["volume", "inspect", volumeName]);
    return true;
  } catch {
    return false;
  }
}

async function seedVolume(volumeName) {
  const templateDir = resolveTemplateDir();
  await pipeTarToVolume(templateDir, volumeName);
}

/** Write a single template file into the user volume (always under /opt/data). */
async function copyTemplateFile(volumeName, filename) {
  const src = join(resolveTemplateDir(), filename);
  if (!existsSync(src)) return;
  const content = readFileSync(src);
  await runDocker(
    [
      "run",
      "--rm",
      "-i",
      "-v",
      `${volumeName}:${VOLUME_MOUNT}:rw`,
      "alpine:3.20",
      "sh",
      "-c",
      `cat > ${VOLUME_MOUNT}/${filename}`,
    ],
    { input: content, timeoutMs: 60_000 }
  );
}

async function resyncVolumeFromTemplate(volumeName, apiKey) {
  await copyTemplateFile(volumeName, "config.yaml");
  await copyTemplateFile(volumeName, ".env");
  await injectVolumeEnv(volumeName, apiKey);
  await writeVolumeSyncHash(volumeName, templateConfigFingerprint());
  console.log(`[orchestrator] synced template → volume ${volumeName}`);
}

/** Overlay per-user gateway settings on top of the template .env. */
async function injectVolumeEnv(volumeName, apiKey) {
  const updates = {
    API_SERVER_KEY: apiKey,
    API_SERVER_ENABLED: "true",
    GATEWAY_ALLOW_ALL_USERS: "true",
  };
  const payload = Buffer.from(
    Object.entries(updates)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  ).toString("base64");
  await runDocker(
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:${VOLUME_MOUNT}:rw`,
      "alpine:3.20",
      "sh",
      "-c",
      `touch ${VOLUME_MOUNT}/.env && echo '${payload}' | base64 -d | while IFS= read -r line; do key="\${line%%=*}"; grep -v "^\${key}=" ${VOLUME_MOUNT}/.env > /tmp/env.tmp 2>/dev/null || true; mv /tmp/env.tmp ${VOLUME_MOUNT}/.env; echo "\$line" >> ${VOLUME_MOUNT}/.env; done`,
    ],
    { timeoutMs: 60_000 }
  );
}

async function createContainer(userId, containerName, apiKey) {
  const volumeName = volumeNameForUser(userId);

  if (!(await volumeExists(volumeName))) {
    await seedVolume(volumeName);
    await writeVolumeSyncHash(volumeName, templateConfigFingerprint());
  }

  const args = [
    "create",
    "--name",
    containerName,
    "--network",
    HERMES_NETWORK,
    "--restart",
    "no",
    "--memory",
    USER_MEMORY,
    "--cpus",
    USER_CPUS,
    "--shm-size",
    "1g",
    "-v",
    `${volumeName}:/opt/data`,
    "-e",
    "API_SERVER_ENABLED=true",
    "-e",
    "API_SERVER_HOST=0.0.0.0",
    "-e",
    `API_SERVER_PORT=${HERMES_PORT}`,
    "-e",
    `API_SERVER_KEY=${apiKey}`,
    "-e",
    `API_SERVER_MODEL_NAME=${process.env.HERMES_API_MODEL_NAME || "Hermes Agent"}`,
  ];

  appendRuntimeEnv(args);

  if (process.env.HERMES_USER_DATABASE_URL || process.env.DATABASE_URL) {
    args.push("-e", `DATABASE_URL=${process.env.HERMES_USER_DATABASE_URL || process.env.DATABASE_URL}`);
  }
  if (process.env.AGENT_API_KEY) args.push("-e", `AGENT_API_KEY=${process.env.AGENT_API_KEY}`);
  args.push("-e", `AGENT_USER_ID=${userId}`);

  args.push(HERMES_IMAGE, "gateway", "run");

  await runDocker(args, { timeoutMs: 120_000 });
}

async function waitForHealth(containerName, signal) {
  const url = `http://${containerName}:${HERMES_PORT}/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Hermes instance did not become healthy in time${lastErr ? `: ${lastErr.message}` : ""}`);
}

/** Rename container when the user's display name slug changed. */
async function syncInstanceContainer(userId, instance) {
  const user = await getUserById(userId);
  const desiredName = containerNameForUser(userId, user?.name);
  const currentName = instance.container_name;
  if (currentName === desiredName) return instance;

  const state = await containerState(currentName);
  if (state !== "missing") {
    await removeContainer(currentName);
  }
  await updateInstanceContainerName(userId, desiredName);
  return { ...instance, container_name: desiredName };
}

async function provisionInstance(userId) {
  let instance = await getInstance(userId);
  if (!instance) {
    const user = await getUserById(userId);
    const containerName = containerNameForUser(userId, user?.name);
    instance = await createInstanceRecord({ userId, containerName, apiKey: newApiKey() });
  }
  return syncInstanceContainer(userId, instance);
}

/**
 * Ensure the user's Hermes container exists, is running and healthy.
 * Returns { baseUrl, apiKey, containerName }. Coalesces concurrent calls.
 */
export function ensureInstance(userId) {
  if (!orchestratorConfigured()) {
    throw new Error("Hermes orchestrator is not available (docker socket missing)");
  }
  if (!templateConfigured()) {
    throw new Error(
      "Hermes template not configured. Ensure ./hermes-data/.env exists (from hermes setup) and is mounted into the API container."
    );
  }
  if (inflight.has(userId)) return inflight.get(userId);

  const p = (async () => {
    const instance = await provisionInstance(userId);
    const { container_name: containerName, api_key: apiKey } = instance;
    const volumeName = volumeNameForUser(userId);

    let templateSynced = false;
    if (await volumeNeedsTemplateSync(volumeName)) {
      templateSynced = true;
      const running = (await containerState(containerName)) === "running";
      if (running) await removeContainer(containerName);
      await resyncVolumeFromTemplate(volumeName, apiKey);
    }

    let state = await containerState(containerName);
    const version = state !== "missing" ? await containerProvisionVersion(containerName) : null;
    const needsRecreate = templateSynced || version !== PROVISION_VERSION;

    if (needsRecreate && state !== "missing") {
      await removeContainer(containerName);
      state = "missing";
    }

    if (state === "missing") {
      await createContainer(userId, containerName, apiKey);
      await setInstanceStatus(userId, "starting");
      await runDocker(["start", containerName]);
    } else if (state === "stopped") {
      await setInstanceStatus(userId, "starting");
      await runDocker(["start", containerName]);
    }

    await waitForHealth(containerName);
    await touchInstance(userId);

    return {
      baseUrl: baseUrlForContainer(containerName),
      apiKey,
      containerName,
    };
  })().finally(() => inflight.delete(userId));

  inflight.set(userId, p);
  return p;
}

/** Mark activity without forcing a (re)start — used by lightweight reads. */
export async function noteActivity(userId) {
  try {
    await touchInstance(userId);
  } catch {
    /* ignore */
  }
}

export async function stopInstance(userId, containerName) {
  try {
    await runDocker(["stop", containerName], { timeoutMs: 30_000 });
  } catch {
    /* container may already be gone */
  }
  await setInstanceStatus(userId, "stopped");
}

export async function stopIdleInstances() {
  if (!orchestratorConfigured()) return;
  let idle = [];
  try {
    idle = await listIdleInstances(IDLE_MINUTES);
  } catch (err) {
    console.error("[orchestrator] listIdleInstances failed:", err.message);
    return;
  }
  for (const inst of idle) {
    try {
      await stopInstance(inst.user_id, inst.container_name);
      console.log(`[orchestrator] stopped idle instance ${inst.container_name}`);
    } catch (err) {
      console.error(`[orchestrator] failed to stop ${inst.container_name}:`, err.message);
    }
  }
}

let reaperTimer = null;

export function startIdleReaper() {
  if (!orchestratorConfigured()) {
    console.log("[orchestrator] disabled (no docker socket); idle reaper not started");
    return;
  }
  if (reaperTimer) return;
  const intervalMs = Number(process.env.HERMES_REAPER_INTERVAL_MS) || 60_000;
  reaperTimer = setInterval(() => {
    stopIdleInstances().catch((err) =>
      console.error("[orchestrator] reaper tick failed:", err.message)
    );
  }, intervalMs);
  if (reaperTimer.unref) reaperTimer.unref();
  console.log(
    `[orchestrator] idle reaper started (idle=${IDLE_MINUTES}m, interval=${intervalMs}ms)`
  );
}

export const ORCHESTRATOR_SETTINGS = {
  image: HERMES_IMAGE,
  network: HERMES_NETWORK,
  baseDir: HERMES_BASE_DIR,
  dataDir: HERMES_DATA_DIR,
  templateDir: resolveTemplateDir(),
  idleMinutes: IDLE_MINUTES,
  memory: USER_MEMORY,
  cpus: USER_CPUS,
};
