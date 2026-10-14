// Lets a webhook answer Meta at once and keep working (drafting the reply) afterwards.
// On Vercel this uses waitUntil; in the local dev server the process simply keeps running.
let waitUntil = null;
try { ({ waitUntil } = await import("@vercel/functions")); } catch {}

export function later(promise) {
  const p = Promise.resolve(promise).catch(e => console.error("Background task failed:", e));
  if (waitUntil && process.env.VERCEL) waitUntil(p);
  return p;
}
