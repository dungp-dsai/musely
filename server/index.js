// REST API for the Hermes Writer app.
// Thin HTTP layer over db.js. The same database file can also be driven directly
// by the Hermes agent via agent-cli.js — see AGENT_GUIDE.md.

import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DB_PATH,
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  addVersion,
  addFeedback,
  updateFeedbackStatus,
  deleteFeedback,
  listPendingFeedback,
  getTaskThread,
  addAiTaskChatMessage,
} from "./db.js";
import { generateTaskChatReply } from "./task-chat.js";
import {
  getActivePostPayload,
  getActiveTasksPayload,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
} from "./agent-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 5174;
const HOST = process.env.HOST || "0.0.0.0";
const STATIC_DIR =
  process.env.STATIC_DIR || join(__dirname, "..", "client", "dist");
const serveStatic = existsSync(STATIC_DIR);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const asJson = (res, fn) => {
  try {
    const result = fn();
    if (result === null) return res.status(404).json({ error: "Not found" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

app.get("/api/health", (_req, res) => res.json({ ok: true, db: DB_PATH }));

// Posts
app.get("/api/posts", (_req, res) => asJson(res, () => listPosts()));
app.post("/api/posts", (req, res) => asJson(res, () => createPost(req.body)));
app.get("/api/posts/:id", (req, res) => asJson(res, () => getPost(Number(req.params.id))));
app.put("/api/posts/:id", (req, res) => asJson(res, () => updatePost(Number(req.params.id), req.body)));
app.delete("/api/posts/:id", (req, res) =>
  asJson(res, () => {
    deletePost(Number(req.params.id));
    return { ok: true };
  })
);

// Versions
app.post("/api/posts/:id/versions", (req, res) =>
  asJson(res, () => addVersion(Number(req.params.id), req.body))
);

// Feedback (AI task queue)
app.post("/api/posts/:id/feedback", (req, res) =>
  asJson(res, () => addFeedback(Number(req.params.id), req.body))
);
app.put("/api/feedback/:id", (req, res) =>
  asJson(res, () => updateFeedbackStatus(Number(req.params.id), req.body.status))
);
app.delete("/api/feedback/:id", (req, res) =>
  asJson(res, () => {
    deleteFeedback(Number(req.params.id));
    return { ok: true };
  })
);
app.get("/api/feedback/pending", (_req, res) => asJson(res, () => listPendingFeedback()));

// Agent API (same surface as agent-cli.js — for Hermes over HTTP)
app.get("/api/active", (_req, res) => asJson(res, () => getActivePostPayload()));

app.get("/api/active/tasks", (_req, res) => asJson(res, () => getActiveTasksPayload()));

app.post("/api/feedback/:id/claim", (req, res) =>
  asJson(res, () => updateFeedbackStatus(Number(req.params.id), "in_progress"))
);

app.get("/api/feedback/:id/work", (req, res) =>
  asJson(res, () => listAiTaskWork(Number(req.params.id)))
);

app.post("/api/feedback/:id/work", (req, res) => {
  const taskId = Number(req.params.id);
  const result = typeof req.body?.result === "string" ? req.body.result : "";
  if (!result.trim()) return res.status(400).json({ error: "result is required" });
  return asJson(res, () => addAiTaskWork(taskId, result));
});

app.get("/api/posts/:id/reports", (req, res) =>
  asJson(res, () => listAiJobReports(Number(req.params.id)))
);

app.post("/api/posts/:id/reports", (req, res) => {
  const postId = Number(req.params.id);
  const versionNumber = Number(req.body?.version_number);
  const summary =
    typeof req.body?.summary_action_report === "string"
      ? req.body.summary_action_report
      : typeof req.body?.summary === "string"
        ? req.body.summary
        : "";
  if (!versionNumber) {
    return res.status(400).json({ error: "version_number is required" });
  }
  if (!summary.trim()) {
    return res.status(400).json({ error: "summary_action_report is required" });
  }
  return asJson(res, () => addAiJobReport(postId, versionNumber, summary));
});

// Task thread (findings + chat)
app.get("/api/feedback/:id/thread", (req, res) =>
  asJson(res, () => getTaskThread(Number(req.params.id)))
);

app.post("/api/feedback/:id/chat", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "message is required" });

    const thread = getTaskThread(taskId);
    if (!thread) return res.status(404).json({ error: "Not found" });

    const userMsg = addAiTaskChatMessage(taskId, "user", message);
    const updatedThread = getTaskThread(taskId);
    const reply = await generateTaskChatReply({ thread: updatedThread });
    const assistantMsg = addAiTaskChatMessage(taskId, "assistant", reply);

    res.json({
      user: userMsg,
      assistant: assistantMsg,
      thread: getTaskThread(taskId),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

if (serveStatic) {
  app.use(express.static(STATIC_DIR, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(STATIC_DIR, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Hermes Writer listening on http://${HOST}:${PORT}`);
  if (serveStatic) console.log(`Serving UI from ${STATIC_DIR}`);
  console.log(`Database: ${DB_PATH}`);
});
