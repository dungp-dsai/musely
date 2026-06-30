// Musely API server (SQLite + Google auth). Frontend is a separate Fly app.

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import {
  DB_PATH,
  initDb,
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
import {
  hermesChatConfigured,
  listHermesModels,
  streamHermesChat,
} from "./hermes-chat.js";
import {
  hermesCronConfigured,
  listCronJobsFor,
  cronSchedulerStatusFor,
  createCronJobFor,
  editCronJobFor,
  pauseCronJobFor,
  resumeCronJobFor,
  runCronJobFor,
  removeCronJobFor,
  CRON_DELIVERY_OPTIONS,
  CRON_SCHEDULE_EXAMPLES,
} from "./hermes-cron.js";
import {
  orchestratorConfigured,
  ensureInstance,
  quickState,
  isMachineRunning,
  templateConfigured,
  startIdleReaper,
  ORCHESTRATOR_SETTINGS,
} from "./hermes-orchestrator.js";
import { listInstances, getInstance } from "./db.js";
import {
  googleAuthUrl,
  exchangeGoogleCode,
  setSessionCookie,
  clearSessionCookie,
  getUserFromRequest,
  newOAuthState,
} from "./auth.js";
import { requireUser, requireUserOrAgent, publicUserId } from "./middleware/auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 8081;
const HOST = process.env.HOST || "0.0.0.0";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

const asJson = async (res, fn) => {
  try {
    const result = await fn();
    if (result === null) return res.status(404).json({ error: "Not found" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.message === "Not found" ? 404 : 500).json({ error: err.message });
  }
};

// ---------- Public ----------

app.get("/api/health", (_req, res) => res.json({ ok: true, db: "sqlite" }));

app.get("/api/config", (_req, res) => {
  const orchestrator = orchestratorConfigured();
  res.json({
    hermesChatEnabled: hermesChatConfigured() || orchestrator,
    hermesCronEnabled: hermesCronConfigured(),
    googleAuthEnabled: Boolean(process.env.GOOGLE_CLIENT_ID),
    orchestratorEnabled: orchestrator,
    orchestratorMissing:
      orchestrator || process.env.HERMES_ORCHESTRATOR === "disabled"
        ? []
        : ["FLY_API_TOKEN", "FLY_AGENT_APP", "FLY_AGENT_IMAGE"].filter((k) => !process.env[k]),
  });
});

// ---------- Auth ----------

app.get("/api/auth/me", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  });
});

app.get("/api/auth/google", (_req, res) => {
  try {
    const state = newOAuthState();
    res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600_000, path: "/" });
    res.redirect(googleAuthUrl(state));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.cookies?.oauth_state) {
      return res.redirect(`${CLIENT_URL}?auth=failed`);
    }
    res.clearCookie("oauth_state", { path: "/" });
    const user = await exchangeGoogleCode(String(code));
    setSessionCookie(res, user.id);
    res.redirect(CLIENT_URL);
  } catch (err) {
    console.error(err);
    res.redirect(`${CLIENT_URL}?auth=failed`);
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Hermes chat (authenticated) ----------

// Resolve the per-user Hermes target. Returns null + 202 semantics handled by caller.
async function resolveChatTarget(req, res) {
  if (!orchestratorConfigured()) return { target: undefined };
  const state = await quickState(req.user.id);
  if (!isMachineRunning(state)) {
    // kick off start in the background (coalesced) and tell the client to retry
    ensureInstance(req.user.id).catch((err) =>
      console.error("[orchestrator] background start failed:", err.message)
    );
    res.status(202).json({ status: "starting", message: "Starting your Hermes instance…" });
    return { warming: true };
  }
  const target = await ensureInstance(req.user.id);
  return { target };
}

app.get("/api/hermes/models", requireUser, async (req, res) => {
  try {
    if (orchestratorConfigured()) {
      const state = await quickState(req.user.id);
      if (!isMachineRunning(state)) {
        ensureInstance(req.user.id).catch(() => {});
        return res.json({ models: [], error: null, status: "starting" });
      }
      const target = await ensureInstance(req.user.id);
      return res.json(await listHermesModels(target));
    }
    res.json(await listHermesModels());
  } catch (err) {
    res.status(500).json({ models: [], error: err.message });
  }
});

app.post("/api/hermes/chat", requireUser, async (req, res) => {
  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages?.length) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const { target, warming } = await resolveChatTarget(req, res);
    if (warming) return; // 202 already sent

    await streamHermesChat({
      messages,
      model: typeof req.body?.model === "string" ? req.body.model : undefined,
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
});

// ---------- Hermes cron (authenticated, per-user instance) ----------

// Ensure the user's Hermes container is running, return its container name.
async function ensureCronContainer(req) {
  const t = await ensureInstance(req.user.id);
  return t.containerName;
}

app.get("/api/hermes/cron/meta", requireUser, (_req, res) => {
  res.json({
    enabled: hermesCronConfigured(),
    deliveryOptions: CRON_DELIVERY_OPTIONS,
    scheduleExamples: CRON_SCHEDULE_EXAMPLES,
  });
});

app.get("/api/hermes/cron/status", requireUser, async (req, res) => {
  try {
    if (!hermesCronConfigured()) {
      return res.status(503).json({ error: "Hermes cron is not configured" });
    }
    // Don't force a cold start just to read status.
    const state = await quickState(req.user.id);
    if (!isMachineRunning(state)) {
      return res.json({ status: "Instance stopped — scheduled jobs run only while it is active." });
    }
    const inst = await getInstance(req.user.id);
    if (!inst?.machine_id) {
      return res.json({ status: "No Hermes instance provisioned yet." });
    }
    res.json(await cronSchedulerStatusFor(inst.machine_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/hermes/cron", requireUser, async (req, res) => {
  try {
    if (!hermesCronConfigured()) {
      return res.status(503).json({ error: "Hermes cron is not configured" });
    }
    // Listing reads jobs.json from the volume without forcing a cold start.
    res.json(await listCronJobsFor(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/hermes/cron", requireUser, async (req, res) => {
  try {
    if (!hermesCronConfigured()) {
      return res.status(503).json({ error: "Hermes cron is not configured" });
    }
    res.json(await createCronJobFor(await ensureCronContainer(req), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/hermes/cron/:id", requireUser, async (req, res) => {
  try {
    if (!hermesCronConfigured()) {
      return res.status(503).json({ error: "Hermes cron is not configured" });
    }
    res.json(await editCronJobFor(await ensureCronContainer(req), req.params.id, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/hermes/cron/:id/pause", requireUser, async (req, res) => {
  try {
    res.json(await pauseCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/hermes/cron/:id/resume", requireUser, async (req, res) => {
  try {
    res.json(await resumeCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/hermes/cron/:id/run", requireUser, async (req, res) => {
  try {
    res.json(await runCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/hermes/cron/:id", requireUser, async (req, res) => {
  try {
    res.json(await removeCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Hermes instance status (authenticated) ----------

app.get("/api/hermes/instance", requireUser, async (req, res) => {
  try {
    if (!orchestratorConfigured()) {
      return res.json({ orchestrator: false, state: "shared" });
    }
    const state = await quickState(req.user.id);
    res.json({ orchestrator: true, state, settings: ORCHESTRATOR_SETTINGS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/hermes/instance/ensure", requireUser, async (req, res) => {
  try {
    if (!orchestratorConfigured()) {
      return res.json({ orchestrator: false, ready: true });
    }
    if (!templateConfigured()) {
      return res.status(503).json({
        ready: false,
        error:
          "Hermes template not configured. Ensure ./hermes-data/.env exists (from hermes setup) and is mounted into the API container.",
      });
    }
    const target = await ensureInstance(req.user.id);
    const { models, error } = await listHermesModels(target);
    if (error && !models?.length) {
      return res.status(503).json({
        ready: false,
        state: "running",
        containerName: target.containerName,
        error: error || "Hermes agent is not responding",
      });
    }
    res.json({
      ready: true,
      state: "running",
      machineId: target.machineId,
      machineName: target.machineName,
    });
  } catch (err) {
    console.error("[orchestrator] ensure failed:", err.message);
    res.status(503).json({ ready: false, error: err.message });
  }
});

// Admin: list all instances (any authenticated user; tighten later if needed)
app.get("/api/hermes/instances", requireUser, async (_req, res) => {
  try {
    res.json({ instances: await listInstances() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Posts (authenticated) ----------

app.get("/api/posts", requireUser, (req, res) =>
  asJson(res, () => listPosts(req.user.id))
);

app.post("/api/posts", requireUser, (req, res) =>
  asJson(res, () => createPost(req.user.id, req.body))
);

app.get("/api/posts/:id", requireUser, (req, res) =>
  asJson(res, () => getPost(Number(req.params.id), req.user.id))
);

app.put("/api/posts/:id", requireUser, (req, res) =>
  asJson(res, () => updatePost(Number(req.params.id), req.user.id, req.body))
);

app.delete("/api/posts/:id", requireUser, (req, res) =>
  asJson(res, async () => {
    await deletePost(Number(req.params.id), req.user.id);
    return { ok: true };
  })
);

app.post("/api/posts/:id/versions", requireUser, (req, res) =>
  asJson(res, () => addVersion(Number(req.params.id), req.user.id, req.body))
);

app.post("/api/posts/:id/feedback", requireUser, (req, res) =>
  asJson(res, () => addFeedback(Number(req.params.id), req.user.id, req.body))
);

app.put("/api/feedback/:id", requireUser, (req, res) =>
  asJson(res, () => updateFeedbackStatus(Number(req.params.id), req.body.status))
);

app.delete("/api/feedback/:id", requireUser, (req, res) =>
  asJson(res, async () => {
    await deleteFeedback(Number(req.params.id), req.user.id);
    return { ok: true };
  })
);

app.get("/api/feedback/pending", requireUser, (req, res) =>
  asJson(res, () => listPendingFeedback(req.user.id))
);

app.get("/api/feedback/:id/thread", requireUser, (req, res) =>
  asJson(res, () => getTaskThread(Number(req.params.id), req.user.id))
);

app.post("/api/feedback/:id/chat", requireUser, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "message is required" });

    const thread = await getTaskThread(taskId, req.user.id);
    if (!thread) return res.status(404).json({ error: "Not found" });

    const userMsg = await addAiTaskChatMessage(taskId, "user", message);
    const updatedThread = await getTaskThread(taskId, req.user.id);
    const reply = await generateTaskChatReply({ thread: updatedThread });
    const assistantMsg = await addAiTaskChatMessage(taskId, "assistant", reply);

    res.json({
      user: userMsg,
      assistant: assistantMsg,
      thread: await getTaskThread(taskId, req.user.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Agent API (Hermes — session or X-Agent-Key) ----------

app.get("/api/active", requireUserOrAgent, (req, res) =>
  asJson(res, () => getActivePostPayload(publicUserId(req)))
);

app.get("/api/active/tasks", requireUserOrAgent, (req, res) =>
  asJson(res, () => getActiveTasksPayload(publicUserId(req)))
);

app.post("/api/feedback/:id/claim", requireUserOrAgent, (req, res) =>
  asJson(res, () => updateFeedbackStatus(Number(req.params.id), "in_progress"))
);

app.get("/api/feedback/:id/work", requireUserOrAgent, (req, res) =>
  asJson(res, () => listAiTaskWork(Number(req.params.id)))
);

app.post("/api/feedback/:id/work", requireUserOrAgent, (req, res) => {
  const taskId = Number(req.params.id);
  const result = typeof req.body?.result === "string" ? req.body.result : "";
  if (!result.trim()) return res.status(400).json({ error: "result is required" });
  return asJson(res, () => addAiTaskWork(taskId, result));
});

app.get("/api/posts/:id/reports", requireUserOrAgent, (req, res) =>
  asJson(res, () => listAiJobReports(Number(req.params.id)))
);

app.post("/api/posts/:id/reports", requireUserOrAgent, (req, res) => {
  const postId = Number(req.params.id);
  const versionNumber = Number(req.body?.version_number);
  const summary =
    typeof req.body?.summary_action_report === "string"
      ? req.body.summary_action_report
      : typeof req.body?.summary === "string"
        ? req.body.summary
        : "";
  if (!versionNumber) return res.status(400).json({ error: "version_number is required" });
  if (!summary.trim()) return res.status(400).json({ error: "summary_action_report is required" });
  return asJson(res, () => addAiJobReport(postId, versionNumber, summary));
});

async function start() {
  initDb();
  startIdleReaper();
  app.listen(PORT, HOST, () => {
    console.log(`Musely API on http://${HOST}:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Client URL (CORS): ${CLIENT_URL}`);
    console.log(`Hermes orchestrator: ${orchestratorConfigured() ? `enabled (app=${process.env.FLY_AGENT_APP})` : "disabled"}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
