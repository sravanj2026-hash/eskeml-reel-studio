import { send, fail, safeEqual } from "../lib/util.js";
import { runDaily } from "../lib/jobs.js";

// Runs once a day (see "crons" in vercel.json). Vercel sends CRON_SECRET as a Bearer token.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || "", `Bearer ${secret}`)) return send(res, 401, { error: "Unauthorized" });
  try { send(res, 200, await runDaily()); } catch (err) { fail(res, err); }
}
