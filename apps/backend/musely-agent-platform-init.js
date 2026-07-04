// Ensure musely-agent-platform/ exists (Fly: /data volume; local: bind mount).

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolvePlatformDirForFs } from "./musely-agent-platform-sync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_DIR = resolve(__dirname, "platform-defaults");

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src, { withFileTypes: true })) {
    if (name.name.startsWith(".")) continue;
    const from = join(src, name.name);
    const to = join(dest, name.name);
    if (name.isDirectory()) copyTree(from, to);
    else if (!existsSync(to)) cpSync(from, to);
  }
}

export function ensurePlatformDir() {
  let mount =
    process.env.MUSELY_AGENT_PLATFORM_MOUNT ||
    (process.env.DB_PATH?.startsWith("/data")
      ? "/data/musely-agent-platform"
      : "");

  if (!mount && !process.env.MUSELY_AGENT_PLATFORM_HOST_DIR) {
    mount = "/data/musely-agent-platform";
  }
  if (mount && !process.env.MUSELY_AGENT_PLATFORM_MOUNT) {
    process.env.MUSELY_AGENT_PLATFORM_MOUNT = mount;
  }

  const dir = resolvePlatformDirForFs();
  if (!dir) {
    console.warn("[platform] no platform directory configured");
    return null;
  }

  mkdirSync(dir, { recursive: true });

  if (existsSync(DEFAULTS_DIR)) {
    const hasConfig =
      existsSync(join(dir, "config.yaml")) || existsSync(join(dir, "config.yaml.example"));
    if (!hasConfig) {
      console.log(`[platform] seeding defaults → ${dir}`);
      copyTree(DEFAULTS_DIR, dir);
    }
    mkdirSync(join(dir, "skills", "musely"), { recursive: true });
  }

  return dir;
}
