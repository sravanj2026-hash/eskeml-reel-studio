import { test } from "node:test";
import assert from "node:assert/strict";
import { pricePiece } from "../lib/pricing.js";
import { readMessage } from "../lib/assistant.js";
import { siteUrl } from "../lib/util.js";

test("prices a 22K piece with percent making and GST", () => {
  const p = pricePiece({ net_weight_g: 10, making_type: "percent", making_value: 12, stone_cost: 2000 }, 7000, 3);
  assert.equal(p.metal, 70000);
  assert.equal(p.making, 8400);
  assert.equal(p.subtotal, 80400);
  assert.equal(p.gst, 2412);
  assert.equal(p.total, 82812);
});

test("per-gram and flat making charges", () => {
  assert.equal(pricePiece({ net_weight_g: 5, making_type: "per_gram", making_value: 500 }, 6000, 0).making, 2500);
  assert.equal(pricePiece({ gross_weight_g: 5, making_type: "flat", making_value: 1500 }, 6000, 0).total, 31500);
});

test("discount comes off making and stones, never the metal", () => {
  const p = pricePiece({ net_weight_g: 10, making_type: "flat", making_value: 1000 }, 7000, 0, 50);
  assert.equal(p.discount, 1000);
  assert.equal(p.subtotal, 70000);
});

test("reads category, budget, occasion and intent from a customer message", () => {
  const r = readMessage("Hi, looking for gold jhumkas for my sister's wedding, budget around 40k. What's the price?");
  assert.equal(r.category, "earrings");
  assert.equal(r.budget, 40000);
  assert.equal(r.occasion, "wedding");
  assert.equal(r.wantsPrice, true);
  assert.equal(readMessage("budget 1.5 lakh necklace").budget, 150000);
  assert.equal(readMessage("can we do a video call tomorrow").wantsCall, true);
  assert.equal(readMessage("I have 2 kids").budget, null);
});

test("payment links use Vercel's own address unless SITE_URL is set", () => {
  assert.equal(siteUrl({ SITE_URL: "https://shop.example/" }), "https://shop.example");
  assert.equal(siteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "eskeml.vercel.app", VERCEL_URL: "x-123.vercel.app" }), "https://eskeml.vercel.app");
  assert.equal(siteUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "eskeml-git-branch.vercel.app", VERCEL_URL: "x-123.vercel.app" }), "https://eskeml-git-branch.vercel.app");
  assert.equal(siteUrl({}), "");
});
