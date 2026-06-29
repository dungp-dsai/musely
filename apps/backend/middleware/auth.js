import { getUserFromRequest } from "../auth.js";

const AGENT_KEY = process.env.AGENT_API_KEY || "";

export function agentUserId() {
  const id = Number(process.env.AGENT_USER_ID);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function requireUser(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

/** Hermes agent routes: session OR X-Agent-Key header. */
export async function requireUserOrAgent(req, res, next) {
  const header = req.get("X-Agent-Key") || req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (AGENT_KEY && header === AGENT_KEY) {
    req.agentMode = true;
    req.user = { id: agentUserId() };
    return next();
  }
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.agentMode = false;
  next();
}

export function publicUserId(req) {
  if (req.agentMode) return agentUserId();
  return req.user?.id;
}
