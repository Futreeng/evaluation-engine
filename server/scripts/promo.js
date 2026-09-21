#!/usr/bin/env node
/**
 * Promo codes from the command line (the admin page does the same thing).
 *
 *   node scripts/promo.js create FOUNDER50 --kind free_months --value 1 --max 50 --note "founders band"
 *   node scripts/promo.js create CREATOR20 --kind percent --value 20 --applies growth_plan --expires 2026-12-31
 *   node scripts/promo.js create PODCAST --kind free_unlock --max 100
 *   node scripts/promo.js create FIVEOFF --kind amount --value 500        # cents
 *   node scripts/promo.js list
 *   node scripts/promo.js off FOUNDER50 | on FOUNDER50
 *   node scripts/promo.js redemptions FOUNDER50
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const geDb = require("../growth_engine_db_select");
const promos = require("../growth_engine_promos");

const [cmd, code, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : d; };
const fmt = (p) => `${p.code.padEnd(14)} ${p.kind.padEnd(12)} ${String(p.value).padEnd(6)} ${p.applies_to.padEnd(12)} ${String(p.redemptions)}/${p.max_redemptions ?? "∞"}`.padEnd(60) + ` ${p.active ? "on " : "off"} ${p.expires_at ? "exp " + new Date(p.expires_at).toISOString().slice(0, 10) : ""} ${p.note || ""}`;

(async () => {
  await geDb.initDb();
  if (cmd === "create") {
    const shape = promos.validateShape({ code, kind: opt("kind"), value: opt("value", 0), applies_to: opt("applies", "any"), max_redemptions: opt("max", null), expires_at: opt("expires", null), note: opt("note", ""), stripe_coupon_id: opt("stripe", null) });
    if (await geDb.getPromo(shape.code)) throw new Error(`${shape.code} already exists`);
    console.log(fmt(await geDb.createPromo(shape)));
  } else if (cmd === "list") {
    for (const p of await geDb.listPromos()) console.log(fmt(p));
  } else if (cmd === "on" || cmd === "off") {
    const p = await geDb.setPromoActive(code, cmd === "on"); if (!p) throw new Error("no such code"); console.log(fmt(p));
  } else if (cmd === "redemptions") {
    for (const r of await geDb.listRedemptions(code)) console.log(`${new Date(r.created_at).toISOString().slice(0, 16)} ${r.email || r.account_id} ${r.product} -$${(r.amount_off / 100).toFixed(2)}`);
  } else {
    console.error("usage: promo.js create <CODE> --kind <free_months|percent|amount|free_unlock> [--value N] [--applies growth_plan|plan_unlock|any] [--max N] [--expires YYYY-MM-DD] [--note ...] | list | on|off <CODE> | redemptions <CODE>");
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
