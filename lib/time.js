// The business runs on India time, whatever time zone the server uses.
export const TZ = "Asia/Kolkata";

export function istDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "2026-10-14" + "11:30" in India time -> Date
export function istToDate(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+05:30`);
}

export function istDayOfWeek(dateStr) { return new Date(dateStr + "T12:00:00+05:30").getUTCDay(); }

export function fmtIst(d) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}
