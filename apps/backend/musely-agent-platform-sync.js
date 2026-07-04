// Push Musely platform config/skills/.env into per-user agent volumes.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listInstances } from "./db.js";
import {
  orchestratorConfigured,
  syncPlatformToUserVolume,
  restartUserAgentIfRunning,
} from "./musely-agent-orchestrator.js";
import { getPlatformEnvMap, DEFAULT_PLATFORM_ENV_KEYS } from "./musely-agent-platform-env.js";
import {
  normalizeSyncSections,
  needsPlatformFiles,
  assertSecretsReadyForSync,
} from "./musely-agent-platform-sync-runner.js";

export { DEFAULT_PLATFORM_ENV_KEYS as PLATFORM_ENV_KEYS };

export function platformEnvFlags() {
  const flags = [];
  for (const [key, val] of Object.entries(getPlatformEnvMap())) {
    flags.push("-e", `${key}=${val}`);
  }
  return flags;
}

/** Path visible to this Node process (admin read/write, config checks). */
export function resolvePlatformDirForFs() {
  const candidates = [
    process.env.MUSELY_AGENT_PLATFORM_MOUNT,
    process.env.MUSELY_AGENT_PLATFORM_HOST_DIR,
    process.env.MUSELY_AGENT_PLATFORM_DIR,
  ].filter(Boolean);
  for (const dir of candidates) {
    const abs = resolve(dir);
    if (existsSync(abs)) return abs;
  }
  return candidates[0] ? resolve(candidates[0]) : "";
}

/** Host path for `docker run -v` (Docker daemon path, not in-container mount). */
export function resolvePlatformDirForDocker() {
  const hostDir = process.env.MUSELY_AGENT_PLATFORM_HOST_DIR;
  if (hostDir) return resolve(hostDir);
  return resolvePlatformDirForFs();
}

/** @deprecated use resolvePlatformDirForFs */
export function resolvePlatformDir() {
  return resolvePlatformDirForFs();
}

export function platformConfigured() {
  const dir = resolvePlatformDirForFs();
  if (!dir || !existsSync(dir)) return false;
  return (
    existsSync(join(dir, "config.yaml")) ||
    existsSync(join(dir, "config.yaml.example")) ||
    existsSync(join(dir, "skills", "musely"))
  );
}

export function readPlatformConfigYaml() {
  const dir = resolvePlatformDirForFs();
  if (!dir) return null;
  for (const name of ["config.yaml", "config.yaml.example"]) {
    const path = join(dir, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

/** Sync selected platform parts into one user's agent volume. */
export async function syncPlatformForUser(userId, { restart = true, sections } = {}) {
  if (!orchestratorConfigured()) {
    throw new Error("Musely agent orchestrator is not configured");
  }
  const normalized = normalizeSyncSections(sections);
  assertSecretsReadyForSync(normalized);
  if (needsPlatformFiles(normalized) && !platformConfigured()) {
    throw new Error(
      "Platform directory not ready — add musely-agent-platform/config.yaml (see config.yaml.example)"
    );
  }
  await syncPlatformToUserVolume(userId, { sections: normalized });
  if (restart) {
    await restartUserAgentIfRunning(userId, { sections: normalized }).catch((err) => {
      console.warn(`[platform-sync] restart user=${userId}: ${err.message}`);
    });
  }
}

/** Admin: sync selected parts to all provisioned user volumes. */
export async function syncPlatformForAllUsers({ restart = true, sections } = {}) {
  const normalized = normalizeSyncSections(sections);
  const instances = await listInstances();
  const results = [];
  for (const inst of instances) {
    const userId = inst.user_id;
    try {
      await syncPlatformForUser(userId, { restart, sections: normalized });
      results.push({ userId, email: inst.email, ok: true });
    } catch (err) {
      results.push({ userId, email: inst.email, ok: false, error: err.message });
    }
  }
  return {
    sections: normalized,
    total: instances.length,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
