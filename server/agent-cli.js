#!/usr/bin/env node
// Hermes agent <-> writer-app bridge (PostgreSQL).

import { readFileSync } from "node:fs";
import { initDb, listPostsForAgent, getPostForAgent, addVersion, listPendingFeedbackForAgent } from "./db.js";
import {
  getActivePostPayload,
  getActiveTasksPayload,
  updateFeedbackStatus,
  addAiTaskWork,
  listAiTaskWork,
  addAiJobReport,
  listAiJobReports,
  latestVersion,
} from "./agent-api.js";
import { agentUserId } from "./middleware/auth.js";

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function readText(flags, inlineKey, fileKey) {
  let text = flags[inlineKey];
  if (flags[fileKey]) {
    text = readFileSync(flags[fileKey], "utf8");
  }
  return text;
}

function requireText(flags, inlineKey, fileKey) {
  const text = readText(flags, inlineKey, fileKey);
  if (text === undefined) {
    console.error(`Provide --${inlineKey} "..." or --${fileKey} <path>`);
    process.exit(1);
  }
  return typeof text === "string" ? text : "";
}

const [, , command, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);
const uid = agentUserId();

async function main() {
  await initDb();

  switch (command) {
    case "tasks":
      out(await listPendingFeedbackForAgent(uid));
      break;

    case "posts":
      out(await listPostsForAgent(uid));
      break;

    case "active":
      out(await getActivePostPayload(uid));
      break;

    case "active-tasks":
      out(await getActiveTasksPayload(uid));
      break;

    case "post": {
      const id = Number(positional[0]);
      const post = await getPostForAgent(id);
      if (!post) {
        console.error(`No post with id ${id}`);
        process.exit(1);
      }
      out({ ...post, latest_version: latestVersion(post) });
      break;
    }

    case "claim":
      out(await updateFeedbackStatus(Number(positional[0]), "in_progress"));
      break;

    case "version": {
      const postId = Number(positional[0]);
      if (!postId) {
        console.error("Usage: version <postId> [--content ... | --content-file ...]");
        process.exit(1);
      }
      let content = flags.content;
      if (flags["content-file"]) {
        content = readFileSync(flags["content-file"], "utf8");
      }
      if (content === undefined) {
        console.error('Provide --content "..." or --content-file <path>');
        process.exit(1);
      }
      out(
        await addVersion(postId, uid, {
          content: typeof content === "string" ? content : "",
          note: typeof flags.note === "string" ? flags.note : "AI revision",
          title: typeof flags.title === "string" ? flags.title : undefined,
          source: "ai",
          resolvesFeedbackId: flags.resolves ? Number(flags.resolves) : undefined,
        })
      );
      break;
    }

    case "store-work": {
      const taskId = Number(positional[0]);
      if (!taskId) {
        console.error("Usage: store-work <taskId> --result \"...\" | --result-file <path>");
        process.exit(1);
      }
      out(await addAiTaskWork(taskId, requireText(flags, "result", "result-file")));
      break;
    }

    case "work":
      out(await listAiTaskWork(Number(positional[0])));
      break;

    case "store-report": {
      const postId = Number(positional[0]);
      const versionNumber = Number(flags.version);
      if (!postId || !versionNumber) {
        console.error(
          "Usage: store-report <postId> --version <n> --summary \"...\" | --summary-file <path>"
        );
        process.exit(1);
      }
      out(await addAiJobReport(postId, versionNumber, requireText(flags, "summary", "summary-file")));
      break;
    }

    case "reports":
      out(await listAiJobReports(Number(positional[0])));
      break;

    default:
      console.error(
        [
          "Hermes Writer agent CLI",
          "",
          "Commands:",
          "  tasks, posts, active, active-tasks, post <id>, claim <id>",
          "  version, store-work, work, store-report, reports",
        ].join("\n")
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
