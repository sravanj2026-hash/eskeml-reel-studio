// Jewellery price = metal value + making + stones, then GST. Everything rounds to whole rupees.
import { q } from "./db.js";
import { istDate } from "./time.js";

export function pricePiece(piece, ratePerG, gstPercent = 3, discountPercent = 0) {
  const weight = Number(piece.net_weight_g ?? piece.gross_weight_g) || 0;
  const rate = Number(ratePerG) || 0;
  const metal = weight * rate;
  const mv = Number(piece.making_value) || 0;
  const making = piece.making_type === "per_gram" ? mv * weight : piece.making_type === "flat" ? mv : metal * mv / 100;
  const stones = Number(piece.stone_cost) || 0;
  const gross = metal + making + stones;
  // A discount comes off the making charge first, never off the metal value.
  const discount = Math.min(making + stones, gross * (Number(discountPercent) || 0) / 100);
  const subtotal = gross - discount;
  const gst = subtotal * (Number(gstPercent) || 0) / 100;
  const r = n => Math.round(n);
  return {
    weight_g: weight, rate_per_g: rate, metal: r(metal), making: r(making), stones: r(stones),
    discount: r(discount), subtotal: r(subtotal), gst: r(gst), total: r(subtotal) + r(gst),
  };
}

// Today's rate for a metal and purity, or null when the owner hasn't entered it yet.
export async function todaysRate(metal, purity, day = istDate()) {
  const rows = await q("select rate_per_g from metal_rates where day = $1 and lower(metal) = lower($2) and lower(purity) = lower($3)", [day, metal, purity]);
  return rows[0]?.rate_per_g ?? null;
}

export async function setRates(rates, day = istDate()) {
  for (const { metal, purity, rate_per_g } of rates) {
    if (!metal || !purity || !(Number(rate_per_g) > 0)) continue;
    await q(`insert into metal_rates (day, metal, purity, rate_per_g) values ($1, $2, $3, $4)
             on conflict (day, metal, purity) do update set rate_per_g = excluded.rate_per_g`, [day, metal.toLowerCase(), purity.toUpperCase(), Number(rate_per_g)]);
  }
  return q("select metal, purity, rate_per_g from metal_rates where day = $1 order by metal, purity", [day]);
}

// Price a list of catalogue pieces at today's rates. Throws if a needed rate is missing,
// so nobody (owner or assistant) ever quotes on a stale or invented rate.
export async function quotePieces(pieces, gstPercent, discountPercent = 0) {
  const lines = [];
  for (const p of pieces) {
    const rate = await todaysRate(p.metal, p.purity);
    if (rate == null) throw Object.assign(new Error(`Today's ${p.purity} ${p.metal} rate isn't set yet.`), { status: 409, code: "rate_missing" });
    lines.push({ sku: p.sku, name: p.name, piece_id: p.id, ...pricePiece(p, rate, gstPercent, discountPercent) });
  }
  const sum = k => lines.reduce((s, l) => s + l[k], 0);
  return { lines, discount_percent: Number(discountPercent) || 0, subtotal: sum("subtotal"), gst: sum("gst"), total: sum("total") };
}
