import QRCode from "qrcode";
import { one } from "../lib/db.js";
import { getSettings } from "../lib/settings.js";
import { upiLink } from "../lib/orders.js";
import { safeEqual, rupees } from "../lib/util.js";

// The payment page customers open from WhatsApp: shows the amount due, a UPI QR code and a
// "Pay with UPI app" button. UPI is free; the owner marks the payment received in the dashboard.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async function handler(req, res) {
  const qy = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const order = await one("select * from orders where number = $1", [String(qy.o || "")]);
    if (!order || !safeEqual(String(qy.t || ""), order.pay_token)) { res.statusCode = 404; return res.end(page("Link not found", "<p>This payment link isn't valid. Please message us on WhatsApp.</p>")); }
    const s = await getSettings();
    const due = order.paid < order.advance_due ? order.advance_due - order.paid : order.total - order.paid;
    if (due <= 0) return res.end(page(s.business.name, `<p>Order <b>${esc(order.number)}</b> is fully paid. Thank you!</p>`));
    if (!s.business.upi_id) return res.end(page(s.business.name, `<p>Amount due for order <b>${esc(order.number)}</b>: <b>${rupees(due)}</b>.</p><p>Please message us for payment details.</p>`));
    const link = upiLink(s.business, due, `Order ${order.number}`);
    const qr = await QRCode.toString(link, { type: "svg", margin: 1, width: 240 });
    res.end(page(s.business.name, `
      <p>Order <b>${esc(order.number)}</b></p>
      <p class="amt">${rupees(due)}</p>
      <p class="muted">${order.paid < order.advance_due ? "Advance to start making your piece" : "Balance due"}</p>
      <div class="qr">${qr}</div>
      <a class="btn" href="${esc(link)}">Pay with a UPI app</a>
      <p class="muted">Or pay to UPI ID <b>${esc(s.business.upi_id)}</b>. After paying, please send us the screenshot on WhatsApp.</p>`));
  } catch (e) {
    console.error(e); res.statusCode = 500; res.end(page("Something went wrong", "<p>Please try again in a minute.</p>"));
  }
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#170a10;--fg:#f4e9df;--muted:#b99f9a;--gold:#e3a923}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;justify-content:center;padding:24px 16px}
main{max-width:380px;width:100%;text-align:center}h1{color:var(--gold);font-size:22px;letter-spacing:.06em}
.amt{font-size:34px;font-weight:700;margin:4px 0}.muted{color:var(--muted);font-size:14px}
.qr{background:#fff;border-radius:12px;padding:12px;display:inline-block;margin:12px 0}.qr svg{display:block;width:220px;height:220px}
.btn{display:block;background:var(--gold);color:#2a0b16;font-weight:700;text-decoration:none;padding:14px;border-radius:8px;margin:8px 0 16px}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
