import { send, readRaw, fail } from "../lib/util.js";
import { verifyChallenge, validSignature } from "../lib/meta.js";
import { recordInbound } from "../lib/messaging.js";
import { draftReply } from "../lib/assistant.js";
import { later } from "../lib/background.js";

// Instagram DMs (Instagram API with Instagram Login). Same flow as WhatsApp.
export default async function handler(req, res) {
  if (req.method === "GET") return verifyChallenge(req, res);
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const raw = await readRaw(req);
    const secret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
    if (!validSignature(raw, req.headers["x-hub-signature-256"], secret)) return send(res, 401, { error: "Bad signature" });
    const body = JSON.parse(raw || "{}");
    const own = process.env.INSTAGRAM_ACCOUNT_ID;
    const leads = new Set();
    for (const entry of body.entry || []) for (const ev of entry.messaging || []) {
      const m = ev.message;
      if (!m || m.is_echo || m.is_deleted || ev.sender?.id === own || ev.sender?.id === entry.id) continue;
      const text = m.text ?? (m.attachments?.length ? `[${m.attachments[0].type}]` : "");
      const r = await recordInbound({ channel: "instagram", external_id: `ig:${m.mid}`, instagram_id: ev.sender.id, body: text });
      if (r.inserted) leads.add(r.lead.id);
    }
    for (const id of leads) later(draftReply(id));
    send(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
}
