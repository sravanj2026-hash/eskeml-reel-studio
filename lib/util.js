// Shared helpers for the API routes (Vercel Node functions: handler(req, res)).

export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Paid features can be locked behind a shared passcode (STUDIO_PASSCODE).
export function checkPasscode(req, res) {
  const want = process.env.STUDIO_PASSCODE;
  if (!want) return true;
  if (req.headers["x-studio-passcode"] === want) return true;
  send(res, 401, { error: "Enter the studio passcode to use the AI features." });
  return false;
}

export function requirePost(req, res) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  send(res, 405, { error: "Use POST." });
  return false;
}

// "data:image/jpeg;base64,..." -> { mime, buffer }
export function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw Object.assign(new Error("Send the photo as a JPEG, PNG or WebP data URL."), { status: 400 });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("That photo is too large. Keep it under 3.5 MB."), { status: 413 });
  return { mime: m[1], buffer };
}

export function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  send(res, status, { error: err.expose === false ? "Something went wrong. Try again." : err.message || "Something went wrong." });
}
