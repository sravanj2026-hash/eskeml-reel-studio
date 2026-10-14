// Money at a glance and an 8-week cash forecast. Cash in = balances customers still owe
// (by order due date), cash out = unpaid bills you entered (karigar, suppliers, rent).
import { q, one } from "./db.js";
import { getSettings } from "./settings.js";
import { istDate, addDays } from "./time.js";

export async function moneySummary(now = new Date()) {
  const today = istDate(now), monthStart = today.slice(0, 8) + "01";
  const sales = await one(`select coalesce(sum(total), 0) as v, count(*) as n from orders where created_at >= $1::date`, [monthStart]);
  const received = await one(`select coalesce(sum(amount), 0) as v from payments where at >= $1::date`, [monthStart]);
  const due = await one(`select coalesce(sum(total - paid), 0) as v, count(*) as n from orders where paid < total`);
  const bills = await one(`select coalesce(sum(amount), 0) as v from payables where not paid`);
  return { month_sales: sales.v, month_orders: Number(sales.n), month_received: received.v, customers_owe: due.v, orders_with_balance: Number(due.n), bills_unpaid: bills.v };
}

export async function cashForecast(weeks = 8, now = new Date()) {
  const s = await getSettings();
  const today = istDate(now);
  const owed = await q(`select total - paid as amount, coalesce(due_date, current_date + 14) as due from orders where paid < total`);
  const bills = await q(`select amount, due_date as due from payables where not paid`);
  const out = [];
  let balance = Number(s.cash_on_hand) || 0;
  for (let w = 0; w < weeks; w++) {
    const start = addDays(today, w * 7), end = addDays(today, w * 7 + 7);
    const inWeek = d => { const x = typeof d === "string" ? d : istDate(new Date(d)); return (w === 0 ? x < end : x >= start && x < end); };
    const cashIn = owed.filter(o => inWeek(o.due)).reduce((t, o) => t + o.amount, 0);
    const cashOut = bills.filter(b => inWeek(b.due)).reduce((t, b) => t + b.amount, 0);
    balance += cashIn - cashOut;
    out.push({ week_of: start, cash_in: Math.round(cashIn), cash_out: Math.round(cashOut), balance: Math.round(balance) });
  }
  return out;
}
