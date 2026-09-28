#!/usr/bin/env node
// Creates (or finds) Scalecraft's products and prices in the Stripe account
// behind STRIPE_API_KEY, and prints the env lines for STRIPE_PRODUCTS_JSON and
// STRIPE_PRICES_JSON. Safe to re-run: products are matched by metadata key,
// prices by product + amount + interval, so nothing is duplicated and nothing
// existing is edited or deleted (a subscriber's price must never change).
//
//   node scripts/stripe_products.js            # create what's missing, print ids
//   node scripts/stripe_products.js --dry      # list what would be created
//
// Amounts come from server/growth_engine_plans.js (env overrides included), so
// the catalogue always matches what the app quotes.

const path = require("path");
// Dependencies live under server/, not the repo root.
const srv = (m) => require(path.join(__dirname, "..", "server", "node_modules", m));
srv("dotenv").config({ path: path.join(__dirname, "..", "server", ".env") });
const plans = require("../server/growth_engine_plans");

const key = process.env.STRIPE_API_KEY || "";
if (!/^sk_(live|test)_[A-Za-z0-9]{24,}$/.test(key)) { console.error("STRIPE_API_KEY in server/.env is missing or a placeholder."); process.exit(1); }
const stripe = srv("stripe")(key);
const mode = key.startsWith("sk_live_") ? "LIVE" : "test";
const dry = process.argv.includes("--dry");

const CATALOGUE = [
  { key: "growth_plan", name: "Scalecraft Growth Plan", description: "Your full 90-day plan, posts written every week, rescored weekly.", prices: [
    { tag: "monthly", amount: plans.priceFor("growth_plan", "monthly"), interval: "month" },
    { tag: "annual", amount: plans.priceFor("growth_plan", "annual"), interval: "year" },
  ] },
  { key: "growth_plan_founders", name: "Scalecraft Growth Plan · founders price", description: `Founders pricing for the first ${plans.FOUNDERS.cap} accounts, locked in while subscribed.`, prices: [
    { tag: "monthly", amount: plans.FOUNDERS.growth_monthly, interval: "month" },
    { tag: "annual", amount: plans.FOUNDERS.growth_annual, interval: "year" },
  ] },
  { key: "growth_plan_pro", name: "Scalecraft Pro", description: "Every platform you're on, rescored every 3 days, double the writing.", prices: [
    { tag: "monthly", amount: plans.priceFor("growth_plan_pro", "monthly"), interval: "month" },
    { tag: "annual", amount: plans.priceFor("growth_plan_pro", "annual"), interval: "year" },
  ] },
  { key: "maintenance", name: "Scalecraft Maintenance", description: "Weekly rescore and score history only.", prices: [
    { tag: "monthly", amount: plans.priceFor("maintenance", "monthly"), interval: "month" },
  ] },
  { key: "plan_unlock", name: "Scalecraft 60-day plan", description: "Phases 1 and 2 of one report's plan, written once. No subscription.", prices: [
    { tag: "once", amount: Number(process.env.PLAN_UNLOCK_PRICE_CENTS || 1500), interval: null },
  ] },
];

const usd = (c) => `$${(c / 100).toFixed(2)}`;

(async () => {
  console.log(`Stripe ${mode} mode\n`);
  const existing = await stripe.products.list({ limit: 100, active: true });
  const products = {}, prices = {};
  for (const item of CATALOGUE) {
    let product = existing.data.find((p) => p.metadata?.scalecraft === item.key);
    if (!product) {
      console.log(`+ product ${item.name}`);
      if (!dry) product = await stripe.products.create({ name: item.name, description: item.description, metadata: { scalecraft: item.key } });
    } else console.log(`= product ${item.name} (${product.id})`);
    if (product) products[item.key] = product.id;
    const have = product ? (await stripe.prices.list({ product: product.id, active: true, limit: 100 })).data : [];
    for (const pr of item.prices) {
      const match = have.find((p) => p.currency === "usd" && p.unit_amount === pr.amount && (pr.interval ? p.recurring?.interval === pr.interval : !p.recurring));
      const label = `${item.name} ${usd(pr.amount)}${pr.interval ? "/" + pr.interval : " once"}`;
      let price = match;
      if (!price) {
        console.log(`  + price ${label}`);
        if (!dry) price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: pr.amount, ...(pr.interval ? { recurring: { interval: pr.interval } } : {}), nickname: `${item.key} ${pr.tag}`, metadata: { scalecraft: item.key, cycle: pr.tag } });
      } else console.log(`  = price ${label} (${price.id})`);
      if (price) {
        if (pr.tag === "once") prices[item.key] = price.id;
        else { prices[item.key] = prices[item.key] || {}; prices[item.key][pr.tag] = price.id; }
      }
    }
  }
  if (dry) { console.log("\n(dry run — nothing created)"); return; }
  console.log("\nAdd to server/.env (and Render):");
  console.log(`STRIPE_PRODUCTS_JSON=${JSON.stringify(products)}`);
  console.log(`STRIPE_PRICES_JSON=${JSON.stringify(prices)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
