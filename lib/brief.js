// The owner's one-page morning brief, plus the 30-day sales trend and sales by channel.
// Everything is read from our own tables, so it costs nothing to run.
import { q, one } from "./db.js";
import { getSettings } from "./settings.js";
import { istDate, addDays } from "./time.js";

const IST = "Asia/Kolkata";
const day = col => `(${col} at time zone '${IST}')::date`;

// Yesterday against the day before, so the owner sees which way things are moving.
async function dayCounts(d) {
  const r = await one(`select
    (select count(*) from leads where ${day("created_at")} = $1::date) as enquiries,
    (select count(*) from orders where ${day("created_at")} = $1::date) as orders,
    (select coalesce(sum(amount), 0) from payments where ${day("at")} = $1::date) as received`, [d]);
  return { enquiries: Number(r.enquiries), orders: Number(r.orders), received: Number(r.received) };
}

// The best hour to post is when customers actually write to you.
async function busyHours(today) {
  const rows = await q(`select extract(hour from at at time zone '${IST}')::int as hr, count(*)::int as n
    from messages where direction = 'in' and at >= $1::date group by 1 order by 1`, [addDays(today, -60)]);
  const total = rows.reduce((t, r) => t + r.n, 0);
  const top = [...rows].sort((a, b) => b.n - a.n)[0];
  return { total, by_hour: rows, peak_hour: total >= 10 && top ? top.hr : null };
}

export async function morningBrief(now = new Date()) {
  const s = await getSettings();
  const today = istDate(now), yday = addDays(today, -1);
  const [yesterday, before, hours] = await Promise.all([dayCounts(yday), dayCounts(addDays(today, -2)), busyHours(today)]);

  // Enquiries from the last 7 days that became orders or visits, and big ones still open.
  const sales = await q(`select o.number, o.total, o.paid, o.advance_due, o.stage, c.name, c.phone, coalesce(l.channel, 'direct') as channel
    from orders o join customers c on c.id = o.customer_id left join leads l on l.id = o.lead_id
    where o.created_at >= now() - interval '7 days' order by o.created_at desc limit 8`);
  const booked = await q(`select b.starts_at, b.kind, c.name, c.phone from bookings b left join leads l on l.id = b.lead_id left join customers c on c.id = coalesce(b.customer_id, l.customer_id)
    where b.status = 'booked' and b.starts_at >= now() order by b.starts_at limit 5`);
  const worth = await q(`select l.id, l.channel, l.interest, l.budget, l.occasion, l.status, c.name, c.phone, c.instagram_handle
    from leads l join customers c on c.id = l.customer_id
    where l.status not in ('won','lost') and l.budget >= $1 order by l.budget desc, l.last_message_at desc nulls last limit 5`, [Number(s.approval.max_quote) || 50000]);

  // What customers ask for, this 30 days against the 30 before.
  const asked = await q(`select lower(trim(interest)) as interest,
      count(*) filter (where created_at >= $1::date)::int as now_n,
      count(*) filter (where created_at < $1::date)::int as before_n
    from leads where interest is not null and trim(interest) <> '' and created_at >= $2::date
    group by 1 order by now_n desc, before_n desc limit 6`, [addDays(today, -30), addDays(today, -60)]);

  // The next reel: the most-asked category's active piece that has the fewest reels.
  let makeNext = null;
  const topAsk = asked.find(a => a.now_n > 0);
  const piece = await one(`select sku, name, category, coalesce(array_length(reels, 1), 0) as reels
    from pieces where status in ('active','made_to_order') ${topAsk ? "and lower(category) like '%' || $1 || '%'" : ""}
    order by coalesce(array_length(reels, 1), 0), created_at desc limit 1`, topAsk ? [topAsk.interest] : []);
  if (piece) makeNext = { ...piece, reels: Number(piece.reels), because: topAsk ? `${topAsk.now_n} customer${topAsk.now_n > 1 ? "s" : ""} asked for ${topAsk.interest} in the last 30 days` : "It has the fewest reels in your catalogue" };

  return { today, yesterday, before, sales, booked, worth, asked, make_next: makeNext, hours, worth_limit: Number(s.approval.max_quote) || 50000 };
}

// Daily orders and money received for the last 30 days, and which channel the sales came from.
export async function salesTrend(days = 30, now = new Date()) {
  const today = istDate(now), from = addDays(today, -(days - 1));
  const [ord, pay, chan] = await Promise.all([
    q(`select ${day("created_at")}::text as d, coalesce(sum(total), 0) as v, count(*)::int as n from orders where created_at >= $1::date - interval '1 day' group by 1`, [from]),
    q(`select ${day("at")}::text as d, coalesce(sum(amount), 0) as v from payments where at >= $1::date - interval '1 day' group by 1`, [from]),
    q(`select ch as channel, sum(enq)::int as enquiries, sum(ord)::int as orders, sum(val) as sales from (
        select channel as ch, 1 as enq, 0 as ord, 0 as val from leads where created_at >= $1::date
        union all
        select coalesce(l.channel, 'direct'), 0, 1, o.total from orders o left join leads l on l.id = o.lead_id where o.created_at >= $1::date
      ) t group by ch order by sales desc, enquiries desc`, [from]),
  ]);
  const o = Object.fromEntries(ord.map(r => [r.d, r])), p = Object.fromEntries(pay.map(r => [r.d, r]));
  const series = [];
  for (let i = 0; i < days; i++) { const d = addDays(from, i); series.push({ day: d, sales: Number(o[d]?.v || 0), orders: o[d]?.n || 0, received: Number(p[d]?.v || 0) }); }
  return { series, channels: chan.map(c => ({ ...c, sales: Number(c.sales) })) };
}
