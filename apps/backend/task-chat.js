/** Build Hermes chat messages for Write-mode task discussion. */

/**
 * @param {object} thread - from getTaskThread (task, post, work, report)
 * @param {string} userMessage
 */
export function buildTaskDiscussMessages(thread, userMessage) {
  const comment = String(userMessage || "").trim();
  return [
    { role: "system", content: buildTaskContext(thread) },
    { role: "user", content: comment },
  ];
}

function buildTaskContext(thread) {
  const task = thread?.task || {};
  const postTitle = thread?.post?.title || "Untitled";
  const work = Array.isArray(thread?.work) ? thread.work : [];
  const report = thread?.report;

  const parts = [
    `You are discussing a writing task with the user in Musely Write.`,
    `Stay grounded in this task, the highlighted draft context, and any stored findings unless they clearly ask about something else.`,
    ``,
    `## Post`,
    postTitle,
    ``,
    `## Highlighted context`,
    `"${task.context || ""}"`,
    ``,
    `## Task`,
    task.content || "(empty)",
    `Status: ${task.status || "unknown"}`,
  ];

  if (work.length) {
    parts.push("", "## Stored AI findings");
    work.forEach((w, i) => {
      parts.push(`### Finding ${i + 1}`);
      parts.push(String(w.result || "").trim() || "(empty)");
      parts.push("");
    });
  } else {
    parts.push("", "## Stored AI findings", "(none yet)");
  }

  if (report?.summary_action_report) {
    parts.push("## Action report for saved version");
    parts.push(String(report.summary_action_report).trim());
  }

  parts.push(
    "",
    "Reply helpfully about this task and findings. Cite URLs when referring to research. Keep answers concise unless they ask for depth."
  );

  return parts.join("\n");
}

/** Stable Hermes session id per user+task. */
export function taskDiscussSessionId(userId, taskId) {
  return `task-chat-u${userId}-t${taskId}`;
}

// Kept for any callers that still expect the old OpenRouter helper name.
export async function generateTaskChatReply() {
  throw new Error(
    "Task chat now streams via the user's Musely agent (Hermes). Use buildTaskDiscussMessages + streamMuselyAgentChat."
  );
}
