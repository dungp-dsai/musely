// Feed ingestion: turns a user's chosen topics into a set of personalized
// feed items ("things to read" + "things to write about"). When an LLM key is
// configured (OpenRouter/OpenAI via ~/.hermes/.env) we ask it to curate items;
// otherwise we fall back to deterministic starter items so the feature always
// produces something useful.

import { loadHermesEnv } from "./hermes-env.js";

function resolveLlmConfig() {
  loadHermesEnv();
  if (process.env.OPENROUTER_API_KEY) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.WRITER_CHAT_MODEL || "anthropic/claude-sonnet-4",
      headers: { "HTTP-Referer": "http://localhost:5173", "X-Title": "musely-feed" },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.WRITER_CHAT_MODEL || "gpt-4o-mini",
      headers: {},
    };
  }
  return null;
}

function normalizeTopics(topics) {
  const read = Array.isArray(topics?.read) ? topics.read : [];
  const write = Array.isArray(topics?.write) ? topics.write : [];
  const interests = String(topics?.interests || "").trim();
  return { interests, read, write };
}

// Extract a few short keyword-ish phrases from the free-text interests so the
// fallback (no-LLM) path can still produce topic-labelled starter items.
function keywordsFromInterests(interests) {
  if (!interests) return [];
  return interests
    .split(/[\n,;.•\-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 60)
    .slice(0, 6);
}

// Deterministic starter items so the "ingest" action is never a dead end,
// even when no LLM is configured or the request fails.
function fallbackItems(topics) {
  const { interests, read, write } = normalizeTopics(topics);
  const readSeeds = read.length ? read : keywordsFromInterests(interests);
  const items = [];

  for (const topic of readSeeds) {
    items.push({
      topic,
      kind: "read",
      title: `Get up to speed on ${topic}`,
      summary: `Your agent will gather recent articles, discussions, and key ideas about ${topic} so your feed stays current.`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`latest ${topic}`)}`,
    });
  }

  const writeSeeds = write.length ? write : readSeeds.slice(0, 2);
  for (const topic of writeSeeds) {
    items.push({
      topic,
      kind: "write",
      title: `Writing prompt: ${topic}`,
      summary: `Draft a short piece sharing your perspective on ${topic}. Open the Write tab to start with your agent's help.`,
      url: null,
    });
  }

  if (items.length === 0) {
    items.push({
      topic: "",
      kind: "read",
      title: "Tell us what you're into to personalize your feed",
      summary: "Describe what you want to read and write about in your preferences so your agent knows what to ingest.",
      url: null,
    });
  }
  return items;
}

function buildPrompt(topics) {
  const { interests, read, write } = normalizeTopics(topics);
  const lines = [
    "You are Hermes, a personal reading/writing agent for the user.",
    "Ingest content for what the user cares about and return a curated feed.",
    "",
    "The user described, in their own words, what they want to READ and WRITE about:",
    `\"\"\"\n${interests || "(they didn't say much — infer reasonable interests)"}\n\"\"\"`,
  ];
  if (read.length) lines.push(`Additional read topics: ${read.join(", ")}`);
  if (write.length) lines.push(`Additional write topics: ${write.join(", ")}`);
  lines.push(
    "",
    "Return STRICT JSON only (no markdown) with this shape:",
    '{ "items": [ { "topic": string, "kind": "read" | "write", "title": string, "summary": string, "url": string | null } ] }',
    "",
    "Rules:",
    "- Honor the user's specificity: if they were detailed, tailor items precisely to what they described.",
    "- Mix 'read' items (real, well-known resources or current themes worth following; include a plausible url when confident, else null) and 'write' items (concrete, specific writing prompts/angles; url must be null).",
    "- Set a short 'topic' label on each item derived from the user's interests.",
    "- Keep each summary to 1-2 sentences.",
    "- Return at most 12 items total."
  );
  return lines.join("\n");
}

async function generateWithLlm(cfg, topics) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...cfg.headers,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: "You output strict JSON only." },
        { role: "user", content: buildPrompt(topics) },
      ],
      temperature: 0.6,
      max_tokens: 1600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Feed LLM request failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const jsonText = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(jsonText);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Feed LLM returned no items");
  }
  return items
    .filter((it) => it && it.title)
    .slice(0, 12)
    .map((it) => ({
      topic: String(it.topic || "").trim(),
      kind: it.kind === "write" ? "write" : "read",
      title: String(it.title).trim(),
      summary: String(it.summary || "").trim(),
      url: it.url ? String(it.url).trim() : null,
    }));
}

// Returns { items, source }. `source` is "agent" when the LLM produced the
// feed, or "starter" for the deterministic fallback.
export async function generateFeedItems(topics) {
  const cfg = resolveLlmConfig();
  if (cfg) {
    try {
      const items = await generateWithLlm(cfg, topics);
      if (items.length) return { items, source: "agent" };
    } catch (err) {
      console.error("[feed] LLM ingest failed, using starter items:", err.message);
    }
  }
  return { items: fallbackItems(topics), source: "starter" };
}
