// Feed ingestion: turns a user's chosen topics into a set of personalized
// feed items ("things to read" + "things to write about"). When an LLM key is
// configured (OpenRouter/OpenAI via backend .env) we ask it to curate items;

import { loadMuselyAgentEnv } from "./musely-agent-env.js";

function resolveLlmConfig() {
  loadMuselyAgentEnv();
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
// fallback (no-LLM) path can still produce topic-labelled items.
function keywordsFromInterests(interests) {
  if (!interests) return [];
  const chunks = interests
    .split(/[\n,;.•\-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 120);
  if (chunks.length) return chunks.slice(0, 6);
  // Single long sentence (common after onboarding) — use as one seed.
  if (interests.length >= 3) return [interests.slice(0, 120)];
  return [];
}

function fallbackItems(topics) {
  const { interests, read, write } = normalizeTopics(topics);
  const readSeeds = read.length ? read : keywordsFromInterests(interests);
  const items = [];

  for (const topic of readSeeds) {
    items.push({
      topic,
      title: `Get up to speed on ${topic}`,
      whats_new: `Recent articles, discussions, and key ideas about ${topic} are worth following this week.`,
      why_it_matters: `This keeps your feed aligned with what you said you want to read about: ${topic}.`,
      sources: [
        {
          label: `Search: latest ${topic}`,
          url: `https://www.google.com/search?q=${encodeURIComponent(`latest ${topic}`)}`,
        },
      ],
    });
  }

  const writeSeeds = write.length ? write : readSeeds.slice(0, 2);
  for (const topic of writeSeeds) {
    items.push({
      topic,
      title: `Writing angle: ${topic}`,
      whats_new: `A timely prompt to draft a short piece sharing your perspective on ${topic}.`,
      why_it_matters: `You listed ${topic} among topics you want to write about — this is a concrete angle to start from.`,
      sources: [],
    });
  }

  return items;
}

function buildPrompt(topics) {
  const { interests, read, write } = normalizeTopics(topics);
  const lines = [
    "You are Musely agent, a personal reading/writing agent for the user.",
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
    '{ "posts": [ { "topic": string, "title": string, "whats_new": string, "why_it_matters": string, "sources": [ { "label": string, "url": string } ] } ] }',
    "",
    "Rules:",
    "- Honor the user's specificity: if they were detailed, tailor items precisely to what they described.",
    "- Each item is a news-style reading card (not a writing prompt).",
    "- whats_new: 1-2 sentences on what happened or what's new.",
    "- why_it_matters: 1-2 sentences on why this is relevant to this user.",
    "- sources: 1-3 real or plausible references with label + url.",
    "- Set a short 'topic' label on each item derived from the user's interests.",
    "- Return at most 12 posts total."
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
  const raw = Array.isArray(parsed) ? parsed : parsed?.posts ?? parsed?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Feed LLM returned no posts");
  }
  return raw
    .filter((it) => it && it.title)
    .slice(0, 12)
    .map((it) => ({
      topic: String(it.topic || "").trim(),
      title: String(it.title).trim(),
      whats_new: String(it.whats_new || it.whatsNew || it.summary || "").trim(),
      why_it_matters: String(it.why_it_matters || it.whyItMatters || "").trim(),
      sources: Array.isArray(it.sources)
        ? it.sources
        : it.url
          ? [{ label: String(it.title).trim(), url: String(it.url).trim() }]
          : [],
    }));
}

// Returns { items, source }. `source` is "agent" when the LLM produced the
// feed, or "starter" for the deterministic fallback. `items` are feed post payloads.
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
