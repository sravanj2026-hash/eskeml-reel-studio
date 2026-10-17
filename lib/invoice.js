// GST tax invoice as a PDF (pdf-lib, no paid service). Standard PDF fonts have no rupee
// sign, so amounts show as "Rs.". Confirm the layout and tax split with your CA.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { q, one } from "./db.js";
import { getSettings } from "./settings.js";
import { httpError } from "./util.js";

const money = n => "Rs. " + (Math.round(Number(n) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function createInvoice(orderId) {
  const existing = await one("select * from invoices where order_id = $1", [orderId]);
  if (existing) return existing;
  const order = await one("select * from orders where id = $1", [orderId]);
  if (!order) throw httpError(404, "Order not found.");
  const customer = await one("select * from customers where id = $1", [order.customer_id]);
  const items = await q("select * from order_items where order_id = $1 order by id", [orderId]);
  const s = await getSettings();
  const taxable = items.reduce((t, i) => t + i.breakup.subtotal * i.qty, 0);
  const gst = items.reduce((t, i) => t + i.breakup.gst * i.qty, 0);
  const sameState = !customer.state || !s.business.state || customer.state.trim().toLowerCase() === s.business.state.trim().toLowerCase();
  const cgst = sameState ? gst / 2 : 0, sgst = sameState ? gst / 2 : 0, igst = sameState ? 0 : gst;
  const n = (await one("select nextval('invoice_no_seq') as n")).n;
  const number = `${s.invoice_prefix}/INV/${new Date().getFullYear()}/${String(n).padStart(4, "0")}`;
  const pdf = await renderPdf({ number, order, customer, items, s, taxable, cgst, sgst, igst, total: taxable + gst });
  return one(`insert into invoices (number, order_id, taxable, cgst, sgst, igst, total, pdf) values ($1, $2, $3, $4, $5, $6, $7, $8)
              on conflict (order_id) do update set number = invoices.number returning *`,
    [number, orderId, taxable, cgst, sgst, igst, taxable + gst, Buffer.from(pdf)]);
}

async function renderPdf({ number, order, customer, items, s, taxable, cgst, sgst, igst, total }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ascii = t => String(t ?? "").replace(/₹/g, "Rs.").replace(/[^\x20-\x7E]/g, "");
  let y = 800;
  const text = (t, x, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(ascii(t), { x, y, size, font: f, color });
  const right = (t, xr, size = 10, f = font) => page.drawText(ascii(t), { x: xr - f.widthOfTextAtSize(ascii(t), size), y, size, font: f });
  text(s.business.name, 40, 18, bold, rgb(0.35, 0.06, 0.13)); right("TAX INVOICE", 555, 14, bold); y -= 18;
  if (s.business.address) { text(s.business.address, 40, 9); y -= 12; }
  text(`GSTIN: ${s.business.gstin || "-"}   State: ${s.business.state || "-"}   Phone: ${s.business.phone || "-"}`, 40, 9); y -= 28;
  text(`Invoice: ${number}`, 40, 10, bold); right(`Date: ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`, 555); y -= 14;
  text(`Order: ${order.number}`, 40); if (order.huid) right(`HUID: ${order.huid}`, 555); y -= 22;
  text("Bill to", 40, 10, bold); y -= 14;
  text(customer.name || "Customer", 40); y -= 12;
  text([customer.phone, customer.city, customer.state].filter(Boolean).join(", "), 40, 9); y -= 26;
  const cols = [40, 250, 300, 360, 420, 480];
  ["Item (HSN 7113)", "Qty", "Wt (g)", "Metal", "Making+Stones", "Taxable"].forEach((h, i) => i ? right(h, cols[i] + 60, 9, bold) : text(h, cols[0], 9, bold));
  y -= 6; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5 }); y -= 14;
  for (const it of items) {
    const b = it.breakup;
    text(it.description.slice(0, 40), cols[0], 9);
    right(String(it.qty), cols[1] + 60, 9);
    right(b.weight_g ? String(b.weight_g) : "-", cols[2] + 60, 9);
    right(b.metal != null ? money(b.metal) : "-", cols[3] + 60, 9);
    right(b.making != null ? money(b.making + (b.stones || 0) - (b.discount || 0)) : "-", cols[4] + 60, 9);
    right(money(b.subtotal * it.qty), cols[5] + 60, 9);
    y -= 14;
  }
  y -= 4; page.drawLine({ start: { x: 300, y }, end: { x: 555, y }, thickness: 0.5 }); y -= 16;
  const row = (label, v, f = font) => { right(label, 470, 10, f); right(money(v), 555, 10, f); y -= 14; };
  row("Taxable value", taxable);
  if (igst) row("IGST", igst); else { row("CGST", cgst); row("SGST", sgst); }
  row("Total", total, bold);
  row("Paid", order.paid);
  if (total - order.paid > 0.5) row("Balance due", total - order.paid, bold);
  y = 80; text("Thank you for choosing " + s.business.name + ". This is a computer-generated invoice.", 40, 8, font, rgb(0.4, 0.4, 0.4));
  return doc.save();
}
