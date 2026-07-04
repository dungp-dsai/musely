// Push Musely platform config/skills/.env into per-user agent volumes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listInstances } from "./db.js";
import {
  orchestratorConfigured,
  syncPlatformToUserVolume,
  restartUserAgentIfRunning,
} from "./musely-agent-orchestrator.js";

/** Env vars merged into each user's /opt/data/.env on sync (from backend secrets). */
export const PLATFORM_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
];

export function platformEnvFlags() {
  const flags = [];
  for (const key of PLATFORM_ENV_KEYS) {
    const val = process.env[key];
    if (val) flags.push("-e", `${key}=${val}`);
  }
  return flags;
}

export function resolvePlatformDir() {
  return (
    process.env.MUSELY_AGENT_PLATFORM_HOST_DIR ||
    process.env.MUSELY_AGENT_PLATFORM_DIR ||
    process.env.MUSELY_AGENT_PLATFORM_MOUNT ||
    ""
  );
}

export function platformConfigured() {
  const dir = resolvePlatformDir();
  if (!dir || !existsSync(dir)) return false;
  return (
    existsSync(join(dir, "config.yaml")) ||
    existsSync(join(dir, "config.yaml.example")) ||
    existsSync(join(dir, "skills", "musely"))
  );
}

export function readPlatformConfigYaml() {
  const dir = resolvePlatformDir();
  if (!dir) return null;
  for (const name of ["config.yaml", "config.yaml.example"]) {
    const path = join(dir, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

/** Sync platform tree into one user's agent volume; optionally restart if running. */
export async function syncPlatformForUser(userId, { restart = true } = {}) {
  if (!orchestratorConfigured()) {
    throw new Error("Musely agent orchestrator is not configured");
  }
  if (!platformConfigured()) {
    throw new Error(
      "Platform directory not ready — add musely-agent-platform/config.yaml (see config.yaml.example)"
    );
  }
  await syncPlatformToUserVolume(userId);
  if (restart) {
    await restartUserAgentIfRunning(userId).catch((err) => {
      console.warn(`[platform-sync] restart user=${userId}: ${err.message}`);
    });
  }
}

/** Admin: sync all provisioned user volumes. */
export async function syncPlatformForAllUsers({ restart = true } = {}) {
  const instances = await listInstances();
  const results = [];
  for (const inst of instances) {
    const userId = inst.user_id;
    try {
      await syncPlatformForUser(userId, { restart });
      results.push({ userId, email: inst.email, ok: true });
    } catch (err) {
      results.push({ userId, email: inst.email, ok: false, error: err.message });
    }
  }
  return {
    total: instances.length,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
