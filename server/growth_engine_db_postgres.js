/**
 * Growth Engine DB — PostgreSQL (used when DATABASE_URL is set, e.g. Railway).
 *
 * Drop-in for growth_engine_db.js: same function names, same argument order,
 * same return shapes (camelCase for reports/entitlements, the job row's
 * result_payload exposed as resultPayload). Anything the SQLite module
 * exports exists here too, so routes, queue and billing don't branch.
 */

const { Pool } = require("pg");
const crypto = require("crypto");

let pool = null;
const uid = () => crypto.randomBytes(12).toString("hex");

async function initDb() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (err) => console.error("[Growth Engine DB] Unexpected error on idle client", err));
  const client = await pool.connect();
  try {
    await client.query("SELECT NOW()");
    console.log("[Growth Engine DB] PostgreSQL connected");
  } finally {
    client.release();
  }
  await initSchema();
  return pool;
}

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        company_name TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_jobs (
        job_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'social_snapshot',
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        input_params JSONB NOT NULL,
        result_payload JSONB,
        error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_account ON growth_engine_jobs (account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON growth_engine_jobs (status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_reports (
        report_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        job_id TEXT,
        tier TEXT NOT NULL DEFAULT 'social_snapshot',
        handle TEXT NOT NULL,
        platform TEXT NOT NULL,
        category TEXT NOT NULL,
        report_body JSONB NOT NULL,
        generated_at BIGINT,
        refresh_due_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`);
    // Columns added after the first deploy; harmless on a fresh DB.
    await client.query(`ALTER TABLE growth_engine_reports ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'social_snapshot'`);
    await client.query(`ALTER TABLE growth_engine_reports ADD COLUMN IF NOT EXISTS generated_at BIGINT`);
    await client.query(`ALTER TABLE growth_engine_reports ADD COLUMN IF NOT EXISTS refresh_due_at BIGINT`);
    await client.query(`ALTER TABLE growth_engine_reports ALTER COLUMN job_id DROP NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_account ON growth_engine_reports (account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_created ON growth_engine_reports (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_handle ON growth_engine_reports (account_id, handle, platform)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_baselines (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        overall INTEGER NOT NULL,
        dimensions JSONB NOT NULL,
        created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_baselines_cat ON growth_engine_baselines (category, platform)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS entitlements (
        user_id TEXT PRIMARY KEY,
        current_tier TEXT NOT NULL DEFAULT 'social_snapshot',
        tier_start_date BIGINT NOT NULL,
        billing_period_start BIGINT,
        billing_period_end BIGINT,
        stripe_subscription_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`);
    // The first deploy defaulted to 'free'; the rest of the codebase says social_snapshot.
    await client.query(`UPDATE entitlements SET current_tier = 'social_snapshot' WHERE current_tier = 'free'`);
    await client.query(`ALTER TABLE entitlements ALTER COLUMN current_tier SET DEFAULT 'social_snapshot'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_tier_history (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        from_tier TEXT,
        to_tier TEXT NOT NULL,
        changed_at BIGINT NOT NULL
      )`);
    console.log("[Growth Engine DB] Schema initialized");
  } finally {
    client.release();
  }
}

// Runs a query on a pooled client and releases it.
async function q(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
const parseJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// ===================== USERS =====================

async function createUser(email, passwordHash, companyName = null) {
  const userId = "user_" + uid();
  const now = Date.now();
  await q(
    `INSERT INTO users (user_id, email, password_hash, company_name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, String(email).toLowerCase(), passwordHash, companyName, now, now]
  );
  return { userId, email: String(email).toLowerCase(), companyName, createdAt: now };
}

function userRow(row) {
  return row
    ? { userId: row.user_id, email: row.email, passwordHash: row.password_hash, companyName: row.company_name, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
    : null;
}
async function getUserByEmail(email) {
  return userRow((await q(`SELECT * FROM users WHERE email = $1`, [String(email).toLowerCase()])).rows[0]);
}
async function getUserById(userId) {
  return userRow((await q(`SELECT * FROM users WHERE user_id = $1`, [userId])).rows[0]);
}
async function updateUserPassword(userId, passwordHash) {
  await q(`UPDATE users SET password_hash = $1, updated_at = $2 WHERE user_id = $3`, [passwordHash, Date.now(), userId]);
  return getUserById(userId);
}

// ===================== JOBS =====================

async function createJob(accountId, tier, inputParams) {
  const jobId = "job_" + uid();
  const now = Date.now();
  await q(
    `INSERT INTO growth_engine_jobs (job_id, account_id, tier, status, input_params, created_at, updated_at)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6)`,
    [jobId, accountId, tier || "social_snapshot", JSON.stringify(inputParams), now, now]
  );
  return { jobId, status: "queued", createdAt: now };
}

function jobRow(row) {
  return row
    ? {
        jobId: row.job_id, accountId: row.account_id, tier: row.tier, status: row.status, stage: row.stage,
        inputParams: parseJson(row.input_params), resultPayload: row.result_payload ? parseJson(row.result_payload) : null,
        error: row.error, created_at: Number(row.created_at), updated_at: Number(row.updated_at),
      }
    : null;
}
async function getJob(jobId) {
  return jobRow((await q(`SELECT * FROM growth_engine_jobs WHERE job_id = $1`, [jobId])).rows[0]);
}

// Same signature as the SQLite module: updates = { stage, resultPayload, error }
async function updateJobStatus(jobId, status, updates = {}) {
  const sets = ["status = $1", "updated_at = $2"];
  const vals = [status, Date.now()];
  if (updates.stage !== undefined) { vals.push(updates.stage); sets.push(`stage = $${vals.length}`); }
  if (updates.resultPayload !== undefined) { vals.push(updates.resultPayload ? JSON.stringify(updates.resultPayload) : null); sets.push(`result_payload = $${vals.length}`); }
  if (updates.error !== undefined) { vals.push(updates.error); sets.push(`error = $${vals.length}`); }
  vals.push(jobId);
  await q(`UPDATE growth_engine_jobs SET ${sets.join(", ")} WHERE job_id = $${vals.length}`, vals);
  return getJob(jobId);
}

// Free-tier quota: non-failed snapshot jobs for an email.
async function countFreeSnapshotsByEmail(email) {
  const r = await q(
    `SELECT COUNT(*) AS n FROM growth_engine_jobs
     WHERE tier = 'social_snapshot' AND status <> 'failed' AND lower(input_params->>'email') = $1`,
    [String(email).trim().toLowerCase()]
  );
  return Number(r.rows[0]?.n || 0);
}

// ===================== REPORTS =====================

async function createReport(accountId, tier, businessInfo, reportBody) {
  const reportId = "rpt_" + uid();
  const now = Date.now();
  await q(
    `INSERT INTO growth_engine_reports
     (report_id, account_id, job_id, tier, handle, platform, category, report_body, generated_at, refresh_due_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [reportId, accountId, businessInfo.jobId || null, tier || "social_snapshot", businessInfo.handle || "", businessInfo.platform || "",
      businessInfo.category || "", JSON.stringify(reportBody), now, reportBody?.refresh_due_at || null, now, now]
  );
  return { reportId, generatedAt: now };
}

function reportRow(row) {
  return row
    ? {
        reportId: row.report_id, accountId: row.account_id, tier: row.tier,
        business: { handle: row.handle, platform: row.platform, category: row.category },
        generatedAt: Number(row.generated_at || row.created_at), refreshDueAt: row.refresh_due_at ? Number(row.refresh_due_at) : null,
        reportBody: parseJson(row.report_body),
      }
    : null;
}
async function getReport(reportId) {
  return reportRow((await q(`SELECT * FROM growth_engine_reports WHERE report_id = $1`, [reportId])).rows[0]);
}
async function listReportsByAccount(accountId, limit = 100) {
  const r = await q(`SELECT * FROM growth_engine_reports WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`, [accountId, limit]);
  return r.rows.map(reportRow);
}
async function patchReportBody(reportId, patch) {
  const report = await getReport(reportId);
  if (!report) return null;
  const body = { ...(report.reportBody || {}), ...patch };
  await q(`UPDATE growth_engine_reports SET report_body = $1, updated_at = $2 WHERE report_id = $3`, [JSON.stringify(body), Date.now(), reportId]);
  return { ...report, reportBody: body };
}
async function updateReportRefreshDue(reportId, refreshDueAt) {
  await q(`UPDATE growth_engine_reports SET refresh_due_at = $1, updated_at = $2 WHERE report_id = $3`, [refreshDueAt, Date.now(), reportId]);
  return getReport(reportId);
}
async function listReportsDueForRefresh(beforeTimestamp) {
  const r = await q(`SELECT * FROM growth_engine_reports WHERE refresh_due_at IS NOT NULL AND refresh_due_at <= $1 ORDER BY refresh_due_at ASC`, [beforeTimestamp]);
  return r.rows.map(reportRow);
}
// Score history for one handle on one account, oldest first.
async function listScoreHistory(accountId, handle, platform) {
  const r = await q(
    `SELECT report_id, tier, generated_at, created_at, report_body FROM growth_engine_reports
     WHERE account_id = $1 AND lower(handle) = $2 AND platform = $3 ORDER BY created_at ASC`,
    [accountId, String(handle).toLowerCase(), platform]
  );
  return r.rows
    .map((row) => {
      const sc = parseJson(row.report_body)?.scores;
      return sc && Number.isFinite(sc.overall)
        ? { report_id: row.report_id, tier: row.tier, generated_at: Number(row.generated_at || row.created_at), overall: sc.overall, dimensions: (sc.dimensions || []).map((d) => ({ label: d.label, score: d.score })) }
        : null;
    })
    .filter(Boolean);
}

// ===================== ENTITLEMENTS =====================

function entRow(row) {
  return row
    ? {
        accountId: row.user_id, user_id: row.user_id,
        currentTier: row.current_tier, current_tier: row.current_tier,
        tierStartDate: Number(row.tier_start_date), tier_start_date: Number(row.tier_start_date),
        billingPeriodStart: row.billing_period_start ? Number(row.billing_period_start) : null, billing_period_start: row.billing_period_start ? Number(row.billing_period_start) : null,
        billingPeriodEnd: row.billing_period_end ? Number(row.billing_period_end) : null, billing_period_end: row.billing_period_end ? Number(row.billing_period_end) : null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
      }
    : null;
}
async function getEntitlement(accountId) {
  return entRow((await q(`SELECT * FROM entitlements WHERE user_id = $1`, [accountId])).rows[0]);
}
async function getOrCreateEntitlement(accountId) {
  const existing = await getEntitlement(accountId);
  if (existing) return existing;
  const now = Date.now();
  await q(
    `INSERT INTO entitlements (user_id, current_tier, tier_start_date, created_at, updated_at) VALUES ($1, 'social_snapshot', $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [accountId, now, now, now]
  );
  return getEntitlement(accountId);
}
async function upgradeTier(accountId, newTier, stripeSubscriptionId = null) {
  const current = await getOrCreateEntitlement(accountId);
  const now = Date.now();
  await q(
    `UPDATE entitlements SET current_tier = $1, tier_start_date = $2, billing_period_start = $2, billing_period_end = $3,
       stripe_subscription_id = COALESCE($4, stripe_subscription_id), updated_at = $2 WHERE user_id = $5`,
    [newTier, now, now + 30 * 24 * 60 * 60 * 1000, stripeSubscriptionId, accountId]
  );
  await q(`INSERT INTO growth_engine_tier_history (id, account_id, from_tier, to_tier, changed_at) VALUES ($1, $2, $3, $4, $5)`,
    ["th_" + uid(), accountId, current?.currentTier || null, newTier, now]);
  return getEntitlement(accountId);
}
// Kept for callers written against the first Postgres draft.
async function updateEntitlement(accountId, tier, stripeSubscriptionId = null) {
  return upgradeTier(accountId, tier, stripeSubscriptionId);
}
async function getTierHistory(accountId) {
  const r = await q(`SELECT * FROM growth_engine_tier_history WHERE account_id = $1 ORDER BY changed_at ASC`, [accountId]);
  return r.rows.map((row) => ({ accountId: row.account_id, fromTier: row.from_tier, toTier: row.to_tier, changedAt: Number(row.changed_at) }));
}

// ===================== CATEGORY BASELINES =====================

async function recordBaseline({ category, platform, handle, overall, dimensions }) {
  if (!category || !platform || !handle || !Number.isFinite(overall)) return;
  const key = `${category}|${platform}|${String(handle).toLowerCase()}`;
  const dims = {};
  for (const d of dimensions || []) if (d && d.label && Number.isFinite(d.score)) dims[d.label] = d.score;
  await q(
    `INSERT INTO growth_engine_baselines (id, category, platform, handle, overall, dimensions, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET overall = EXCLUDED.overall, dimensions = EXCLUDED.dimensions, created_at = EXCLUDED.created_at`,
    [key, category, platform, String(handle).toLowerCase(), Math.round(overall), JSON.stringify(dims), Date.now()]
  );
}
async function getCategoryBaseline(category, { minN = 20 } = {}) {
  const r = await q(`SELECT overall, dimensions FROM growth_engine_baselines WHERE category = $1`, [category]);
  const rows = r.rows;
  if (!rows.length) return null;
  if (rows.length < minN) return { n: rows.length, min_n: minN, ready: false };
  const overalls = rows.map((x) => Number(x.overall)).sort((a, b) => a - b);
  const sums = {}, counts = {};
  for (const x of rows) for (const [k, v] of Object.entries(parseJson(x.dimensions) || {})) { sums[k] = (sums[k] || 0) + v; counts[k] = (counts[k] || 0) + 1; }
  const dimensions = {};
  for (const k of Object.keys(sums)) dimensions[k] = Math.round(sums[k] / counts[k]);
  return {
    n: rows.length, min_n: minN, ready: true,
    overall: Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length),
    top_quartile: overalls[Math.min(overalls.length - 1, Math.floor(overalls.length * 0.75))],
    dimensions,
  };
}
async function getBaselineSummary() {
  const r = await q(`SELECT category, COUNT(*) AS n FROM growth_engine_baselines GROUP BY category`);
  const by_category = {};
  let total = 0;
  for (const row of r.rows) { by_category[row.category] = Number(row.n); total += Number(row.n); }
  return { total, by_category };
}
// Aliases for the first Postgres draft's names.
async function createBaseline(category, platform, handle, overall, dimensions) {
  return recordBaseline({ category, platform, handle, overall, dimensions: Array.isArray(dimensions) ? dimensions : Object.entries(dimensions || {}).map(([label, score]) => ({ label, score })) });
}
async function getBaselineStats(category) {
  const b = await getCategoryBaseline(category, { minN: 1 });
  return b ? { avg_overall: b.overall, count: b.n } : { avg_overall: null, count: 0 };
}

module.exports = {
  initDb,
  initSchema,
  // Users
  createUser,
  getUserByEmail,
  getUserById,
  updateUserPassword,
  // Jobs
  createJob,
  getJob,
  updateJobStatus,
  countFreeSnapshotsByEmail,
  // Reports
  createReport,
  getReport,
  listReportsByAccount,
  patchReportBody,
  updateReportRefreshDue,
  listReportsDueForRefresh,
  listScoreHistory,
  // Entitlements
  getOrCreateEntitlement,
  getEntitlement,
  upgradeTier,
  updateEntitlement,
  getTierHistory,
  // Baselines
  recordBaseline,
  getCategoryBaseline,
  getBaselineSummary,
  createBaseline,
  getBaselineStats,
};
