// Shared by the WhatsApp and Instagram webhooks.
import { createHmac } from "node:crypto";
import { safeEqual } from "./util.js";

// Meta's one-time check when you save the webhook URL in the app dashboard.
export function verifyChallenge(req, res) {
  const qy = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  if (qy["hub.mode"] === "subscribe" && process.env.META_VERIFY_TOKEN && qy["hub.verify_token"] === process.env.META_VERIFY_TOKEN) {
    res.statusCode = 200; res.setHeader("Content-Type", "text/plain"); res.end(String(qy["hub.challenge"] || ""));
  } else { res.statusCode = 403; res.end("Verification failed"); }
}

export function validSignature(raw, header, secret) {
  if (!secret || !header) return false;
  const want = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return safeEqual(header, want);
}
