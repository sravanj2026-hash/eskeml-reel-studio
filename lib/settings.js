// Owner-editable settings, stored as one JSON row per key. Defaults cover everything.
import { q } from "./db.js";

export const DEFAULTS = {
  business: { name: "Art of Eskeml", gstin: "", address: "", state: "", phone: "", upi_id: "", upi_name: "Art of Eskeml", review_link: "" },
  gst_percent: 3,                         // confirm with your CA
  approval: { max_quote: 50000, max_discount_percent: 5 },
  auto_send: { replies: false },          // false = every reply waits for the owner to tap Send
  advance_percent: 30,
  hours: { days: [1, 2, 3, 4, 5, 6], start: "11:00", end: "19:00", slot_minutes: 30 },
  invoice_prefix: "AOE",
  cash_on_hand: 0,
};

export async function getSettings() {
  const rows = await q("select key, value from settings");
  const out = structuredClone(DEFAULTS);
  for (const { key, value } of rows) {
    if (!(key in DEFAULTS)) continue;
    out[key] = value && typeof value === "object" && !Array.isArray(value) && typeof DEFAULTS[key] === "object" && !Array.isArray(DEFAULTS[key])
      ? { ...DEFAULTS[key], ...value } : value;
  }
  return out;
}

export async function saveSettings(patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue;
    await q("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
  }
  return getSettings();
}
