// Proxy to Hermes Agent's OpenAI-compatible API server.
// Keeps API_SERVER_KEY on the server; the browser talks only to writer-app.

import { getHermesApiConfig } from "./hermes-env.js";

const HERMES_CHAT_MODEL = process.env.HERMES_CHAT_MODEL || "";

function hermesHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function hermesChatConfigured() {
  const { apiKey, baseUrl } = getHermesApiConfig();
  return Boolean(apiKey && baseUrl);
}

export async function listHermesModels() {
  const { apiKey, baseUrl } = getHermesApiConfig();
  if (!apiKey) {
    return {
      models: [],
      error: "Hermes API not configured (set API_SERVER_KEY in ~/.hermes/.env or HERMES_API_SERVER_KEY)",
    };
  }

  const res = await fetch(`${baseUrl}/models`, { headers: hermesHeaders(apiKey) });
  if (!res.ok) {
    const text = await res.text();
    return { models: [], error: text || `Hermes models failed: ${res.status}` };
  }

  const data = await res.json();
  const models = (data.data || []).map((m) => m.id).filter(Boolean);
  return { models, error: null };
}

export async function resolveHermesModel() {
  if (HERMES_CHAT_MODEL) return HERMES_CHAT_MODEL;
  const { models } = await listHermesModels();
  return models[0] || "hermes-agent";
}

export async function streamHermesChat({ messages, model, res, signal }) {
  const { apiKey, baseUrl } = getHermesApiConfig();
  if (!apiKey) {
    res.status(503).json({
      error: "Hermes API not configured (set API_SERVER_KEY in ~/.hermes/.env or HERMES_API_SERVER_KEY)",
    });
    return;
  }

  const resolvedModel = model || (await resolveHermesModel());
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: hermesHeaders(apiKey),
    signal,
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      stream: true,
    }),
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
