// Shared helpers for the API routes (Vercel Node functions: handler(req, res)).
import { timingSafeEqual } from "node:crypto";

export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Paid features can be locked behind a shared passcode (STUDIO_PASSCODE).
export function checkPasscode(req, res) {
  const want = process.env.STUDIO_PASSCODE;
  if (!want) return true;
  if (req.headers["x-studio-passcode"] === want) return true;
  send(res, 401, { error: "Enter the studio passcode to use the AI features." });
  return false;
}

export function requirePost(req, res) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  send(res, 405, { error: "Use POST." });
  return false;
}

// "data:image/jpeg;base64,..." -> { mime, buffer }
export function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw Object.assign(new Error("Send the photo as a JPEG, PNG or WebP data URL."), { status: 400 });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("That photo is too large. Keep it under 3.5 MB."), { status: 413 });
  return { mime: m[1], buffer };
}

export function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  send(res, status, { error: err.expose === false ? "Something went wrong. Try again." : err.message || "Something went wrong." });
}

// ---- Shared by the Art of Eskeml business system (admin, webhooks, cron) ----

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The owner dashboard sends ADMIN_PASSCODE in this header. With no passcode set the
// business API stays closed, because it holds customer data.
export function checkAdmin(req, res) {
  const want = process.env.ADMIN_PASSCODE;
  if (!want) { send(res, 501, { error: "Set ADMIN_PASSCODE to open the dashboard." }); return false; }
  if (safeEqual(String(req.headers["x-admin-passcode"] || ""), want)) return true;
  send(res, 401, { error: "Wrong dashboard passcode." });
  return false;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Webhook signatures are computed over the exact bytes Meta sent. The local dev server
// stores them on req.rawBody; on Vercel the request stream is still unread.
export async function readRaw(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// "98765 43210" -> "919876543210". Indian 10-digit numbers get the 91 prefix.
export function normalizePhone(p) {
  const d = String(p || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  return d.length === 10 ? "91" + d : d;
}

export function rupees(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// The site's own address, for links sent to customers. Set SITE_URL to use a custom domain;
// otherwise Vercel's built-in system variables give the right address for live and test copies.
export function siteUrl(env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, "");
  const host = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : "";
}
