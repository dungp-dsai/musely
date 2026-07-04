// Shared platform → /opt/data sync logic (Docker volumes + Fly machines).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolvePlatformDirForFs } from "./musely-agent-platform-sync.js";
import { getPlatformEnvMap } from "./musely-agent-platform-env.js";

const SKILLS_PREFIX = "skills/musely";

export const SYNC_SECTIONS = ["config", "skills", "secrets"];

/** @param {unknown} input */
export function normalizeSyncSections(input) {
  const allowed = new Set(SYNC_SECTIONS);
  const list = Array.isArray(input) ? input : SYNC_SECTIONS;
  const out = list.filter((s) => allowed.has(s));
  if (!out.length) throw new Error(`sections must include one of: ${SYNC_SECTIONS.join(", ")}`);
  return out;
}

export function platformDirOrThrow() {
  const dir = resolvePlatformDirForFs();
  if (!dir || !existsSync(dir)) {
    throw new Error("Platform directory not configured or missing");
  }
  return dir;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Shell script: copy selected platform parts into $DATA. */
export function buildPlatformSyncShell({
  platformPath = "/platform",
  dataPath = "/opt/data",
  sections = SYNC_SECTIONS,
} = {}) {
  const set = new Set(normalizeSyncSections(sections));
  const envMap = getPlatformEnvMap();
  const lines = ["set -eu", `DATA=${shellQuote(dataPath)}`, `PLATFORM=${shellQuote(platformPath)}`];

  if (set.has("config") || set.has("skills")) {
    lines.push('mkdir -p "$DATA/skills" "$DATA/sessions" "$DATA/memories"');
  }

  if (set.has("config")) {
    lines.push(
      '[ -f "$PLATFORM/config.yaml" ] || [ -f "$PLATFORM/config.yaml.example" ] || { echo "platform config missing" >&2; exit 1; }',
      '[ -f "$PLATFORM/config.yaml" ] && cp "$PLATFORM/config.yaml" "$DATA/config.yaml"',
      '[ -f "$PLATFORM/config.yaml.example" ] && [ ! -f "$DATA/config.yaml" ] && cp "$PLATFORM/config.yaml.example" "$DATA/config.yaml"',
      '[ -f "$PLATFORM/SOUL.md" ] && cp "$PLATFORM/SOUL.md" "$DATA/SOUL.md"'
    );
  }

  if (set.has("skills")) {
    lines.push(
      'if [ ! -d "$PLATFORM/skills/musely" ] || [ -z "$(ls -A "$PLATFORM/skills/musely" 2>/dev/null)" ]; then echo "platform skills missing under $PLATFORM/skills/musely" >&2; exit 1; fi',
      'rm -rf "$DATA/skills/musely"',
      'cp -a "$PLATFORM/skills/musely" "$DATA/skills/musely"'
    );
  }

  if (set.has("secrets")) {
    lines.push('mkdir -p "$DATA"', 'ENV_FILE="$DATA/.env"', 'touch "$ENV_FILE"');
    for (const [key, val] of Object.entries(envMap)) {
      lines.push(
        `tmp="$ENV_FILE.tmp"`,
        `grep -v "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || : > "$tmp"`,
        `mv "$tmp" "$ENV_FILE"`,
        `printf '%s=%s\\n' ${shellQuote(key)} ${shellQuote(val)} >> "$ENV_FILE"`
      );
    }
  }

  lines.push(`echo "[musely] platform sync (${[...set].join(",")}) → $DATA"`);
  return lines.join("\n");
}

/** Post-sync checks on the user volume (Fly/Docker). */
export function buildPlatformSyncVerifyShell({
  dataPath = "/opt/data",
  sections = SYNC_SECTIONS,
} = {}) {
  const set = new Set(normalizeSyncSections(sections));
  const lines = ["set -eu", `DATA=${shellQuote(dataPath)}`];

  if (set.has("config")) {
    lines.push('[ -f "$DATA/config.yaml" ] || { echo "verify: missing $DATA/config.yaml" >&2; exit 1; }');
  }
  if (set.has("skills")) {
    lines.push(
      '[ -d "$DATA/skills/musely" ] || { echo "verify: missing $DATA/skills/musely" >&2; exit 1; }',
      '[ -n "$(ls -A "$DATA/skills/musely" 2>/dev/null)" ] || { echo "verify: $DATA/skills/musely is empty" >&2; exit 1; }'
    );
  }
  if (set.has("secrets")) {
    lines.push('[ -s "$DATA/.env" ] || { echo "verify: missing or empty $DATA/.env" >&2; exit 1; }');
  }

  lines.push('echo "[musely] platform sync verified"');
  return lines.join("\n");
}

function collectTarPaths(platformDir, sections) {
  const set = new Set(normalizeSyncSections(sections));
  const paths = [];

  if (set.has("config")) {
    for (const name of ["config.yaml", "config.yaml.example", "SOUL.md"]) {
      if (existsSync(join(platformDir, name))) paths.push(name);
    }
  }

  if (set.has("skills")) {
    const skillsRoot = join(platformDir, SKILLS_PREFIX);
    if (existsSync(skillsRoot)) {
      const walk = (dir, relPrefix) => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
          const abs = join(dir, ent.name);
          if (ent.isDirectory()) walk(abs, rel);
          else paths.push(`${SKILLS_PREFIX}/${rel}`);
        }
      };
      walk(skillsRoot, "");
    }
  }

  return paths;
}

/** gzip tarball of selected platform paths (for Fly upload). */
export function createPlatformTarBuffer(platformDir, sections = SYNC_SECTIONS) {
  const paths = collectTarPaths(platformDir, sections);
  if (paths.length === 0) {
    const label = normalizeSyncSections(sections).join(", ");
    throw new Error(`Nothing to sync for section(s): ${label}`);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn("tar", ["-czf", "-", "-C", platformDir, ...paths], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(Buffer.concat(chunks).toString("utf8") || `tar exit ${code}`));
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export function chunkBase64(buffer, size = 32_000) {
  const b64 = buffer.toString("base64");
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

export function needsPlatformFiles(sections) {
  return normalizeSyncSections(sections).some((s) => s === "config" || s === "skills");
}

export function assertSecretsReadyForSync(sections) {
  if (!normalizeSyncSections(sections).includes("secrets")) return;
  const map = getPlatformEnvMap();
  if (Object.keys(map).length === 0) {
    throw new Error(
      "No env variables in admin database — enter values and click Save secrets before Sync env vars"
    );
  }
}
