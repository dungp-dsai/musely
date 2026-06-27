// Lightweight LLM helper for task follow-up chat in the Writer UI.
// Reads API keys from ~/.hermes/.env (OPENROUTER_API_KEY or OPENAI_API_KEY).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let envLoaded = false;

function loadHermesEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const candidates = [
    process.env.HERMES_HOME ? join(process.env.HERMES_HOME, ".env") : null,
    join(homedir(), ".hermes", ".env"),
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  }
}

function resolveLlmConfig() {
  loadHermesEnv();
  if (process.env.OPENROUTER_API_KEY) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.WRITER_CHAT_MODEL || "anthropic/claude-sonnet-4",
      headers: {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "DungPham Writer",
      },
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

function buildSystemPrompt({ task, postTitle, workResults, report }) {
  const parts = [
    "You are Hermes, the writing assistant for DungPham Writer.",
    "The user highlighted a passage in their draft and assigned a task. You (or a prior run) may have already researched and stored findings.",
    "Help the user review your work, answer follow-ups, suggest edits, and explain sources clearly.",
    "Be concise, precise, and cite URLs when referencing research. Match a thoughtful personal essay tone.",
    "",
    `Post: ${postTitle || "Untitled"}`,
    `Highlighted context: "${task.context || ""}"`,
    `Task: ${task.content}`,
    `Status: ${task.status}`,
  ];

  if (workResults?.length) {
    parts.push("", "## Your stored findings");
    for (const w of workResults) {
      parts.push(w.result);
      parts.push("");
    }
  }

  if (report?.summary_action_report) {
    parts.push("## Your action report for the saved version");
    parts.push(report.summary_action_report);
  }

  return parts.join("\n");
}

export async function generateTaskChatReply({ thread }) {
  const cfg = resolveLlmConfig();
  if (!cfg) {
    throw new Error(
      "No LLM configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY in ~/.hermes/.env"
    );
  }

  const system = buildSystemPrompt({
    task: thread.task,
    postTitle: thread.post?.title,
    workResults: thread.work,
    report: thread.report,
  });

  const history = (thread.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages = [
    { role: "system", content: system },
    ...history,
  ];

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...cfg.headers,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.4,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return content.trim();
}
