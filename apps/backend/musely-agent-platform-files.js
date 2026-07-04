// Admin CRUD for musely-agent-platform/ files (local path or compose mount).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  resolvePlatformDirForFs,
  resolvePlatformDirForDocker,
} from "./musely-agent-platform-sync.js";
import { platformSecretsPreview } from "./musely-agent-platform-env.js";

export { platformSecretsPreview };

const EDITABLE_EXT = new Set([
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".json",
  ".sh",
  ".env",
]);

function platformRoot() {
  const abs = resolvePlatformDirForFs();
  if (!abs) {
    throw new Error(
      "Platform directory not configured — set MUSELY_AGENT_PLATFORM_MOUNT or MUSELY_AGENT_PLATFORM_HOST_DIR"
    );
  }
  if (!existsSync(abs)) throw new Error(`Platform directory not found: ${abs}`);
  return abs;
}

function platformDisplayRoot() {
  const host = process.env.MUSELY_AGENT_PLATFORM_HOST_DIR;
  return host ? resolve(host) : platformRoot();
}

function isEditableFile(relPath) {
  const base = relPath.split("/").pop() || "";
  if (base === ".env") return false;
  if (base === ".gitkeep") return false;
  if (relPath.startsWith("skills/")) return false;
  if (base === ".env.example" || base.endsWith(".example")) return true;
  if (base === "SKILL.md" || base === "DESCRIPTION.md") return true;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false;
  return EDITABLE_EXT.has(base.slice(dot).toLowerCase());
}

export function resolvePlatformFile(relPath) {
  const root = platformRoot();
  const clean = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid file path");
  const abs = resolve(root, clean);
  if (!abs.startsWith(root + "/") && abs !== root) throw new Error("Invalid file path");
  return { root, rel: clean, abs };
}

function walkConfigFiles(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    if (name === "skills") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkConfigFiles(abs, root, out);
      continue;
    }
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (isEditableFile(rel)) out.push(rel);
  }
  return out;
}

export function listPlatformFiles() {
  const root = platformRoot();
  const files = walkConfigFiles(root, root).sort();
  for (const rel of ["config.yaml", "config.yaml.example", "SOUL.md"]) {
    if (!files.includes(rel) && existsSync(join(root, rel))) files.push(rel);
  }
  return {
    root: platformDisplayRoot(),
    files: [...new Set(files)].sort(),
    dockerRoot: resolvePlatformDirForDocker(),
    secrets: platformSecretsPreview(),
  };
}

export function readPlatformFile(relPath) {
  const { rel, abs } = resolvePlatformFile(relPath);
  if (!existsSync(abs)) throw new Error(`File not found: ${rel}`);
  if (!isEditableFile(rel)) throw new Error(`File is not editable: ${rel}`);
  return { path: rel, content: readFileSync(abs, "utf8") };
}

export function writePlatformFile(relPath, content) {
  const { rel, abs } = resolvePlatformFile(relPath);
  if (!isEditableFile(rel)) throw new Error(`File is not editable: ${rel}`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, String(content ?? ""), "utf8");
  return { path: rel, bytes: Buffer.byteLength(String(content ?? ""), "utf8") };
}
