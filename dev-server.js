// Local preview: `npm run dev`, then open http://localhost:3000
// Mimics Vercel: serves /public and routes /api/<name> to api/<name>.js handlers.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

try { (await readFile(".env", "utf8")).split("\n").forEach(l => { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }); } catch {}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, "");
      const { default: handler } = await import(`./api/${name}.js`);
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString();
      req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : {};
      req.query = Object.fromEntries(url.searchParams);
      return await handler(req, res);
    }
    const path = normalize(join("public", url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith("public")) throw new Error("bad path");
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(data);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(e.code === "ENOENT" || e.code === "ERR_MODULE_NOT_FOUND" ? 404 : 500); }
    res.end(e.code === "ENOENT" ? "Not found" : String(e.message));
  }
}).listen(port, () => console.log(`Eskeml Reel Studio on http://localhost:${port}`));
