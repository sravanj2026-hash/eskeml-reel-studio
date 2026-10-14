// Customers, leads and messages, plus sending replies on WhatsApp and Instagram.
//
// Free-only rule: WhatsApp (Cloud API) and Instagram both let a business reply for free
// within 24 hours of the customer's last message. Outside that window this code never
// sends a paid template. It hands back a link that opens the chat on the owner's own
// phone with the text ready, and the owner taps Send there.
import { q, one } from "./db.js";
import { httpError, normalizePhone } from "./util.js";

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
const IG_GRAPH = () => `https://graph.instagram.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
const WINDOW_MS = 24 * 3600 * 1000 - 10 * 60 * 1000; // keep 10 minutes of margin

export async function upsertCustomer({ phone, instagram_id, instagram_handle, name, source, email, city, state }) {
  phone = normalizePhone(phone);
  let c = null;
  if (phone) c = await one("select * from customers where phone = $1", [phone]);
  if (!c && instagram_id) c = await one("select * from customers where instagram_id = $1", [instagram_id]);
  if (c) {
    return one(`update customers set name = coalesce(customers.name, $2), instagram_id = coalesce(customers.instagram_id, $3),
                  instagram_handle = coalesce(customers.instagram_handle, $4), phone = coalesce(customers.phone, $5),
                  email = coalesce(customers.email, $6), city = coalesce(customers.city, $7), state = coalesce(customers.state, $8)
                where id = $1 returning *`, [c.id, name || null, instagram_id || null, instagram_handle || null, phone, email || null, city || null, state || null]);
  }
  return one(`insert into customers (name, phone, instagram_id, instagram_handle, source, email, city, state)
              values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [name || null, phone, instagram_id || null, instagram_handle || null, source || null, email || null, city || null, state || null]);
}

// The customer's open conversation, or a new one.
export async function openLead(customerId, channel) {
  const lead = await one(`select * from leads where customer_id = $1 and status not in ('won','lost')
                          order by created_at desc limit 1`, [customerId]);
  if (lead) {
    if (lead.channel !== channel && ["whatsapp", "instagram"].includes(channel)) {
      return one("update leads set channel = $2 where id = $1 returning *", [lead.id, channel]);
    }
    return lead;
  }
  return one("insert into leads (customer_id, channel) values ($1, $2) returning *", [customerId, channel]);
}

// Saves a customer message. `inserted` is false when Meta re-delivers one we already have.
export async function recordInbound({ channel, external_id, phone, instagram_id, name, body, media = [] }) {
  const customer = await upsertCustomer({ phone, instagram_id, name, source: channel });
  const lead = await openLead(customer.id, channel);
  const msg = await one(`insert into messages (lead_id, direction, channel, external_id, body, media)
                         values ($1, 'in', $2, $3, $4, $5) on conflict (external_id) do nothing returning *`,
    [lead.id, channel, external_id || null, body || "", media]);
  if (msg) await q("update leads set last_inbound_at = now(), last_message_at = now() where id = $1", [lead.id]);
  return { customer, lead, message: msg, inserted: Boolean(msg) };
}

export function waLink(phone, text) {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text || "")}`;
}

export function insideFreeWindow(lead, now = Date.now()) {
  return Boolean(lead.last_inbound_at) && now - new Date(lead.last_inbound_at).getTime() < WINDOW_MS;
}

async function graphPost(url, body, token) {
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, `Meta refused the message: ${data?.error?.message || r.status}`);
  return data;
}

export async function sendWhatsApp(to, text, images = []) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw httpError(501, "Add WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to send on WhatsApp.");
  const url = `${GRAPH()}/${phoneId}/messages`;
  const ids = [];
  for (const link of images.slice(0, 4)) {
    const r = await graphPost(url, { messaging_product: "whatsapp", to, type: "image", image: { link } }, token);
    ids.push(r.messages?.[0]?.id);
  }
  if (text) {
    const r = await graphPost(url, { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } }, token);
    ids.push(r.messages?.[0]?.id);
  }
  return ids.filter(Boolean);
}

export async function sendWhatsAppDocument(to, bytes, filename, caption) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw httpError(501, "Add WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to send on WhatsApp.");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const up = await fetch(`${GRAPH()}/${phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const media = await up.json().catch(() => ({}));
  if (!up.ok) throw httpError(502, `WhatsApp refused the file: ${media?.error?.message || up.status}`);
  return graphPost(`${GRAPH()}/${phoneId}/messages`, { messaging_product: "whatsapp", to, type: "document", document: { id: media.id, filename, caption } }, token);
}

export async function sendInstagram(recipientId, text, images = []) {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) throw httpError(501, "Add INSTAGRAM_TOKEN to send Instagram DMs.");
  const url = `${IG_GRAPH()}/me/messages`;
  const ids = [];
  for (const link of images.slice(0, 4)) {
    const r = await graphPost(url, { recipient: { id: recipientId }, message: { attachment: { type: "image", payload: { url: link } } } }, token);
    ids.push(r.message_id);
  }
  if (text) ids.push((await graphPost(url, { recipient: { id: recipientId }, message: { text } }, token)).message_id);
  return ids.filter(Boolean);
}

// Sends text (and optional photos) to the customer behind a lead.
// Returns { sent: true } when it went out free through the API, or
// { sent: false, link, reason } when the owner needs to send it from their phone.
export async function sendToLead(leadId, { text, images = [] }) {
  const lead = await one("select l.*, c.phone, c.instagram_id, c.instagram_handle from leads l join customers c on c.id = l.customer_id where l.id = $1", [leadId]);
  if (!lead) throw httpError(404, "That conversation no longer exists.");
  const free = insideFreeWindow(lead);
  let sent = false, reason = null, link = null;
  try {
    if (free && lead.channel === "whatsapp" && lead.phone && process.env.WHATSAPP_TOKEN) { await sendWhatsApp(lead.phone, text, images); sent = true; }
    else if (free && lead.channel === "instagram" && lead.instagram_id && process.env.INSTAGRAM_TOKEN) { await sendInstagram(lead.instagram_id, text, images); sent = true; }
    else reason = free ? "not_connected" : "outside_24h";
  } catch (e) { reason = e.message; }
  if (!sent) {
    const withPhotos = images.length ? `${text}\n\n${images.join("\n")}` : text;
    link = lead.phone ? waLink(lead.phone, withPhotos) : lead.instagram_handle ? `https://ig.me/m/${lead.instagram_handle.replace(/^@/, "")}` : null;
  }
  await q(`insert into messages (lead_id, direction, channel, body, media, status) values ($1, 'out', $2, $3, $4, $5)`,
    [lead.id, lead.channel, text || "", images, sent ? "ok" : "manual"]);
  await q("update leads set last_message_at = now() where id = $1", [lead.id]);
  return { sent, link, reason, text: images.length ? `${text}\n\n${images.join("\n")}` : text };
}

// Same idea for a customer with no open conversation (order updates, reminders).
export async function messageCustomer(customerId, text) {
  const c = await one("select * from customers where id = $1", [customerId]);
  if (!c) throw httpError(404, "Customer not found.");
  const lead = await one("select * from leads where customer_id = $1 order by last_inbound_at desc nulls last limit 1", [customerId]);
  if (lead && insideFreeWindow(lead)) return sendToLead(lead.id, { text });
  const link = c.phone ? waLink(c.phone, text) : c.instagram_handle ? `https://ig.me/m/${c.instagram_handle.replace(/^@/, "")}` : null;
  return { sent: false, link, reason: "outside_24h", text };
}
