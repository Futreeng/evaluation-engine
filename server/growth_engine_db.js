const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const DATA_DIR = path.join(__dirname, "data");
const GROWTH_ENGINE_DB_FILE = path.join(DATA_DIR, "growth_engine.db");

let SQL = null;
let db = null;

async function initDb() {
  if (SQL) return db;

  SQL = await initSqlJs();

  if (fs.existsSync(GROWTH_ENGINE_DB_FILE)) {
    const data = fs.readFileSync(GROWTH_ENGINE_DB_FILE);
    db = new SQL.Database(data);
  } else {
    fs.mkdirSync(path.dirname(GROWTH_ENGINE_DB_FILE), { recursive: true });
    db = new SQL.Database();
  }
  // Every statement is CREATE ... IF NOT EXISTS, so this also migrates
  // existing files forward when a table is added.
  initSchema();
  saveDb();

  return db;
}

function initSchema() {
  if (!db) throw new Error("Database not initialized");

  // Users table: customer accounts
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      company_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Jobs table: tracks async evaluation jobs
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_jobs (
      job_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT,
      input_params TEXT NOT NULL,
      result_payload TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Category baselines: one row per completed evaluation, so category
  // averages come from profiles we actually scored, not assumptions.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_baselines (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      overall INTEGER NOT NULL,
      dimensions TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_baselines_cat ON growth_engine_baselines (category, platform)`);

  // Fetched-profile cache: one Apify pull per handle per day, across restarts
  // and across the report, competitor and refresh paths.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_profile_cache (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `);
  // Metered actions per account per day (on-demand runs, competitor pulls).
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_usage (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0
    )
  `);
  // What they did between runs → what changed. The proof the plan works.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_outcomes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      platform TEXT NOT NULL,
      category TEXT,
      moves_done INTEGER NOT NULL,
      score_delta INTEGER NOT NULL,
      follower_delta INTEGER,
      days INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_waitlist (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Plan context: the four intake answers (next 90 days, hours, goal, style)
  // per account + handle + platform. Reused by every refresh and re-run.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_plan_context (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      platform TEXT NOT NULL,
      context TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Reports table: stores generated reports
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_reports (
      report_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      business_handle TEXT,
      business_platform TEXT,
      business_category TEXT,
      generated_at INTEGER NOT NULL,
      refresh_due_at INTEGER,
      report_body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Entitlements table: tracks subscription tiers and billing state
  db.run(`
    CREATE TABLE IF NOT EXISTS entitlements (
      account_id TEXT PRIMARY KEY,
      current_tier TEXT NOT NULL DEFAULT 'social_snapshot',
      tier_start_date INTEGER,
      billing_period_start INTEGER,
      billing_period_end INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Cancel-at-period-end: tier stays until this timestamp, then reads as free.
  try { db.run(`ALTER TABLE entitlements ADD COLUMN cancel_at INTEGER`); } catch { /* exists */ }
  // "Pause these emails": check-ins, score changes and plan-ended stop; reset + report-ready still send.
  try { db.run(`ALTER TABLE users ADD COLUMN email_paused INTEGER DEFAULT 0`); } catch { /* exists */ }
  // Phase-2 signals (spec 1.9): business flag + confirmed niche on the account
  try { db.run(`ALTER TABLE users ADD COLUMN is_business INTEGER DEFAULT 0`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE users ADD COLUMN niche TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE users ADD COLUMN price_variant TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE users ADD COLUMN email_prefs TEXT`); } catch { /* exists */ }
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_email_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      to_email TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL,
      provider TEXT,
      provider_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Password reset tokens: sha256 of the emailed token, single use, 1h.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )
  `);


  // Promo codes + redemptions (see growth_engine_promos.js for the rules)
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_promo_codes (
      code TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      applies_to TEXT NOT NULL DEFAULT 'any',
      max_redemptions INTEGER,
      redemptions INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      stripe_coupon_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_promo_redemptions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product TEXT NOT NULL,
      amount_off INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (code, account_id)
    )
  `);


  // Funnel events (spec 1.13)
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_id TEXT,
      anon TEXT,
      ref TEXT,
      report_id TEXT,
      props TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_name_time ON growth_engine_events (name, created_at)`);


  // Costs (spec 1.2): one row per scrape or LLM call, attributed to account/job/report
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_costs (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      job_id TEXT,
      report_id TEXT,
      feature TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      label TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      detail TEXT,
      cents REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_costs_time ON growth_engine_costs (created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_costs_account ON growth_engine_costs (account_id)`);


  // Outcomes data (spec 1.15): every move toggle, and the score change
  // measured at the next rescore for each move done in between.
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_move_log (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      handle TEXT,
      platform TEXT,
      category TEXT,
      move_key TEXT NOT NULL,
      done INTEGER NOT NULL,
      overall_at INTEGER,
      dims_at TEXT,
      plan_day INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_move_log_report ON growth_engine_move_log (report_id)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_move_outcomes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      handle TEXT,
      platform TEXT,
      category TEXT,
      move_key TEXT NOT NULL,
      moves_done_together INTEGER NOT NULL,
      score_before INTEGER,
      score_after INTEGER,
      dims_before TEXT,
      dims_after TEXT,
      days INTEGER,
      from_report TEXT,
      to_report TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_move_outcomes_key ON growth_engine_move_outcomes (category, platform, move_key)`);


  // Share cards (spec 1.7): a public card snapshot, never the report
  db.run(`
    CREATE TABLE IF NOT EXISTS growth_engine_shares (
      share_id TEXT PRIMARY KEY,
      account_id TEXT,
      report_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      ref TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // Tier history table: audit log of tier changes
  db.run(`
    CREATE TABLE IF NOT EXISTS tier_history (
      history_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      from_tier TEXT,
      to_tier TEXT NOT NULL,
      changed_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES entitlements(account_id)
    )
  `);

  // Indices for common queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_account ON growth_engine_jobs(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON growth_engine_jobs(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reports_account ON growth_engine_reports(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reports_refresh_due ON growth_engine_reports(refresh_due_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tier_history_account ON tier_history(account_id)`);
}

function saveDb() {
  if (!db) throw new Error("Database not initialized");

  // Atomic write: write to temp file, then rename
  const data = db.export();
  const buffer = Buffer.from(data);
  const tmp = GROWTH_ENGINE_DB_FILE + ".tmp";

  fs.writeFileSync(tmp, buffer);
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmp, GROWTH_ENGINE_DB_FILE);
      return;
    } catch (err) {
      const retryable = err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
      if (!retryable || attempt === MAX_ATTEMPTS) {
        try { fs.unlinkSync(tmp); } catch (e) {}
        throw err;
      }
      const waitUntil = Date.now() + attempt * 50;
      while (Date.now() < waitUntil) {}
    }
  }
}

function uid() {
  return crypto.randomBytes(12).toString("hex");
}

// ===================== JOB OPERATIONS =====================

async function createJob(accountId, tier, inputParams) {
  if (!db) throw new Error("Database not initialized");

  const jobId = "job_" + uid();
  const now = Date.now();

  db.run(
    `INSERT INTO growth_engine_jobs
     (job_id, account_id, tier, status, input_params, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    [jobId, accountId, tier, JSON.stringify(inputParams), now, now]
  );

  saveDb();
  return { jobId, status: "queued", createdAt: now };
}

// ===================== CATEGORY BASELINES =====================

// Record a scored profile. One row per handle+category+platform (latest wins)
// so re-running the same account doesn't weight the average.
async function recordBaseline({ category, platform, handle, overall, dimensions }) {
  if (!db) throw new Error("Database not initialized");
  if (!category || !platform || !handle || !Number.isFinite(overall)) return;
  const key = `${category}|${platform}|${String(handle).toLowerCase()}`;
  const dims = {};
  for (const d of dimensions || []) if (d && d.label && Number.isFinite(d.score)) dims[d.label] = d.score;
  db.run(
    `INSERT OR REPLACE INTO growth_engine_baselines (id, category, platform, handle, overall, dimensions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [key, category, platform, String(handle).toLowerCase(), Math.round(overall), JSON.stringify(dims), Date.now()]
  );
  saveDb();
}

// Average scores for a category (any platform). Returns null below min_n.
async function getCategoryBaseline(category, { minN = Number(process.env.BASELINE_MIN_N || 10), platform = null } = {}) {
  if (!db) throw new Error("Database not initialized");
  const result = platform
    ? db.exec(`SELECT overall, dimensions FROM growth_engine_baselines WHERE category = ? AND platform = ?`, [category, platform])
    : db.exec(`SELECT overall, dimensions FROM growth_engine_baselines WHERE category = ?`, [category]);
  if (!result.length) return null;
  const rows = result[0].values;
  if (rows.length < minN) return { n: rows.length, min_n: minN, ready: false };
  const overalls = rows.map((r) => Number(r[0])).sort((a, b) => a - b);
  const dimSums = {}; const dimCounts = {};
  for (const r of rows) {
    let dims = {}; try { dims = JSON.parse(r[1]); } catch { /* skip */ }
    for (const [k, v] of Object.entries(dims)) { dimSums[k] = (dimSums[k] || 0) + v; dimCounts[k] = (dimCounts[k] || 0) + 1; }
  }
  const avg = Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length);
  const q3 = overalls[Math.min(overalls.length - 1, Math.floor(overalls.length * 0.75))];
  const dimensions = {};
  for (const k of Object.keys(dimSums)) dimensions[k] = Math.round(dimSums[k] / dimCounts[k]);
  return { n: rows.length, min_n: minN, ready: true, overall: avg, top_quartile: q3, dimensions };
}

// Totals for the landing page: profiles scored overall and per category.
// Every baseline row — for moving a seeded set between databases.
async function listBaselines() {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT category, platform, handle, overall, dimensions, created_at FROM growth_engine_baselines ORDER BY category, platform, handle`);
  if (!r.length) return [];
  return r[0].values.map(([category, platform, handle, overall, dimensions, created_at]) => { let dims = {}; try { dims = JSON.parse(dimensions); } catch { /* skip */ } return { category, platform, handle, overall: Number(overall), dimensions: Object.entries(dims).map(([label, score]) => ({ label, score })), created_at: Number(created_at) }; });
}
async function getBaselineSummary() {
  if (!db) throw new Error("Database not initialized");
  const result = db.exec(`SELECT category, platform, COUNT(*) FROM growth_engine_baselines GROUP BY category, platform`);
  const by_category = {}; const by_platform = {};
  let total = 0;
  if (result.length) for (const [c, p, n] of result[0].values) { by_category[c] = (by_category[c] || 0) + Number(n); by_platform[`${c}:${p}`] = Number(n); total += Number(n); }
  return { total, by_category, by_platform };
}

// GDPR/CCPA: remove the account and everything written for it.
async function deleteAccount(accountId) {
  if (!db) throw new Error("Database not initialized");
  const n = db.exec(`SELECT COUNT(*) FROM growth_engine_reports WHERE account_id = ?`, [accountId]);
  const reports = n.length ? Number(n[0].values[0][0]) : 0;
  for (const t of ["growth_engine_reports", "growth_engine_jobs", "growth_engine_tier_history", "growth_engine_entitlements", "entitlements"]) {
    try { db.run(`DELETE FROM ${t} WHERE account_id = ?`, [accountId]); } catch { /* table/column may not exist in this schema */ }
  }
  try { db.run(`DELETE FROM entitlements WHERE user_id = ?`, [accountId]); } catch { /* sqlite schema uses account_id */ }
  try { db.run(`DELETE FROM users WHERE user_id = ?`, [accountId]); } catch { /* users may live in the Convergence store */ }
  saveDb();
  return { deleted: true, reports };
}

async function recordOutcome({ accountId, handle, platform, category, movesDone, scoreDelta, followerDelta, days }) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_outcomes (id, account_id, handle, platform, category, moves_done, score_delta, follower_delta, days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["oc_" + uid(), accountId, String(handle).toLowerCase(), platform, category || null, movesDone, scoreDelta, followerDelta ?? null, days ?? null, Date.now()]);
  saveDb();
}
// Aggregate: does doing the moves move the score?
async function getOutcomeSummary() {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT CASE WHEN moves_done >= 3 THEN 'did_3_plus' WHEN moves_done >= 1 THEN 'did_some' ELSE 'did_none' END AS bucket,
    COUNT(*), AVG(score_delta), AVG(follower_delta) FROM growth_engine_outcomes GROUP BY bucket`);
  const out = {};
  if (r.length) for (const [b, n, sd, fd] of r[0].values) out[b] = { n: Number(n), avg_score_delta: +Number(sd).toFixed(1), avg_follower_delta: fd == null ? null : Math.round(Number(fd)) };
  return out;
}

// ---------- profile cache ----------
async function getCachedProfile(platform, handle, maxAgeMs) {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT data, fetched_at FROM growth_engine_profile_cache WHERE id = ?`, [`${platform}|${String(handle).toLowerCase()}`]);
  if (!r.length || !r[0].values.length) return null;
  const [data, at] = r[0].values[0];
  if (Date.now() - Number(at) > maxAgeMs) return null;
  try { return { data: JSON.parse(data), fetchedAt: Number(at) }; } catch { return null; }
}
async function putCachedProfile(platform, handle, data) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT OR REPLACE INTO growth_engine_profile_cache (id, platform, handle, data, fetched_at) VALUES (?, ?, ?, ?, ?)`,
    [`${platform}|${String(handle).toLowerCase()}`, platform, String(handle).toLowerCase(), JSON.stringify(data), Date.now()]);
  saveDb();
}

// ---------- usage meter ----------
const dayKey = () => new Date().toISOString().slice(0, 10);
async function getUsage(accountId, kind) {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT count FROM growth_engine_usage WHERE id = ?`, [`${accountId}|${kind}|${dayKey()}`]);
  return r.length && r[0].values.length ? Number(r[0].values[0][0]) : 0;
}
async function bumpUsage(accountId, kind, n = 1) {
  if (!db) throw new Error("Database not initialized");
  const id = `${accountId}|${kind}|${dayKey()}`;
  const cur = await getUsage(accountId, kind);
  db.run(`INSERT OR REPLACE INTO growth_engine_usage (id, account_id, kind, day, count) VALUES (?, ?, ?, ?, ?)`, [id, accountId, kind, dayKey(), cur + n]);
  saveDb();
  return cur + n;
}

// (7) A free report is written under demo-account with the email in the job
// params. When that email signs up, the reports become theirs — so history,
// then-vs-now and the upsell all know about the first score.
async function adoptAnonymousReports(accountId, email) {
  if (!db) throw new Error("Database not initialized");
  const needle = `%"email":${JSON.stringify(String(email).trim().toLowerCase())}%`;
  const jobs = db.exec(`SELECT job_id FROM growth_engine_jobs WHERE account_id = 'demo-account' AND lower(input_params) LIKE ?`, [needle]);
  const jobIds = jobs.length ? jobs[0].values.map((r) => r[0]) : [];
  if (!jobIds.length) return { adopted: 0 };
  const now = Date.now();
  let adopted = 0;
  for (const jobId of jobIds) {
    const j = db.exec(`SELECT result_payload FROM growth_engine_jobs WHERE job_id = ?`, [jobId]);
    let rid = null; try { rid = JSON.parse(j[0].values[0][0] || "null")?.report_id || null; } catch { /* no payload */ }
    db.run(`UPDATE growth_engine_jobs SET account_id = ?, updated_at = ? WHERE job_id = ?`, [accountId, now, jobId]);
    if (rid) { db.run(`UPDATE growth_engine_reports SET account_id = ?, updated_at = ? WHERE report_id = ? AND account_id = 'demo-account'`, [accountId, now, rid]); adopted++; }
  }
  saveDb();
  return { adopted };
}

async function addWaitlist(email, platform) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT OR REPLACE INTO growth_engine_waitlist (id, email, platform, created_at) VALUES (?, ?, ?, ?)`,
    [`${platform}|${email}`, email, platform, Date.now()]);
  saveDb();
}

async function getPlanContext(accountId, handle, platform) {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT context, updated_at FROM growth_engine_plan_context WHERE id = ?`, [`${accountId}|${platform}|${String(handle).toLowerCase()}`]);
  if (!r.length || !r[0].values.length) return null;
  try { return { ...JSON.parse(r[0].values[0][0]), updated_at: r[0].values[0][1] }; } catch { return null; }
}
async function setPlanContext(accountId, handle, platform, context) {
  if (!db) throw new Error("Database not initialized");
  const { updated_at, ...ctx } = context || {};
  db.run(`INSERT OR REPLACE INTO growth_engine_plan_context (id, account_id, handle, platform, context, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [`${accountId}|${platform}|${String(handle).toLowerCase()}`, accountId, String(handle).toLowerCase(), platform, JSON.stringify(ctx), Date.now()]);
  saveDb();
  return { ...ctx, updated_at: Date.now() };
}

// Free reports older than a cutoff whose thumbnails haven't been removed yet (spec 1.4 cleanup).
async function listReportsForThumbCleanup(beforeTs, limit = 50) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT report_id, report_body FROM growth_engine_reports WHERE tier = 'social_snapshot' AND generated_at < ? AND report_body LIKE '%"thumb_prefix":%' AND report_body NOT LIKE '%"thumbs_removed":true%' LIMIT ?`, [beforeTs, limit])
    .map((r) => { let b = {}; try { b = JSON.parse(r.report_body); } catch { /* skip */ } return { reportId: r.report_id, thumbPrefix: b.thumb_prefix || null }; });
}
// Paid reports generated inside a window — the scheduled-email sweeper uses
// this to find plans at day 28 / 58 / 60.
async function listPaidReportsBetween(fromTs, toTs) {
  if (!db) throw new Error("Database not initialized");
  const result = db.exec(
    `SELECT * FROM growth_engine_reports WHERE tier != 'social_snapshot' AND generated_at >= ? AND generated_at <= ? ORDER BY generated_at ASC`,
    [fromTs, toTs]
  );
  if (!result || result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map((row) => ({
    reportId: row[columns.indexOf("report_id")],
    accountId: row[columns.indexOf("account_id")],
    tier: row[columns.indexOf("tier")],
    business: { handle: row[columns.indexOf("business_handle")], platform: row[columns.indexOf("business_platform")], category: row[columns.indexOf("business_category")] },
    generatedAt: row[columns.indexOf("generated_at")],
    refreshDueAt: row[columns.indexOf("refresh_due_at")],
    reportBody: JSON.parse(row[columns.indexOf("report_body")]),
  }));
}

// Free-tier quota by account: has this handle on this platform already been
// scored for free? Returns the latest such report id so the UI can show it
// instead of a wall. (Email-keyed limits were trivially bypassed.)
async function findFreeSnapshotForHandle(handle, platform) {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(
    `SELECT report_id, generated_at FROM growth_engine_reports
     WHERE tier = 'social_snapshot' AND lower(business_handle) = ? AND business_platform = ?
     ORDER BY generated_at DESC LIMIT 1`,
    [String(handle).toLowerCase(), platform]
  );
  if (r.length && r[0].values.length) return { reportId: r[0].values[0][0], generatedAt: Number(r[0].values[0][1]) };
  // In-flight (queued/running) job counts too, so a double-submit doesn't double-bill.
  const j = db.exec(
    `SELECT job_id FROM growth_engine_jobs WHERE tier = 'social_snapshot' AND status IN ('queued','running')
       AND lower(input_params) LIKE ? AND lower(input_params) LIKE ? ORDER BY created_at DESC LIMIT 1`,
    [`%"handle":${JSON.stringify(String(handle).toLowerCase())}%`, `%"platform":${JSON.stringify(platform)}%`]
  );
  if (j.length && j[0].values.length) return { jobId: j[0].values[0][0] };
  return null;
}

// (kept for callers that still count by email)
async function countFreeSnapshotsByEmail(email) {
  if (!db) throw new Error("Database not initialized");
  const needle = `%"email":${JSON.stringify(String(email).trim().toLowerCase())}%`;
  const result = db.exec(
    `SELECT COUNT(*) FROM growth_engine_jobs
     WHERE tier = 'social_snapshot' AND status != 'failed' AND lower(input_params) LIKE ?`,
    [needle]
  );
  return result.length ? Number(result[0].values[0][0]) : 0;
}

// Latest completed free report for an email (any handle) — what the 402 points at.
async function latestFreeSnapshotForEmail(email) {
  if (!db) throw new Error("Database not initialized");
  const needle = `%"email":${JSON.stringify(String(email).trim().toLowerCase())}%`;
  const r = rowsOf(`SELECT result_payload, created_at FROM growth_engine_jobs WHERE tier = 'social_snapshot' AND status = 'complete' AND lower(input_params) LIKE ? ORDER BY created_at DESC LIMIT 1`, [needle]);
  if (!r.length) return null;
  try { const p = JSON.parse(r[0].result_payload); return { reportId: p.report_id || null, generatedAt: Number(r[0].created_at) }; } catch { return null; }
}

async function getJob(jobId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM growth_engine_jobs WHERE job_id = ?`,
    [jobId]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const columns = result[0].columns;

  return {
    jobId: row[columns.indexOf("job_id")],
    accountId: row[columns.indexOf("account_id")],
    tier: row[columns.indexOf("tier")],
    status: row[columns.indexOf("status")],
    stage: row[columns.indexOf("stage")],
    inputParams: JSON.parse(row[columns.indexOf("input_params")]),
    resultPayload: row[columns.indexOf("result_payload")]
      ? JSON.parse(row[columns.indexOf("result_payload")])
      : null,
    error: row[columns.indexOf("error")],
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
  };
}

async function updateJobStatus(jobId, status, updates = {}) {
  if (!db) throw new Error("Database not initialized");

  const now = Date.now();
  const setClauses = ["status = ?", "updated_at = ?"];
  const params = [status, now];

  if (updates.stage !== undefined) {
    setClauses.push("stage = ?");
    params.push(updates.stage);
  }
  if (updates.resultPayload !== undefined) {
    setClauses.push("result_payload = ?");
    params.push(JSON.stringify(updates.resultPayload));
  }
  if (updates.error !== undefined) {
    setClauses.push("error = ?");
    params.push(updates.error);
  }

  params.push(jobId);

  db.run(
    `UPDATE growth_engine_jobs SET ${setClauses.join(", ")} WHERE job_id = ?`,
    params
  );

  saveDb();
  return getJob(jobId);
}

// ===================== REPORT OPERATIONS =====================

async function createReport(accountId, tier, businessInfo, reportBody) {
  if (!db) throw new Error("Database not initialized");

  const reportId = "rpt_" + uid();
  const now = Date.now();
  // The stored body must carry the row's id — the evaluator's provisional
  // report_id would otherwise be what clients send back to us.
  if (reportBody && typeof reportBody === "object") reportBody.report_id = reportId;

  db.run(
    `INSERT INTO growth_engine_reports
     (report_id, account_id, tier, business_handle, business_platform, business_category,
      generated_at, report_body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reportId,
      accountId,
      tier,
      businessInfo.handle || null,
      businessInfo.platform || null,
      businessInfo.category || null,
      now,
      JSON.stringify(reportBody),
      now,
      now,
    ]
  );

  saveDb();
  return { reportId, generatedAt: now };
}

async function getReport(reportId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM growth_engine_reports WHERE report_id = ?`,
    [reportId]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const columns = result[0].columns;

  return {
    reportId: row[columns.indexOf("report_id")],
    accountId: row[columns.indexOf("account_id")],
    tier: row[columns.indexOf("tier")],
    business: {
      handle: row[columns.indexOf("business_handle")],
      platform: row[columns.indexOf("business_platform")],
      category: row[columns.indexOf("business_category")],
    },
    generatedAt: row[columns.indexOf("generated_at")],
    refreshDueAt: row[columns.indexOf("refresh_due_at")],
    reportBody: JSON.parse(row[columns.indexOf("report_body")]),
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
  };
}

// Merge fields into a stored report body (e.g. competitor comparison added later).
async function patchReportBody(reportId, patch) {
  if (!db) throw new Error("Database not initialized");
  const report = await getReport(reportId);
  if (!report) return null;
  const body = { ...(report.reportBody || {}), ...patch };
  db.run(`UPDATE growth_engine_reports SET report_body = ?, updated_at = ? WHERE report_id = ?`, [JSON.stringify(body), Date.now(), reportId]);
  saveDb();
  return { ...report, reportBody: body };
}

// Score history for one handle on one account, oldest first.
async function listScoreHistory(accountId, handle, platform) {
  if (!db) throw new Error("Database not initialized");
  const result = db.exec(
    `SELECT report_id, tier, generated_at, report_body FROM growth_engine_reports
     WHERE account_id = ? AND lower(business_handle) = ? AND business_platform = ? ORDER BY generated_at ASC`,
    [accountId, String(handle).toLowerCase(), platform]
  );
  if (!result.length) return [];
  return result[0].values.map(([report_id, tier, generated_at, body]) => {
    let sc = null; try { sc = JSON.parse(body).scores || null; } catch { /* skip */ }
    let followers = null; try { followers = JSON.parse(body).business?.followers ?? null; } catch { /* skip */ }
    return sc && Number.isFinite(sc.overall)
      ? { report_id, tier, generated_at, overall: sc.overall, followers, dimensions: (sc.dimensions || []).map((d) => ({ label: d.label, score: d.score })) }
      : null;
  }).filter(Boolean);
}

async function updateReportRefreshDue(reportId, refreshDueAt) {
  if (!db) throw new Error("Database not initialized");

  const now = Date.now();
  db.run(
    `UPDATE growth_engine_reports SET refresh_due_at = ?, updated_at = ? WHERE report_id = ?`,
    [refreshDueAt, now, reportId]
  );

  saveDb();
  return getReport(reportId);
}

async function listReportsByAccount(accountId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM growth_engine_reports WHERE account_id = ? ORDER BY generated_at DESC`,
    [accountId]
  );

  if (!result || result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map((row) => ({
    reportId: row[columns.indexOf("report_id")],
    accountId: row[columns.indexOf("account_id")],
    tier: row[columns.indexOf("tier")],
    business: {
      handle: row[columns.indexOf("business_handle")],
      platform: row[columns.indexOf("business_platform")],
      category: row[columns.indexOf("business_category")],
    },
    generatedAt: row[columns.indexOf("generated_at")],
    refreshDueAt: row[columns.indexOf("refresh_due_at")],
    reportBody: JSON.parse(row[columns.indexOf("report_body")]),
  }));
}

async function listReportsDueForRefresh(beforeTimestamp) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM growth_engine_reports WHERE refresh_due_at IS NOT NULL AND refresh_due_at < ? ORDER BY refresh_due_at ASC`,
    [beforeTimestamp]
  );

  if (!result || result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map((row) => ({
    reportId: row[columns.indexOf("report_id")],
    accountId: row[columns.indexOf("account_id")],
    tier: row[columns.indexOf("tier")],
    business: {
      handle: row[columns.indexOf("business_handle")],
      platform: row[columns.indexOf("business_platform")],
      category: row[columns.indexOf("business_category")],
    },
    generatedAt: row[columns.indexOf("generated_at")],
    refreshDueAt: row[columns.indexOf("refresh_due_at")],
    reportBody: JSON.parse(row[columns.indexOf("report_body")]),
  }));
}


// ===================== ADMIN =====================
// Read-only aggregates for #/admin. Each returns plain objects.
function rowsOf(sql, params = []) {
  const r = db.exec(sql, params);
  if (!r.length) return [];
  const cols = r[0].columns;
  return r[0].values.map((v) => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
}
const one = (sql, params) => rowsOf(sql, params)[0] || {};
async function adminOverview() {
  if (!db) throw new Error("Database not initialized");
  const now = Date.now(), day = 86400000, today = dayKey();
  const usage = rowsOf(`SELECT kind, SUM(count) AS n FROM growth_engine_usage WHERE day = ? GROUP BY kind`, [today]);
  const u = Object.fromEntries(usage.map((r) => [r.kind, Number(r.n)]));
  const tiers = rowsOf(`SELECT current_tier, COUNT(*) AS n, SUM(CASE WHEN cancel_at IS NOT NULL THEN 1 ELSE 0 END) AS pending FROM entitlements GROUP BY current_tier`);
  const signups = [7, 30].map((d) => Number(one(`SELECT COUNT(*) AS n FROM users WHERE created_at > ?`, [now - d * day]).n || 0));
  const reports = rowsOf(`SELECT tier, COUNT(*) AS n FROM growth_engine_reports WHERE generated_at > ? GROUP BY tier`, [now - day]);
  const oneTime = Number(one(`SELECT COUNT(*) AS n FROM growth_engine_reports WHERE report_body LIKE '%"one_time_unlock":{%'`).n || 0);
  const jobs = rowsOf(`SELECT status, COUNT(*) AS n FROM growth_engine_jobs WHERE created_at > ? GROUP BY status`, [now - day]);
  const waitlist = rowsOf(`SELECT platform, COUNT(*) AS n FROM growth_engine_waitlist GROUP BY platform ORDER BY n DESC`);
  return {
    today: { free_scores: u.free_eval || 0, paid_runs: u.eval || 0, competitor_pulls: u.competitor || 0, jobs: Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)])), reports: Object.fromEntries(reports.map((r) => [r.tier, Number(r.n)])) },
    people: { users: Number(one(`SELECT COUNT(*) AS n FROM users`).n || 0), signups_7d: signups[0], signups_30d: signups[1], tiers: tiers.map((t) => ({ tier: t.current_tier, n: Number(t.n), cancel_pending: Number(t.pending) })), one_time_buyers: oneTime, waitlist: waitlist.map((w) => ({ platform: w.platform, n: Number(w.n) })) },
  };
}
async function adminRecentReports(limit = 50) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT report_id, account_id, tier, business_handle AS handle, business_platform AS platform, business_category AS category, generated_at, report_body FROM growth_engine_reports ORDER BY generated_at DESC LIMIT ?`, [limit]).map((r) => {
    let b = {}; try { b = JSON.parse(r.report_body); } catch { /* skip */ }
    return { report_id: r.report_id, account_id: r.account_id, tier: r.tier, handle: r.handle, platform: r.platform, category: r.category, generated_at: Number(r.generated_at), overall: b.scores?.overall ?? null, email: b.email || null, one_time: !!b.one_time_unlock, partial: !!b.plan_incomplete };
  });
}
async function adminFailedJobs(limit = 30) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT job_id, account_id, tier, stage, error, input_params, created_at FROM growth_engine_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT ?`, [limit]).map((j) => {
    let p = {}; try { p = JSON.parse(j.input_params); } catch { /* skip */ }
    return { job_id: j.job_id, account_id: j.account_id, tier: j.tier, stage: j.stage, error: j.error, handle: p.handle, platform: p.platform, email: p.email || null, created_at: Number(j.created_at) };
  });
}
async function adminFindAccount(query) {
  if (!db) throw new Error("Database not initialized");
  const s = String(query || "").trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  let user = await getUserByEmail(s);
  if (!user) {
    const r = one(`SELECT account_id FROM growth_engine_reports WHERE lower(business_handle) = ? AND account_id != 'demo-account' ORDER BY generated_at DESC LIMIT 1`, [s]);
    if (r.account_id) user = await getUserById(r.account_id);
  }
  if (!user) return null;
  const ent = await getEffectiveEntitlement(user.userId);
  const reports = (await listReportsByAccount(user.userId)).map((r) => ({ report_id: r.reportId, tier: r.tier, handle: r.business?.handle, platform: r.business?.platform, generated_at: r.generatedAt, overall: r.reportBody?.scores?.overall ?? null, moves_done: Object.keys(r.reportBody?.moves_done || {}).length, checkins: r.reportBody?.checkins || null, emails_sent: r.reportBody?.emails_sent || [], one_time: !!r.reportBody?.one_time_unlock }));
  const contexts = rowsOf(`SELECT handle, platform, context, updated_at FROM growth_engine_plan_context WHERE account_id = ?`, [user.userId]).map((c) => { let ctx = {}; try { ctx = JSON.parse(c.context); } catch { /* skip */ } return { handle: c.handle, platform: c.platform, ...ctx, updated_at: Number(c.updated_at) }; });
  const usage = rowsOf(`SELECT kind, count FROM growth_engine_usage WHERE account_id = ? AND day = ?`, [user.userId, dayKey()]);
  return { user: { user_id: user.userId, email: user.email, created_at: user.createdAt, email_paused: !!user.emailPaused }, entitlement: { tier: ent.currentTier, cancel_at: ent.cancelAt || null, period_end: ent.billingPeriodEnd || null }, reports, plan_contexts: contexts, usage_today: Object.fromEntries(usage.map((x) => [x.kind, Number(x.count)])) };
}


// ===================== PROMO CODES =====================
const promoRow = (r) => r ? { ...r, max_redemptions: r.max_redemptions == null ? null : Number(r.max_redemptions), redemptions: Number(r.redemptions || 0), expires_at: r.expires_at == null ? null : Number(r.expires_at), active: !!r.active, value: Number(r.value || 0), created_at: Number(r.created_at) } : null;
async function createPromo(p) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_promo_codes (code, kind, value, applies_to, max_redemptions, redemptions, expires_at, active, note, stripe_coupon_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [p.code, p.kind, p.value, p.applies_to, p.max_redemptions, p.expires_at, p.active ? 1 : 0, p.note || null, p.stripe_coupon_id || null, Date.now()]);
  saveDb();
  return getPromo(p.code);
}
async function getPromo(code) {
  if (!db) throw new Error("Database not initialized");
  return promoRow(rowsOf(`SELECT * FROM growth_engine_promo_codes WHERE code = ?`, [String(code || "").toUpperCase()])[0]);
}
async function listPromos() {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT * FROM growth_engine_promo_codes ORDER BY created_at DESC`).map(promoRow);
}
async function setPromoActive(code, active) {
  if (!db) throw new Error("Database not initialized");
  db.run(`UPDATE growth_engine_promo_codes SET active = ? WHERE code = ?`, [active ? 1 : 0, String(code).toUpperCase()]);
  saveDb();
  return getPromo(code);
}
async function hasRedeemed(code, accountId) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT 1 AS x FROM growth_engine_promo_redemptions WHERE code = ? AND account_id = ?`, [String(code).toUpperCase(), accountId]).length > 0;
}
async function redeemPromo(code, accountId, product, amountOff) {
  if (!db) throw new Error("Database not initialized");
  const c = String(code).toUpperCase();
  db.run(`INSERT INTO growth_engine_promo_redemptions (id, code, account_id, product, amount_off, created_at) VALUES (?, ?, ?, ?, ?, ?)`, ["pr_" + uid(), c, accountId, product, Number(amountOff) || 0, Date.now()]);
  db.run(`UPDATE growth_engine_promo_codes SET redemptions = redemptions + 1 WHERE code = ?`, [c]);
  saveDb();
  return getPromo(c);
}
async function listRedemptions(code, limit = 100) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT r.*, u.email FROM growth_engine_promo_redemptions r LEFT JOIN users u ON u.user_id = r.account_id WHERE r.code = ? ORDER BY r.created_at DESC LIMIT ?`, [String(code).toUpperCase(), limit]).map((r) => ({ ...r, amount_off: Number(r.amount_off), created_at: Number(r.created_at) }));
}


// ===================== EVENTS =====================
async function insertEvent(e) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_events (id, name, account_id, anon, ref, report_id, props, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ev_" + uid(), e.name, e.accountId, e.anon, e.ref, e.reportId, e.props, e.ip, Date.now()]);
  saveDb();
}
// Distinct actors per event name in a window. An actor is the account when
// known, else the anonymous browser id. Also conversion by ref code.
async function eventFunnel(sinceTs, names) {
  if (!db) throw new Error("Database not initialized");
  const out = {};
  for (const n of names) {
    const r = one(`SELECT COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors, COUNT(*) AS total FROM growth_engine_events WHERE name = ? AND created_at >= ?`, [n, sinceTs]);
    out[n] = { actors: Number(r.actors || 0), total: Number(r.total || 0) };
  }
  const byRef = rowsOf(`SELECT ref, name, COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors FROM growth_engine_events WHERE ref IS NOT NULL AND created_at >= ? AND name IN ('evaluate_started','signup','subscribe') GROUP BY ref, name`, [sinceTs]);
  const refs = {};
  for (const r of byRef) (refs[r.ref] ||= {})[r.name] = Number(r.actors);
  return { steps: out, by_ref: refs };
}
// Conversion by price variant: distinct people who viewed pricing vs subscribed/unlocked, per variant.
async function variantFunnel(sinceTs) {
  if (!db) throw new Error("Database not initialized");
  const rows = rowsOf(`SELECT json_extract(props, '$.variant') AS v, name, COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors, SUM(CAST(COALESCE(json_extract(props, '$.amount_cents'), 0) AS REAL)) AS cents FROM growth_engine_events WHERE created_at >= ? AND name IN ('pricing_viewed','subscribe','unlock') AND json_extract(props, '$.variant') IS NOT NULL GROUP BY v, name`, [sinceTs]);
  const out = {};
  for (const r of rows) { (out[r.v] ||= { pricing_viewed: 0, subscribe: 0, unlock: 0, revenue_cents: 0 })[r.name] = Number(r.actors); if (r.name !== "pricing_viewed") out[r.v].revenue_cents += Number(r.cents) || 0; }
  return out;
}
// Month-two retention: accounts that subscribed 30–60 days ago and are still
// on a paid tier now (cancel_at in the future counts as still paying).
async function paidRetention() {
  if (!db) throw new Error("Database not initialized");
  const now = Date.now(), d = 86400000;
  const cohort = rowsOf(`SELECT DISTINCT account_id FROM growth_engine_events WHERE name = 'subscribe' AND created_at BETWEEN ? AND ?`, [now - 60 * d, now - 30 * d]).map((r) => r.account_id).filter(Boolean);
  let retained = 0;
  for (const id of cohort) { const e = one(`SELECT current_tier, cancel_at FROM entitlements WHERE account_id = ?`, [id]); if (e.current_tier && e.current_tier !== "social_snapshot" && (!e.cancel_at || Number(e.cancel_at) > now)) retained++; }
  return { cohort: cohort.length, retained, rate: cohort.length ? retained / cohort.length : null };
}


// ===================== COSTS =====================
async function insertCost(c) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_costs (id, account_id, job_id, report_id, feature, kind, provider, model, label, quantity, detail, cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c_" + uid(), c.accountId, c.jobId, c.reportId, c.feature, c.kind, c.provider || null, c.model || null, c.label || null, Number(c.quantity) || 0, c.detail ? JSON.stringify(c.detail) : null, Number(c.cents) || 0, Date.now()]);
  saveDb();
}
// Cost rows are written before the report exists; stamp them once it does.
async function attachReportToCosts(jobId, reportId) {
  if (!db) throw new Error("Database not initialized");
  db.run(`UPDATE growth_engine_costs SET report_id = ? WHERE job_id = ? AND report_id IS NULL`, [reportId, jobId]);
  saveDb();
}
// Totals by kind/provider/feature since a time, plus per-account cost next to
// revenue (mock revenue = subscribe/unlock events' amount_cents; real Stripe
// later replaces this with invoices).
async function adminCosts(sinceTs, limit = 50) {
  if (!db) throw new Error("Database not initialized");
  const by = (col) => rowsOf(`SELECT ${col} AS k, SUM(cents) AS cents, COUNT(*) AS n, SUM(quantity) AS qty FROM growth_engine_costs WHERE created_at >= ? GROUP BY ${col} ORDER BY cents DESC`, [sinceTs]).map((r) => ({ key: r.k, cents: Number(r.cents), n: Number(r.n), quantity: Number(r.qty) }));
  const total = Number(one(`SELECT SUM(cents) AS c FROM growth_engine_costs WHERE created_at >= ?`, [sinceTs]).c || 0);
  const perReport = one(`SELECT AVG(c) AS avg FROM (SELECT SUM(cents) AS c FROM growth_engine_costs WHERE created_at >= ? AND report_id IS NOT NULL GROUP BY report_id)`, [sinceTs]);
  const users = rowsOf(`SELECT c.account_id, u.email, SUM(c.cents) AS cents, COUNT(DISTINCT c.report_id) AS reports FROM growth_engine_costs c LEFT JOIN users u ON u.user_id = c.account_id WHERE c.created_at >= ? AND c.account_id IS NOT NULL GROUP BY c.account_id ORDER BY cents DESC LIMIT ?`, [sinceTs, limit]);
  const revenue = rowsOf(`SELECT account_id, SUM(CAST(json_extract(props, '$.amount_cents') AS REAL)) AS cents FROM growth_engine_events WHERE name IN ('subscribe','unlock') AND account_id IS NOT NULL GROUP BY account_id`);
  const rev = Object.fromEntries(revenue.map((r) => [r.account_id, Number(r.cents) || 0]));
  return { total_cents: total, avg_cents_per_report: Number(perReport.avg || 0), by_kind: by("kind"), by_provider: by("provider"), by_feature: by("feature"), by_model: by("model"),
    users: users.map((u) => ({ account_id: u.account_id, email: u.email, cost_cents: Number(u.cents), reports: Number(u.reports), revenue_cents: rev[u.account_id] || 0 })) };
}


// ===================== OUTCOMES (spec 1.15) =====================
async function logMove({ accountId, reportId, handle, platform, category, moveKey, done, overall, dims, planDay }) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_move_log (id, account_id, report_id, handle, platform, category, move_key, done, overall_at, dims_at, plan_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ml_" + uid(), accountId, reportId, handle || null, platform || null, category || null, moveKey, done ? 1 : 0, overall ?? null, dims ? JSON.stringify(dims) : null, planDay ?? null, Date.now()]);
  saveDb();
}
async function recordMoveOutcomes({ accountId, handle, platform, category, moveKeys, before, after, days, fromReport, toReport }) {
  if (!db) throw new Error("Database not initialized");
  for (const k of moveKeys) {
    db.run(`INSERT INTO growth_engine_move_outcomes (id, account_id, handle, platform, category, move_key, moves_done_together, score_before, score_after, dims_before, dims_after, days, from_report, to_report, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["mo_" + uid(), accountId, handle || null, platform || null, category || null, k, moveKeys.length, before.overall ?? null, after.overall ?? null, JSON.stringify(before.dims || {}), JSON.stringify(after.dims || {}), days ?? null, fromReport || null, toReport || null, Date.now()]);
  }
  saveDb();
}
// Which moves raise scores where: avg delta per move key, by niche+platform.
async function moveOutcomeSummary({ category = null, platform = null } = {}) {
  if (!db) throw new Error("Database not initialized");
  const where = []; const params = [];
  if (category) { where.push("category = ?"); params.push(category); }
  if (platform) { where.push("platform = ?"); params.push(platform); }
  return rowsOf(`SELECT category, platform, move_key, COUNT(*) AS n, AVG(score_after - score_before) AS avg_delta, AVG(moves_done_together) AS avg_together FROM growth_engine_move_outcomes ${where.length ? "WHERE " + where.join(" AND ") : ""} GROUP BY category, platform, move_key ORDER BY n DESC, avg_delta DESC`, params)
    .map((r) => ({ ...r, n: Number(r.n), avg_delta: Number(r.avg_delta), avg_together: Number(r.avg_together) }));
}


// ===================== SHARE CARDS (spec 1.7) =====================
async function createShare({ accountId, reportId, kind, data, ref }) {
  if (!db) throw new Error("Database not initialized");
  const shareId = crypto.randomBytes(6).toString("base64url");
  db.run(`INSERT INTO growth_engine_shares (share_id, account_id, report_id, kind, data, ref, views, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`, [shareId, accountId || null, reportId, kind, JSON.stringify(data), ref || null, Date.now()]);
  saveDb();
  return getShare(shareId);
}
async function getShare(shareId) {
  if (!db) throw new Error("Database not initialized");
  const r = rowsOf(`SELECT * FROM growth_engine_shares WHERE share_id = ?`, [shareId])[0];
  if (!r) return null;
  let data = {}; try { data = JSON.parse(r.data); } catch { /* skip */ }
  return { shareId: r.share_id, accountId: r.account_id, reportId: r.report_id, kind: r.kind, data, ref: r.ref, views: Number(r.views), createdAt: Number(r.created_at) };
}
async function bumpShareViews(shareId) { if (!db) throw new Error("Database not initialized"); db.run(`UPDATE growth_engine_shares SET views = views + 1 WHERE share_id = ?`, [shareId]); saveDb(); }

// ===================== ENTITLEMENT OPERATIONS =====================

async function getOrCreateEntitlement(accountId) {
  if (!db) throw new Error("Database not initialized");

  const existing = await getEntitlement(accountId);
  if (existing) return existing;

  const now = Date.now();
  db.run(
    `INSERT INTO entitlements
     (account_id, current_tier, tier_start_date, created_at, updated_at)
     VALUES (?, 'social_snapshot', ?, ?, ?)`,
    [accountId, now, now, now]
  );

  saveDb();
  return getEntitlement(accountId);
}

async function getEntitlement(accountId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM entitlements WHERE account_id = ?`,
    [accountId]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const columns = result[0].columns;

  return {
    accountId: row[columns.indexOf("account_id")],
    currentTier: row[columns.indexOf("current_tier")],
    tierStartDate: row[columns.indexOf("tier_start_date")],
    billingPeriodStart: row[columns.indexOf("billing_period_start")],
    billingPeriodEnd: row[columns.indexOf("billing_period_end")],
    cancelAt: columns.includes("cancel_at") ? row[columns.indexOf("cancel_at")] || null : null,
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
  };
}

// A cancelled plan keeps its tier until cancel_at, then reads as free. The
// downgrade is applied lazily here so every caller sees the same answer.
async function getEffectiveEntitlement(accountId) {
  const ent = await getOrCreateEntitlement(accountId);
  if (ent.cancelAt && ent.cancelAt <= Date.now() && ent.currentTier !== "social_snapshot") {
    await upgradeTier(accountId, "social_snapshot");
    db.run(`UPDATE entitlements SET cancel_at = NULL, updated_at = ? WHERE account_id = ?`, [Date.now(), accountId]);
    saveDb();
    return getEntitlement(accountId);
  }
  return ent;
}
async function setCancelAt(accountId, cancelAt) {
  if (!db) throw new Error("Database not initialized");
  await getOrCreateEntitlement(accountId);
  db.run(`UPDATE entitlements SET cancel_at = ?, updated_at = ? WHERE account_id = ?`, [cancelAt || null, Date.now(), accountId]);
  saveDb();
  return getEntitlement(accountId);
}
async function setBillingPeriod(accountId, start, end) {
  if (!db) throw new Error("Database not initialized");
  await getOrCreateEntitlement(accountId);
  db.run(`UPDATE entitlements SET billing_period_start = ?, billing_period_end = ?, updated_at = ? WHERE account_id = ?`, [start || null, end || null, Date.now(), accountId]);
  saveDb();
  return getEntitlement(accountId);
}

async function createPasswordReset(userId, tokenHash, expiresAt) {
  if (!db) throw new Error("Database not initialized");
  db.run(`DELETE FROM growth_engine_password_resets WHERE user_id = ? OR expires_at < ?`, [userId, Date.now()]);
  db.run(`INSERT INTO growth_engine_password_resets (token_hash, user_id, expires_at, used_at) VALUES (?, ?, ?, NULL)`, [tokenHash, userId, expiresAt]);
  saveDb();
}
// Returns the user id for a live token and burns it, or null.
async function consumePasswordReset(tokenHash) {
  if (!db) throw new Error("Database not initialized");
  const r = db.exec(`SELECT user_id, expires_at, used_at FROM growth_engine_password_resets WHERE token_hash = ?`, [tokenHash]);
  if (!r.length || !r[0].values.length) return null;
  const [userId, expiresAt, usedAt] = r[0].values[0];
  if (usedAt || expiresAt < Date.now()) return null;
  db.run(`UPDATE growth_engine_password_resets SET used_at = ? WHERE token_hash = ?`, [Date.now(), tokenHash]);
  saveDb();
  return userId;
}

async function upgradeTier(accountId, newTier) {
  if (!db) throw new Error("Database not initialized");

  // Get current entitlement
  const ent = await getOrCreateEntitlement(accountId);
  const oldTier = ent.currentTier;
  const now = Date.now();

  // This is a transaction: update entitlement AND create history in one atomic operation
  db.run("BEGIN TRANSACTION");

  try {
    db.run(
      `UPDATE entitlements SET current_tier = ?, tier_start_date = ?, updated_at = ? WHERE account_id = ?`,
      [newTier, now, now, accountId]
    );

    db.run(
      `INSERT INTO tier_history (history_id, account_id, from_tier, to_tier, changed_at) VALUES (?, ?, ?, ?, ?)`,
      ["hist_" + uid(), accountId, oldTier, newTier, now]
    );

    db.run("COMMIT");
    saveDb();

    return getEntitlement(accountId);
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

async function getTierHistory(accountId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM tier_history WHERE account_id = ? ORDER BY changed_at DESC`,
    [accountId]
  );

  if (!result || result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map((row) => ({
    historyId: row[columns.indexOf("history_id")],
    accountId: row[columns.indexOf("account_id")],
    fromTier: row[columns.indexOf("from_tier")],
    toTier: row[columns.indexOf("to_tier")],
    changedAt: row[columns.indexOf("changed_at")],
  }));
}

// ===================== USER OPERATIONS =====================

async function createUser(email, passwordHash, companyName) {
  if (!db) throw new Error("Database not initialized");

  const userId = "user_" + uid();
  const now = Date.now();

  db.run(
    `INSERT INTO users (user_id, email, password_hash, company_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, email, passwordHash, companyName || null, now, now]
  );

  saveDb();
  return { userId, email, companyName, createdAt: now };
}

async function getUserByEmail(email) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM users WHERE email = ?`,
    [email]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const columns = result[0].columns;

  return {
    userId: row[columns.indexOf("user_id")],
    email: row[columns.indexOf("email")],
    passwordHash: row[columns.indexOf("password_hash")],
    companyName: row[columns.indexOf("company_name")],
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
    emailPaused: columns.includes("email_paused") ? !!row[columns.indexOf("email_paused")] : false,
    isBusiness: columns.includes("is_business") ? !!row[columns.indexOf("is_business")] : false,
    priceVariant: columns.includes("price_variant") ? row[columns.indexOf("price_variant")] || null : null,
    emailPrefs: columns.includes("email_prefs") ? (() => { try { return JSON.parse(row[columns.indexOf("email_prefs")] || "null") || null; } catch { return null; } })() : null,
    niche: columns.includes("niche") ? row[columns.indexOf("niche")] || null : null,
  };
}

async function getUserById(userId) {
  if (!db) throw new Error("Database not initialized");

  const result = db.exec(
    `SELECT * FROM users WHERE user_id = ?`,
    [userId]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const columns = result[0].columns;

  return {
    userId: row[columns.indexOf("user_id")],
    email: row[columns.indexOf("email")],
    passwordHash: row[columns.indexOf("password_hash")],
    companyName: row[columns.indexOf("company_name")],
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
    emailPaused: columns.includes("email_paused") ? !!row[columns.indexOf("email_paused")] : false,
    isBusiness: columns.includes("is_business") ? !!row[columns.indexOf("is_business")] : false,
    priceVariant: columns.includes("price_variant") ? row[columns.indexOf("price_variant")] || null : null,
    emailPrefs: columns.includes("email_prefs") ? (() => { try { return JSON.parse(row[columns.indexOf("email_prefs")] || "null") || null; } catch { return null; } })() : null,
    niche: columns.includes("niche") ? row[columns.indexOf("niche")] || null : null,
  };
}

async function setUserProfile(userId, { isBusiness, niche, priceVariant } = {}) {
  if (!db) throw new Error("Database not initialized");
  if (priceVariant !== undefined) db.run(`UPDATE users SET price_variant = ?, updated_at = ? WHERE user_id = ?`, [priceVariant || null, Date.now(), userId]);
  if (isBusiness !== undefined) db.run(`UPDATE users SET is_business = ?, updated_at = ? WHERE user_id = ?`, [isBusiness ? 1 : 0, Date.now(), userId]);
  if (niche !== undefined) db.run(`UPDATE users SET niche = ?, updated_at = ? WHERE user_id = ?`, [niche || null, Date.now(), userId]);
  saveDb();
  return getUserById(userId);
}
// Phase-2 waitlist: every account or report flagged as a business.
async function listBusinessAccounts() {
  if (!db) throw new Error("Database not initialized");
  const users = rowsOf(`SELECT user_id, email, niche, created_at FROM users WHERE is_business = 1 ORDER BY created_at DESC`);
  const reports = rowsOf(`SELECT r.account_id, r.business_handle AS handle, r.business_platform AS platform, r.business_category AS category, r.generated_at, r.report_body, u.email AS user_email FROM growth_engine_reports r LEFT JOIN users u ON u.user_id = r.account_id WHERE r.report_body LIKE '%"is_business_account":true%' ORDER BY r.generated_at DESC`)
    .map((r) => { let b = {}; try { b = JSON.parse(r.report_body); } catch { /* skip */ } return { account_id: r.account_id, email: b.email || r.user_email || null, handle: r.handle, platform: r.platform, category: r.category, overall: b.scores?.overall ?? null, generated_at: Number(r.generated_at) }; });
  return { users: users.map((u) => ({ ...u, created_at: Number(u.created_at) })), reports };
}
async function setEmailPrefs(userId, prefs) {
  if (!db) throw new Error("Database not initialized");
  db.run(`UPDATE users SET email_prefs = ?, updated_at = ? WHERE user_id = ?`, [JSON.stringify(prefs || {}), Date.now(), userId]);
  saveDb();
  return getUserById(userId);
}
async function insertEmailLog(e) {
  if (!db) throw new Error("Database not initialized");
  db.run(`INSERT INTO growth_engine_email_log (id, user_id, to_email, type, subject, status, provider, provider_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["em_" + uid(), e.userId || null, e.to, e.type, (e.subject || "").slice(0, 200), e.status, e.provider || null, e.providerId || null, e.error ? String(e.error).slice(0, 300) : null, Date.now()]);
  saveDb();
}
async function listEmailLog(limit = 100) {
  if (!db) throw new Error("Database not initialized");
  return rowsOf(`SELECT * FROM growth_engine_email_log ORDER BY created_at DESC LIMIT ?`, [limit]).map((r) => ({ ...r, created_at: Number(r.created_at) }));
}
async function setEmailPaused(userId, paused) {
  if (!db) throw new Error("Database not initialized");
  db.run(`UPDATE users SET email_paused = ?, updated_at = ? WHERE user_id = ?`, [paused ? 1 : 0, Date.now(), userId]);
  saveDb();
  return getUserById(userId);
}
async function isEmailPaused(email) {
  const u = await getUserByEmail(String(email || "").toLowerCase());
  return !!(u && u.emailPaused);
}

async function updateUserPassword(userId, passwordHash) {
  if (!db) throw new Error("Database not initialized");

  const now = Date.now();
  db.run(
    `UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?`,
    [passwordHash, now, userId]
  );

  saveDb();
  return getUserById(userId);
}

module.exports = {
  countFreeSnapshotsByEmail,
  latestFreeSnapshotForEmail,
  findFreeSnapshotForHandle,
  adoptAnonymousReports,
  getCachedProfile,
  putCachedProfile,
  recordOutcome,
  getOutcomeSummary,
  getUsage,
  bumpUsage,
  addWaitlist,
  getPlanContext,
  setPlanContext,
  listPaidReportsBetween,
  listReportsForThumbCleanup,
  deleteAccount,
  recordBaseline,
  getCategoryBaseline,
  patchReportBody,
  listScoreHistory,
  getBaselineSummary,
  listBaselines,
  initDb,
  // Jobs
  createJob,
  getJob,
  updateJobStatus,
  // Reports
  createReport,
  getReport,
  updateReportRefreshDue,
  listReportsByAccount,
  listReportsDueForRefresh,
  // Entitlements
  getOrCreateEntitlement,
  getEntitlement,
  getEffectiveEntitlement,
  adminOverview,
  adminRecentReports,
  adminFailedJobs,
  adminFindAccount,
  insertEvent, eventFunnel, paidRetention, variantFunnel,
  insertCost, adminCosts, attachReportToCosts,
  logMove, recordMoveOutcomes, moveOutcomeSummary,
  createShare, getShare, bumpShareViews,
  createPromo, getPromo, listPromos, setPromoActive, hasRedeemed, redeemPromo, listRedemptions,
  setCancelAt,
  setBillingPeriod,
  createPasswordReset,
  consumePasswordReset,
  upgradeTier,
  getTierHistory,
  // Users
  createUser,
  getUserByEmail,
  getUserById,
  updateUserPassword,
  setEmailPaused,
  isEmailPaused,
  setEmailPrefs,
  insertEmailLog,
  listEmailLog,
  setUserProfile,
  listBusinessAccounts,
};
