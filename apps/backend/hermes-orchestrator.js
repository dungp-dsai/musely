// Per-user Hermes orchestration via the Fly Machines API.
//
// Each user gets a dedicated Fly Machine + persistent volume inside
// FLY_AGENT_APP. Machines are started on demand and stopped when idle.
// The backend reaches running machines through Fly's internal 6PN network:
//   http://<machine-id>.vm.<FLY_AGENT_APP>.internal:<HERMES_PORT>/v1

import { randomBytes } from "node:crypto";
import {
  getInstance,
  getUserById,
  createInstanceRecord,
  updateInstanceMachineId,
  setInstanceStatus,
  touchInstance,
  listIdleInstances,
} from "./db.js";

// Fly strips FLY_API_TOKEN from app runtime (reserved for flyctl/CI). Use MACHINES_API_TOKEN.
function machinesApiToken() {
  return process.env.MACHINES_API_TOKEN || process.env.FLY_API_TOKEN;
}

const FLY_AGENT_APP = process.env.FLY_AGENT_APP;
const FLY_AGENT_IMAGE = process.env.FLY_AGENT_IMAGE;
const FLY_AGENT_REGION = process.env.FLY_AGENT_REGION || "sin";
const FLY_API_BASE = `https://${process.env.FLY_API_HOSTNAME || "api.machines.dev"}`;

const HERMES_PORT = Number(process.env.HERMES_PORT) || 8642;
const IDLE_MINUTES = Number(process.env.HERMES_IDLE_MINUTES) || 15;
const USER_MEMORY_MB = Number(process.env.HERMES_USER_MEMORY_MB) || 2048;
const USER_CPUS = Number(process.env.HERMES_USER_CPUS) || 1;
const HEALTH_TIMEOUT_MS = Number(process.env.HERMES_HEALTH_TIMEOUT_MS) || 180_000;

// Headless gateway + API server (default image CMD is interactive `hermes` TUI).
const GATEWAY_CMD = ["hermes", "gateway", "run", "--no-supervise", "-q", "--accept-hooks"];

// Coalesce concurrent ensure() calls per user.
const inflight = new Map();

// ---------- Availability ----------

export function orchestratorConfigured() {
  if (process.env.HERMES_ORCHESTRATOR === "disabled") return false;
  return Boolean(machinesApiToken() && FLY_AGENT_APP && FLY_AGENT_IMAGE);
}

export function templateConfigured() {
  return Boolean(FLY_AGENT_IMAGE);
}

// ---------- Fly Machines API helpers ----------

async function flyRequest(method, path, body) {
  const url = `${FLY_API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${machinesApiToken()}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) throw new Error(`Fly API ${method} ${path}: HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`Fly API ${method} ${path}: ${res.status} ${msg}`);
  }
  return data;
}

// ---------- Naming helpers ----------

export function machineNameForUser(userId, userName) {
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

function volumeNameForUser(userId) {
  // Volume names must match ^[a-zA-Z][a-zA-Z0-9_]*$
  return `hermes_user_${userId}`;
}

function baseUrlForMachine(machineId) {
  return `http://${machineId}.vm.${FLY_AGENT_APP}.internal:${HERMES_PORT}/v1`;
}

function newApiKey() {
  return randomBytes(32).toString("hex");
}

// ---------- Fly Machines operations ----------

async function getMachineState(machineId) {
  try {
    const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
    return machine?.state || "unknown";
  } catch {
    return "missing";
  }
}

async function findExistingVolume(userId) {
  try {
    const vols = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/volumes`);
    return vols?.find((v) => v.name === volumeNameForUser(userId) && v.state !== "destroyed")?.id ?? null;
  } catch {
    return null;
  }
}

async function createVolume(userId) {
  const vol = await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/volumes`, {
    name: volumeNameForUser(userId),
    size_gb: 1,
    region: FLY_AGENT_REGION,
  });
  return vol.id;
}

function machineConfig({ volumeId, apiKey, userId }) {
  const env = {
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: "0.0.0.0",
    API_SERVER_PORT: String(HERMES_PORT),
    API_SERVER_KEY: apiKey,
    API_SERVER_MODEL_NAME: process.env.HERMES_API_MODEL_NAME || "Hermes Agent",
    AGENT_USER_ID: String(userId),
  };
  if (process.env.AGENT_API_KEY) env.AGENT_API_KEY = process.env.AGENT_API_KEY;

  return {
    image: FLY_AGENT_IMAGE,
    env,
    mounts: [{ volume: volumeId, path: "/opt/data" }],
    init: {
      cmd: GATEWAY_CMD,
    },
    restart: { policy: "no" },
    guest: {
      cpu_kind: "shared",
      cpus: USER_CPUS,
      memory_mb: USER_MEMORY_MB,
    },
  };
}

async function createMachine({ machineName, volumeId, apiKey, userId }) {
  const machine = await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines`, {
    name: machineName,
    region: FLY_AGENT_REGION,
    config: machineConfig({ volumeId, apiKey, userId }),
    // Boot on create. skip_launch leaves machines in "created" where /start does not work.
  });
  return machine;
}

/** /start only works from "stopped". Machines in "created" must be launched via update. */
async function launchMachine(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config) throw new Error("Machine config missing");
  await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`, {
    config: machine.config,
    skip_launch: false,
  });
}

async function startMachine(machineId) {
  await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/start`);
}

/** Patch stopped machines that still use the interactive default CMD. */
async function ensureMachineGatewayCmd(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config) return;
  const current = machine.config.init?.cmd;
  if (JSON.stringify(current) === JSON.stringify(GATEWAY_CMD)) return;
  await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`, {
    config: { ...machine.config, init: { ...machine.config.init, cmd: GATEWAY_CMD } },
    skip_launch: true,
  });
}

async function stopMachine(machineId) {
  try {
    await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/stop`, {
      signal: "SIGTERM",
      timeout: 30,
    });
  } catch {
    /* already stopped or destroyed */
  }
}

const FLY_WAIT_MAX_SEC = 60; // Fly Machines API: WaitMachineRequest.Timeout must be in [1s, 60s]

async function waitForMachineState(machineId, state, totalTimeoutSec = 60) {
  const deadline = Date.now() + Math.max(1, totalTimeoutSec) * 1000;
  while (Date.now() < deadline) {
    const remainingSec = Math.ceil((deadline - Date.now()) / 1000);
    const chunkSec = Math.min(FLY_WAIT_MAX_SEC, Math.max(1, remainingSec));
    try {
      await flyRequest(
        "GET",
        `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/wait?state=${state}&timeout=${chunkSec}`
      );
      return;
    } catch (err) {
      const msg = err.message || "";
      const timedOut =
        msg.includes("timeout") || msg.includes("408") || msg.includes("deadline exceeded");
      if (!timedOut || Date.now() >= deadline) throw err;
    }
  }
}

// ---------- Exported orchestrator primitives ----------

/** Exec a command inside a running machine. Returns stdout string. */
export async function execInContainer(machineId, argv, opts = {}) {
  const timeoutSec = opts.timeoutMs ? Math.ceil(opts.timeoutMs / 1000) : 30;
  const result = await flyRequest(
    "POST",
    `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/exec`,
    { cmd: argv, timeout: timeoutSec }
  );
  if (result?.exit_code !== 0) {
    throw new Error(result?.stderr?.trim() || `exec exited with code ${result?.exit_code}`);
  }
  return result?.stdout || "";
}

/**
 * Lightweight volume read without forcing a cold start.
 * With Fly Machines we cannot mount a volume read-only into a transient container
 * without starting a full machine, so this returns empty.
 * Callers should gracefully handle an empty/missing result.
 */
export async function runTransientReader(_userId, _argv, _opts = {}) {
  return "";
}

/** Fly Machines API uses "started"; DB status uses "running". */
export function isMachineRunning(state) {
  return state === "started" || state === "running";
}

function normalizeMachineState(flyState) {
  if (isMachineRunning(flyState)) return "running";
  if (flyState === "created") return "stopped";
  return flyState;
}

/** Fast container state check without starting the machine. */
export async function quickState(userId) {
  const instance = await getInstance(userId);
  if (!instance?.machine_id) return "missing";
  const flyState = await getMachineState(instance.machine_id);
  return normalizeMachineState(flyState);
}

/** Resolve the display name (machine_name) for a user — does not start anything. */
export async function resolveContainerName(userId) {
  const instance = await getInstance(userId);
  if (instance?.machine_name) return instance.machine_name;
  const user = await getUserById(userId);
  return machineNameForUser(userId, user?.name);
}

/** Resolve the Fly machine_id needed for exec operations. */
export async function resolveMachineId(userId) {
  const instance = await getInstance(userId);
  return instance?.machine_id ?? null;
}

// ---------- Health polling ----------

async function waitForHealth(machineId, signal) {
  const url = `http://${machineId}.vm.${FLY_AGENT_APP}.internal:${HERMES_PORT}/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");

    const state = await getMachineState(machineId);
    if (state === "stopped" || state === "destroyed") {
      throw new Error(
        `Hermes machine exited before becoming healthy (state=${state}). ` +
          `Check: flyctl logs -a ${FLY_AGENT_APP} --machine ${machineId}`
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
    `Hermes instance did not become healthy in time${lastErr ? `: ${lastErr.message}` : ""}`
  );
}

// ---------- Provisioning ----------

async function provisionInstance(userId) {
  let instance = await getInstance(userId);

  if (instance?.machine_id) return instance; // already provisioned

  const user = await getUserById(userId);
  const machineName = machineNameForUser(userId, user?.name);
  const apiKey = newApiKey();

  const volumeId = (await findExistingVolume(userId)) || (await createVolume(userId));
  const machine = await createMachine({ machineName, volumeId, apiKey, userId });

  return createInstanceRecord({
    userId,
    machineName,
    machineId: machine.id,
    volumeId,
    apiKey,
  });
}

/**
 * Ensure the user's Hermes machine exists, is running, and is healthy.
 * Returns { baseUrl, apiKey, machineId, machineName, containerName }.
 * Concurrent calls for the same userId are coalesced into one promise.
 */
export function ensureInstance(userId) {
  if (!orchestratorConfigured()) {
    throw new Error(
      "Hermes orchestrator is not available (set MACHINES_API_TOKEN, FLY_AGENT_APP, FLY_AGENT_IMAGE)"
    );
  }
  if (inflight.has(userId)) return inflight.get(userId);

  const p = (async () => {
    const t0 = Date.now();
    const logStep = (step) => console.log(`[orchestrator] ensure user=${userId} +${Date.now() - t0}ms ${step}`);

    let instance = await provisionInstance(userId);
    logStep("provisioned");
    let { machine_id: machineId, machine_name: machineName, api_key: apiKey } = instance;

    const state = await getMachineState(machineId);

    if (state === "destroyed" || state === "missing") {
      // Machine was deleted externally; recreate it (volume persists). Boots on create.
      const user = await getUserById(userId);
      const newName = machineNameForUser(userId, user?.name);
      const volumeId = (await findExistingVolume(userId)) || (await createVolume(userId));
      const newMachine = await createMachine({ machineName: newName, volumeId, apiKey, userId });
      await updateInstanceMachineId(userId, newMachine.id, newName);
      machineId = newMachine.id;
      machineName = newName;
      await setInstanceStatus(userId, "starting");
    } else if (state === "created") {
      // skip_launch leftovers or mid-provision — /start rejects "created"; launch via update.
      await setInstanceStatus(userId, "starting");
      await ensureMachineGatewayCmd(machineId);
      await launchMachine(machineId);
    } else if (state === "stopped") {
      await setInstanceStatus(userId, "starting");
      await ensureMachineGatewayCmd(machineId);
      await startMachine(machineId);
    }
    // state === "started" → already running, fall through to health check

    await waitForMachineState(machineId, "started", 120);
    logStep(`machine started (${machineId})`);
    await waitForHealth(machineId);
    logStep("healthy");
    await touchInstance(userId);

    return {
      baseUrl: baseUrlForMachine(machineId),
      apiKey,
      machineId,
      machineName,
      containerName: machineId, // backward-compat alias used by hermes-cron.js
    };
  })().finally(() => inflight.delete(userId));

  inflight.set(userId, p);
  return p;
}

/** Record activity without forcing a start. */
export async function noteActivity(userId) {
  try {
    await touchInstance(userId);
  } catch {
    /* ignore */
  }
}

export async function stopInstance(userId, machineId) {
  await stopMachine(machineId);
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
      await stopInstance(inst.user_id, inst.machine_id);
      console.log(`[orchestrator] stopped idle machine ${inst.machine_name}`);
    } catch (err) {
      console.error(`[orchestrator] failed to stop ${inst.machine_name}:`, err.message);
    }
  }
}

let reaperTimer = null;

export function startIdleReaper() {
  if (!orchestratorConfigured()) {
    console.log("[orchestrator] disabled (MACHINES_API_TOKEN / FLY_AGENT_APP not set)");
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
  console.log(`[orchestrator] idle reaper started (idle=${IDLE_MINUTES}m, interval=${intervalMs}ms)`);
}

export const ORCHESTRATOR_SETTINGS = {
  app: FLY_AGENT_APP,
  image: FLY_AGENT_IMAGE,
  region: FLY_AGENT_REGION,
  idleMinutes: IDLE_MINUTES,
  memoryMb: USER_MEMORY_MB,
  cpus: USER_CPUS,
};
