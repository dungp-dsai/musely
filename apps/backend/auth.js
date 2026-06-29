// Google OAuth + session JWT in httpOnly cookie.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { upsertGoogleUser, getUserById } from "./db.js";

const SESSION_COOKIE = "writer_session";
const SESSION_DAYS = 30;

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)");
  }
  return s;
}

function b64url(data) {
  return Buffer.from(data).toString("base64url");
}

function fromB64url(str) {
  return Buffer.from(str, "base64url");
}

export function signSessionToken(userId) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ userId, exp }));
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(fromB64url(sig), fromB64url(expected))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8"));
    if (!data.userId || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, userId) {
  const token = signSessionToken(userId);
  const secure = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "lax" : "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function getUserFromRequest(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  const data = verifySessionToken(token);
  if (!data) return null;
  return getUserById(data.userId);
}

export function googleAuthUrl(state) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;
  if (!clientId || !redirectUri) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CALLBACK_URL must be set");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }

  const tokens = await tokenRes.json();
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) throw new Error("Failed to fetch Google user profile");
  const profile = await userRes.json();

  return upsertGoogleUser({
    googleId: profile.sub,
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture,
  });
}

export function newOAuthState() {
  return randomBytes(24).toString("hex");
}

export { SESSION_COOKIE };
