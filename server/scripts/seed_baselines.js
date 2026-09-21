#!/usr/bin/env node
/**
 * Seed niche baselines — fetch + score public accounts and record them,
 * WITHOUT the LLM. Scores are deterministic (growth_engine_scoring.js), so
 * the model adds nothing to an average; skipping it makes a niche take
 * minutes instead of hours and doesn't touch the LLM quota.
 *
 *   node scripts/seed_baselines.js <niche> [--platform instagram|tiktok] <handle> [handle ...]
 *   node scripts/seed_baselines.js --file seeds.json          # {"travel": {"instagram": ["h1", ...]}, ...}
 *   node scripts/seed_baselines.js --file seeds.json --dry    # count + cost, no fetching
 *
 * Cost per handle: Instagram ≈ $0.003, TikTok ≈ $0.06 (Apify). Profiles are
 * cached 24h so a re-run of the same list is free. Handles are only ever
 * aggregated into a niche average — never shown individually. Real customer
 * evaluations replace seeded rows naturally (upsert on handle+niche+platform).
 *
 * Runs in-process against the DB (needs server/.env), not through the API,
 * so it never trips the free limit or the job queue.
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const geDb = require("../growth_engine_db_select");
const { scoreProfile, CREATOR_NICHES } = require("../growth_engine_scoring");
const { analyzeInstagramAccountViaApify } = require("../instagram_apify_fetcher");
const { analyzeTikTokAccountViaApify } = require("../tiktok_apify_fetcher");

const COST = { instagram: 0.003, tiktok: 0.06 };
const args = process.argv.slice(2);
const dry = args.includes("--dry");
let plan = {}; // { niche: { platform: [handles] } }

if (args.includes("--file")) {
  const file = args[args.indexOf("--file") + 1];
  plan = JSON.parse(fs.readFileSync(file, "utf8"));
} else {
  const rest = args.filter((a) => a !== "--dry");
  const niche = rest.shift();
  let platform = "instagram";
  const handles = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i] === "--platform") platform = rest[++i]; else handles.push(rest[i]); }
  if (!niche || !handles.length) { console.error("usage: seed_baselines.js <niche> [--platform instagram|tiktok] <handle> ... | --file seeds.json [--dry]"); process.exit(1); }
  plan = { [niche]: { [platform]: handles } };
}

const clean = (h) => String(h || "").replace(/^@/, "").trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchProfile(platform, handle) {
  if (platform === "tiktok") return analyzeTikTokAccountViaApify(handle);
  if (!process.env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  return analyzeInstagramAccountViaApify(handle);
}

(async () => {
  let total = 0, cost = 0;
  for (const [niche, byPlatform] of Object.entries(plan)) {
    if (!CREATOR_NICHES || (CREATOR_NICHES[niche] === undefined && !Object.keys(CREATOR_NICHES).includes(niche))) console.warn(`(niche "${niche}" is not one of the creator niches — scoring with default targets)`);
    for (const [platform, handles] of Object.entries(byPlatform)) {
      const list = [...new Set(handles.map(clean).filter(Boolean))];
      total += list.length; cost += list.length * (COST[platform] || 0.01);
    }
  }
  console.log(`${total} handles across ${Object.keys(plan).length} niche(s) — est. Apify cost $${cost.toFixed(2)}${dry ? " (dry run)" : ""}`);
  if (dry) process.exit(0);

  await geDb.initDb();
  const summary = [];
  for (const [niche, byPlatform] of Object.entries(plan)) {
    for (const [platform, handles] of Object.entries(byPlatform)) {
      let ok = 0, skipped = 0;
      for (const raw of handles) {
        const handle = clean(raw); if (!handle) continue;
        try {
          const data = await fetchProfile(platform, handle);
          const scored = scoreProfile(data, niche);
          if (!scored || !Number.isFinite(scored.overall)) throw new Error("no score");
          await geDb.recordBaseline({ category: niche, platform, handle, overall: scored.overall, dimensions: scored.dimensions });
          ok++;
          console.log(`  ✔ ${niche}/${platform} @${handle} → ${scored.overall}`);
        } catch (err) {
          skipped++;
          console.log(`  – ${niche}/${platform} @${handle} skipped: ${err.message}`);
        }
        await sleep(400); // be polite to Apify
      }
      const base = await geDb.getCategoryBaseline(niche, { platform });
      summary.push({ niche, platform, ok, skipped, n: base?.n ?? 0, ready: !!base?.ready, avg: base?.overall ?? null });
    }
  }
  console.log("\nniche · platform · seeded · skipped · total · ready · avg");
  for (const s of summary) console.log(`${s.niche} · ${s.platform} · ${s.ok} · ${s.skipped} · ${s.n} · ${s.ready ? "yes" : "no"} · ${s.avg ?? "—"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
