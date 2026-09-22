#!/usr/bin/env node
/**
 * State of Small Creators — report template filler (spec 5.3). Not published.
 *
 * Reads the aggregated niche stats (from a running server's admin export, or
 * straight from the DB) and fills docs/STATE_OF_SMALL_CREATORS_TEMPLATE.md
 * into a markdown report. Only niches at BASELINE_MIN_N appear; everything
 * is an aggregate — no handle, no account, no caption.
 *
 *   node scripts/state_of_creators.js                          # DB directly → stdout
 *   node scripts/state_of_creators.js --out ../docs/state.md   # write a file
 *   STATS_BASE=https://… ADMIN_TOKEN=… node scripts/state_of_creators.js   # from the admin export
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function load() {
  if (process.env.STATS_BASE) {
    const r = await fetch(`${process.env.STATS_BASE.replace(/\/$/, "")}/api/growth-engine/v1/admin/state-of-creators`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "" } });
    if (!r.ok) throw new Error(`admin export ${r.status}`);
    return r.json();
  }
  const db = require("../growth_engine_db_select"); await db.initDb();
  return require("../growth_engine_stats").nicheStats();
}

const nice = (c) => String(c || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const n = (v, d = "—") => (v == null ? d : Number(v).toLocaleString("en-US"));

function fill(tpl, data) {
  const ready = data.niches.filter((x) => x.ready);
  const pending = data.niches.filter((x) => !x.ready);
  const all = ready.flatMap((x) => Array(x.n).fill(x.score.median));
  const rows = ready.map((x) => `| ${nice(x.category)} (${x.platform}) | ${n(x.n)} | ${n(x.score.median)} | ${n(x.score.p25)}–${n(x.score.p75)} | ${n(x.posting.posts_per_week_median)} | ${n(x.posting.video_share_median)}% | ${n(x.engagement.rate_median_pct)}% |`).join("\n");
  const bands = ready.map((x) => `| ${nice(x.category)} | ${Object.values(x.score.bands).map((b) => `${b}%`).join(" | ")} |`).join("\n");
  const dims = ready.map((x) => `| ${nice(x.category)} | ${["Posting Consistency", "Content Mix", "Engagement Quality", "Profile Clarity"].map((d) => n(x.dimensions[d])).join(" | ")} |`).join("\n");
  const formats = ready.map((x) => `| ${nice(x.category)} | ${n(x.formats.reel, "0")}% | ${n(x.formats.carousel, "0")}% | ${n(x.formats.image, "0")}% |`).join("\n");
  const weakest = ready.map((x) => { const e = Object.entries(x.dimensions).sort((a, b) => a[1] - b[1])[0]; return e ? `- **${nice(x.category)}**: ${e[0]} (${n(e[1])})` : ""; }).filter(Boolean).join("\n");
  const vars = {
    DATE: new Date(data.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    WINDOW_DAYS: data.window_days, MIN_N: data.min_n,
    NICHES_READY: ready.length, ACCOUNTS_TOTAL: n(ready.reduce((a, x) => a + x.n, 0)), POSTS_TOTAL: n(ready.reduce((a, x) => a + (x.posts_sampled || 0), 0)),
    OVERALL_MEDIAN: all.length ? n(all.sort((a, b) => a - b)[Math.floor(all.length / 2)]) : "—",
    TABLE_NICHES: rows || "_No niche has reached the minimum yet._", TABLE_BANDS: bands || "_—_", TABLE_DIMS: dims || "_—_", TABLE_FORMATS: formats || "_—_",
    WEAKEST_DIMS: weakest || "_—_",
    PENDING: pending.length ? pending.map((x) => `${nice(x.category)} (${x.platform}): ${x.n} of ${data.min_n}`).join(", ") : "none",
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`));
}

(async () => {
  const data = await load();
  const tpl = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "STATE_OF_SMALL_CREATORS_TEMPLATE.md"), "utf8");
  const out = fill(tpl, data);
  const i = process.argv.indexOf("--out");
  if (i > 0 && process.argv[i + 1]) { fs.writeFileSync(process.argv[i + 1], out); console.log(`wrote ${process.argv[i + 1]} (${data.niches.filter((x) => x.ready).length} niches ready)`); }
  else process.stdout.write(out);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
