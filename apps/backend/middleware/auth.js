import { getUserFromRequest } from "../auth.js";

const AGENT_KEY = process.env.AGENT_API_KEY || "";

/** Dev-only: pin agent API to one user when backend env AGENT_USER_ID is set. */
export function agentUserIdFromEnv() {
  const id = Number(process.env.AGENT_USER_ID);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Per-user agent machines must send their provisioned id on every agent API call. */
export function agentUserIdFromRequest(req) {
  const id = Number(req.get("X-Agent-User-Id") || req.get("X-User-Id"));
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function resolveAgentUserId(req) {
  return agentUserIdFromRequest(req) ?? agentUserIdFromEnv();
}

export async function requireUser(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

/** Musely agent routes: session OR X-Agent-Key + X-Agent-User-Id. */
export async function requireUserOrAgent(req, res, next) {
  const header = req.get("X-Agent-Key") || req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (AGENT_KEY && header === AGENT_KEY) {
    const userId = resolveAgentUserId(req);
    if (!userId) {
      return res.status(400).json({
        error: "Agent request requires X-Agent-User-Id header (AGENT_USER_ID on the machine)",
      });
    }
    req.agentMode = true;
    req.user = { id: userId };
    return next();
  }
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.agentMode = false;
  next();
}

export function publicUserId(req) {
  if (req.agentMode) return req.user?.id ?? resolveAgentUserId(req);
  return req.user?.id;
}
