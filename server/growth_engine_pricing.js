/**
 * Price variants (spec 1.14). Prices and features already come from config
 * (growth_engine_billing.js); this adds A/B variants on top.
 *
 *   PRICE_VARIANTS_JSON='{"control":{"weight":50},"lower":{"weight":50,"growth_plan":900,"plan_unlock":1200}}'
 *
 * Each variant may override growth_plan (cents/month) and plan_unlock
 * (cents). Missing keys fall back to the base price. Assignment is a stable
 * hash of the visitor id (anonymous browser id before signup); the variant
 * is copied onto the account at signup so the price a person saw is the
 * price they pay for the life of the account. Unset → everyone is "control".
 */
const crypto = require("crypto");
const { TIER_PRICING, ONE_TIME_PRICING } = require("./growth_engine_billing");

let VARIANTS = { control: { weight: 100 } };
try {
  if (process.env.PRICE_VARIANTS_JSON) {
    const o = JSON.parse(process.env.PRICE_VARIANTS_JSON);
    if (o && typeof o === "object" && Object.keys(o).length) VARIANTS = o;
  }
} catch { console.warn("[Pricing] PRICE_VARIANTS_JSON did not parse; single control variant"); }
if (!VARIANTS.control) VARIANTS = { control: { weight: 0 }, ...VARIANTS };

const names = () => Object.keys(VARIANTS);
function isVariant(name) { return !!name && Object.prototype.hasOwnProperty.call(VARIANTS, name); }

// Stable assignment: hash the visitor key onto the weight line.
function assign(key) {
  const list = names().map((n) => [n, Math.max(0, Number(VARIANTS[n].weight) || 0)]);
  const total = list.reduce((s, [, w]) => s + w, 0);
  if (!key || total <= 0 || list.length === 1) return "control";
  const h = parseInt(crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 8), 16) % total;
  let acc = 0;
  for (const [n, w] of list) { acc += w; if (h < acc) return n; }
  return "control";
}
function prices(variant) {
  const v = VARIANTS[isVariant(variant) ? variant : "control"] || {};
  return { variant: isVariant(variant) ? variant : "control", growth_plan: Number(v.growth_plan) || TIER_PRICING.growth_plan, plan_unlock: Number(v.plan_unlock) || ONE_TIME_PRICING.plan_unlock };
}
module.exports = { VARIANTS, names, isVariant, assign, prices, testing: () => names().length > 1 };
