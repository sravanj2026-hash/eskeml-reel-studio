import { send, checkPasscode, parseDataUrl, fail } from "../lib/util.js";

// Runway image-to-video: POST starts a clip, GET ?id= checks on it.
// https://docs.dev.runwayml.com/api/
const BASE = process.env.RUNWAY_API_URL || "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";
const RATIOS = { "9:16": "720:1280", "1:1": "960:960", "4:5": "832:1104", "16:9": "1280:720" };

function headers(key) {
  return { Authorization: `Bearer ${key}`, "X-Runway-Version": VERSION, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  if (!checkPasscode(req, res)) return;
  const key = process.env.RUNWAYML_API_SECRET;
  if (!key) return send(res, 501, { error: "Add RUNWAYML_API_SECRET to enable AI motion videos." });
  try {
    if (req.method === "GET") {
      const id = String(req.query?.id || new URL(req.url, "http://x").searchParams.get("id") || "");
      if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return send(res, 400, { error: "Missing clip id." });
      const r = await fetch(`${BASE}/tasks/${id}`, { headers: headers(key) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok) return send(res, 502, { error: "Couldn't check on the clip. Try again." });
      return send(res, 200, { status: t.status, progress: t.progress ?? null, url: t.output?.[0] || null, failure: t.failure || null });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return send(res, 405, { error: "Use GET or POST." }); }
    const { image, prompt = "", aspect = "9:16", duration = 5 } = req.body || {};
    const { mime, buffer } = parseDataUrl(image);
    const body = {
      model: "gen4_turbo",
      promptImage: `data:${mime};base64,${buffer.toString("base64")}`,
      promptText: String(prompt).slice(0, 900) || "Slow cinematic camera push-in on the jewellery, soft studio light, sparkling highlights on the stones",
      ratio: RATIOS[aspect] || RATIOS["9:16"],
      duration: Number(duration) === 10 ? 10 : 5,
    };
    const r = await fetch(`${BASE}/image_to_video`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Runway", r.status, JSON.stringify(t).slice(0, 300));
      const msg = r.status === 401 ? "Runway rejected the API key. Check RUNWAYML_API_SECRET."
        : r.status === 429 ? "Runway is busy or your plan's limit is reached. Try again shortly."
        : r.status === 400 ? (t.error || "Runway couldn't use this photo.")
        : "Runway couldn't start the clip. Try again.";
      return send(res, 502, { error: msg });
    }
    send(res, 200, { id: t.id });
  } catch (err) { fail(res, err); }
}
