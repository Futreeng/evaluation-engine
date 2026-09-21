#!/usr/bin/env node
/**
 * Move seeded baselines between servers without re-fetching from Apify.
 *
 *   node scripts/baselines_sync.js export                      # local DB → baselines.export.json
 *   node scripts/baselines_sync.js import https://host TOKEN   # baselines.export.json → that server's DB
 *
 * import needs the target's ADMIN_TOKEN (or set ADMIN_TOKEN in the env).
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const FILE = path.join(__dirname, "baselines.export.json");
const [cmd, base, tokenArg] = process.argv.slice(2);
(async () => {
  if (cmd === "export") {
    const geDb = require("../growth_engine_db_select");
    await geDb.initDb();
    const rows = await geDb.listBaselines();
    fs.writeFileSync(FILE, JSON.stringify({ exported_at: Date.now(), rows }, null, 1));
    console.log(`wrote ${rows.length} rows to ${FILE}`);
  } else if (cmd === "import") {
    const token = tokenArg || process.env.ADMIN_TOKEN;
    if (!base || !token) throw new Error("usage: import <https://host> <ADMIN_TOKEN>");
    const { rows } = JSON.parse(fs.readFileSync(FILE, "utf8"));
    let total = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/growth-engine/v1/admin/baselines/import`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify({ rows: rows.slice(i, i + 500) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      total += body.imported; console.log(`imported ${total}/${rows.length}`, JSON.stringify(body.summary?.by_category || {}));
    }
  } else { console.error("usage: baselines_sync.js export | import <https://host> <ADMIN_TOKEN>"); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
