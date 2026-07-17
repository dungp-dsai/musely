// Proxy to Musely Agent's OpenAI-compatible API server.
// Keeps API_SERVER_KEY on the server; the browser talks only to writer-app.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getMuselyAgentApiConfig } from "./musely-agent-env.js";

const MUSELY_AGENT_CHAT_MODEL = process.env.MUSELY_AGENT_CHAT_MODEL || "";
const GATEWAY_MODEL = process.env.MUSELY_AGENT_API_MODEL_NAME || "Musely Agent";
const MUSELY_AGENT_DATA_DIR = process.env.MUSELY_AGENT_DATA_DIR || "/opt/hermes-data";
const MUSELY_AGENT_PLATFORM_DIR = process.env.MUSELY_AGENT_PLATFORM_DIR || "/opt/musely-agent-platform";

function muselyAgentHeaders(apiKey, sessionId) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (sessionId) headers["X-Hermes-Session-Id"] = String(sessionId).slice(0, 256);
  return headers;
}

function resolveTarget(target) {
  if (target?.baseUrl && target?.apiKey) {
    return { baseUrl: target.baseUrl.replace(/\/+$/, ""), apiKey: target.apiKey };
  }
  return getMuselyAgentApiConfig();
}

function isGatewayModel(model) {
  if (!model || !String(model).trim()) return true;
  const m = String(model).trim().toLowerCase();
  return (
    m === "hermes agent" ||
    m === "hermes-agent" ||
    m === GATEWAY_MODEL.toLowerCase()
  );
}

/** Read model.default from the mounted Hermes template (for UI display only). */
function readTemplateDefaultModel() {
  for (const dir of [MUSELY_AGENT_DATA_DIR, MUSELY_AGENT_PLATFORM_DIR]) {
    const path = join(dir, "config.yaml");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const block = text.match(/^model:\s*\n([\s\S]*?)(?=\n[^\s#]|\n*$)/m);
    if (!block) continue;
    const def = block[1].match(/^\s+default:\s*(.+)$/m);
    if (def) return def[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

export function muselyAgentChatConfigured() {
  const { apiKey, baseUrl } = getMuselyAgentApiConfig();
  return Boolean(apiKey && baseUrl);
}

export async function listMuselyAgentModels(_target) {
  const configuredDefault = readTemplateDefaultModel();
  return {
    models: [GATEWAY_MODEL],
    defaultModel: configuredDefault,
    gatewayModel: GATEWAY_MODEL,
    error: null,
  };
}

export async function resolveMuselyAgentModel(_target, requestedModel) {
  if (MUSELY_AGENT_CHAT_MODEL) return MUSELY_AGENT_CHAT_MODEL;
  if (requestedModel && !isGatewayModel(requestedModel)) return requestedModel;
  // Omit model — Hermes uses model.default from the user's synced config.yaml volume.
  return null;
}

/** Pull assistant text deltas from an OpenAI SSE `data:` line. */
function extractDeltaContent(payload) {
  if (!payload || payload === "[DONE]") return { done: payload === "[DONE]", content: "" };
  try {
    const parsed = JSON.parse(payload);
    if (parsed.error) {
      const msg =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error.message || JSON.stringify(parsed.error);
      return { done: true, content: "", error: msg };
    }
    const delta = parsed.choices?.[0]?.delta;
    const message = parsed.choices?.[0]?.message;
    const content =
      (typeof delta?.content === "string" ? delta.content : "") ||
      (typeof delta?.text === "string" ? delta.text : "") ||
      (typeof message?.content === "string" ? message.content : "") ||
      (typeof parsed.choices?.[0]?.text === "string" ? parsed.choices[0].text : "");
    return { done: false, content };
  } catch {
    return { done: false, content: "" };
  }
}

/**
 * Stream Hermes chat completions to `res`.
 * @returns {{ assistantText: string }}
 */
export async function streamMuselyAgentChat({
  messages,
  model,
  res,
  signal,
  target,
  sessionId,
  onComplete,
}) {
  const { apiKey, baseUrl } = resolveTarget(target);
  if (!apiKey) {
    res.status(503).json({
      error: "Musely agent API not configured (set API_SERVER_KEY in ~/.hermes/.env or HERMES_API_SERVER_KEY)",
    });
    return { assistantText: "" };
  }

  const resolvedModel = await resolveMuselyAgentModel(target, model);
  const body = { messages, stream: true };
  if (resolvedModel) body.model = resolvedModel;

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: muselyAgentHeaders(apiKey, sessionId),
    signal,
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    res.status(upstream.status).json({ error: text || `Hermes chat failed: ${upstream.status}` });
    return { assistantText: "" };
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (sessionId) res.setHeader("X-Hermes-Session-Id", String(sessionId));
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = "";
  let assistantText = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        const { content, error } = extractDeltaContent(payload);
        if (error) break;
        if (content) assistantText += content;
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return { assistantText };
    console.error(err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  }

  // Persist before ending the SSE so clients that reload on stream-close see the reply.
  if (typeof onComplete === "function" && assistantText.trim()) {
    try {
      await onComplete(assistantText.trim());
    } catch (err) {
      console.error("[musely-agent-chat] onComplete failed:", err.message);
    }
  }

  if (!res.writableEnded) res.end();
  return { assistantText };
}
