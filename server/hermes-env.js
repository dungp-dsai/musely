import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let envLoaded = false;

export function loadHermesEnv() {
  if (envLoaded) return;
  envLoaded = true;

  const candidates = [
    process.env.HERMES_HOME ? join(process.env.HERMES_HOME, ".env") : null,
    join(homedir(), ".hermes", ".env"),
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  }
}

export function getHermesApiConfig() {
  loadHermesEnv();

  const apiKey =
    process.env.HERMES_API_SERVER_KEY || process.env.API_SERVER_KEY || "";
  const port = process.env.API_SERVER_PORT || "8642";
  const baseUrl = (
    process.env.HERMES_API_BASE_URL || `http://127.0.0.1:${port}/v1`
  ).replace(/\/+$/, "");

  return { apiKey, baseUrl };
}
