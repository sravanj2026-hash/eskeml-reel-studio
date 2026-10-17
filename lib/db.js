// Postgres connection (Supabase free tier works: use its "Transaction pooler" connection string).
import pg from "pg";
import { httpError } from "./util.js";

// numeric columns come back as strings by default; money and weights here fit in a double.
pg.types.setTypeParser(1700, v => v === null ? null : Number(v));
// date columns stay as "YYYY-MM-DD" strings instead of shifting through the server's time zone.
pg.types.setTypeParser(1082, v => v);

let pool;
export function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw httpError(501, "Add DATABASE_URL (your Supabase connection string) to use the business system.");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export async function q(text, params = []) { return (await db().query(text, params)).rows; }
export async function one(text, params = []) { return (await q(text, params))[0] || null; }

export async function closeDb() { if (pool) { await pool.end(); pool = null; } }
