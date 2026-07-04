// Platform env vars stored in SQLite — synced into each user agent /opt/data/.env

import { db } from "./db.js";

/** Well-known keys (also seeded from process.env on boot). */
export const DEFAULT_PLATFORM_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
];

const KEY_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function validatePlatformEnvKey(key) {
  const k = String(key || "").trim();
  if (!KEY_RE.test(k)) {
    throw new Error("Key must match ^[A-Z][A-Z0-9_]+$ (e.g. OPENROUTER_API_KEY)");
  }
  return k;
}

export function listPlatformSecrets() {
  return db
    .prepare("SELECT key, value, updated_at FROM platform_secrets ORDER BY key")
    .all()
    .map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
}

export function getPlatformSecret(key) {
  const row = db.prepare("SELECT value FROM platform_secrets WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setPlatformSecret(key, value) {
  const k = validatePlatformEnvKey(key);
  const v = String(value ?? "");
  if (!v.trim()) throw new Error("Value is required");
  db.prepare(
    `INSERT INTO platform_secrets (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(k, v);
  return { key: k };
}

export function deletePlatformSecret(key) {
  const k = validatePlatformEnvKey(key);
  db.prepare("DELETE FROM platform_secrets WHERE key = ?").run(k);
  return { key: k };
}

/** Map used when syncing platform to user agents. Admin DB is source of truth. */
export function getPlatformEnvMap() {
  const map = {};
  for (const row of listPlatformSecrets()) {
    if (row.value) map[row.key] = row.value;
  }
  return map;
}

export function maskSecretValue(value) {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function platformSecretsPreview() {
  const entries = listPlatformSecrets().map((row) => ({
    key: row.key,
    masked: maskSecretValue(row.value),
    hasValue: Boolean(row.value),
  }));
  return {
    entries,
    note: "Saved here in the backend database. Sync pushes these into every user agent /opt/data/.env.",
  };
}

/** Import Fly / .env secrets into DB when a key is not set yet (first boot). */
export function seedPlatformSecretsFromEnv() {
  for (const key of DEFAULT_PLATFORM_ENV_KEYS) {
    const fromEnv = process.env[key];
    if (!fromEnv || getPlatformSecret(key)) continue;
    setPlatformSecret(key, fromEnv);
  }
}
