// The daily job (Vercel Cron, free on the Hobby plan): review and referral asks, occasion
// reminders, balance reminders and follow-ups for quiet enquiries.
//
// Each message goes out free on WhatsApp/Instagram when the customer wrote in the last 24 hours.
// Otherwise it waits on the dashboard's "To send" list as a one-tap link for the owner's phone.
import { randomBytes } from "node:crypto";
import { q, one } from "./db.js";
import { getSettings } from "./settings.js";
import { messageCustomer } from "./messaging.js";
import { draftReply } from "./assistant.js";
import { payUrl } from "./orders.js";
import { istDate, addDays } from "./time.js";
import { rupees } from "./util.js";

async function remind(kind, ref, customer, text) {
  const row = await one(`insert into reminders (kind, ref, customer_id, body) values ($1, $2, $3, $4)
                         on conflict (kind, ref) do nothing returning *`, [kind, ref, customer.id, text]);
  if (!row) return null; // already done on an earlier day
  const r = await messageCustomer(customer.id, text);
  await q("update reminders set channel = $3, done = $4 where kind = $1 and ref = $2", [kind, ref, r.sent ? "sent" : "link", r.sent]);
  return r;
}

const first = c => (c.name || "").split(" ")[0] || "there";

export async function runDaily(now = new Date()) {
  const s = await getSettings();
  const brand = s.business.name, today = istDate(now);
  const done = { review: 0, referral: 0, occasion: 0, balance: 0, followup: 0 };

  // Review request, 3 days after delivery.
  for (const o of await q(`select o.*, row_to_json(c) as c from orders o join customers c on c.id = o.customer_id
                           where o.stage = 'delivered' and o.delivered_at < $1::timestamptz - interval '3 days'
                             and o.delivered_at > $1::timestamptz - interval '30 days'`, [now])) {
    const link = s.business.review_link ? ` It takes a minute: ${s.business.review_link}` : "";
    if (await remind("review", o.id, o.c, `Hi ${first(o.c)}, we hope you love your piece from ${brand}! Would you share a short review?${link} Thank you!`)) done.review++;
  }

  // Referral ask, 10 days after delivery, with the customer's own code.
  for (const o of await q(`select o.*, row_to_json(c) as c from orders o join customers c on c.id = o.customer_id
                           where o.stage = 'delivered' and o.delivered_at < $1::timestamptz - interval '10 days'
                             and o.delivered_at > $1::timestamptz - interval '60 days'`, [now])) {
    let code = o.c.referral_code;
    if (!code) {
      code = (first(o.c).replace(/[^a-z]/gi, "").slice(0, 6) || "ESK").toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
      await q("update customers set referral_code = $2 where id = $1 and referral_code is null", [o.c.id, code]);
    }
    if (await remind("referral", o.c.id, o.c, `Hi ${first(o.c)}, thank you again for choosing ${brand}. If a friend or family member is looking for jewellery, share your code ${code} and we'll take good care of them.`)) done.referral++;
  }

  // Birthday and anniversary, 15 days ahead, only for customers who agreed to hear from you.
  const target = addDays(today, 15).slice(5); // "MM-DD"
  for (const c of await q(`select * from customers where consent_marketing and (to_char(birthday, 'MM-DD') = $1 or to_char(anniversary, 'MM-DD') = $1)`, [target])) {
    const what = c.birthday && String(c.birthday).slice(5) === target ? "birthday" : "anniversary";
    if (await remind("occasion", `${c.id}:${what}:${today.slice(0, 4)}`, c, `Hi ${first(c)}, your ${what} is coming up soon! If you'd like something special from ${brand}, we'd be happy to show you new designs.`)) done.occasion++;
  }

  // Balance due once the piece is hallmarked: every 3 days, at most 3 times.
  for (const o of await q(`select o.*, row_to_json(c) as c from orders o join customers c on c.id = o.customer_id
                           where o.paid < o.total and o.stage in ('hallmarked','shipped','delivered')`)) {
    const sent = Number((await one("select count(*) as n, max(created_at) as last from reminders where kind = 'balance' and ref like $1", [`${o.id}:%`])).n);
    const last = (await one("select max(created_at) as last from reminders where kind = 'balance' and ref like $1", [`${o.id}:%`])).last;
    if (sent >= 3 || (last && now - new Date(last) < 3 * 86400000 - 3600000)) continue;
    if (await remind("balance", `${o.id}:${sent + 1}`, o.c, `Hi ${first(o.c)}, a gentle reminder that ${rupees(o.total - o.paid)} is due for order ${o.number}. You can pay by UPI here: ${payUrl(o)}`)) done.balance++;
  }

  // Quiet enquiries: no message either way for 2 days. The assistant drafts a follow-up for the owner.
  for (const l of await q(`select l.id from leads l where l.status in ('new','talking','quoted')
                           and l.last_message_at < $1::timestamptz - interval '2 days' and l.last_message_at > $1::timestamptz - interval '14 days'
                           and not exists (select 1 from drafts d where d.lead_id = l.id and d.created_at > l.last_message_at)`, [now])) {
    try { await draftReply(l.id, { followUp: true }); done.followup++; } catch (e) { console.error("follow-up", l.id, e.message); }
  }
  return done;
}
