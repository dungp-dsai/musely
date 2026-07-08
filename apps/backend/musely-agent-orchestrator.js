// Musely agent orchestrator facade — picks Fly Machines API or local Docker CLI.
//
// MUSELY_AGENT_ORCHESTRATOR=fly|docker|disabled
// Auto-detect: docker when socket + MUSELY_AGENT_IMAGE; else fly when Machines API env set.

import * as docker from "./musely-agent-orchestrator-docker.js";
import * as fly from "./musely-agent-orchestrator-fly.js";

function pickImpl() {
  const mode = process.env.MUSELY_AGENT_ORCHESTRATOR;
  if (mode === "disabled") return null;
  if (mode === "docker") return docker.orchestratorConfigured() ? docker : null;
  if (mode === "fly") return fly.orchestratorConfigured() ? fly : null;
  if (docker.orchestratorConfigured()) return docker;
  if (fly.orchestratorConfigured()) return fly;
  return null;
}

const impl = pickImpl();

function requireImpl() {
  if (!impl) {
    throw new Error(
      "Musely agent orchestrator is not configured (set MUSELY_AGENT_ORCHESTRATOR=docker + MUSELY_AGENT_IMAGE, or Fly Machines API env)"
    );
  }
  return impl;
}

export function orchestratorConfigured() {
  return Boolean(impl?.orchestratorConfigured());
}

export function templateConfigured() {
  return Boolean(impl?.templateConfigured());
}

export function machineNameForUser(userId, userName) {
  return (impl ?? docker).machineNameForUser(userId, userName);
}

export const execInContainer = (...args) => requireImpl().execInContainer(...args);
export const runTransientReader = (...args) => requireImpl().runTransientReader(...args);
export const isMachineRunning = (...args) => requireImpl().isMachineRunning(...args);
export const quickState = (...args) => requireImpl().quickState(...args);
export const resolveContainerName = (...args) => requireImpl().resolveContainerName(...args);
export const resolveMachineId = (...args) => requireImpl().resolveMachineId(...args);
export const ensureInstance = (...args) => requireImpl().ensureInstance(...args);
export const noteActivity = (...args) => requireImpl().noteActivity(...args);
export const stopInstance = (...args) => requireImpl().stopInstance(...args);
export const syncPlatformToUserVolume = (...args) => requireImpl().syncPlatformToUserVolume(...args);
export const restartUserAgentIfRunning = (...args) => requireImpl().restartUserAgentIfRunning(...args);
export const restartUserAgentAfterSync = (...args) => requireImpl().restartUserAgentAfterSync(...args);
export const startIdleReaper = (...args) => requireImpl().startIdleReaper(...args);

export const ORCHESTRATOR_SETTINGS = impl?.ORCHESTRATOR_SETTINGS ?? {
  mode: "disabled",
};
