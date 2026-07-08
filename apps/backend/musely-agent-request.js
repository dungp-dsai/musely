// Shared Musely agent chat streaming (browser → backend → user agent instance).

import { streamMuselyAgentChat } from "./musely-agent-chat.js";
import {
  orchestratorConfigured,
  quickState,
  isMachineRunning,
  ensureInstance,
} from "./musely-agent-orchestrator.js";

/** Ensure the user's agent is running; may respond 202 while starting. */
export async function resolveMuselyAgentTarget(userId, res) {
  if (!orchestratorConfigured()) return { target: undefined };
  const state = await quickState(userId);
  if (!isMachineRunning(state)) {
    ensureInstance(userId).catch((err) =>
      console.error("[orchestrator] background start failed:", err.message)
    );
    res.status(202).json({ status: "starting", message: "Starting your Musely agent instance…" });
    return { warming: true };
  }
  const target = await ensureInstance(userId);
  return { target };
}

/** Stream a chat completion to `res` (SSE). Caller handles validation. */
export async function handleMuselyAgentStreamRequest(req, res, { messages, model }) {
  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  try {
    const { target, warming } = await resolveMuselyAgentTarget(req.user.id, res);
    if (warming) return;

    await streamMuselyAgentChat({
      messages,
      model,
      res,
      signal: controller.signal,
      target,
    });
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    req.off("aborted", abortUpstream);
    res.off("close", abortUpstream);
  }
}
