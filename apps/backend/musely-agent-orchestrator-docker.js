// Per-user Musely agent orchestration via the local Docker CLI (local dev).
//
// Each user gets a named container + volume on MUSELY_AGENT_NETWORK.
// The backend must run on the same Docker network to reach agents at:
//   http://<container-name>:<MUSELY_AGENT_PORT>/v1

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  getInstance,
  getUserById,
  createInstanceRecord,
  updateInstanceMachineId,
  setInstanceStatus,
  touchInstance,
  listIdleInstances,
} from "./db.js";
import {
  buildPlatformSyncShell,
  buildMuselyApiEnvShell,
  normalizeSyncSections,
  needsPlatformFiles,
  SYNC_SECTIONS,
} from "./musely-agent-platform-sync-runner.js";
import { getMuselyAgentApiEnv } from "./musely-agent-api-env.js";
import {
  resolvePlatformDirForFs,
  resolvePlatformDirForDocker,
} from "./musely-agent-platform-sync.js";

const MUSELY_AGENT_IMAGE = process.env.MUSELY_AGENT_IMAGE || "musely-agent:local";
const MUSELY_AGENT_NETWORK = process.env.MUSELY_AGENT_NETWORK || "musely-net";
// Host path for `docker run -v` — must be a path on the Docker daemon host, not inside
// the backend container (e.g. /Users/you/musely/musely-agent-platform, not /opt/musely-agent-platform).
const MUSELY_AGENT_PLATFORM_HOST_DIR =
  process.env.MUSELY_AGENT_PLATFORM_HOST_DIR || process.env.MUSELY_AGENT_PLATFORM_DIR || "";
// In-container mount for template checks when backend runs in compose (/opt/musely-agent-platform).
const MUSELY_AGENT_PLATFORM_MOUNT = process.env.MUSELY_AGENT_PLATFORM_MOUNT || MUSELY_AGENT_PLATFORM_HOST_DIR;
const MUSELY_AGENT_PORT = Number(process.env.MUSELY_AGENT_PORT) || 8642;
const IDLE_MINUTES = Number(process.env.MUSELY_AGENT_IDLE_MINUTES) || 15;
const USER_MEMORY_MB = Number(process.env.MUSELY_AGENT_USER_MEMORY_MB) || 2048;
const HEALTH_TIMEOUT_MS = Number(process.env.MUSELY_AGENT_HEALTH_TIMEOUT_MS) || 180_000;

const GATEWAY_CMD = [
  "hermes",
  "gateway",
  "run",
  "--no-supervise",
  "-q",
  "--accept-hooks",
  "--replace",
];

const inflight = new Map();

// ---------- Docker CLI ----------

function docker(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error((stderr || stdout || `docker exit ${code}`).trim()));
    });
  });
}

async function dockerQuiet(args, opts) {
  try {
    return await docker(args, opts);
  } catch {
    return null;
  }
}

// ---------- Availability ----------

export function orchestratorConfigured() {
  if (process.env.MUSELY_AGENT_ORCHESTRATOR === "disabled") return false;
  if (process.env.MUSELY_AGENT_ORCHESTRATOR === "fly") return false;
  return existsSync("/var/run/docker.sock") && Boolean(MUSELY_AGENT_IMAGE);
}

async function runPlatformSyncOnVolume(volumeName, sections) {
  const normalized = normalizeSyncSections(sections);
  const syncScript = buildPlatformSyncShell({
    platformPath: "/platform",
    dataPath: "/opt/data",
    sections: normalized,
  });
  const args = ["run", "--rm"];
  if (needsPlatformFiles(normalized)) {
    const fsDir = resolvePlatformDirForFs();
    if (!fsDir || !existsSync(fsDir)) {
      throw new Error("musely-agent-platform/ is not configured or missing");
    }
    const platformDir = resolvePlatformDirForDocker();
    if (!platformDir) {
      throw new Error("MUSELY_AGENT_PLATFORM_HOST_DIR is not set");
    }
    args.push("-v", `${platformDir}:/platform:ro`);
  }
  args.push(
    "-v",
    `${volumeName}:/opt/data`,
    "alpine",
    "sh",
    "-c",
    syncScript
  );
  await docker(args, { timeoutMs: 300_000 });
}

/** Write CLIENT_URL / AGENT_API_KEY / AGENT_USER_ID into the user volume .env. */
async function syncMuselyApiEnvToUserVolume(userId) {
  const volumeName = volumeNameForUser(userId);
  await ensureVolume(volumeName);
  const script = buildMuselyApiEnvShell({ dataPath: "/opt/data", userId });
  await docker(
    ["run", "--rm", "-v", `${volumeName}:/opt/data`, "alpine", "sh", "-c", script],
    { timeoutMs: 60_000 }
  );
}

async function restartGatewayIfRunning(containerRef) {
  const state = await getContainerState(containerRef);
  if (state !== "started") return;
  await dockerQuiet(["exec", containerRef, "hermes", "gateway", "restart"]);
}

/** Push selected platform parts into a user's Docker volume. */
export async function syncPlatformToUserVolume(userId, { sections } = {}) {
  const volumeName = volumeNameForUser(userId);
  await ensureVolume(volumeName);
  await runPlatformSyncOnVolume(volumeName, sections);
  console.log(`[orchestrator:docker] platform sync → ${volumeName} (user=${userId})`);
}

export async function restartUserAgentIfRunning(userId, { sections } = {}) {
  const instance = await getInstance(userId);
  const ref = instance?.machine_name || instance?.machine_id;
  if (!ref) return;
  const state = await getContainerState(ref);
  if (state !== "started") return;
  const volumeName = volumeNameForUser(userId);
  await runPlatformSyncOnVolume(volumeName, sections);
  await dockerQuiet(["exec", ref, "hermes", "gateway", "restart"]);
}

/** After admin sync: reload gateway only when the container is already running.
 *  Volume sync uses a transient alpine container — stopped agents still get updated files. */
export async function restartUserAgentAfterSync(userId, { restartGateway = true } = {}) {
  const instance = await getInstance(userId);
  const ref = instance?.machine_name || instance?.machine_id;
  if (!ref) throw new Error("No agent container for user — provision first");

  const state = await getContainerState(ref);
  if (state === "missing") {
    throw new Error("Agent container missing — provision first");
  }
  if (!isMachineRunning(state) || !restartGateway) return;

  await dockerQuiet(["exec", ref, "hermes", "gateway", "restart"]);
  await touchInstance(userId);
}

// ---------- Naming ----------

export function machineNameForUser(userId, userName) {
  if (userName) {
    const slug = userName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (slug) return `musely-agent-${slug}-${userId}`;
  }
  return `musely-agent-user-${userId}`;
}

function volumeNameForUser(userId) {
  return `musely-agent-user-${userId}`;
}

function baseUrlForContainer(containerName) {
  return `http://${containerName}:${MUSELY_AGENT_PORT}/v1`;
}

function newApiKey() {
  return randomBytes(32).toString("hex");
}

// ---------- Container ops ----------

async function ensureNetwork() {
  const found = await dockerQuiet(["network", "inspect", MUSELY_AGENT_NETWORK]);
  if (found) return;
  await docker(["network", "create", MUSELY_AGENT_NETWORK]);
}

async function getContainerState(containerRef) {
  const res = await dockerQuiet([
    "inspect",
    "-f",
    "{{.State.Status}}",
    containerRef,
  ]);
  if (!res) return "missing";
  const status = res.stdout;
  if (status === "running") return "started";
  if (status === "exited") return "stopped";
  if (status === "created") return "created";
  return status;
}

async function volumeExists(volumeName) {
  const res = await dockerQuiet(["volume", "inspect", volumeName]);
  return Boolean(res);
}

async function ensureVolume(volumeName) {
  if (await volumeExists(volumeName)) return volumeName;
  await docker(["volume", "create", volumeName]);
  return volumeName;
}

export function templateConfigured() {
  return orchestratorConfigured();
}

function containerEnvFlags(apiKey, userId) {
  const muselyApi = getMuselyAgentApiEnv(userId);
  const flags = [
    "-e",
    "API_SERVER_ENABLED=true",
    "-e",
    "API_SERVER_HOST=0.0.0.0",
    "-e",
    `API_SERVER_PORT=${MUSELY_AGENT_PORT}`,
    "-e",
    `API_SERVER_KEY=${apiKey}`,
    "-e",
    `HERMES_GATEWAY_NO_SUPERVISE=1`,
    "-e",
    `AGENT_USER_ID=${muselyApi.AGENT_USER_ID}`,
    "-e",
    `CLIENT_URL=${muselyApi.CLIENT_URL}`,
    "-e",
    `AGENT_API_KEY=${muselyApi.AGENT_API_KEY}`,
    "-e",
    `API_SERVER_MODEL_NAME=${process.env.MUSELY_AGENT_API_MODEL_NAME || "Musely Agent"}`,
  ];
  for (const key of [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GLM_API_KEY",
    "KIMI_API_KEY",
  ]) {
    if (process.env[key]) flags.push("-e", `${key}=${process.env[key]}`);
  }
  return flags;
}

async function createContainer({ containerName, volumeName, apiKey, userId }) {
  await ensureNetwork();
  await ensureVolume(volumeName);
  try {
    await syncPlatformToUserVolume(userId, { sections: SYNC_SECTIONS });
  } catch (err) {
    console.warn(`[orchestrator:docker] platform sync skipped: ${err.message}`);
  }

  const args = [
    "create",
    "--name",
    containerName,
    "--network",
    MUSELY_AGENT_NETWORK,
    "-v",
    `${volumeName}:/opt/data`,
    "--memory",
    `${USER_MEMORY_MB}m`,
    "--memory-swap",
    `${USER_MEMORY_MB}m`,
    "--shm-size",
    "256m",
    ...containerEnvFlags(apiKey, userId),
    MUSELY_AGENT_IMAGE,
    ...GATEWAY_CMD,
  ];

  const { stdout } = await docker(args, { timeoutMs: 300_000 });
  return stdout || containerName;
}

async function startContainer(containerName) {
  await docker(["start", containerName]);
}

async function stopContainer(containerName) {
  await dockerQuiet(["stop", "-t", "30", containerName]);
}

// ---------- Exported primitives ----------

export async function execInContainer(containerRef, argv, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { stdout } = await docker(
    ["exec", containerRef, ...argv],
    { timeoutMs }
  );
  return stdout;
}

export async function runTransientReader(userId, argv, _opts = {}) {
  const volumeName = volumeNameForUser(userId);
  if (!(await volumeExists(volumeName))) return "";
  const { stdout } = await docker(
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/opt/data:ro`,
      "alpine",
      ...argv,
    ],
    { timeoutMs: 60_000 }
  );
  return stdout;
}

export function isMachineRunning(state) {
  return state === "started" || state === "running";
}

function normalizeState(raw) {
  if (isMachineRunning(raw)) return "running";
  if (raw === "created") return "stopped";
  return raw;
}

export async function quickState(userId) {
  const instance = await getInstance(userId);
  const ref = instance?.machine_name || instance?.machine_id;
  if (!ref) return "missing";
  return normalizeState(await getContainerState(ref));
}

export async function resolveContainerName(userId) {
  const instance = await getInstance(userId);
  if (instance?.machine_name) return instance.machine_name;
  const user = await getUserById(userId);
  return machineNameForUser(userId, user?.name);
}

export async function resolveMachineId(userId) {
  const instance = await getInstance(userId);
  return instance?.machine_name || instance?.machine_id || null;
}

async function waitForHealth(containerName, signal) {
  const url = `http://${containerName}:${MUSELY_AGENT_PORT}/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");

    const state = await getContainerState(containerName);
    if (state === "stopped" || state === "missing") {
      throw new Error(
        `Hermes container exited before becoming healthy (state=${state}). ` +
          `Check: docker logs ${containerName}`
      );
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `Musely agent instance did not become healthy in time${lastErr ? `: ${lastErr.message}` : ""}`
  );
}

async function provisionInstance(userId) {
  let instance = await getInstance(userId);
  if (instance?.machine_id || instance?.machine_name) return instance;

  const user = await getUserById(userId);
  const containerName = machineNameForUser(userId, user?.name);
  const volumeName = volumeNameForUser(userId);
  const apiKey = newApiKey();

  await createContainer({ containerName, volumeName, apiKey, userId });
  await startContainer(containerName);

  return createInstanceRecord({
    userId,
    machineName: containerName,
    machineId: containerName,
    volumeId: volumeName,
    apiKey,
  });
}

export function ensureInstance(userId) {
  if (!orchestratorConfigured()) {
    throw new Error(
      "Musely agent docker orchestrator is not available (docker socket + MUSELY_AGENT_IMAGE)"
    );
  }
  if (inflight.has(userId)) return inflight.get(userId);

  const p = (async () => {
    const t0 = Date.now();
    const logStep = (step) =>
      console.log(`[orchestrator:docker] ensure user=${userId} +${Date.now() - t0}ms ${step}`);

    let instance = await provisionInstance(userId);
    logStep("provisioned");

    await syncMuselyApiEnvToUserVolume(userId);
    logStep("musely api env synced");

    let containerName = instance.machine_name;
    let { api_key: apiKey } = instance;
    let state = await getContainerState(containerName);

    if (state === "missing") {
      const user = await getUserById(userId);
      containerName = machineNameForUser(userId, user?.name);
      const volumeName = volumeNameForUser(userId);
      await createContainer({
        containerName,
        volumeName,
        apiKey,
        userId,
      });
      await updateInstanceMachineId(userId, containerName, containerName);
      await setInstanceStatus(userId, "starting");
      state = "created";
    }

    if (state === "stopped" || state === "created") {
      await setInstanceStatus(userId, "starting");
      await startContainer(containerName);
    }

    logStep(`container started (${containerName})`);
    await waitForHealth(containerName);
    logStep("healthy");
    await restartGatewayIfRunning(containerName);
    await touchInstance(userId);

    return {
      baseUrl: baseUrlForContainer(containerName),
      apiKey,
      machineId: containerName,
      machineName: containerName,
      containerName,
    };
  })().finally(() => inflight.delete(userId));

  inflight.set(userId, p);
  return p;
}

export async function noteActivity(userId) {
  try {
    await touchInstance(userId);
  } catch {
    /* ignore */
  }
}

export async function stopInstance(userId, containerRef) {
  await stopContainer(containerRef);
  await setInstanceStatus(userId, "stopped");
}

export async function stopIdleInstances() {
  if (!orchestratorConfigured()) return;
  let idle = [];
  try {
    idle = await listIdleInstances(IDLE_MINUTES);
  } catch (err) {
    console.error("[orchestrator:docker] listIdleInstances failed:", err.message);
    return;
  }
  for (const inst of idle) {
    try {
      const ref = inst.machine_name || inst.machine_id;
      await stopInstance(inst.user_id, ref);
      console.log(`[orchestrator:docker] stopped idle container ${inst.machine_name}`);
    } catch (err) {
      console.error(`[orchestrator:docker] failed to stop ${inst.machine_name}:`, err.message);
    }
  }
}

let reaperTimer = null;

export function startIdleReaper() {
  if (!orchestratorConfigured()) {
    console.log("[orchestrator:docker] disabled (no docker socket / MUSELY_AGENT_IMAGE)");
    return;
  }
  if (reaperTimer) return;
  const intervalMs = Number(process.env.MUSELY_AGENT_REAPER_INTERVAL_MS) || 60_000;
  reaperTimer = setInterval(() => {
    stopIdleInstances().catch((err) =>
      console.error("[orchestrator:docker] reaper tick failed:", err.message)
    );
  }, intervalMs);
  if (reaperTimer.unref) reaperTimer.unref();
  console.log(
    `[orchestrator:docker] idle reaper started (idle=${IDLE_MINUTES}m, interval=${intervalMs}ms)`
  );
}

export const ORCHESTRATOR_SETTINGS = {
  mode: "docker",
  image: MUSELY_AGENT_IMAGE,
  network: MUSELY_AGENT_NETWORK,
  idleMinutes: IDLE_MINUTES,
  memoryMb: USER_MEMORY_MB,
};
