import { send, readRaw, fail } from "../lib/util.js";
import { verifyChallenge, validSignature } from "../lib/meta.js";
import { recordInbound } from "../lib/messaging.js";
import { draftReply } from "../lib/assistant.js";
import { later } from "../lib/background.js";

// WhatsApp Cloud API webhook: every customer message becomes a lead in the inbox,
// and the assistant prepares a reply for the owner.
export default async function handler(req, res) {
  if (req.method === "GET") return verifyChallenge(req, res);
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const raw = await readRaw(req);
    if (!validSignature(raw, req.headers["x-hub-signature-256"], process.env.META_APP_SECRET)) return send(res, 401, { error: "Bad signature" });
    const body = JSON.parse(raw || "{}");
    const leads = new Set();
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const text = m.text?.body ?? m.image?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? (m.type === "image" ? "[photo]" : m.type === "audio" ? "[voice note]" : m.type === "video" ? "[video]" : `[${m.type}]`);
        const r = await recordInbound({ channel: "whatsapp", external_id: `wa:${m.id}`, phone: m.from, name: names[m.from], body: text });
        if (r.inserted) leads.add(r.lead.id);
      }
    }
    for (const id of leads) later(draftReply(id));
    send(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
}
