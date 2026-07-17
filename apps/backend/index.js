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
  serializeUser,
  setUserOnboarding,
  getUserPreferences,
  updateUserTopics,
  parseUserTopics,
  getUserById,
  listFeedPosts,
  getFeedPost,
  countFeedPosts,
  addFeedPosts,
  clearFeedPosts,
  setFeedPostReaction,
  addFeedPostFeedback,
  getFeedUserPrefs,
  updateFeedUserPrefs,
  normalizeFeedPostInput,
  getFeedDiscussionThread,
  ensureFeedDiscussion,
  addFeedDiscussionMessage,
} from "./db.js";
import { buildTaskDiscussMessages, taskDiscussSessionId } from "./task-chat.js";
import { generateFeedItems } from "./feed.js";
import {
  getActivePostPayload,
  getActiveTasksPayload,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
} from "./agent-api.js";
import {
  muselyAgentChatConfigured,
  listMuselyAgentModels,
  streamMuselyAgentChat,
} from "./musely-agent-chat.js";
import {
  handleMuselyAgentStreamRequest,
  resolveMuselyAgentTarget,
} from "./musely-agent-request.js";
import { buildFeedRefreshMessages } from "./feed-agent.js";
import { buildFeedDiscussMessages } from "./feed-discuss.js";
import { muselyAgentApiEnvConfigured } from "./musely-agent-api-env.js";
import {
  muselyAgentCronConfigured,
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
} from "./musely-agent-cron.js";
import {
  orchestratorConfigured,
  ensureInstance,
  quickState,
  isMachineRunning,
  templateConfigured,
  startIdleReaper,
  ORCHESTRATOR_SETTINGS,
} from "./musely-agent-orchestrator.js";
import {
  listInstances,
  getInstance,
  addWaitlistEmail,
  listWaitlist,
  getWaitlistRow,
  setWaitlistApproval,
  isEmailApproved,
} from "./db.js";
import { sendWaitlistConfirmation, sendWaitlistApproval, emailConfigured } from "./email.js";
import {
  adminConfigured,
  verifyAdminCredentials,
  setAdminCookie,
  clearAdminCookie,
  isAdminRequest,
  requireAdmin,
} from "./admin.js";
import {
  googleAuthUrl,
  exchangeGoogleCode,
  setSessionCookie,
  clearSessionCookie,
  getUserFromRequest,
  newOAuthState,
} from "./auth.js";
import { requireUser, requireUserOrAgent, publicUserId } from "./middleware/auth.js";
import { syncPlatformForAllUsers, platformConfigured } from "./musely-agent-platform-sync.js";
import { normalizeSyncSections } from "./musely-agent-platform-sync-runner.js";
import {
  listPlatformFiles,
  readPlatformFile,
  writePlatformFile,
  createPlatformFile,
  deletePlatformFile,
} from "./musely-agent-platform-files.js";
import {
  setPlatformSecret,
  deletePlatformSecret,
  seedPlatformSecretsFromEnv,
  platformSecretsPreview,
} from "./musely-agent-platform-env.js";
import {
  listPlatformSkills,
  readPlatformSkill,
  createPlatformSkill,
  updatePlatformSkill,
  deletePlatformSkill,
} from "./musely-agent-platform-skills.js";
import { ensurePlatformDir } from "./musely-agent-platform-init.js";

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
    muselyAgentChatEnabled: muselyAgentChatConfigured() || orchestrator,
    muselyAgentCronEnabled: muselyAgentCronConfigured(),
    googleAuthEnabled: Boolean(process.env.GOOGLE_CLIENT_ID),
    orchestratorEnabled: orchestrator,
    orchestratorMissing:
      orchestrator || process.env.MUSELY_AGENT_ORCHESTRATOR === "disabled"
        ? []
        : ["MACHINES_API_TOKEN", "FLY_AGENT_APP", "FLY_AGENT_IMAGE"].filter(
            (k) => !(k === "MACHINES_API_TOKEN" ? process.env.MACHINES_API_TOKEN || process.env.FLY_API_TOKEN : process.env[k])
          ),
  });
});

// ---------- Waiting list (public) ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/waitlist", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const { created } = await addWaitlistEmail(email, "landing");

    // Confirm via Resend. Never fail the signup if the email send hiccups —
    // the address is already safely stored.
    let emailed = false;
    if (created && emailConfigured()) {
      try {
        await sendWaitlistConfirmation(email);
        emailed = true;
      } catch (err) {
        console.error("[waitlist] confirmation email failed:", err.message);
      }
    }

    res.json({ ok: true, alreadyJoined: !created, emailed });
  } catch (err) {
    console.error("[waitlist]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ---------- Admin panel ----------

app.get("/api/admin/me", (req, res) => {
  res.json({ authenticated: isAdminRequest(req), configured: adminConfigured() });
});

app.post("/api/admin/login", (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({ error: "Admin panel is not configured (set ADMIN_PASSWORD)." });
  }
  const { username, password } = req.body || {};
  if (!verifyAdminCredentials(username, password)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  setAdminCookie(res);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/waitlist", requireAdmin, async (_req, res) => {
  try {
    const entries = await listWaitlist();
    res.json({
      entries: entries.map((e) => ({
        id: e.id,
        email: e.email,
        approved: Boolean(e.approved),
        source: e.source,
        createdAt: e.created_at,
        approvedAt: e.approved_at,
      })),
      emailConfigured: emailConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/waitlist/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getWaitlistRow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const wasApproved = Boolean(existing.approved);
    const row = await setWaitlistApproval(id, true);

    // Notify the user on first approval only (best-effort).
    let emailed = false;
    if (!wasApproved && emailConfigured()) {
      try {
        await sendWaitlistApproval(row.email);
        emailed = true;
      } catch (err) {
        console.error("[admin] approval email failed:", err.message);
      }
    }

    res.json({ ok: true, emailed, entry: { id: row.id, email: row.email, approved: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/waitlist/:id/revoke", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getWaitlistRow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const row = await setWaitlistApproval(id, false);
    res.json({ ok: true, entry: { id: row.id, email: row.email, approved: false } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/musely-agent/sync-platform", requireAdmin, async (req, res) => {
  try {
    const sections = normalizeSyncSections(req.body?.sections);
    const result = await syncPlatformForAllUsers({
      restart: req.body?.restart !== false,
      sections,
    });
    res.json({ ok: true, platformConfigured: platformConfigured(), ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/musely-agent/platform/files", requireAdmin, (_req, res) => {
  try {
    res.json(listPlatformFiles());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/musely-agent/platform/secrets", requireAdmin, (_req, res) => {
  try {
    res.json(platformSecretsPreview());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/musely-agent/platform/secrets", requireAdmin, (req, res) => {
  try {
    const items = Array.isArray(req.body?.secrets) ? req.body.secrets : [];
    const saved = [];
    for (const item of items) {
      if (!item?.key) continue;
      if (item.delete) {
        deletePlatformSecret(item.key);
        saved.push({ key: item.key, deleted: true });
      } else if (item.value) {
        setPlatformSecret(item.key, item.value);
        saved.push({ key: item.key, saved: true });
      }
    }
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/musely-agent/platform/skills", requireAdmin, (_req, res) => {
  try {
    res.json({ skills: listPlatformSkills() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/musely-agent/platform/skills", requireAdmin, (req, res) => {
  try {
    const skill = createPlatformSkill({
      id: req.body?.id,
      content: req.body?.content,
    });
    res.status(201).json(skill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/musely-agent/platform/skills/:id", requireAdmin, (req, res) => {
  try {
    res.json(readPlatformSkill(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/admin/musely-agent/platform/skills/:id", requireAdmin, (req, res) => {
  try {
    res.json(updatePlatformSkill(req.params.id, req.body?.content ?? ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/musely-agent/platform/skills/:id", requireAdmin, (req, res) => {
  try {
    res.json(deletePlatformSkill(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/musely-agent/platform/file", requireAdmin, (req, res) => {
  try {
    const path = String(req.query.path || "");
    res.json(readPlatformFile(path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/admin/musely-agent/platform/file", requireAdmin, (req, res) => {
  try {
    const path = String(req.body?.path || "");
    const content = req.body?.content ?? "";
    res.json(writePlatformFile(path, content));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/admin/musely-agent/platform/file", requireAdmin, (req, res) => {
  try {
    const path = String(req.body?.path || "");
    const content = req.body?.content ?? "";
    res.status(201).json(createPlatformFile(path, content));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/musely-agent/platform/file", requireAdmin, (req, res) => {
  try {
    const path = String(req.query.path || req.body?.path || "");
    res.json(deletePlatformFile(path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Auth ----------

app.get("/api/auth/me", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json(serializeUser(user));
});

// First-run onboarding: save the topics the user wants to write and read about,
// then mark them onboarded. Only after this does the client provision the agent.
app.post("/api/onboarding", requireUser, (req, res) =>
  asJson(res, async () => {
    const topics = parseUserTopics({
      interests: req.body?.interests ?? req.body?.topics?.interests,
      write: req.body?.write ?? req.body?.topics?.write,
      read: req.body?.read ?? req.body?.topics?.read,
    });
    await setUserOnboarding(req.user.id, topics);
    return serializeUser(await getUserById(req.user.id));
  })
);

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
    if (!(await isEmailApproved(user.email))) {
      return res.redirect(`${CLIENT_URL}?auth=not_approved`);
    }
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

// ---------- Musely agent chat (authenticated) ----------

app.get("/api/musely-agent/models", requireUser, async (req, res) => {
  try {
    if (orchestratorConfigured()) {
      const state = await quickState(req.user.id);
      if (!isMachineRunning(state)) {
        ensureInstance(req.user.id).catch(() => {});
        return res.json({ models: [], error: null, status: "starting" });
      }
      const target = await ensureInstance(req.user.id);
      return res.json(await listMuselyAgentModels(target));
    }
    res.json(await listMuselyAgentModels());
  } catch (err) {
    res.status(500).json({ models: [], error: err.message });
  }
});

app.post("/api/musely-agent/chat", requireUser, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages?.length) {
    return res.status(400).json({ error: "messages array is required" });
  }
  await handleMuselyAgentStreamRequest(req, res, {
    messages,
    model: typeof req.body?.model === "string" ? req.body.model : undefined,
  });
});

// ---------- Musely agent cron (authenticated, per-user instance) ----------

// Ensure the user's Musely agent container is running, return its container name.
async function ensureCronContainer(req) {
  const t = await ensureInstance(req.user.id);
  return t.containerName;
}

app.get("/api/musely-agent/cron/meta", requireUser, (_req, res) => {
  res.json({
    enabled: muselyAgentCronConfigured(),
    deliveryOptions: CRON_DELIVERY_OPTIONS,
    scheduleExamples: CRON_SCHEDULE_EXAMPLES,
  });
});

app.get("/api/musely-agent/cron/status", requireUser, async (req, res) => {
  try {
    if (!muselyAgentCronConfigured()) {
      return res.status(503).json({ error: "Musely agent cron is not configured" });
    }
    // Don't force a cold start just to read status.
    const state = await quickState(req.user.id);
    if (!isMachineRunning(state)) {
      return res.json({ status: "Instance stopped — scheduled jobs run only while it is active." });
    }
    const inst = await getInstance(req.user.id);
    if (!inst?.machine_id) {
      return res.json({ status: "No Musely agent instance provisioned yet." });
    }
    res.json(await cronSchedulerStatusFor(inst.machine_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/musely-agent/cron", requireUser, async (req, res) => {
  try {
    if (!muselyAgentCronConfigured()) {
      return res.status(503).json({ error: "Musely agent cron is not configured" });
    }
    // Listing reads jobs.json from the volume without forcing a cold start.
    res.json(await listCronJobsFor(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/musely-agent/cron", requireUser, async (req, res) => {
  try {
    if (!muselyAgentCronConfigured()) {
      return res.status(503).json({ error: "Musely agent cron is not configured" });
    }
    res.json(await createCronJobFor(await ensureCronContainer(req), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/musely-agent/cron/:id", requireUser, async (req, res) => {
  try {
    if (!muselyAgentCronConfigured()) {
      return res.status(503).json({ error: "Musely agent cron is not configured" });
    }
    res.json(await editCronJobFor(await ensureCronContainer(req), req.params.id, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/musely-agent/cron/:id/pause", requireUser, async (req, res) => {
  try {
    res.json(await pauseCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/musely-agent/cron/:id/resume", requireUser, async (req, res) => {
  try {
    res.json(await resumeCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/musely-agent/cron/:id/run", requireUser, async (req, res) => {
  try {
    res.json(await runCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/musely-agent/cron/:id", requireUser, async (req, res) => {
  try {
    res.json(await removeCronJobFor(await ensureCronContainer(req), req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Musely agent instance status (authenticated) ----------

app.get("/api/musely-agent/instance", requireUser, async (req, res) => {
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

app.post("/api/musely-agent/instance/ensure", requireUser, async (req, res) => {
  try {
    if (!orchestratorConfigured()) {
      return res.json({ orchestrator: false, ready: true });
    }
    if (!templateConfigured()) {
      return res.status(503).json({
        ready: false,
        error:
          "Musely agent orchestrator is not ready. Run ./scripts/dev.sh for local dev. Add musely-agent-platform/config.yaml (see config.yaml.example) and sync from Admin.",
      });
    }
    const target = await ensureInstance(req.user.id);
    const { models, error } = await listMuselyAgentModels(target);
    if (error && !models?.length) {
      return res.status(503).json({
        ready: false,
        state: "running",
        containerName: target.containerName,
        error: error || "Musely agent is not responding",
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
app.get("/api/musely-agent/instances", requireUser, async (_req, res) => {
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
  const taskId = Number(req.params.id);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "message is required" });

  const thread = await getTaskThread(taskId, req.user.id);
  if (!thread) return res.status(404).json({ error: "Not found" });

  // Resolve agent BEFORE any writes — 202 warm retries must not duplicate user rows.
  const { target, warming } = await resolveMuselyAgentTarget(req.user.id, res);
  if (warming) return;

  await addAiTaskChatMessage(taskId, "user", message);
  const fresh = await getTaskThread(taskId, req.user.id);
  const messages = buildTaskDiscussMessages(fresh, message);

  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  try {
    await streamMuselyAgentChat({
      messages,
      res,
      signal: controller.signal,
      target,
      sessionId: taskDiscussSessionId(req.user.id, taskId),
      onComplete: async (reply) => {
        await addAiTaskChatMessage(taskId, "assistant", reply);
      },
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

// ---------- Home feed ----------

function feedListQuery(req) {
  const limit = Number(req.query?.limit) || 20;
  const offset = Number(req.query?.offset) || 0;
  return { limit, offset };
}

function parseFeedPostsBody(body) {
  if (Array.isArray(body?.posts)) return body.posts;
  if (body && typeof body === "object" && body.title) return [body];
  return [];
}

// List feed posts for the signed-in user (also used by the agent for history).
app.get("/api/feed/posts", requireUserOrAgent, (req, res) =>
  asJson(res, async () => {
    const userId = publicUserId(req);
    const { limit, offset } = feedListQuery(req);
    const posts = await listFeedPosts(userId, { limit, offset });
    return {
      posts,
      total: await countFeedPosts(userId),
      limit,
      offset,
    };
  })
);

app.get("/api/feed/posts/:id", requireUserOrAgent, (req, res) =>
  asJson(res, async () => {
    const post = await getFeedPost(publicUserId(req), Number(req.params.id));
    if (!post) throw new Error("Not found");
    return post;
  })
);

// Agent (or user) writes one or more feed posts after ingestion.
app.post("/api/feed/posts", requireUserOrAgent, (req, res) => {
  const posts = parseFeedPostsBody(req.body);
  if (!posts.length) {
    return res.status(400).json({ error: "posts array or single post object is required" });
  }
  const invalid = posts.find((p) => !normalizeFeedPostInput(p));
  if (invalid) {
    return res.status(400).json({ error: "each post requires a non-empty title" });
  }
  return asJson(res, async () => {
    const userId = publicUserId(req);
    const inserted = await addFeedPosts(userId, posts);
    return { ok: true, count: inserted.length, posts: inserted };
  });
});

app.put("/api/feed/posts/:id/reaction", requireUser, (req, res) => {
  const reaction = req.body?.reaction;
  if (reaction !== null && reaction !== "up" && reaction !== "down") {
    return res.status(400).json({ error: 'reaction must be "up", "down", or null' });
  }
  return asJson(res, async () => {
    const post = await setFeedPostReaction(
      req.user.id,
      Number(req.params.id),
      reaction ?? null
    );
    if (!post) throw new Error("Not found");
    return post;
  });
});

app.post("/api/feed/posts/:id/feedback", requireUser, (req, res) => {
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  if (!content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }
  return asJson(res, async () => {
    const row = await addFeedPostFeedback(req.user.id, Number(req.params.id), content);
    if (!row) throw new Error("Not found");
    return row;
  });
});

app.get("/api/feed/posts/:id/discuss", requireUser, (req, res) =>
  asJson(res, async () => {
    const postId = Number(req.params.id);
    const thread = await getFeedDiscussionThread(req.user.id, postId);
    if (!thread) throw new Error("Not found");
    return thread;
  })
);

app.post("/api/feed/posts/:id/discuss", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const post = await getFeedPost(req.user.id, postId);
  if (!post) return res.status(404).json({ error: "Not found" });

  const discussion = await ensureFeedDiscussion(req.user.id, postId);
  if (!discussion) return res.status(404).json({ error: "Not found" });

  // Resolve agent BEFORE any writes — a 202 warm retry would otherwise
  // duplicate the user message and skip first-turn post context.
  const { target, warming } = await resolveMuselyAgentTarget(req.user.id, res);
  if (warming) return;

  await addFeedDiscussionMessage(discussion.id, "user", message);

  const messages = buildFeedDiscussMessages(post, message);

  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  try {
    await streamMuselyAgentChat({
      messages,
      res,
      signal: controller.signal,
      target,
      sessionId: discussion.hermes_session_id,
      onComplete: async (reply) => {
        await addFeedDiscussionMessage(discussion.id, "assistant", reply);
      },
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

app.get("/api/feed/prefs", requireUser, (req, res) =>
  asJson(res, () => getFeedUserPrefs(req.user.id))
);

app.put("/api/feed/prefs", requireUser, (req, res) =>
  asJson(res, () =>
    updateFeedUserPrefs(req.user.id, {
      skip_feedback_prompt: Boolean(req.body?.skip_feedback_prompt),
    })
  )
);

// User topic preferences (interests / read / write) — for feed personalization and agent prompts.
app.get("/api/user/preferences", requireUserOrAgent, (req, res) =>
  asJson(res, async () => {
    const prefs = await getUserPreferences(publicUserId(req));
    if (!prefs) throw new Error("Not found");
    return prefs;
  })
);

app.put("/api/user/preferences", requireUserOrAgent, (req, res) =>
  asJson(res, async () => {
    const userId = publicUserId(req);
    const topics = parseUserTopics({
      interests: req.body?.interests ?? req.body?.topics?.interests,
      write: req.body?.write ?? req.body?.topics?.write,
      read: req.body?.read ?? req.body?.topics?.read,
    });
    const row = await updateUserTopics(userId, topics);
    if (!row) throw new Error("Not found");
    return getUserPreferences(userId);
  })
);

// Legacy alias
app.get("/api/feed", requireUser, (req, res) =>
  asJson(res, async () => listFeedPosts(req.user.id, feedListQuery(req)))
);

// Ask the user's agent to build feed posts via the build-feed skill (SSE stream).
app.post("/api/feed/refresh", requireUser, async (req, res) => {
  if (orchestratorConfigured() && !muselyAgentApiEnvConfigured()) {
    return res
      .status(503)
      .json({ error: "We couldn't update your feed right now. Please try again in a moment." });
  }
  const prefs = await getUserPreferences(req.user.id);
  const topics = prefs?.topics;
  const hasPrefs =
    String(topics?.interests || "").trim() ||
    topics?.read?.length ||
    topics?.write?.length;
  if (!hasPrefs) {
    return res.status(400).json({ error: "Please set your interests in Profile first." });
  }
  const messages = buildFeedRefreshMessages(prefs);
  await handleMuselyAgentStreamRequest(req, res, { messages });
});

// Legacy LLM ingest (deprecated — prefer /api/feed/refresh).
app.post("/api/feed/ingest", requireUser, (req, res) =>
  asJson(res, async () => {
    const user = await getUserById(req.user.id);
    const topics = parseUserTopics(user?.topics);
    const replace = req.body?.replace !== false;

    const { items, source } = await generateFeedItems(topics);
    if (replace) await clearFeedPosts(req.user.id);
    if (items.length) await addFeedPosts(req.user.id, items);

    return {
      ok: true,
      source,
      posts: await listFeedPosts(req.user.id, { limit: 100 }),
    };
  })
);

app.post("/api/feed/clear", requireUser, (req, res) =>
  asJson(res, async () => {
    await clearFeedPosts(req.user.id);
    return { ok: true, count: await countFeedPosts(req.user.id) };
  })
);

// ---------- Agent API (Musely agent — session or X-Agent-Key) ----------

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
  ensurePlatformDir();
  seedPlatformSecretsFromEnv();
  startIdleReaper();
  app.listen(PORT, HOST, () => {
    console.log(`Musely API on http://${HOST}:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Client URL (CORS): ${CLIENT_URL}`);
    console.log(`Musely agent orchestrator: ${orchestratorConfigured() ? `enabled (app=${process.env.FLY_AGENT_APP})` : "disabled"}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
