import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DB_URL, resetDb, mkReq, mkRes, sign, mockFetch, settle } from "./helpers.js";

const skip = !DB_URL && "set TEST_DATABASE_URL (or DATABASE_URL) to a local Postgres to run";
let q, one, closeDb, admin, whatsapp, instagram, cron, pay, enquiry, runDaily, claudeDraft, calls;

before(async () => {
  if (skip) return;
  Object.assign(process.env, { ADMIN_PASSCODE: "owner-pass", META_APP_SECRET: "app-secret", META_VERIFY_TOKEN: "verify-me", WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_ID: "PHONE1",
    INSTAGRAM_TOKEN: "ig-token", INSTAGRAM_ACCOUNT_ID: "IGME", CRON_SECRET: "cron-secret", SITE_URL: "https://shop.example" });
  // Reel Studio's Claude key alone must not switch the paid sales assistant on.
  process.env.ANTHROPIC_API_KEY = "sk-test-not-used";
  delete process.env.SALES_ASSISTANT;
  await resetDb();
  ({ q, one, closeDb } = await import("../lib/db.js"));
  admin = (await import("../api/admin.js")).default;
  whatsapp = (await import("../api/whatsapp.js")).default;
  instagram = (await import("../api/instagram.js")).default;
  cron = (await import("../api/cron.js")).default;
  pay = (await import("../api/pay.js")).default;
  enquiry = (await import("../api/enquiry.js")).default;
  ({ runDaily } = await import("../lib/jobs.js"));
  ({ claudeDraft } = await import("../lib/assistant.js"));
  calls = mockFetch();
});
after(async () => { if (!skip) await closeDb(); });

async function call(action, body = {}, pass = "owner-pass") {
  const res = mkRes();
  await admin(mkReq({ body: { action, ...body }, headers: { "x-admin-passcode": pass } }), res);
  return res;
}
async function A(action, body) { const r = await call(action, body); assert.equal(r.statusCode, 200, r.body); return r.json; }

function waPayload(from, id, text, name = "Priya Sharma") {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, type: "text", text: { body: text } }] } }] }] };
}
async function postWa(payload, secret = "app-secret") {
  const raw = JSON.stringify(payload), res = mkRes();
  await whatsapp(mkReq({ raw, headers: { "x-hub-signature-256": sign(raw, secret) } }), res);
  await settle();
  return res;
}

test("dashboard API is locked without the right passcode", { skip }, async () => {
  assert.equal((await call("summary", {}, "wrong")).statusCode, 401);
  assert.equal((await call("nope")).statusCode, 400);
  assert.equal((await A("summary")).business, "Art of Eskeml");
});

test("catalogue: save pieces, Reel Studio words, today's rates", { skip }, async () => {
  await A("pieces.save", { piece: { sku: "er-001", name: "Antique Gold Jhumka", category: "earrings", metal: "gold", purity: "22K", net_weight_g: 8, making_type: "percent", making_value: 14, photos: ["https://cdn.example/er1.jpg"] } });
  await A("pieces.save", { piece: { sku: "NK-010", name: "Temple Necklace", category: "necklace", metal: "gold", purity: "22K", net_weight_g: 40, making_type: "percent", making_value: 12 } });
  const { piece } = await A("pieces.save_creative", { sku: "ER-001", tagline: "Heritage in every sway", caption: "Meet our jhumkas", hashtags: ["#jhumka", "goldjewellery"] });
  assert.equal(piece.name, "Antique Gold Jhumka");
  assert.deepEqual(piece.hashtags, ["jhumka", "goldjewellery"]);
  const { rates } = await A("rates.set", { rates: [{ metal: "gold", purity: "22K", rate_per_g: 7000 }, { metal: "silver", purity: "925", rate_per_g: 0 }] });
  assert.equal(rates.length, 1);
});

test("webhook rejects a bad signature and answers Meta's verification", { skip }, async () => {
  assert.equal((await postWa(waPayload("919800000001", "wamid.X", "hi"), "wrong")).statusCode, 401);
  const res = mkRes();
  await whatsapp(mkReq({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" } }), res);
  assert.equal(res.body, "42");
});

test("a WhatsApp enquiry becomes a lead with a priced draft; Send goes out free inside 24h", { skip }, async () => {
  const res = await postWa(waPayload("919811112222", "wamid.A1", "Hi, do you have gold jhumka earrings for a wedding? Budget 80k. Price?"));
  assert.equal(res.statusCode, 200);
  await postWa(waPayload("919811112222", "wamid.A1", "duplicate delivery")); // Meta retries: ignored
  const { leads } = await A("leads.list", {});
  assert.equal(leads.length, 1);
  assert.equal(leads[0].interest, "earrings");
  assert.equal(leads[0].budget, 80000);
  const { drafts } = await A("drafts.list");
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.equal(d.kind, "quote");
  assert.match(d.body, /Antique Gold Jhumka/);
  // 8 g x 7000 = 56000, making 14% = 7840, GST 3% of 63840 = 1915 -> 65755
  assert.match(d.body, /65,755/);
  assert.equal(d.quote.total, 65755);
  assert.match(d.reason, /Auto-send is off/);

  calls.length = 0;
  const { draft } = await A("draft.approve", { id: d.id, body: d.body + "\nWarm regards" });
  assert.equal(draft.delivery.sent, true);
  const sentText = calls.find(c => c.body?.type === "text");
  assert.equal(sentText.body.to, "919811112222");
  assert.match(sentText.body.text.body, /Warm regards/);
  assert.ok(calls.some(c => c.body?.type === "image" && c.body.image.link === "https://cdn.example/er1.jpg"));
  assert.equal((await one("select status from leads")).status, "quoted");
});

test("outside the 24-hour window nothing is sent; the owner gets a wa.me link", { skip }, async () => {
  const lead = await one("select * from leads");
  await q("update leads set last_inbound_at = now() - interval '2 days' where id = $1", [lead.id]);
  calls.length = 0;
  const r = await A("lead.reply", { id: lead.id, text: "Following up on the jhumkas" });
  assert.equal(r.sent, false);
  assert.match(r.link, /^https:\/\/wa\.me\/919811112222\?text=Following/);
  assert.equal(calls.length, 0);
});

test("Instagram DMs land in the inbox; echoes of our own messages are ignored", { skip }, async () => {
  const payload = { object: "instagram", entry: [{ id: "IGME", messaging: [
    { sender: { id: "IGUSER1" }, recipient: { id: "IGME" }, message: { mid: "m1", text: "Necklace price please" } },
    { sender: { id: "IGME" }, recipient: { id: "IGUSER1" }, message: { mid: "m2", text: "echo", is_echo: true } }] }] };
  const raw = JSON.stringify(payload), res = mkRes();
  process.env.INSTAGRAM_APP_SECRET = "ig-secret";
  await instagram(mkReq({ raw, headers: { "x-hub-signature-256": sign(raw, "ig-secret") } }), res);
  await settle();
  assert.equal(res.statusCode, 200);
  const msgs = await q("select m.* from messages m join leads l on l.id = m.lead_id where l.channel = 'instagram'");
  assert.equal(msgs.length, 1);
  const draft = await one("select d.* from drafts d join leads l on l.id = d.lead_id where l.channel = 'instagram'");
  assert.match(draft.body, /Temple Necklace/);
});

test("website enquiry form: validates, ignores bots, creates a lead", { skip }, async () => {
  let res = mkRes(); await enquiry(mkReq({ body: { name: "A", phone: "12", message: "hi" } }), res); assert.equal(res.statusCode, 400);
  res = mkRes(); await enquiry(mkReq({ body: { name: "Bot", phone: "9876543210", message: "spam", website: "x" } }), res); assert.equal(res.statusCode, 200);
  res = mkRes(); await enquiry(mkReq({ body: { name: "Kavya", phone: "98765 43210", message: "I want a ring for engagement" } }), res); await settle();
  assert.equal(res.statusCode, 200);
  assert.equal((await one("select count(*)::int as n from customers where phone = '919876543210'")).n, 1);
  assert.equal((await one("select count(*)::int as n from customers where name = 'Bot'")).n, 0);
  // No ring in the catalogue: the assistant must not offer earrings just because "earring" contains "ring".
  const d = await one("select d.* from drafts d join leads l on l.id = d.lead_id where l.channel = 'web'");
  assert.deepEqual(d.piece_skus, []);
  assert.match(d.body, /ring/);
});

test("orders: advance link, payment moves stage, HUID required, invoice on delivery", { skip }, async () => {
  await A("settings.save", { settings: { business: { name: "Art of Eskeml", upi_id: "eskeml@okaxis", state: "Telangana", gstin: "36ABCDE1234F1Z5" } } });
  const lead = await one("select * from leads where channel = 'whatsapp'");
  await q("update leads set last_inbound_at = now() where id = $1", [lead.id]);
  calls.length = 0;
  const r = await A("order.create", { customer_id: lead.customer_id, lead_id: lead.id, type: "custom", items: [{ sku: "NK-010" }, { description: "Matching earrings (custom)", amount: 20000 }] });
  // necklace: 40 g x 7000 = 280000 + 12% = 313600, GST 9408 -> 323008; custom 20000 + 600 = 20600
  assert.equal(r.order.total, 343608);
  assert.equal(r.order.advance_due, Math.round(343608 * 0.3));
  assert.equal(r.delivery.sent, true);
  assert.match(calls.find(c => c.body?.type === "text").body.text.body, /https:\/\/shop\.example\/api\/pay\?o=AOE-/);
  assert.equal((await one("select status from leads where id = $1", [lead.id])).status, "won");

  const id = r.order.id;
  const payRes = mkRes();
  await pay(mkReq({ method: "GET", query: { o: r.order.number, t: r.order.pay_token } }), payRes);
  assert.match(payRes.body, /upi:\/\/pay\?pa=eskeml%40okaxis/);
  assert.match(payRes.body, /<svg/);
  const bad = mkRes(); await pay(mkReq({ method: "GET", query: { o: r.order.number, t: "guess" } }), bad); assert.equal(bad.statusCode, 404);

  const paid = await A("order.payment", { id, amount: r.order.advance_due, method: "upi" });
  assert.equal(paid.order.stage, "advance_paid");
  assert.equal((await call("order.stage", { id, stage: "hallmarked" })).statusCode, 400);
  await A("order.stage", { id, stage: "hallmarked", huid: "ab12cd" });
  const done = await A("order.stage", { id, stage: "delivered" });
  assert.match(done.invoice.number, /^AOE\/INV\/\d{4}\/0001$/);
  const inv = await A("order.invoice", { id });
  assert.equal(Buffer.from(inv.pdf_base64, "base64").subarray(0, 4).toString(), "%PDF");
  const row = await one("select * from invoices");
  assert.equal(row.cgst + row.sgst, 9408 + 600); // same state: CGST + SGST
  assert.equal(row.igst, 0);
});

test("daily job: review, referral and balance reminders, sent once, links when outside 24h", { skip }, async () => {
  const order = await one("select * from orders");
  await q("update orders set delivered_at = now() - interval '11 days' where id = $1", [order.id]);
  await q("update leads set last_inbound_at = now() - interval '5 days'");
  await q("insert into payables (party, amount, due_date) values ('Karigar Ravi', 50000, current_date + 3)");
  let res = mkRes(); await cron(mkReq({ method: "GET", headers: { authorization: "Bearer nope" } }), res); assert.equal(res.statusCode, 401);
  calls.length = 0;
  res = mkRes(); await cron(mkReq({ method: "GET", headers: { authorization: "Bearer cron-secret" } }), res);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual({ review: res.json.review, referral: res.json.referral, balance: res.json.balance }, { review: 1, referral: 1, balance: 1 });
  assert.equal(calls.length, 0); // outside the free window: nothing sent through the API
  const { reminders } = await A("reminders.list");
  assert.equal(reminders.filter(r => r.kind !== "order_update").length, 3);
  assert.ok(reminders.every(r => r.link.startsWith("https://wa.me/919811112222")));
  assert.match(reminders.find(r => r.kind === "balance").body, /api\/pay/);
  const again = await runDaily();
  assert.equal(again.review + again.referral + again.balance, 0);
  await A("reminder.done", { kind: "review", ref: order.id });
  assert.equal((await A("reminders.list")).reminders.filter(r => r.kind !== "order_update").length, 2);
  const f = await A("forecast");
  assert.equal(f.weeks.length, 8);
  assert.equal(f.weeks[0].cash_out, 50000);
  assert.ok(f.summary.customers_owe > 0);
  const s = await A("summary");
  assert.equal(s.counts.to_send, (await A("reminders.list")).reminders.length);
});

test("quiet enquiries get a follow-up draft after 2 days", { skip }, async () => {
  const lead = await one("select * from leads where channel = 'instagram'");
  await q("update leads set last_message_at = now() - interval '3 days' where id = $1", [lead.id]);
  await q("update drafts set created_at = now() - interval '4 days' where lead_id = $1", [lead.id]);
  const r = await runDaily();
  assert.equal(r.followup, 1);
  assert.equal((await one("select kind from drafts where lead_id = $1 order by created_at desc limit 1", [lead.id])).kind, "followup");
});

test("optional Claude engine: tools run here and prices come from the catalogue, not the model", { skip }, async () => {
  const lead = await one("select * from leads where channel = 'web'");
  await A("pieces.save", { piece: { sku: "NK-020", name: "Lakshmi Coin Necklace", category: "necklace", metal: "gold", purity: "22K", net_weight_g: 30, making_type: "percent", making_value: 10 } });
  const script = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_catalogue", input: { category: "necklace" } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "update_lead", input: { occasion: "engagement", budget: 300000 } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "create_draft", input: { kind: "quote", body: "Our Temple Necklace is lovely for an engagement!", skus: ["NK-020", "NK-010", "FAKE-1"], discount_percent: 10 } }] },
  ];
  const seen = [];
  const client = { beta: { messages: { create: async params => { seen.push(params); return script.shift(); } } } };
  const { draft } = await claudeDraft(lead.id, { client });
  assert.equal(draft.author, "claude");
  assert.deepEqual(draft.piece_skus, ["NK-020"]); // NK-010 was sold in the order test, FAKE-1 never existed
  assert.equal(draft.quote.discount_percent, 10);
  // 30 g x 7000 = 210000, making 21000 less 10% of 231000 capped at making = 21000 -> 210000, GST 6300
  assert.equal(draft.quote.total, 216300);
  assert.match(draft.reason, /Discount of 10% is above your limit/);
  assert.equal(seen[0].model, "claude-opus-5-5");
  // The SDK gets the same growing array each turn; find what our search tool returned.
  const toolResult = seen[0].messages.flatMap(m => Array.isArray(m.content) ? m.content : []).find(b => b.tool_use_id === "t1");
  assert.match(toolResult.content, /Lakshmi Coin Necklace/);
  assert.doesNotMatch(toolResult.content, /Temple Necklace/);
  assert.equal((await one("select occasion, budget from leads where id = $1", [lead.id])).occasion, "engagement");
});
