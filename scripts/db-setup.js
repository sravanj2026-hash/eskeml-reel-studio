// Creates or updates the database tables: `npm run db:setup` (reads DATABASE_URL from .env).
import { readFile } from "node:fs/promises";
try { (await readFile(".env", "utf8")).split("\n").forEach(l => { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }); } catch {}
const { db, closeDb } = await import("../lib/db.js");
await db().query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
await closeDb();
console.log("Database is ready.");
