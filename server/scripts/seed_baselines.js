#!/usr/bin/env node
/**
 * Seed category baselines by scoring public accounts through the running API.
 *
 *   node scripts/seed_baselines.js retail nike glossier everlane ...
 *   node scripts/seed_baselines.js boutique_fitness --platform instagram handle1 handle2
 *
 * Each handle costs one Apify profile pull (~$0.003) and one LLM run. Runs are
 * sequential so a free-tier LLM key isn't rate-limited into failure. Uses a
 * unique seed email per handle so the one-free-snapshot rule doesn't block it.
 *
 * Seeded baselines are a starting point; real customer evaluations replace
 * them naturally (INSERT OR REPLACE on handle+category+platform).
 */

const API = process.env.API || "http://localhost:3005/api/growth-engine/v1";
const args = process.argv.slice(2);
const category = args.shift();
let platform = "instagram";
const handles = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--platform") platform = args[++i];
  else handles.push(args[i].replace(/^@/, ""));
}
if (!category || !handles.length) {
  console.error("usage: seed_baselines.js <category> [--platform instagram] <handle> [handle ...]");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scoreOne(handle) {
  const email = `seed+${handle}@scalecraft.local`;
  const res = await fetch(`${API}/evaluate/social-snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, platform, category, email }),
  });
  const body = await res.json();
  if (!res.ok) return { handle, status: "skipped", note: body.code || body.error };
  const { job_id } = body;
  for (let t = 0; t < 120; t++) {
    await sleep(3000);
    const job = await (await fetch(`${API}/job/${job_id}`)).json();
    if (job.status === "complete") return { handle, status: "complete", overall: job.resultPayload?.scores?.overall };
    if (job.status === "failed") return { handle, status: "failed", note: String(job.error || "").slice(0, 80) };
  }
  return { handle, status: "timeout" };
}

(async () => {
  console.log(`Seeding ${category} (${platform}) with ${handles.length} handles via ${API}`);
  for (const h of handles) {
    const r = await scoreOne(h);
    console.log(`${r.status.padEnd(9)} @${h}${r.overall != null ? `  overall=${r.overall}` : ""}${r.note ? `  ${r.note}` : ""}`);
  }
  const base = await (await fetch(`${API}/baselines/${category}`)).json();
  console.log("baseline:", JSON.stringify(base));
})();
