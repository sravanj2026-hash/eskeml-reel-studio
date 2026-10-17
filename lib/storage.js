// Photos and reels in Supabase Storage (free tier: 1 GB). The browser uploads straight to
// Supabase with a one-time signed URL, so big reel files never pass through Vercel.
import { httpError } from "./util.js";

const BUCKET = () => process.env.SUPABASE_BUCKET || "catalogue";

export async function signedUpload(path) {
  let base = (process.env.SUPABASE_URL || "").trim(); const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  // Forgive a pasted address without https:// (e.g. abcd.supabase.co).
  if (/^[a-z0-9-]+\.supabase\.co\/?$/i.test(base)) base = `https://${base}`;
  if (!base || !key) throw httpError(501, "Add SUPABASE_URL and SUPABASE_SERVICE_KEY to upload photos and reels.");
  if (!/^https:\/\/\S+$/.test(base)) throw httpError(500, "SUPABASE_URL must be your Supabase Project URL, like https://abcd.supabase.co (not a key).");
  base = base.replace(/\/+$/, "");
  // New-style sb_secret_ keys are not JWTs: send them only as apikey.
  const auth = key.startsWith("sb_") ? { apikey: key } : { Authorization: `Bearer ${key}`, apikey: key };
  const clean = String(path).replace(/[^a-zA-Z0-9._/-]/g, "-").replace(/\.\.+/g, ".").replace(/^\/+/, "");
  const r = await fetch(`${base}/storage/v1/object/upload/sign/${BUCKET()}/${clean}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) throw httpError(502, `Supabase refused the upload: ${data.message || data.error || r.status}`);
  return { upload_url: `${base}/storage/v1${data.url}`, public_url: `${base}/storage/v1/object/public/${BUCKET()}/${clean}` };
}
