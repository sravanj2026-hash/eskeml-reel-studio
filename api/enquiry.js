import { send, fail, normalizePhone } from "../lib/util.js";
import { recordInbound } from "../lib/messaging.js";
import { draftReply } from "../lib/assistant.js";
import { later } from "../lib/background.js";

// Website enquiry form. Point your form at POST /api/enquiry with JSON
// { name, phone, message, website (leave empty: it's a trap for spam bots) }.
export default async function handler(req, res) {
  const origin = process.env.ENQUIRY_ORIGIN;
  if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); }
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const { name = "", phone = "", message = "", website = "" } = req.body || {};
    if (website) return send(res, 200, { ok: true });
    const p = normalizePhone(phone);
    if (!p || p.length < 11 || p.length > 15) return send(res, 400, { error: "Please enter a valid phone number." });
    if (!String(message).trim()) return send(res, 400, { error: "Please write a message." });
    const r = await recordInbound({ channel: "web", phone: p, name: String(name).slice(0, 80), body: String(message).slice(0, 2000) });
    later(draftReply(r.lead.id));
    send(res, 200, { ok: true, message: "Thank you! We'll reply on WhatsApp shortly." });
  } catch (err) { fail(res, err); }
}
