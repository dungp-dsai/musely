// Musely API credentials injected into each user agent (container env + /opt/data/.env).

/** Base URL agents use for `{BASE}/api/...` (not the LLM gateway). */
export function resolveClientUrlForAgent() {
  const explicit = process.env.MUSELY_AGENT_CLIENT_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const clientUrl = (process.env.CLIENT_URL || "").trim().replace(/\/$/, "");

  // Docker agents cannot reach the host's localhost — use the backend on musely-net.
  if (process.env.MUSELY_AGENT_ORCHESTRATOR === "docker") {
    if (!clientUrl || /localhost|127\.0\.0\.1/.test(clientUrl)) {
      const backendInCompose = process.env.DB_PATH?.startsWith("/app/");
      return backendInCompose ? "http://musely-backend:8081" : "http://host.docker.internal:8081";
    }
  }

  return clientUrl || "http://localhost:8081";
}

/** Per-user env for Musely backend API calls (build-feed skill, agent-api, etc.). */
export function getMuselyAgentApiEnv(userId) {
  return {
    CLIENT_URL: resolveClientUrlForAgent(),
    AGENT_API_KEY: process.env.AGENT_API_KEY || "",
    AGENT_USER_ID: String(userId),
  };
}

export function muselyAgentApiEnvConfigured() {
  const env = getMuselyAgentApiEnv(0);
  return Boolean(env.CLIENT_URL && env.AGENT_API_KEY);
}
