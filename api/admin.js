import { send, fail, requirePost, checkAdmin, httpError, normalizePhone, siteUrl } from "../lib/util.js";
import { q, one } from "../lib/db.js";
import { getSettings, saveSettings } from "../lib/settings.js";
import { setRates } from "../lib/pricing.js";
import { upsertCustomer, openLead, sendToLead, waLink } from "../lib/messaging.js";
import { draftReply, approveDraft, searchCatalogue } from "../lib/assistant.js";
import { createOrder, moveStage, recordPayment, payUrl, STAGES } from "../lib/orders.js";
import { createInvoice } from "../lib/invoice.js";
import { moneySummary, cashForecast } from "../lib/finance.js";
import { signedUpload } from "../lib/storage.js";
import { istDate, addDays } from "../lib/time.js";

// The owner dashboard's API. Every call is POST { action, ...fields } with the
// x-admin-passcode header. Only the owner can use it.
const PIECE_FIELDS = ["name", "category", "metal", "purity", "gross_weight_g", "net_weight_g", "making_type", "making_value", "stone_cost", "stock", "status", "tagline", "caption", "hashtags", "description", "photos", "reels"];
const CUSTOMER_FIELDS = ["name", "phone", "instagram_handle", "email", "city", "state", "birthday", "anniversary", "consent_marketing"];

const actions = {
  async summary() {
    const today = istDate();
    const [rates, s, money] = await Promise.all([q("select metal, purity, rate_per_g from metal_rates where day = $1 order by metal, purity", [today]), getSettings(), moneySummary()]);
    const c = await one(`select
      (select count(*) from leads where created_at >= $1::date) as new_leads,
      (select count(*) from drafts where status = 'pending') as pending_drafts,
      (select count(*) from orders where stage <> 'delivered') as open_orders,
      (select count(*) from orders where stage <> 'delivered' and due_date <= $2::date) as due_this_week,
      (select count(*) from reminders where not done) as to_send,
      (select count(*) from bookings where status = 'booked' and starts_at::date = $1::date) as calls_today`, [today, addDays(today, 7)]);
    const byStage = await q("select stage, count(*)::int as n from orders where stage <> 'delivered' group by stage");
    return { today, rates, counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)])), by_stage: byStage, money, business: s.business.name,
      connected: { whatsapp: Boolean(process.env.WHATSAPP_TOKEN), instagram: Boolean(process.env.INSTAGRAM_TOKEN), claude: process.env.SALES_ASSISTANT === "claude" && Boolean(process.env.ANTHROPIC_API_KEY), storage: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY), site_url: siteUrl() } };
  },

  async "rates.set"({ rates }) { return { rates: await setRates(Array.isArray(rates) ? rates : []) }; },

  // ---- catalogue ----
  async "pieces.list"({ search = "" }) {
    return { pieces: await q(`select * from pieces where status <> 'hidden' or $1 = 'all'
      ${search ? "and (sku ilike $2 or name ilike $2 or category ilike $2)" : ""} order by created_at desc limit 500`, search ? ["", `%${search}%`] : [""]) };
  },
  async "pieces.save"({ piece = {} }) {
    const sku = String(piece.sku || "").trim().toUpperCase();
    if (!sku) throw httpError(400, "Every piece needs a SKU (your own code, e.g. ER-0012).");
    const cols = PIECE_FIELDS.filter(f => f in piece);
    const vals = cols.map(f => ["gross_weight_g", "net_weight_g", "making_value", "stone_cost"].includes(f) ? (piece[f] === "" || piece[f] == null ? null : Number(piece[f]))
      : f === "stock" ? Number(piece[f]) || 0 : f === "hashtags" || f === "photos" || f === "reels" ? (Array.isArray(piece[f]) ? piece[f] : String(piece[f] || "").split(/[\s,]+/).filter(Boolean)) : piece[f]);
    const row = await one(`insert into pieces (sku${cols.map(c => ", " + c).join("")}) values ($1${cols.map((_, i) => `, $${i + 2}`).join("")})
      on conflict (sku) do update set ${cols.map((c, i) => `${c} = $${i + 2}`).concat("updated_at = now()").join(", ")} returning *`, [sku, ...vals]);
    return { piece: row };
  },
  // Reel Studio's "Save to catalogue": the words Claude wrote for the piece.
  async "pieces.save_creative"({ sku, name, tagline, caption, hashtags = [] }) {
    sku = String(sku || "").trim().toUpperCase();
    if (!sku) throw httpError(400, "Enter the piece's SKU.");
    const row = await one(`insert into pieces (sku, name, tagline, caption, hashtags) values ($1, coalesce($2, ''), $3, $4, $5)
      on conflict (sku) do update set name = case when pieces.name = '' then coalesce($2, '') else pieces.name end,
        tagline = $3, caption = $4, hashtags = $5, updated_at = now() returning *`,
      [sku, name || null, tagline || null, caption || null, (Array.isArray(hashtags) ? hashtags : []).map(h => String(h).replace(/^#/, "")).slice(0, 30)]);
    return { piece: row };
  },
  async "pieces.upload_url"({ sku, filename = "file", kind = "photo" }) {
    sku = String(sku || "").trim().toUpperCase();
    if (!sku) throw httpError(400, "Enter the piece's SKU.");
    const ext = (/\.([a-z0-9]{2,4})$/i.exec(filename)?.[1] || (kind === "reel" ? "mp4" : "jpg")).toLowerCase();
    return signedUpload(`${kind === "reel" ? "reels" : "photos"}/${sku}/${Date.now()}.${ext}`);
  },
  async "pieces.add_media"({ sku, kind = "photo", url }) {
    if (!/^https:\/\//.test(url || "")) throw httpError(400, "Media must be an https link.");
    const col = kind === "reel" ? "reels" : "photos";
    const row = await one(`update pieces set ${col} = array_append(${col}, $2), updated_at = now() where sku = $1 returning *`, [String(sku).toUpperCase(), url]);
    if (!row) throw httpError(404, "No piece with that SKU. Save the piece first.");
    return { piece: row };
  },
  async "catalogue.search"(input) { return { results: await searchCatalogue({ ...input, limit: 10 }, await getSettings()) }; },

  // ---- customers and inbox ----
  async "customers.list"({ search = "" }) {
    return { customers: await q(`select c.*, (select count(*) from orders o where o.customer_id = c.id)::int as orders from customers c
      ${search ? "where c.name ilike $1 or c.phone ilike $1 or c.instagram_handle ilike $1" : ""} order by c.created_at desc limit 300`, search ? [`%${search}%`] : []) };
  },
  async "customers.save"({ customer = {} }) {
    if (customer.id) {
      const cols = CUSTOMER_FIELDS.filter(f => f in customer);
      const vals = cols.map(f => f === "phone" ? normalizePhone(customer[f]) : customer[f] === "" ? null : customer[f]);
      return { customer: await one(`update customers set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ") || "name = name"} where id = $1 returning *`, [customer.id, ...vals]) };
    }
    return { customer: await upsertCustomer({ ...customer, source: customer.source || "manual" }) };
  },
  async "leads.list"({ status = "open" }) {
    const where = status === "open" ? "l.status not in ('won','lost')" : status === "all" ? "true" : "l.status = $1";
    return { leads: await q(`select l.*, c.name, c.phone, c.instagram_handle,
        (select body from messages m where m.lead_id = l.id order by at desc limit 1) as last_body,
        (select count(*) from drafts d where d.lead_id = l.id and d.status = 'pending')::int as pending
      from leads l join customers c on c.id = l.customer_id where ${where} order by l.last_message_at desc nulls last limit 200`, where.includes("$1") ? [status] : []) };
  },
  async "lead.get"({ id }) {
    const lead = await one("select l.*, row_to_json(c) as customer from leads l join customers c on c.id = l.customer_id where l.id = $1", [id]);
    if (!lead) throw httpError(404, "Lead not found.");
    const [messages, drafts] = await Promise.all([q("select * from messages where lead_id = $1 order by at", [id]), q("select * from drafts where lead_id = $1 order by created_at desc limit 10", [id])]);
    return { lead, messages, drafts };
  },
  // Enquiries that came by phone call, walk-in, referral or exhibition.
  async "lead.add"({ name, phone, instagram_handle, channel = "call", note = "" }) {
    if (!phone && !instagram_handle) throw httpError(400, "Enter a phone number or Instagram handle.");
    const c = await upsertCustomer({ name, phone, instagram_handle, source: channel });
    const lead = await openLead(c.id, channel);
    if (note) await q("insert into messages (lead_id, direction, channel, body) values ($1, 'in', $2, $3)", [lead.id, channel, note]);
    await q("update leads set last_message_at = now() where id = $1", [lead.id]);
    return { lead };
  },
  async "lead.reply"({ id, text }) {
    if (!String(text || "").trim()) throw httpError(400, "Write a message first.");
    return sendToLead(id, { text: String(text).trim() });
  },
  async "lead.draft"({ id }) { return draftReply(id); },
  async "lead.status"({ id, status }) { return { lead: await one("update leads set status = $2 where id = $1 returning *", [id, status]) }; },

  async "drafts.list"() {
    return { drafts: await q(`select d.*, c.name, c.phone, l.channel,
        (select body from messages m where m.lead_id = d.lead_id and m.direction = 'in' order by at desc limit 1) as customer_said
      from drafts d join leads l on l.id = d.lead_id join customers c on c.id = l.customer_id where d.status = 'pending' order by d.created_at`) };
  },
  async "draft.approve"({ id, body }) { return { draft: await approveDraft(id, body) }; },
  async "draft.reject"({ id }) { await q("update drafts set status = 'rejected', decided_at = now() where id = $1 and status = 'pending'", [id]); return { ok: true }; },
  async "bookings.list"() {
    return { bookings: await q(`select b.*, c.name, c.phone from bookings b left join customers c on c.id = b.customer_id
      where b.status = 'booked' and b.starts_at > now() - interval '2 hours' order by b.starts_at limit 50`) };
  },
  async "booking.status"({ id, status }) { await q("update bookings set status = $2 where id = $1", [id, status]); return { ok: true }; },

  // ---- orders ----
  async "orders.list"({ include_delivered = false }) {
    return { stages: STAGES, orders: await q(`select o.*, c.name, c.phone,
        (select string_agg(description, ', ') from order_items i where i.order_id = o.id) as items
      from orders o join customers c on c.id = o.customer_id
      where $1 or o.stage <> 'delivered' or o.delivered_at > now() - interval '7 days' order by o.created_at desc limit 300`, [Boolean(include_delivered)]) };
  },
  async "order.get"({ id }) {
    const order = await one("select o.*, row_to_json(c) as customer from orders o join customers c on c.id = o.customer_id where o.id = $1", [id]);
    if (!order) throw httpError(404, "Order not found.");
    const [items, events, payments, invoice] = await Promise.all([
      q("select * from order_items where order_id = $1 order by id", [id]), q("select * from order_events where order_id = $1 order by at", [id]),
      q("select * from payments where order_id = $1 order by at", [id]), one("select number, total, created_at from invoices where order_id = $1", [id])]);
    return { order: { ...order, pay_url: payUrl(order) }, items, events, payments, invoice };
  },
  async "order.create"(input) {
    let customer_id = input.customer_id;
    if (!customer_id) {
      if (!input.phone) throw httpError(400, "Enter the customer's phone number.");
      customer_id = (await upsertCustomer({ name: input.name, phone: input.phone, state: input.state, source: "order" })).id;
    }
    return createOrder({ ...input, customer_id });
  },
  async "order.stage"({ id, stage, note, huid, tracking_url }) { return moveStage(id, stage, { note, huid, tracking_url }); },
  async "order.payment"({ id, amount, method, reference }) { return { order: await recordPayment(id, { amount, method, reference }) }; },
  async "order.update"({ id, due_date, notes }) { return { order: await one("update orders set due_date = coalesce($2::date, due_date), notes = coalesce($3, notes) where id = $1 returning *", [id, due_date || null, notes ?? null]) }; },
  async "order.invoice"({ id }) {
    const inv = await createInvoice(id);
    return { number: inv.number, pdf_base64: Buffer.from(inv.pdf).toString("base64") };
  },

  // ---- reminders the owner sends from their phone ----
  async "reminders.list"() {
    const rows = await q(`select r.*, c.name, c.phone, c.instagram_handle from reminders r left join customers c on c.id = r.customer_id
      where not r.done order by r.created_at desc limit 100`);
    return { reminders: rows.map(r => ({ ...r, link: r.phone ? waLink(r.phone, r.body) : r.instagram_handle ? `https://ig.me/m/${r.instagram_handle.replace(/^@/, "")}` : null })) };
  },
  async "reminder.done"({ kind, ref }) { await q("update reminders set done = true where kind = $1 and ref = $2", [kind, ref]); return { ok: true }; },

  // ---- money ----
  async "payables.list"() { return { payables: await q("select * from payables order by paid, due_date limit 200") }; },
  async "payable.save"({ party, amount, due_date, note }) {
    if (!party || !(Number(amount) > 0) || !due_date) throw httpError(400, "Enter who, how much and when.");
    return { payable: await one("insert into payables (party, amount, due_date, note) values ($1, $2, $3, $4) returning *", [party, Number(amount), due_date, note || null]) };
  },
  async "payable.paid"({ id }) { await q("update payables set paid = true where id = $1", [id]); return { ok: true }; },
  async forecast() { return { summary: await moneySummary(), weeks: await cashForecast() }; },

  async "settings.get"() { return { settings: await getSettings() }; },
  async "settings.save"({ settings }) { return { settings: await saveSettings(settings) }; },
};

export default async function handler(req, res) {
  if (!requirePost(req, res) || !checkAdmin(req, res)) return;
  try {
    const { action, ...input } = req.body || {};
    const fn = Object.hasOwn(actions, action) ? actions[action] : null;
    if (!fn) return send(res, 400, { error: `Unknown action "${action}".` });
    send(res, 200, await fn(input));
  } catch (err) {
    if (err.code === "23505") return send(res, 409, { error: "That already exists." });
    fail(res, err);
  }
}
