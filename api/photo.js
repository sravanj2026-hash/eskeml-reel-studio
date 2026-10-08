import { send, checkPasscode, requirePost, parseDataUrl, fail } from "../lib/util.js";

// Photoroom Image Editing API v2: https://docs.photoroom.com/edit-image-api
// mode "cutout"   -> transparent PNG of the piece only
// mode "backdrop" -> the piece on an AI-generated background described by `prompt`
const ENDPOINT = process.env.PHOTOROOM_API_URL || "https://image-api.photoroom.com/v2/edit";

export default async function handler(req, res) {
  if (!requirePost(req, res) || !checkPasscode(req, res)) return;
  const key = process.env.PHOTOROOM_API_KEY;
  if (!key) return send(res, 501, { error: "Add PHOTOROOM_API_KEY to enable AI cut-outs and backdrops." });
  try {
    const { image, mode = "cutout", prompt = "" } = req.body || {};
    const { mime, buffer } = parseDataUrl(image);
    const form = new FormData();
    form.append("imageFile", new Blob([buffer], { type: mime }), "piece." + mime.split("/")[1]);
    form.append("removeBackground", "true");
    if (mode === "backdrop") {
      const p = String(prompt).trim().slice(0, 400);
      if (!p) return send(res, 400, { error: "Describe the backdrop you want." });
      form.append("background.prompt", p);
      form.append("padding", "0.12");
      form.append("shadow.mode", "ai.soft");
      form.append("outputSize", "1080x1350");
    } else {
      form.append("padding", "0.04");
    }
    const r = await fetch(ENDPOINT, { method: "POST", headers: { "x-api-key": key }, body: form });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.error("Photoroom", r.status, detail);
      const msg = r.status === 402 ? "Your Photoroom plan has run out of credits or doesn't include this feature."
        : r.status === 401 || r.status === 403 ? "Photoroom rejected the API key. Check PHOTOROOM_API_KEY."
        : "Photoroom couldn't process this photo. Try another one.";
      return send(res, 502, { error: msg });
    }
    const outType = r.headers.get("content-type") || "image/png";
    const out = Buffer.from(await r.arrayBuffer());
    send(res, 200, { image: `data:${outType};base64,${out.toString("base64")}` });
  } catch (err) { fail(res, err); }
}
