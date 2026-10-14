// Test helpers: a fresh local Postgres schema per test file, fake req/res, and a fetch recorder.
// Run with a local database: DATABASE_URL=postgres://user:pass@localhost:5432/db npm test
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";

export const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

export async function resetDb() {
  process.env.DATABASE_URL = DB_URL;
  const { db } = await import("../lib/db.js");
  await db().query("drop schema if exists public cascade; create schema public;");
  await db().query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
}

export function mkReq({ method = "POST", body, raw, headers = {}, query = {} } = {}) {
  const rawBody = raw ?? (body === undefined ? "" : JSON.stringify(body));
  return { method, headers, query, rawBody, body: body ?? (rawBody ? JSON.parse(rawBody) : {}), url: "/" };
}

export function mkRes() {
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b = "") { this.body = String(b); this.done = true; } };
  Object.defineProperty(res, "json", { get() { return JSON.parse(this.body); } });
  return res;
}

export function sign(raw, secret) { return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"); }

// Replaces global fetch; records calls and answers Meta Graph calls with a message id.
export function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    const json = String(url).includes("/media") ? { id: "MEDIA1" } : { messages: [{ id: "wamid.OUT" + calls.length }], message_id: "ig.OUT" + calls.length };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

export const settle = () => new Promise(r => setTimeout(r, 50));
