// CRUD for Musely-owned skills under musely-agent-platform/skills/musely/

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolvePlatformDirForFs } from "./musely-agent-platform-sync.js";

const SKILLS_REL = "skills/musely";
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

function skillsRoot() {
  const base = resolvePlatformDirForFs();
  if (!base) throw new Error("Platform directory not configured");
  const root = join(base, SKILLS_REL);
  mkdirSync(root, { recursive: true });
  return root;
}

function skillDir(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new Error("Skill name must be lowercase letters, numbers, and hyphens (e.g. feed-writer)");
  }
  return join(skillsRoot(), slug);
}

function skillMdPath(slug) {
  return join(skillDir(slug), "SKILL.md");
}

export function listPlatformSkills() {
  const root = skillsRoot();
  const skills = [];
  if (!existsSync(root)) return skills;

  for (const name of readdirSync(root)) {
    if (name.startsWith(".") || name === ".gitkeep") continue;
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    skills.push({ id: name, hasSkillMd: existsSync(join(dir, "SKILL.md")) });
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function readPlatformSkill(slug) {
  const path = skillMdPath(slug);
  if (!existsSync(path)) throw new Error(`Skill not found: ${slug}`);
  return {
    id: slug,
    path: `${SKILLS_REL}/${slug}/SKILL.md`,
    content: readFileSync(path, "utf8"),
  };
}

export function createPlatformSkill({ id, content }) {
  const slug = String(id || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new Error("Skill name must be lowercase letters, numbers, and hyphens (e.g. feed-writer)");
  }
  const dir = skillDir(slug);
  if (existsSync(dir)) throw new Error(`Skill already exists: ${slug}`);
  mkdirSync(dir, { recursive: true });
  const body = String(content ?? "").trim() || `# ${slug}\n\nDescribe what this skill does.\n`;
  writeFileSync(join(dir, "SKILL.md"), body, "utf8");
  return { id: slug, path: `${SKILLS_REL}/${slug}/SKILL.md`, content: body };
}

export function updatePlatformSkill(slug, content) {
  const path = skillMdPath(slug);
  if (!existsSync(join(skillDir(slug)))) throw new Error(`Skill not found: ${slug}`);
  writeFileSync(path, String(content ?? ""), "utf8");
  return { id: slug, path: `${SKILLS_REL}/${slug}/SKILL.md`, bytes: Buffer.byteLength(String(content ?? "")) };
}

export function deletePlatformSkill(slug) {
  const dir = skillDir(slug);
  if (!existsSync(dir)) throw new Error(`Skill not found: ${slug}`);
  rmSync(dir, { recursive: true, force: true });
  return { id: slug };
}
