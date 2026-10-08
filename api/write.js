import Anthropic from "@anthropic-ai/sdk";
import { send, checkPasscode, requirePost, parseDataUrl, fail } from "../lib/util.js";

// Claude looks at the photo and writes the reel's words, picks styles,
// and suggests prompts for the AI backdrop and AI motion features.
const client = new Anthropic();

export default async function handler(req, res) {
  if (!requirePost(req, res) || !checkPasscode(req, res)) return;
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 501, { error: "Add ANTHROPIC_API_KEY to let Claude write the words." });
  try {
    const { image, brand = "Eskeml", handle = "@eskemljewellery", styles = [] } = req.body || {};
    const { mime, buffer } = parseDataUrl(image);
    const styleList = (Array.isArray(styles) ? styles : []).slice(0, 20)
      .map(s => `${String(s.id).slice(0, 30)} (${String(s.name).slice(0, 40)}: ${String(s.desc).slice(0, 140)})`).join("\n");
    const b = String(brand).slice(0, 60), h = String(handle).slice(0, 60);
    const prompt = `You are the creative director for ${b}, an Indian jewellery house (Instagram ${h}). The attached photo is a piece to turn into short Instagram reels.
Reply with only a JSON object of this shape, no other text:
{"piece": "what the piece is in a few words, e.g. 'antique gold jhumka earrings'",
 "title": "on-screen product name, 2-4 words, Title Case",
 "tagline": "romantic one-line tagline, max 6 words",
 "offer": "short offer line, max 4 words, or empty string",
 "caption": "Instagram caption, 2-3 short lines, warm, may use 1-2 emoji, ends with a call to DM ${h}",
 "hashtags": ["8 relevant hashtags without spaces or #"],
 "styles": ["the 3 best style ids from the list below for this piece, best first"],
 "why": "one sentence on why those styles suit it",
 "backdrops": ["3 short prompts for an AI-generated product backdrop that would flatter this piece, e.g. 'deep maroon velvet with soft gold bokeh'"],
 "motions": ["3 prompts for an AI image-to-video model describing camera and light motion only, keeping the jewellery itself unchanged, e.g. 'slow orbit around the necklace, light glinting across the stones, shallow depth of field'"]}
Never invent a price. Style ids:
${styleList || "royal, sparkle, spin, promo, mandala, cuts, festive"}
If the photo is not jewellery, still fill every field sensibly for the brand and say so in "why".`;

    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: buffer.toString("base64") } },
        { type: "text", text: prompt },
      ] }],
    });
    if (msg.stop_reason === "refusal") return send(res, 422, { error: "Claude declined this photo. Try a different one." });
    const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let out;
    try { out = JSON.parse(json); } catch { return send(res, 502, { error: "Claude's answer came back garbled. Press the button again." }); }
    send(res, 200, out);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: "Claude is busy right now. Try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 502, { error: "Claude rejected the API key. Check ANTHROPIC_API_KEY." });
    if (err instanceof Anthropic.APIError) { console.error(err); return send(res, 502, { error: "Couldn't reach Claude. Try again." }); }
    fail(res, err);
  }
}
