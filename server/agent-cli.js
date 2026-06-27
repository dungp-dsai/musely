#!/usr/bin/env node
// Hermes agent <-> Hermes Writer bridge.
//
// This is the command-line surface the Hermes AI agent uses to collaborate on
// writing. It reads/writes the SAME local database the web app uses, so anything
// the agent does shows up instantly in the UI (and vice versa).
//
// Usage:
//   node agent-cli.js tasks                 # list pending feedback (the work queue) as JSON
//   node agent-cli.js post <postId>         # full post: idea, latest draft, all feedback (JSON)
//   node agent-cli.js posts                 # list all posts (JSON)
//   node agent-cli.js active                # In Progress post: content only (JSON)
//   node agent-cli.js active-tasks          # task queue for the In Progress post (JSON)
//   node agent-cli.js claim <feedbackId>    # mark a feedback item as in_progress
//   node agent-cli.js version <postId> --content-file draft.md [--note "..."] [--title "..."] [--resolves <feedbackId>]
//   node agent-cli.js store-work <taskId> --result "..." [--result-file <path>]
//   node agent-cli.js store-report <postId> --version <n> --summary "..." [--summary-file <path>]
//
// Every version created by the agent is tagged source='ai', giving you a clean,
// auditable version history alongside your own edits.

import { readFileSync } from "node:fs";
import {
  listPosts,
  getPost,
  addVersion,
  listPendingFeedback,
} from "./db.js";
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

function requireText(flags, inlineKey, fileKey, label) {
  const text = readText(flags, inlineKey, fileKey);
  if (text === undefined) {
    console.error(`Provide --${inlineKey} "..." or --${fileKey} <path>`);
    process.exit(1);
  }
  return typeof text === "string" ? text : "";
}

const [, , command, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);

try {
  switch (command) {
    case "tasks": {
      out(listPendingFeedback());
      break;
    }

    case "posts": {
      out(listPosts());
      break;
    }

    case "active": {
      out(getActivePostPayload());
      break;
    }

    case "active-tasks": {
      out(getActiveTasksPayload());
      break;
    }

    case "post": {
      const id = Number(positional[0]);
      const post = getPost(id);
      if (!post) {
        console.error(`No post with id ${id}`);
        process.exit(1);
      }
      out({ ...post, latest_version: latestVersion(post) });
      break;
    }

    case "claim": {
      const id = Number(positional[0]);
      out(updateFeedbackStatus(id, "in_progress"));
      break;
    }

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
        console.error("Provide --content \"...\" or --content-file <path>");
        process.exit(1);
      }
      const version = addVersion(postId, {
        content: typeof content === "string" ? content : "",
        note: typeof flags.note === "string" ? flags.note : "AI revision",
        title: typeof flags.title === "string" ? flags.title : undefined,
        source: "ai",
        resolvesFeedbackId: flags.resolves ? Number(flags.resolves) : undefined,
      });
      out(version);
      break;
    }

    case "store-work": {
      const taskId = Number(positional[0]);
      if (!taskId) {
        console.error("Usage: store-work <taskId> --result \"...\" | --result-file <path>");
        process.exit(1);
      }
      const result = requireText(flags, "result", "result-file", "result");
      out(addAiTaskWork(taskId, result));
      break;
    }

    case "work": {
      const taskId = Number(positional[0]);
      if (!taskId) {
        console.error("Usage: work <taskId>");
        process.exit(1);
      }
      out(listAiTaskWork(taskId));
      break;
    }

    case "store-report": {
      const postId = Number(positional[0]);
      const versionNumber = Number(flags.version);
      if (!postId || !versionNumber) {
        console.error(
          "Usage: store-report <postId> --version <n> --summary \"...\" | --summary-file <path>"
        );
        process.exit(1);
      }
      const summary = requireText(flags, "summary", "summary-file", "summary");
      out(addAiJobReport(postId, versionNumber, summary));
      break;
    }

    case "reports": {
      const postId = Number(positional[0]);
      if (!postId) {
        console.error("Usage: reports <postId>");
        process.exit(1);
      }
      out(listAiJobReports(postId));
      break;
    }

    default:
      console.error(
        [
          "Hermes Writer agent CLI",
          "",
          "Commands:",
          "  tasks                       list pending feedback (work queue)",
          "  posts                       list all posts",
          "  active                      In Progress post (content + save state)",
          "  active-tasks                task queue for the In Progress post",
          "  post <postId>               full post incl. idea, drafts, feedback",
          "  claim <feedbackId>          mark feedback in_progress",
          "  version <postId> --content-file <path> [--note ..] [--title ..] [--resolves <feedbackId>]",
          "  version <postId> --content \"text\" [--note ..] [--resolves <feedbackId>]",
          "  store-work <taskId> --result \"...\" | --result-file <path>",
          "  work <taskId>                  list AI work stored for a task",
          "  store-report <postId> --version <n> --summary \"...\" | --summary-file <path>",
          "  reports <postId>               list AI job reports for a post",
        ].join("\n")
      );
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
