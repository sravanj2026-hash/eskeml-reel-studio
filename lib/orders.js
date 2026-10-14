// Orders: create from catalogue pieces (or a custom description), move through stages,
// tell the customer at each step, and take payments by UPI (free, no gateway fees).
import { q, one } from "./db.js";
import { getSettings } from "./settings.js";
import { quotePieces } from "./pricing.js";
import { messageCustomer, sendWhatsAppDocument, insideFreeWindow } from "./messaging.js";
import { createInvoice } from "./invoice.js";
import { httpError, rupees } from "./util.js";

export const STAGES = ["design_approved", "advance_paid", "in_making", "qc", "hallmarked", "shipped", "delivered"];
export const STAGE_LABEL = {
  design_approved: "Design approved", advance_paid: "Advance received", in_making: "In making", qc: "Quality check",
  hallmarked: "Hallmarked", shipped: "Shipped", delivered: "Delivered",
};

export function payUrl(order, base = process.env.PUBLIC_URL || "") {
  return `${base.replace(/\/$/, "")}/api/pay?o=${encodeURIComponent(order.number)}&t=${order.pay_token}`;
}

// items: [{ sku, qty }] for catalogue pieces and/or [{ description, amount, qty }] for a custom
// piece priced by the owner (amount is the price before GST).
export async function createOrder({ customer_id, lead_id = null, type = "custom", items = [], discount_percent = 0, due_date = null, notes = null, advance_percent }) {
  const settings = await getSettings();
  if (!customer_id) throw httpError(400, "Pick a customer.");
  if (!items.length) throw httpError(400, "Add at least one item.");
  const lines = [];
  const skus = items.filter(i => i.sku).map(i => i.sku);
  if (skus.length) {
    const pieces = await q("select * from pieces where sku = any($1)", [skus]);
    const quote = await quotePieces(pieces, settings.gst_percent, discount_percent);
    for (const l of quote.lines) {
      const qty = Math.max(1, Number(items.find(i => i.sku === l.sku)?.qty) || 1);
      lines.push({ piece_id: l.piece_id, description: `${l.name} (${l.sku})`, qty, breakup: l });
    }
  }
  for (const i of items.filter(i => !i.sku)) {
    const sub = Math.round(Number(i.amount) || 0);
    if (!i.description || sub <= 0) throw httpError(400, "Custom items need a description and an amount.");
    const gst = Math.round(sub * settings.gst_percent / 100);
    lines.push({ piece_id: null, description: i.description, qty: Math.max(1, Number(i.qty) || 1), breakup: { subtotal: sub, gst, total: sub + gst } });
  }
  const total = lines.reduce((s, l) => s + l.breakup.total * l.qty, 0);
  const pct = advance_percent ?? (type === "custom" ? settings.advance_percent : 100);
  const n = (await one("select nextval('order_no_seq') as n")).n;
  const number = `${settings.invoice_prefix}-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
  const order = await one(`insert into orders (number, customer_id, lead_id, type, total, advance_due, due_date, notes)
                           values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [number, customer_id, lead_id, type, total, Math.round(total * pct / 100), due_date, notes]);
  for (const l of lines) await q("insert into order_items (order_id, piece_id, description, qty, breakup) values ($1, $2, $3, $4, $5)", [order.id, l.piece_id, l.description, l.qty, l.breakup]);
  if (lead_id) await q("update leads set status = 'won' where id = $1", [lead_id]);
  for (const l of lines.filter(l => l.piece_id)) await q("update pieces set stock = greatest(stock - $2, 0), status = case when stock - $2 <= 0 and status = 'active' then 'sold' else status end where id = $1", [l.piece_id, l.qty]);
  // Sends the order summary and the advance payment link to the customer.
  return moveStage(order.id, "design_approved", { note: "Order created" });
}

function stageMessage(order, customer, stage, extra, settings) {
  const hi = customer.name ? `Hi ${customer.name.split(" ")[0]},` : "Hi,";
  const brand = settings.business.name;
  const due = Math.max(0, order.total - order.paid);
  switch (stage) {
    case "design_approved": return `${hi} thank you for your order ${order.number} with ${brand}! Total ${rupees(order.total)}. To start making your piece, please pay the advance of ${rupees(order.advance_due)} here: ${payUrl(order)}`;
    case "advance_paid": return `${hi} we've received your advance for order ${order.number}. Your piece goes to our craftsmen now.`;
    case "in_making": return `${hi} your piece for order ${order.number} is being made.${extra.note ? " " + extra.note : ""}`;
    case "qc": return `${hi} your piece for order ${order.number} is done and going through our quality check.`;
    case "hallmarked": return `${hi} your piece for order ${order.number} is BIS hallmarked (HUID ${order.huid}).${due > 0 ? ` The balance is ${rupees(due)}, payable here: ${payUrl(order)}` : ""}`;
    case "shipped": return `${hi} your order ${order.number} has been shipped!${order.tracking_url ? ` Track it here: ${order.tracking_url}` : ""}`;
    case "delivered": return `${hi} your order ${order.number} has been delivered. Thank you for choosing ${brand}! We'd love to see you wear it.`;
    default: return "";
  }
}

// Moves an order forward (or back, if the owner corrects a mistake) and tells the customer.
export async function moveStage(orderId, stage, { note = null, photo = null, huid = null, tracking_url = null } = {}) {
  if (!STAGES.includes(stage)) throw httpError(400, "Unknown stage.");
  let order = await one("select * from orders where id = $1", [orderId]);
  if (!order) throw httpError(404, "Order not found.");
  if (huid) order = await one("update orders set huid = $2 where id = $1 returning *", [orderId, String(huid).trim().toUpperCase()]);
  if (tracking_url) order = await one("update orders set tracking_url = $2 where id = $1 returning *", [orderId, tracking_url]);
  if (stage === "hallmarked" && !order.huid) throw httpError(400, "Enter the HUID before marking the piece hallmarked.");
  if (stage === "delivered") order = await one("update orders set delivered_at = coalesce(delivered_at, now()) where id = $1 returning *", [orderId]);
  order = await one("update orders set stage = $2 where id = $1 returning *", [orderId, stage]);
  const settings = await getSettings();
  const customer = await one("select * from customers where id = $1", [order.customer_id]);
  const text = stageMessage(order, customer, stage, { note }, settings);
  const delivery = text ? await messageCustomer(customer.id, text) : null;
  await q("insert into order_events (order_id, stage, note, photo, customer_notified) values ($1, $2, $3, $4, $5)",
    [orderId, stage, note, photo, delivery ? (delivery.sent ? "sent" : "link") : null]);
  // Not sent for free: keep it on the dashboard's "To send from your phone" list until the owner sends it.
  if (delivery && !delivery.sent) {
    await q(`insert into reminders (kind, ref, customer_id, body, channel) values ('order_update', $1, $2, $3, 'link')
             on conflict (kind, ref) do update set body = excluded.body, done = false`, [`${orderId}:${stage}`, customer.id, text]);
  }
  let invoice = null;
  if (stage === "delivered") invoice = await ensureInvoice(order, customer);
  return { order, delivery, invoice: invoice && { number: invoice.number, sent: invoice.sent } };
}

async function ensureInvoice(order, customer) {
  const inv = await one("select * from invoices where order_id = $1", [order.id]) || await createInvoice(order.id);
  let sent = false;
  const lead = await one("select * from leads where customer_id = $1 order by last_inbound_at desc nulls last limit 1", [customer.id]);
  if (customer.phone && lead && lead.channel === "whatsapp" && insideFreeWindow(lead) && process.env.WHATSAPP_TOKEN) {
    try { await sendWhatsAppDocument(customer.phone, inv.pdf, `${inv.number}.pdf`, `Invoice ${inv.number}`); sent = true; } catch (e) { console.error(e.message); }
  }
  return { ...inv, sent };
}

// The owner records money received (UPI, cash, card). Moves a new order to "advance paid" by itself.
export async function recordPayment(orderId, { amount, method = "upi", reference = null }) {
  amount = Math.round(Number(amount) || 0);
  if (amount <= 0) throw httpError(400, "Enter the amount received.");
  await q("insert into payments (order_id, amount, method, reference) values ($1, $2, $3, $4)", [orderId, amount, method, reference]);
  const order = await one("update orders set paid = paid + $2 where id = $1 returning *", [orderId, amount]);
  if (order.stage === "design_approved" && order.paid >= order.advance_due) return (await moveStage(orderId, "advance_paid")).order;
  return order;
}

// Builds the "upi://pay" link UPI apps understand. Free: money goes straight to your UPI ID.
export function upiLink({ upi_id, upi_name }, amount, note) {
  const p = new URLSearchParams({ pa: upi_id, pn: upi_name || "", am: String(Math.round(amount)), cu: "INR", tn: String(note).slice(0, 60) });
  return `upi://pay?${p.toString().replace(/\+/g, "%20")}`;
}
