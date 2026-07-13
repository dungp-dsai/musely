// Per-user Musely agent orchestration via the Fly Machines API.
//
// HARD CONSTRAINTS (do not regress): docs/fly-agent-gateway-sync.md
//   - Always --no-supervise + HERMES_GATEWAY_NO_SUPERVISE=1 on Fly
//   - Never hermes gateway restart (kills VM)
//   - Plain sh exec for /opt/data writes (no nested unshare+/init)
//   - Recreate machines only on Fly 404 / destroyed
//
// Each user gets a dedicated Fly Machine + persistent volume inside
// FLY_AGENT_APP. Machines are started on demand and stopped when idle.
// The backend reaches running machines through Fly's internal 6PN network:
//   http://<machine-id>.vm.<FLY_AGENT_APP>.internal:<MUSELY_AGENT_PORT>/v1

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
import {
  buildPlatformSyncShell,
  buildPlatformSyncVerifyShell,
  buildMuselyApiEnvShell,
  createPlatformTarBuffer,
  chunkBase64,
  platformDirOrThrow,
  normalizeSyncSections,
  needsPlatformFiles,
  SYNC_SECTIONS,
} from "./musely-agent-platform-sync-runner.js";
import { getMuselyAgentApiEnv } from "./musely-agent-api-env.js";

// Fly strips FLY_API_TOKEN from app runtime (reserved for flyctl/CI). Use MACHINES_API_TOKEN.
function machinesApiToken() {
  return process.env.MACHINES_API_TOKEN || process.env.FLY_API_TOKEN;
}

const FLY_AGENT_APP = process.env.FLY_AGENT_APP;
const FLY_AGENT_IMAGE = process.env.FLY_AGENT_IMAGE;
const FLY_AGENT_REGION = process.env.FLY_AGENT_REGION || "sin";
const FLY_API_BASE = `https://${process.env.FLY_API_HOSTNAME || "api.machines.dev"}`;

const MUSELY_AGENT_PORT = Number(process.env.MUSELY_AGENT_PORT) || 8642;
const IDLE_MINUTES = Number(process.env.MUSELY_AGENT_IDLE_MINUTES) || 15;
const USER_MEMORY_MB = Number(process.env.MUSELY_AGENT_USER_MEMORY_MB) || 2048;
const USER_CPUS = Number(process.env.MUSELY_AGENT_USER_CPUS) || 1;
const HEALTH_TIMEOUT_MS = Number(process.env.MUSELY_AGENT_HEALTH_TIMEOUT_MS) || 180_000;

// Headless gateway + API server. Must use --no-supervise on Fly: our entrypoint
 // nests Hermes /init under unshare, and Hermes's default "auto-supervise"
 // redirect exits the main process (~SIGTERM/143) within seconds of boot.
 // Tradeoff: `hermes gateway restart` also exits the VM — never call it here.
const GATEWAY_CMD = ["hermes", "gateway", "run", "--no-supervise", "-q", "--accept-hooks", "--replace"];
const GATEWAY_CMD_STR = GATEWAY_CMD.join(" ");
const FLY_SYNC_IMAGE = process.env.FLY_SYNC_IMAGE || "alpine:3.20";
const BROKEN_SUPERVISED_CMD = ["hermes", "gateway", "run", "-q", "--accept-hooks", "--replace"];

/** Fly GET often returns init.cmd as one string; Machines spawn needs argv[]. */
function normalizeInitCmd(cmd) {
  if (Array.isArray(cmd) && cmd.length > 0) return cmd;
  if (typeof cmd === "string") {
    const trimmed = cmd.trim();
    if (!trimmed) return GATEWAY_CMD;
    if (trimmed === GATEWAY_CMD_STR) return GATEWAY_CMD;
    if (trimmed === BROKEN_SUPERVISED_CMD.join(" ")) return GATEWAY_CMD;
    if (trimmed === "sleep infinity" || trimmed === "sleep inf") return ["sleep", "infinity"];
    return ["sh", "-c", cmd];
  }
  return GATEWAY_CMD;
}

/** Ensure agent machine config uses Hermes image + argv CMD (not a flattened string). */
function normalizeAgentMachineConfig(config) {
  const out = JSON.parse(JSON.stringify(config || {}));
  out.image = out.image && out.image !== FLY_SYNC_IMAGE ? out.image : FLY_AGENT_IMAGE;
  const init = { ...(out.init || {}) };
  delete init.exec;
  init.cmd = normalizeInitCmd(init.cmd);
  out.init = init;
  return out;
}

function machineNeedsHermesRepair(config) {
  if (!config) return true;
  const image = String(config.image || "");
  if (image.includes("alpine") || image.endsWith(FLY_SYNC_IMAGE)) return true;
  if (config.init?.exec) return true;
  if (typeof config.init?.cmd === "string") return true;
  return JSON.stringify(normalizeInitCmd(config.init?.cmd)) !== JSON.stringify(GATEWAY_CMD);
}

async function quickHealthCheck(machineId) {
  const url = `http://${machineId}.vm.${FLY_AGENT_APP}.internal:${MUSELY_AGENT_PORT}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fix alpine / broken cmd left from old sync flows — stop + update config, never destroy. */
async function repairHermesMachine(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config || !machineNeedsHermesRepair(machine.config)) return;

  console.log(`[orchestrator] repairing machine ${machineId} (restore Hermes image/cmd)`);
  const wasRunning = isMachineRunning(machine.state);
  if (wasRunning) {
    await stopMachine(machineId);
    await waitForMachineState(machineId, "stopped", 120);
  }

  await updateMachineConfig(
    machineId,
    normalizeAgentMachineConfig({
      ...machine.config,
      env: {
        ...(machine.config.env || {}),
        API_SERVER_HOST: "::",
        HERMES_GATEWAY_NO_SUPERVISE: "1",
      },
    }),
    { launch: false }
  );
}

// Coalesce concurrent ensure() calls per user.
const inflight = new Map();

// ---------- Availability ----------

export function orchestratorConfigured() {
  if (process.env.MUSELY_AGENT_ORCHESTRATOR === "disabled") return false;
  return Boolean(machinesApiToken() && FLY_AGENT_APP && FLY_AGENT_IMAGE);
}

export function templateConfigured() {
  return Boolean(FLY_AGENT_IMAGE);
}

// ---------- Fly Machines API helpers ----------

function flyApiError(method, path, status, detail) {
  const err = new Error(`Fly API ${method} ${path}: ${status} ${detail}`);
  err.status = status;
  return err;
}

/** True only when Fly confirms this machine id does not exist (not auth/network/5xx). */
function isFlyMachineNotFoundError(err) {
  return err?.status === 404;
}

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
    if (!res.ok) throw flyApiError(method, path, res.status, `HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw flyApiError(method, path, res.status, msg);
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
    if (slug) return `musely-agent-${slug}-${userId}`;
  }
  return `musely-agent-user-${userId}`;
}

function volumeNameForUser(userId) {
  // Volume names must match ^[a-zA-Z][a-zA-Z0-9_]*$
  return `musely_agent_user_${userId}`;
}

function baseUrlForMachine(machineId) {
  return `http://${machineId}.vm.${FLY_AGENT_APP}.internal:${MUSELY_AGENT_PORT}/v1`;
}

function newApiKey() {
  return randomBytes(32).toString("hex");
}

// ---------- Fly Machines operations ----------

async function getMachineState(machineId) {
  try {
    const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
    return machine?.state || "unknown";
  } catch (err) {
    // Only treat genuine "machine id gone" as missing. Auth/network/5xx must not
    // look like a deleted machine or ensure() will create orphan replacements.
    if (isFlyMachineNotFoundError(err)) return "missing";
    throw err;
  }
}

async function findExistingVolume(userId) {
  try {
    const vols = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/volumes`);
    const primary = volumeNameForUser(userId);
    const legacy = `hermes_user_${userId}`;
    return (
      vols?.find((v) => v.name === primary && v.state !== "destroyed")?.id ??
      vols?.find((v) => v.name === legacy && v.state !== "destroyed")?.id ??
      null
    );
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
  const muselyApi = getMuselyAgentApiEnv(userId);
  const env = {
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: "::",
    API_SERVER_PORT: String(MUSELY_AGENT_PORT),
    API_SERVER_KEY: apiKey,
    API_SERVER_MODEL_NAME: process.env.MUSELY_AGENT_API_MODEL_NAME || "Musely Agent",
    AGENT_USER_ID: muselyApi.AGENT_USER_ID,
    CLIENT_URL: muselyApi.CLIENT_URL,
    AGENT_API_KEY: muselyApi.AGENT_API_KEY,
    HERMES_GATEWAY_NO_SUPERVISE: "1",
  };
  for (const key of [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GLM_API_KEY",
    "KIMI_API_KEY",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }

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

function isFlyExecTimeoutError(err) {
  const msg = err?.message || "";
  return (
    err?.status === 408 ||
    msg.includes("deadline_exceeded") ||
    msg.includes("Client.Timeout exceeded while awaiting headers")
  );
}

/** Guest dropped the exec connection (machine dying/restarting mid-command). */
function isFlyExecEofError(err) {
  const msg = err?.message || "";
  return (
    err?.status === 412 ||
    msg.includes("failed_precondition") ||
    /\bEOF\b/.test(msg)
  );
}

function isFlyMachineNotRunningError(err) {
  const msg = err?.message || "";
  return /machine not running/i.test(msg);
}

function isFlyExecRetryableError(err) {
  // "machine not running" needs a start, not blind retries against a stopped VM.
  if (isFlyMachineNotRunningError(err)) return false;
  return isFlyExecTimeoutError(err) || isFlyExecEofError(err) || err?.status === 409;
}

/** Fly marks VM started before guest exec is ready — probe until a trivial cmd works. */
async function waitForMachineExecReady(machineId, totalTimeoutSec = 90) {
  const deadline = Date.now() + Math.max(1, totalTimeoutSec) * 1000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await execInContainer(machineId, ["sh", "-c", "echo ok"], {
        timeoutMs: 10_000,
        retries: 1,
      });
      return;
    } catch (err) {
      lastErr = err;
      if (!isFlyExecRetryableError(err) && err?.status) throw err;
      await flySleep(1500);
    }
  }
  throw lastErr || new Error(`Machine ${machineId} not ready for exec`);
}

/** Start machine if needed for volume exec; returns true when this call started it. */
async function ensureMachineRunningForOps(machineId) {
  let state = await getMachineState(machineId);
  if (isTransitionalMachineState(state)) {
    state = await waitForMachineStable(machineId, 120);
  }
  if (state === "missing" || state === "destroyed") {
    throw flyApiError("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`, 404, "machine not found");
  }

  // May stop/start once to restore --no-supervise on machines broken by supervised CMD.
  await ensureForegroundGateway(machineId);
  state = await getMachineState(machineId);
  if (isTransitionalMachineState(state)) {
    state = await waitForMachineStable(machineId, 120);
  }
  if (isMachineRunning(state)) return false;
  await ensureMachineGatewayCmd(machineId);
  if (state === "created") await launchMachine(machineId);
  else await startMachine(machineId);
  await waitForMachineState(machineId, "started", 120);
  await waitForMachineExecReady(machineId, 90);
  return true;
}

/** Sync selected platform parts from backend storage into user volume.
 *  Never replaces or destroys the user machine — only stop/start + exec on the same machine ID. */
export async function syncPlatformToUserVolume(userId, { sections, stopAfterSync = true } = {}) {
  const instance = await getInstance(userId);
  const machineId = instance?.machine_id;
  if (!machineId) throw new Error("No agent machine for user — provision first");

  const normalized = normalizeSyncSections(sections);
  const syncScript = buildPlatformSyncShell({
    platformPath: "/tmp/musely-platform",
    dataPath: "/opt/data",
    sections: normalized,
  });
  const verifyScript = buildPlatformSyncVerifyShell({
    dataPath: "/opt/data",
    sections: normalized,
  });

  const startedForSync = await ensureMachineRunningForOps(machineId);

  try {
    if (needsPlatformFiles(normalized)) {
      const platformDir = platformDirOrThrow();
      const tarBuffer = await createPlatformTarBuffer(platformDir, normalized);
      const chunks = chunkBase64(tarBuffer);

      await execInContainer(machineId, [
        "sh",
        "-c",
        "rm -rf /tmp/musely-platform /tmp/platform.tgz /tmp/platform.tgz.b64 && mkdir -p /tmp/musely-platform",
      ]);

      for (const chunk of chunks) {
        const escaped = chunk.replace(/'/g, `'\\''`);
        await execInContainer(machineId, [
          "sh",
          "-c",
          `printf '%s' '${escaped}' >> /tmp/platform.tgz.b64`,
        ]);
      }

      await execInContainer(
        machineId,
        [
          "sh",
          "-c",
          "test -s /tmp/platform.tgz.b64 && " +
            "(base64 -d /tmp/platform.tgz.b64 2>/dev/null || base64 -D /tmp/platform.tgz.b64) > /tmp/platform.tgz && " +
            "test -s /tmp/platform.tgz && " +
            "tar -xzf /tmp/platform.tgz -C /tmp/musely-platform",
        ],
        { timeoutMs: 120_000 }
      );
    }

    const out = await execOnAgentVolume(machineId, syncScript, { timeoutMs: 120_000 });
    console.log(`[orchestrator] platform sync user=${userId}: ${out.trim()}`);
    await execOnAgentVolume(machineId, verifyScript, { timeoutMs: 60_000 });
  } finally {
    if (startedForSync && stopAfterSync) {
      await stopMachine(machineId);
      await waitForMachineState(machineId, "stopped", 120);
      await setInstanceStatus(userId, "stopped");
    }
  }
}

/** Write Musely API credentials into /opt/data/.env on the user's volume. */
async function syncMuselyApiEnvToUserVolume(userId, { restartGateway: _restartGateway = false } = {}) {
  const instance = await getInstance(userId);
  const machineId = instance?.machine_id;
  if (!machineId) return;

  const script = buildMuselyApiEnvShell({ dataPath: "/opt/data", userId });
  const startedForSync = await ensureMachineRunningForOps(machineId);
  try {
    await execOnAgentVolume(machineId, script, { timeoutMs: 60_000 });
    // Never `hermes gateway restart` — with --no-supervise it SIGTERMs the VM.
  } finally {
    if (startedForSync) {
      await stopMachine(machineId);
      await waitForMachineState(machineId, "stopped", 120);
      await setInstanceStatus(userId, "stopped");
    }
  }
}

export async function restartUserAgentIfRunning(userId, { sections: _sections } = {}) {
  // In-place gateway restart is unsafe on Fly (exits the machine). No-op.
  const instance = await getInstance(userId);
  if (instance?.machine_id) await touchInstance(userId);
}

/**
 * After admin sync: files are already on /opt/data. Do not restart the gateway —
 * that exits the Fly machine (412 machine not running / EOF). Config/skills apply
 * on the next cold start (idle stop → ensure).
 */
export async function restartUserAgentAfterSync(userId, { restartGateway: _restartGateway = true } = {}) {
  const instance = await getInstance(userId);
  const machineId = instance?.machine_id;
  if (!machineId) throw new Error("No agent machine for user — provision first");

  await ensureMachineRunningForOps(machineId);
  await touchInstance(userId);
}

/** /start only works from "stopped". Machines in "created" must be launched via update. */
async function launchMachine(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config) throw new Error("Machine config missing");
  await updateMachineConfig(machineId, normalizeAgentMachineConfig(machine.config), {
    launch: true,
  });
  await waitForMachineState(machineId, "started", 120);
}

async function startMachine(machineId, { retries = 8 } = {}) {
  await waitForMachineStable(machineId, 120);
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/start`);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err.message || "";
      if (
        msg.includes("getting replaced") ||
        msg.includes("412") ||
        msg.includes("failed_precondition")
      ) {
        await flySleep(1500 * (i + 1));
        await waitForMachineStable(machineId, 60);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`Failed to start machine ${machineId}`);
}

/** Patch machines that were migrated to broken supervised CMD (exits with 143 on Fly). */
async function ensureForegroundGateway(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config) return;

  const current = normalizeInitCmd(machine.config.init?.cmd);
  const env = { ...(machine.config.env || {}) };
  const needsCmd = JSON.stringify(current) !== JSON.stringify(GATEWAY_CMD);
  const needsEnv = env.HERMES_GATEWAY_NO_SUPERVISE !== "1" || env.API_SERVER_HOST !== "::";
  if (!needsCmd && !needsEnv) return;

  console.log(`[orchestrator] restoring --no-supervise on ${machineId} (supervised CMD exits on Fly)`);
  const wasRunning = isMachineRunning(machine.state);
  if (wasRunning || isTransitionalMachineState(machine.state)) {
    await stopMachine(machineId);
    await waitForMachineState(machineId, "stopped", 120);
  }

  env.HERMES_GATEWAY_NO_SUPERVISE = "1";
  env.API_SERVER_HOST = "::";
  await updateMachineConfig(
    machineId,
    normalizeAgentMachineConfig({
      ...machine.config,
      env,
      init: { ...(machine.config.init || {}), cmd: GATEWAY_CMD },
    }),
    { launch: false }
  );

  if (wasRunning) {
    await startMachine(machineId);
    await waitForMachineState(machineId, "started", 120);
    await waitForMachineExecReady(machineId, 90);
  }
}

/** Patch stopped machines missing foreground-gateway settings. */
async function ensureMachineGatewayCmd(machineId) {
  const machine = await flyRequest("GET", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`);
  if (!machine?.config) return;
  const current = normalizeInitCmd(machine.config.init?.cmd);
  const env = machine.config.env || {};
  const needsCmd = JSON.stringify(current) !== JSON.stringify(GATEWAY_CMD);
  const needsEnv = env.API_SERVER_HOST !== "::" || env.HERMES_GATEWAY_NO_SUPERVISE !== "1";
  if (!needsCmd && !needsEnv) return;
  await updateMachineConfig(
    machineId,
    normalizeAgentMachineConfig({
      ...machine.config,
      env: { ...env, API_SERVER_HOST: "::", HERMES_GATEWAY_NO_SUPERVISE: "1" },
    }),
    { launch: false }
  );
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

const flySleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransitionalMachineState(state) {
  return (
    state === "replacing" ||
    state === "replaced" ||
    state === "starting" ||
    state === "stopping" ||
    state === "destroying"
  );
}

/** Wait until Fly finishes a config replace / stop / start transition. */
async function waitForMachineStable(machineId, totalTimeoutSec = 120) {
  const deadline = Date.now() + Math.max(1, totalTimeoutSec) * 1000;
  while (Date.now() < deadline) {
    const state = await getMachineState(machineId);
    if (!isTransitionalMachineState(state)) return state;
    await flySleep(1000);
  }
  throw new Error(`Machine ${machineId} stuck in transitional state`);
}

async function updateMachineConfig(machineId, config, { launch = false } = {}) {
  await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}`, {
    config,
    skip_launch: !launch,
  });
  await waitForMachineStable(machineId, 120);
  if (!launch) {
    try {
      await waitForMachineState(machineId, "stopped", 90);
    } catch {
      const state = await getMachineState(machineId);
      if (state !== "stopped" && state !== "created") {
        throw new Error(`Machine ${machineId} not quiescent after config update (state=${state})`);
      }
    }
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

/** Fly exec API accepts cmd as a single shell string, not argv[]. */
function shellQuoteSingle(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function argvToFlyCmd(argv) {
  if (typeof argv === "string") return argv;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("exec argv must be a non-empty array or string");
  }
  if (argv[0] === "sh" && argv[1] === "-c") {
    const script = argv.slice(2).join(" ");
    return `sh -c ${shellQuoteSingle(script)}`;
  }
  return argv.map(shellQuoteSingle).join(" ");
}

// Fly Machines exec timeout is capped at 60s (API rejects higher values).
const FLY_EXEC_MAX_TIMEOUT_SEC = 60;

/** Exec a command inside a running machine. Returns stdout string. */
export async function execInContainer(machineId, argv, opts = {}) {
  const timeoutSec = Math.min(
    FLY_EXEC_MAX_TIMEOUT_SEC,
    Math.max(1, opts.timeoutMs ? Math.ceil(opts.timeoutMs / 1000) : 30)
  );
  const retries = opts.retries ?? 3;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await flyRequest(
        "POST",
        `/v1/apps/${FLY_AGENT_APP}/machines/${machineId}/exec`,
        { cmd: argvToFlyCmd(argv), timeout: timeoutSec }
      );
      if (result?.exit_code !== 0) {
        throw new Error(result?.stderr?.trim() || `exec exited with code ${result?.exit_code}`);
      }
      return result?.stdout || "";
    } catch (err) {
      lastErr = err;
      // Cold start / guest dying mid-exec — retry timeouts and 412 EOF, not command failures.
      if (!isFlyExecRetryableError(err) || attempt === retries) throw err;
      console.warn(
        `[orchestrator] exec retry on ${machineId} (attempt ${attempt}/${retries}): ${err.message}`
      );
      await flySleep(1500 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Run a shell script with the machine's mounted /opt/data visible.
 * Use plain Fly exec — do NOT nest unshare+/init (that boots a second s6 stack and
 * routinely 408s with "Client.Timeout exceeded while awaiting headers").
 */
async function execOnAgentVolume(machineId, shellScript, opts = {}) {
  return execInContainer(machineId, ["sh", "-c", shellScript], opts);
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
  const url = `http://${machineId}.vm.${FLY_AGENT_APP}.internal:${MUSELY_AGENT_PORT}/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");

    const state = await getMachineState(machineId);
    if (state === "stopped" || state === "destroyed" || state === "missing") {
      throw new Error(
        `Musely agent machine exited before becoming healthy (state=${state}). ` +
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
    `Musely agent instance did not become healthy in time${lastErr ? `: ${lastErr.message}` : ""}`
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

  const record = await createInstanceRecord({
    userId,
    machineName,
    machineId: machine.id,
    volumeId,
    apiKey,
  });

  // Same as Docker createContainer: seed config + skills + secrets onto /opt/data.
  try {
    await syncPlatformToUserVolume(userId, { sections: SYNC_SECTIONS });
    console.log(
      `[orchestrator] platform seed sync (config, skills, secrets) → user=${userId}`
    );
  } catch (err) {
    console.warn(`[orchestrator] platform seed sync skipped (user=${userId}): ${err.message}`);
  }

  return record;
}

/**
 * Ensure the user's Musely agent machine exists, is running, and is healthy.
 * Returns { baseUrl, apiKey, machineId, machineName, containerName }.
 * Concurrent calls for the same userId are coalesced into one promise.
 */
export function ensureInstance(userId) {
  if (!orchestratorConfigured()) {
    throw new Error(
      "Musely agent orchestrator is not available (set MACHINES_API_TOKEN, FLY_AGENT_APP, FLY_AGENT_IMAGE)"
    );
  }
  if (inflight.has(userId)) return inflight.get(userId);

  const p = (async () => {
    const t0 = Date.now();
    const logStep = (step) => console.log(`[orchestrator] ensure user=${userId} +${Date.now() - t0}ms ${step}`);

    let instance = await provisionInstance(userId);
    logStep("provisioned");

    let { machine_id: machineId, machine_name: machineName, api_key: apiKey } = instance;

    // Resolve Fly state before any ops that require the machine to exist.
    // Otherwise sync/repair hit 404 on a stale DB machine_id and never recreate.
    let state = await getMachineState(machineId);
    if (isTransitionalMachineState(state)) {
      logStep(`waiting for machine (was ${state})`);
      state = await waitForMachineStable(machineId, 180);
    }

    if (state === "destroyed" || state === "missing") {
      // Machine deleted on Fly (or never existed) while DB still has the old id.
      // Recreate only for missing/destroyed — not for auth/network/API failures.
      logStep(`machine ${machineId} ${state} — recreating`);
      const user = await getUserById(userId);
      const newName = machineNameForUser(userId, user?.name);
      const volumeId = (await findExistingVolume(userId)) || (await createVolume(userId));
      const newMachine = await createMachine({ machineName: newName, volumeId, apiKey, userId });
      await updateInstanceMachineId(userId, newMachine.id, newName);
      machineId = newMachine.id;
      machineName = newName;
      await setInstanceStatus(userId, "starting");
      state = await getMachineState(machineId);
    }

    await syncMuselyApiEnvToUserVolume(userId);
    logStep("musely api env synced");

    await repairHermesMachine(machineId);
    state = await getMachineState(machineId);

    if (state === "started" && (await quickHealthCheck(machineId))) {
      await syncMuselyApiEnvToUserVolume(userId, { restartGateway: true });
      logStep("already healthy");
      await touchInstance(userId);
      return {
        baseUrl: baseUrlForMachine(machineId),
        apiKey,
        machineId,
        machineName,
        containerName: machineId,
      };
    }

    if (state === "created") {
      // skip_launch leftovers or mid-provision — /start rejects "created"; launch via update.
      await setInstanceStatus(userId, "starting");
      await ensureMachineGatewayCmd(machineId);
      await launchMachine(machineId);
    } else if (state === "stopped") {
      await setInstanceStatus(userId, "starting");
      await ensureMachineGatewayCmd(machineId);
      await startMachine(machineId);
    } else if (state === "started") {
      logStep("started but not healthy yet — waiting for gateway");
    }

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
      containerName: machineId, // backward-compat alias used by musely-agent-cron.js
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
  const intervalMs = Number(process.env.MUSELY_AGENT_REAPER_INTERVAL_MS) || 60_000;
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
