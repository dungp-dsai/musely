// Proxy to Hermes Agent's OpenAI-compatible API server.
// Keeps API_SERVER_KEY on the server; the browser talks only to writer-app.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getHermesApiConfig } from "./hermes-env.js";

const HERMES_CHAT_MODEL = process.env.HERMES_CHAT_MODEL || "";
const GATEWAY_MODEL = process.env.HERMES_API_MODEL_NAME || "Hermes Agent";
const HERMES_DATA_DIR = process.env.HERMES_DATA_DIR || "/opt/hermes-data";
const HERMES_BASE_DIR = process.env.HERMES_BASE_DIR || "/opt/hermes-base";

function hermesHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function resolveTarget(target) {
  if (target?.baseUrl && target?.apiKey) {
    return { baseUrl: target.baseUrl.replace(/\/+$/, ""), apiKey: target.apiKey };
  }
  return getHermesApiConfig();
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
  for (const dir of [HERMES_DATA_DIR, HERMES_BASE_DIR]) {
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

export function hermesChatConfigured() {
  const { apiKey, baseUrl } = getHermesApiConfig();
  return Boolean(apiKey && baseUrl);
}

export async function listHermesModels(_target) {
  const configuredDefault = readTemplateDefaultModel();
  return {
    models: [GATEWAY_MODEL],
    defaultModel: configuredDefault,
    gatewayModel: GATEWAY_MODEL,
    error: null,
  };
}

export async function resolveHermesModel(_target, requestedModel) {
  if (HERMES_CHAT_MODEL) return HERMES_CHAT_MODEL;
  if (requestedModel && !isGatewayModel(requestedModel)) return requestedModel;
  // Omit model — Hermes uses model.default from the user's synced config.yaml volume.
  return null;
}

export async function streamHermesChat({ messages, model, res, signal, target }) {
  const { apiKey, baseUrl } = resolveTarget(target);
  if (!apiKey) {
    res.status(503).json({
      error: "Hermes API not configured (set API_SERVER_KEY in ~/.hermes/.env or HERMES_API_SERVER_KEY)",
    });
    return;
  }

  const resolvedModel = await resolveHermesModel(target, model);
  const body = { messages, stream: true };
  if (resolvedModel) body.model = resolvedModel;

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: hermesHeaders(apiKey),
    signal,
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    res.status(upstream.status).json({ error: text || `Hermes chat failed: ${upstream.status}` });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
