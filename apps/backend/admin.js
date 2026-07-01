// Admin panel auth — a single set of credentials (ADMIN_USERNAME / ADMIN_PASSWORD)
// guarded by an HMAC-signed cookie. Separate from the Google user session.

import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE = "musely_admin";
const ADMIN_DAYS = 7;

function adminSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (min 16 chars)");
  return s;
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function adminUsername() {
  return process.env.ADMIN_USERNAME || "admin";
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyAdminCredentials(username, password) {
  if (!adminConfigured()) return false;
  // Evaluate both comparisons to avoid short-circuit timing leaks.
  const okUser = safeEqual(username ?? "", adminUsername());
  const okPass = safeEqual(password ?? "", process.env.ADMIN_PASSWORD);
  return okUser && okPass;
}

export function signAdminToken() {
  const exp = Date.now() + ADMIN_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ admin: true, exp })).toString("base64url");
  const sig = createHmac("sha256", adminSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyAdminToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", adminSecret()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(data.admin) && typeof data.exp === "number" && Date.now() <= data.exp;
  } catch {
    return false;
  }
}

export function setAdminCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  res.cookie(ADMIN_COOKIE, signAdminToken(), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: ADMIN_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function isAdminRequest(req) {
  return verifyAdminToken(req.cookies?.[ADMIN_COOKIE]);
}

export function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

export { ADMIN_COOKIE };
