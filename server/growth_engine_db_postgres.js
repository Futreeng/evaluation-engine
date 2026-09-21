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
      CREATE TABLE IF NOT EXISTS growth_engine_outcomes (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, handle TEXT NOT NULL, platform TEXT NOT NULL, category TEXT,
        moves_done INTEGER NOT NULL, score_delta INTEGER NOT NULL, follower_delta INTEGER, days INTEGER, created_at BIGINT NOT NULL
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_profile_cache (
        id TEXT PRIMARY KEY, platform TEXT NOT NULL, handle TEXT NOT NULL, data JSONB NOT NULL, fetched_at BIGINT NOT NULL
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_usage (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_waitlist (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )`);
    await client.query(`ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS cancel_at BIGINT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_paused BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS niche TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS price_variant TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_prefs TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code ON users (ref_code)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_referrals (
        id TEXT PRIMARY KEY, ref_code TEXT NOT NULL, referrer_id TEXT NOT NULL, referred_id TEXT NOT NULL UNIQUE, signed_up_at BIGINT NOT NULL,
        first_paid_at BIGINT, first_paid_cents INTEGER, first_paid_product TEXT, payout_status TEXT NOT NULL DEFAULT 'none', payout_cents INTEGER, created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON growth_engine_referrals (referrer_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_email_log (
        id TEXT PRIMARY KEY, user_id TEXT, to_email TEXT NOT NULL, type TEXT NOT NULL, subject TEXT, status TEXT NOT NULL,
        provider TEXT, provider_id TEXT, error TEXT, created_at BIGINT NOT NULL
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_promo_codes (
        code TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        applies_to TEXT NOT NULL DEFAULT 'any',
        max_redemptions INTEGER,
        redemptions INTEGER NOT NULL DEFAULT 0,
        expires_at BIGINT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        note TEXT,
        stripe_coupon_id TEXT,
        created_at BIGINT NOT NULL
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_promo_redemptions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        account_id TEXT NOT NULL,
        product TEXT NOT NULL,
        amount_off INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        UNIQUE (code, account_id)
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_id TEXT,
        anon TEXT,
        ref TEXT,
        report_id TEXT,
        props TEXT,
        ip TEXT,
        created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_events_name_time ON growth_engine_events (name, created_at)`);
    await client.query(`
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
        quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
        detail TEXT,
        cents DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_costs_time ON growth_engine_costs (created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_costs_account ON growth_engine_costs (account_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_move_log (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, report_id TEXT NOT NULL, handle TEXT, platform TEXT, category TEXT,
        move_key TEXT NOT NULL, done BOOLEAN NOT NULL, overall_at INTEGER, dims_at TEXT, plan_day INTEGER, created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_move_log_report ON growth_engine_move_log (report_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_move_outcomes (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, handle TEXT, platform TEXT, category TEXT, move_key TEXT NOT NULL,
        moves_done_together INTEGER NOT NULL, score_before INTEGER, score_after INTEGER, dims_before TEXT, dims_after TEXT,
        days INTEGER, from_report TEXT, to_report TEXT, created_at BIGINT NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_move_outcomes_key ON growth_engine_move_outcomes (category, platform, move_key)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_shares (
        share_id TEXT PRIMARY KEY, account_id TEXT, report_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, ref TEXT,
        views INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_plan_context (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        platform TEXT NOT NULL,
        context TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      )`);
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
    ? { userId: row.user_id, email: row.email, passwordHash: row.password_hash, companyName: row.company_name, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), emailPaused: !!row.email_paused, isBusiness: !!row.is_business, niche: row.niche || null, priceVariant: row.price_variant || null, refCode: row.ref_code || null, emailPrefs: (() => { try { return row.email_prefs ? (typeof row.email_prefs === "string" ? JSON.parse(row.email_prefs) : row.email_prefs) : null; } catch { return null; } })() }
    : null;
}
async function getUserByEmail(email) {
  return userRow((await q(`SELECT * FROM users WHERE email = $1`, [String(email).toLowerCase()])).rows[0]);
}
async function getUserById(userId) {
  return userRow((await q(`SELECT * FROM users WHERE user_id = $1`, [userId])).rows[0]);
}
async function setUserProfile(userId, { isBusiness, niche, priceVariant } = {}) {
  if (priceVariant !== undefined) await q(`UPDATE users SET price_variant = $1, updated_at = $2 WHERE user_id = $3`, [priceVariant || null, Date.now(), userId]);
  if (isBusiness !== undefined) await q(`UPDATE users SET is_business = $1, updated_at = $2 WHERE user_id = $3`, [!!isBusiness, Date.now(), userId]);
  if (niche !== undefined) await q(`UPDATE users SET niche = $1, updated_at = $2 WHERE user_id = $3`, [niche || null, Date.now(), userId]);
  return getUserById(userId);
}
async function listBusinessAccounts() {
  const users = (await q(`SELECT user_id, email, niche, created_at FROM users WHERE is_business = TRUE ORDER BY created_at DESC`)).rows.map((u) => ({ ...u, created_at: Number(u.created_at) }));
  const reports = (await q(`SELECT r.account_id, r.handle, r.platform, r.category, r.generated_at, r.report_body, u.email AS user_email FROM growth_engine_reports r LEFT JOIN users u ON u.user_id = r.account_id WHERE r.report_body LIKE '%"is_business_account":true%' ORDER BY r.generated_at DESC NULLS LAST`)).rows
    .map((r) => { const b = parseJson(r.report_body) || {}; return { account_id: r.account_id, email: b.email || r.user_email || null, handle: r.handle, platform: r.platform, category: r.category, overall: b.scores?.overall ?? null, generated_at: Number(r.generated_at) }; });
  return { users, reports };
}
async function setEmailPrefs(userId, prefs) { await q(`UPDATE users SET email_prefs = $1, updated_at = $2 WHERE user_id = $3`, [JSON.stringify(prefs || {}), Date.now(), userId]); return getUserById(userId); }
async function insertEmailLog(e) {
  await q(`INSERT INTO growth_engine_email_log (id, user_id, to_email, type, subject, status, provider, provider_id, error, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    ["em_" + uid(), e.userId || null, e.to, e.type, (e.subject || "").slice(0, 200), e.status, e.provider || null, e.providerId || null, e.error ? String(e.error).slice(0, 300) : null, Date.now()]);
}
async function listEmailLog(limit = 100) { return (await q(`SELECT * FROM growth_engine_email_log ORDER BY created_at DESC LIMIT $1`, [limit])).rows.map((r) => ({ ...r, created_at: Number(r.created_at) })); }
async function setEmailPaused(userId, paused) {
  await q(`UPDATE users SET email_paused = $1, updated_at = $2 WHERE user_id = $3`, [!!paused, Date.now(), userId]);
  return getUserById(userId);
}
async function isEmailPaused(email) {
  const u = await getUserByEmail(String(email || "").toLowerCase());
  return !!(u && u.emailPaused);
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

async function recordOutcome({ accountId, handle, platform, category, movesDone, scoreDelta, followerDelta, days }) {
  await q(`INSERT INTO growth_engine_outcomes (id, account_id, handle, platform, category, moves_done, score_delta, follower_delta, days, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    ["oc_" + uid(), accountId, String(handle).toLowerCase(), platform, category || null, movesDone, scoreDelta, followerDelta ?? null, days ?? null, Date.now()]);
}
async function getOutcomeSummary() {
  const r = await q(`SELECT CASE WHEN moves_done >= 3 THEN 'did_3_plus' WHEN moves_done >= 1 THEN 'did_some' ELSE 'did_none' END AS bucket,
    COUNT(*) AS n, AVG(score_delta) AS sd, AVG(follower_delta) AS fd FROM growth_engine_outcomes GROUP BY bucket`);
  const out = {};
  for (const row of r.rows) out[row.bucket] = { n: Number(row.n), avg_score_delta: +Number(row.sd).toFixed(1), avg_follower_delta: row.fd == null ? null : Math.round(Number(row.fd)) };
  return out;
}

async function getCachedProfile(platform, handle, maxAgeMs) {
  const r = await q(`SELECT data, fetched_at FROM growth_engine_profile_cache WHERE id = $1`, [`${platform}|${String(handle).toLowerCase()}`]);
  const row = r.rows[0];
  if (!row || Date.now() - Number(row.fetched_at) > maxAgeMs) return null;
  return { data: parseJson(row.data), fetchedAt: Number(row.fetched_at) };
}
async function putCachedProfile(platform, handle, data) {
  await q(`INSERT INTO growth_engine_profile_cache (id, platform, handle, data, fetched_at) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
    [`${platform}|${String(handle).toLowerCase()}`, platform, String(handle).toLowerCase(), JSON.stringify(data), Date.now()]);
}
const dayKey = () => new Date().toISOString().slice(0, 10);
async function getUsage(accountId, kind) {
  const r = await q(`SELECT count FROM growth_engine_usage WHERE id = $1`, [`${accountId}|${kind}|${dayKey()}`]);
  return Number(r.rows[0]?.count || 0);
}
async function bumpUsage(accountId, kind, n = 1) {
  const id = `${accountId}|${kind}|${dayKey()}`;
  const r = await q(`INSERT INTO growth_engine_usage (id, account_id, kind, day, count) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET count = growth_engine_usage.count + $5 RETURNING count`, [id, accountId, kind, dayKey(), n]);
  return Number(r.rows[0]?.count || n);
}

async function findFreeSnapshotForHandle(handle, platform) {
  const r = await q(`SELECT report_id, generated_at, created_at FROM growth_engine_reports
     WHERE tier = 'social_snapshot' AND lower(handle) = $1 AND platform = $2 ORDER BY created_at DESC LIMIT 1`, [String(handle).toLowerCase(), platform]);
  if (r.rows[0]) return { reportId: r.rows[0].report_id, generatedAt: Number(r.rows[0].generated_at || r.rows[0].created_at) };
  const j = await q(`SELECT job_id FROM growth_engine_jobs WHERE tier = 'social_snapshot' AND status IN ('queued','running')
     AND lower(input_params->>'handle') = $1 AND input_params->>'platform' = $2 ORDER BY created_at DESC LIMIT 1`, [String(handle).toLowerCase(), platform]);
  if (j.rows[0]) return { jobId: j.rows[0].job_id };
  return null;
}

async function adoptAnonymousReports(accountId, email) {
  const e = String(email).trim().toLowerCase();
  const now = Date.now();
  const jobs = await q(`SELECT job_id, result_payload FROM growth_engine_jobs WHERE account_id = 'demo-account' AND lower(input_params->>'email') = $1`, [e]);
  let adopted = 0;
  for (const row of jobs.rows) {
    await q(`UPDATE growth_engine_jobs SET account_id = $1, updated_at = $2 WHERE job_id = $3`, [accountId, now, row.job_id]);
    const rid = parseJson(row.result_payload)?.report_id;
    if (rid) { const u = await q(`UPDATE growth_engine_reports SET account_id = $1, updated_at = $2 WHERE report_id = $3 AND account_id = 'demo-account'`, [accountId, now, rid]); adopted += u.rowCount || 0; }
  }
  return { adopted };
}

// Free-tier quota: non-failed snapshot jobs for an email.
async function latestFreeSnapshotForEmail(email) {
  const r = await q(`SELECT result_payload, created_at FROM growth_engine_jobs WHERE tier = 'social_snapshot' AND status = 'complete' AND lower(input_params->>'email') = $1 ORDER BY created_at DESC LIMIT 1`, [String(email).trim().toLowerCase()]);
  const row = r.rows[0]; if (!row) return null;
  const p = parseJson(row.result_payload) || {}; return { reportId: p.report_id || null, generatedAt: Number(row.created_at) };
}
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
  if (reportBody && typeof reportBody === "object") reportBody.report_id = reportId;
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
      const body = parseJson(row.report_body) || {}; const sc = body.scores;
      return sc && Number.isFinite(sc.overall)
        ? { report_id: row.report_id, tier: row.tier, generated_at: Number(row.generated_at || row.created_at), overall: sc.overall, followers: body.business?.followers ?? null, dimensions: (sc.dimensions || []).map((d) => ({ label: d.label, score: d.score })) }
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
        cancelAt: row.cancel_at ? Number(row.cancel_at) : null, cancel_at: row.cancel_at ? Number(row.cancel_at) : null,
      }
    : null;
}
async function getEffectiveEntitlement(accountId) {
  const ent = await getOrCreateEntitlement(accountId);
  if (ent.cancelAt && ent.cancelAt <= Date.now() && ent.currentTier !== "social_snapshot") {
    await upgradeTier(accountId, "social_snapshot");
    await q(`UPDATE entitlements SET cancel_at = NULL, updated_at = $1 WHERE user_id = $2`, [Date.now(), accountId]);
    return getEntitlement(accountId);
  }
  return ent;
}
async function setCancelAt(accountId, cancelAt) {
  await getOrCreateEntitlement(accountId);
  await q(`UPDATE entitlements SET cancel_at = $1, updated_at = $2 WHERE user_id = $3`, [cancelAt || null, Date.now(), accountId]);
  return getEntitlement(accountId);
}
async function setBillingPeriod(accountId, start, end) {
  await getOrCreateEntitlement(accountId);
  await q(`UPDATE entitlements SET billing_period_start = $1, billing_period_end = $2, updated_at = $3 WHERE user_id = $4`, [start || null, end || null, Date.now(), accountId]);
  return getEntitlement(accountId);
}
async function createPasswordReset(userId, tokenHash, expiresAt) {
  await q(`DELETE FROM growth_engine_password_resets WHERE user_id = $1 OR expires_at < $2`, [userId, Date.now()]);
  await q(`INSERT INTO growth_engine_password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [tokenHash, userId, expiresAt]);
}
async function consumePasswordReset(tokenHash) {
  const r = await q(`SELECT user_id, expires_at, used_at FROM growth_engine_password_resets WHERE token_hash = $1`, [tokenHash]);
  const row = r.rows[0];
  if (!row || row.used_at || Number(row.expires_at) < Date.now()) return null;
  await q(`UPDATE growth_engine_password_resets SET used_at = $1 WHERE token_hash = $2`, [Date.now(), tokenHash]);
  return row.user_id;
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

async function deleteAccount(accountId) {
  const n = await q(`SELECT COUNT(*) AS n FROM growth_engine_reports WHERE account_id = $1`, [accountId]);
  await q(`DELETE FROM growth_engine_reports WHERE account_id = $1`, [accountId]);
  await q(`DELETE FROM growth_engine_jobs WHERE account_id = $1`, [accountId]);
  await q(`DELETE FROM growth_engine_tier_history WHERE account_id = $1`, [accountId]);
  await q(`DELETE FROM entitlements WHERE user_id = $1`, [accountId]);
  await q(`DELETE FROM users WHERE user_id = $1`, [accountId]);
  return { deleted: true, reports: Number(n.rows[0]?.n || 0) };
}

async function addWaitlist(email, platform) {
  await q(`INSERT INTO growth_engine_waitlist (id, email, platform, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [`${platform}|${email}`, email, platform, Date.now()]);
}

async function getPlanContext(accountId, handle, platform) {
  const r = await q(`SELECT context, updated_at FROM growth_engine_plan_context WHERE id = $1`, [`${accountId}|${platform}|${String(handle).toLowerCase()}`]);
  if (!r.rows.length) return null;
  try { return { ...JSON.parse(r.rows[0].context), updated_at: Number(r.rows[0].updated_at) }; } catch { return null; }
}
async function setPlanContext(accountId, handle, platform, context) {
  const { updated_at, ...ctx } = context || {};
  const now = Date.now();
  await q(`INSERT INTO growth_engine_plan_context (id, account_id, handle, platform, context, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET context = EXCLUDED.context, updated_at = EXCLUDED.updated_at`,
    [`${accountId}|${platform}|${String(handle).toLowerCase()}`, accountId, String(handle).toLowerCase(), platform, JSON.stringify(ctx), now]);
  return { ...ctx, updated_at: now };
}
async function listReportsForThumbCleanup(beforeTs, limit = 50) {
  const r = await q(`SELECT report_id, report_body FROM growth_engine_reports WHERE tier = 'social_snapshot' AND generated_at < $1 AND report_body LIKE '%"thumb_prefix":%' AND report_body NOT LIKE '%"thumbs_removed":true%' LIMIT $2`, [beforeTs, limit]);
  return r.rows.map((x) => { const b = parseJson(x.report_body) || {}; return { reportId: x.report_id, thumbPrefix: b.thumb_prefix || null }; });
}
async function listPaidReportsBetween(fromTs, toTs) {
  const r = await q(`SELECT * FROM growth_engine_reports WHERE tier <> 'social_snapshot' AND generated_at >= $1 AND generated_at <= $2 ORDER BY generated_at ASC`, [fromTs, toTs]);
  return r.rows.map(reportRow);
}


// ===================== ADMIN =====================
async function adminOverview() {
  const now = Date.now(), day = 86400000, today = dayKey();
  const usage = (await q(`SELECT kind, SUM(count) AS n FROM growth_engine_usage WHERE day = $1 GROUP BY kind`, [today])).rows;
  const u = Object.fromEntries(usage.map((r) => [r.kind, Number(r.n)]));
  const tiers = (await q(`SELECT current_tier, COUNT(*) AS n, SUM(CASE WHEN cancel_at IS NOT NULL THEN 1 ELSE 0 END) AS pending FROM entitlements GROUP BY current_tier`)).rows;
  const s7 = Number((await q(`SELECT COUNT(*) AS n FROM users WHERE created_at > $1`, [now - 7 * day])).rows[0].n);
  const s30 = Number((await q(`SELECT COUNT(*) AS n FROM users WHERE created_at > $1`, [now - 30 * day])).rows[0].n);
  const reports = (await q(`SELECT tier, COUNT(*) AS n FROM growth_engine_reports WHERE generated_at > $1 GROUP BY tier`, [now - day])).rows;
  const oneTime = Number((await q(`SELECT COUNT(*) AS n FROM growth_engine_reports WHERE report_body LIKE '%"one_time_unlock":{%'`)).rows[0].n);
  const jobs = (await q(`SELECT status, COUNT(*) AS n FROM growth_engine_jobs WHERE created_at > $1 GROUP BY status`, [now - day])).rows;
  const waitlist = (await q(`SELECT platform, COUNT(*) AS n FROM growth_engine_waitlist GROUP BY platform ORDER BY n DESC`)).rows;
  const users = Number((await q(`SELECT COUNT(*) AS n FROM users`)).rows[0].n);
  return {
    today: { free_scores: u.free_eval || 0, paid_runs: u.eval || 0, competitor_pulls: u.competitor || 0, jobs: Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)])), reports: Object.fromEntries(reports.map((r) => [r.tier, Number(r.n)])) },
    people: { users, signups_7d: s7, signups_30d: s30, tiers: tiers.map((t) => ({ tier: t.current_tier, n: Number(t.n), cancel_pending: Number(t.pending) })), one_time_buyers: oneTime, waitlist: waitlist.map((w) => ({ platform: w.platform, n: Number(w.n) })) },
  };
}
async function adminRecentReports(limit = 50) {
  const r = await q(`SELECT report_id, account_id, tier, handle, platform, category, generated_at, report_body FROM growth_engine_reports ORDER BY generated_at DESC NULLS LAST LIMIT $1`, [limit]);
  return r.rows.map((x) => { const b = parseJson(x.report_body) || {}; return { report_id: x.report_id, account_id: x.account_id, tier: x.tier, handle: x.handle, platform: x.platform, category: x.category, generated_at: Number(x.generated_at), overall: b.scores?.overall ?? null, email: b.email || null, one_time: !!b.one_time_unlock, partial: !!b.plan_incomplete }; });
}
async function adminFailedJobs(limit = 30) {
  const r = await q(`SELECT job_id, account_id, tier, stage, error, input_params, created_at FROM growth_engine_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows.map((j) => { const p = parseJson(j.input_params) || {}; return { job_id: j.job_id, account_id: j.account_id, tier: j.tier, stage: j.stage, error: j.error, handle: p.handle, platform: p.platform, email: p.email || null, created_at: Number(j.created_at) }; });
}
async function adminFindAccount(query) {
  const s = String(query || "").trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  let user = await getUserByEmail(s);
  if (!user) {
    const r = await q(`SELECT account_id FROM growth_engine_reports WHERE lower(handle) = $1 AND account_id <> 'demo-account' ORDER BY generated_at DESC NULLS LAST LIMIT 1`, [s]);
    if (r.rows[0]) user = await getUserById(r.rows[0].account_id);
  }
  if (!user) return null;
  const ent = await getEffectiveEntitlement(user.userId);
  const reports = (await listReportsByAccount(user.userId)).map((x) => ({ report_id: x.reportId, tier: x.tier, handle: x.business?.handle, platform: x.business?.platform, generated_at: x.generatedAt, overall: x.reportBody?.scores?.overall ?? null, moves_done: Object.keys(x.reportBody?.moves_done || {}).length, checkins: x.reportBody?.checkins || null, emails_sent: x.reportBody?.emails_sent || [], one_time: !!x.reportBody?.one_time_unlock }));
  const ctx = (await q(`SELECT handle, platform, context, updated_at FROM growth_engine_plan_context WHERE account_id = $1`, [user.userId])).rows.map((c) => ({ handle: c.handle, platform: c.platform, ...(parseJson(c.context) || {}), updated_at: Number(c.updated_at) }));
  const usage = (await q(`SELECT kind, count FROM growth_engine_usage WHERE account_id = $1 AND day = $2`, [user.userId, dayKey()])).rows;
  return { user: { user_id: user.userId, email: user.email, created_at: user.createdAt, email_paused: !!user.emailPaused }, entitlement: { tier: ent.currentTier, cancel_at: ent.cancelAt || null, period_end: ent.billingPeriodEnd || null }, reports, plan_contexts: ctx, usage_today: Object.fromEntries(usage.map((x) => [x.kind, Number(x.count)])) };
}


// ===================== PROMO CODES =====================
const promoRow = (r) => r ? { ...r, max_redemptions: r.max_redemptions == null ? null : Number(r.max_redemptions), redemptions: Number(r.redemptions || 0), expires_at: r.expires_at == null ? null : Number(r.expires_at), active: !!r.active, value: Number(r.value || 0), created_at: Number(r.created_at) } : null;
async function createPromo(p) {
  await q(`INSERT INTO growth_engine_promo_codes (code, kind, value, applies_to, max_redemptions, redemptions, expires_at, active, note, stripe_coupon_id, created_at) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10)`,
    [p.code, p.kind, p.value, p.applies_to, p.max_redemptions, p.expires_at, !!p.active, p.note || null, p.stripe_coupon_id || null, Date.now()]);
  return getPromo(p.code);
}
async function getPromo(code) { return promoRow((await q(`SELECT * FROM growth_engine_promo_codes WHERE code = $1`, [String(code || "").toUpperCase()])).rows[0]); }
async function listPromos() { return (await q(`SELECT * FROM growth_engine_promo_codes ORDER BY created_at DESC`)).rows.map(promoRow); }
async function setPromoActive(code, active) { await q(`UPDATE growth_engine_promo_codes SET active = $1 WHERE code = $2`, [!!active, String(code).toUpperCase()]); return getPromo(code); }
async function hasRedeemed(code, accountId) { return (await q(`SELECT 1 FROM growth_engine_promo_redemptions WHERE code = $1 AND account_id = $2`, [String(code).toUpperCase(), accountId])).rows.length > 0; }
async function redeemPromo(code, accountId, product, amountOff) {
  const c = String(code).toUpperCase();
  await q(`INSERT INTO growth_engine_promo_redemptions (id, code, account_id, product, amount_off, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, ["pr_" + uid(), c, accountId, product, Number(amountOff) || 0, Date.now()]);
  await q(`UPDATE growth_engine_promo_codes SET redemptions = redemptions + 1 WHERE code = $1`, [c]);
  return getPromo(c);
}
async function listRedemptions(code, limit = 100) {
  const r = await q(`SELECT r.*, u.email FROM growth_engine_promo_redemptions r LEFT JOIN users u ON u.user_id = r.account_id WHERE r.code = $1 ORDER BY r.created_at DESC LIMIT $2`, [String(code).toUpperCase(), limit]);
  return r.rows.map((x) => ({ ...x, amount_off: Number(x.amount_off), created_at: Number(x.created_at) }));
}


// ===================== EVENTS =====================
async function insertEvent(e) {
  await q(`INSERT INTO growth_engine_events (id, name, account_id, anon, ref, report_id, props, ip, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    ["ev_" + uid(), e.name, e.accountId, e.anon, e.ref, e.reportId, e.props, e.ip, Date.now()]);
}
async function eventFunnel(sinceTs, names) {
  const out = {};
  for (const n of names) {
    const r = (await q(`SELECT COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors, COUNT(*) AS total FROM growth_engine_events WHERE name = $1 AND created_at >= $2`, [n, sinceTs])).rows[0];
    out[n] = { actors: Number(r.actors || 0), total: Number(r.total || 0) };
  }
  const byRef = (await q(`SELECT ref, name, COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors FROM growth_engine_events WHERE ref IS NOT NULL AND created_at >= $1 AND name IN ('evaluate_started','signup','subscribe') GROUP BY ref, name`, [sinceTs])).rows;
  const refs = {};
  for (const r of byRef) (refs[r.ref] ||= {})[r.name] = Number(r.actors);
  return { steps: out, by_ref: refs };
}
async function variantFunnel(sinceTs) {
  const r = await q(`SELECT props::json->>'variant' AS v, name, COUNT(DISTINCT COALESCE(account_id, anon, ip)) AS actors, SUM(COALESCE((props::json->>'amount_cents')::numeric, 0)) AS cents FROM growth_engine_events WHERE created_at >= $1 AND name IN ('pricing_viewed','subscribe','unlock') AND props IS NOT NULL AND props::json->>'variant' IS NOT NULL GROUP BY v, name`, [sinceTs]);
  const out = {};
  for (const x of r.rows) { (out[x.v] ||= { pricing_viewed: 0, subscribe: 0, unlock: 0, revenue_cents: 0 })[x.name] = Number(x.actors); if (x.name !== "pricing_viewed") out[x.v].revenue_cents += Number(x.cents) || 0; }
  return out;
}
async function paidRetention() {
  const now = Date.now(), d = 86400000;
  const cohort = (await q(`SELECT DISTINCT account_id FROM growth_engine_events WHERE name = 'subscribe' AND created_at BETWEEN $1 AND $2 AND account_id IS NOT NULL`, [now - 60 * d, now - 30 * d])).rows.map((r) => r.account_id);
  let retained = 0;
  for (const id of cohort) { const e = (await q(`SELECT current_tier, cancel_at FROM entitlements WHERE user_id = $1`, [id])).rows[0] || {}; if (e.current_tier && e.current_tier !== "social_snapshot" && (!e.cancel_at || Number(e.cancel_at) > now)) retained++; }
  return { cohort: cohort.length, retained, rate: cohort.length ? retained / cohort.length : null };
}


// ===================== COSTS =====================
async function insertCost(c) {
  await q(`INSERT INTO growth_engine_costs (id, account_id, job_id, report_id, feature, kind, provider, model, label, quantity, detail, cents, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    ["c_" + uid(), c.accountId, c.jobId, c.reportId, c.feature, c.kind, c.provider || null, c.model || null, c.label || null, Number(c.quantity) || 0, c.detail ? JSON.stringify(c.detail) : null, Number(c.cents) || 0, Date.now()]);
}
async function attachReportToCosts(jobId, reportId) { await q(`UPDATE growth_engine_costs SET report_id = $1 WHERE job_id = $2 AND report_id IS NULL`, [reportId, jobId]); }
async function adminCosts(sinceTs, limit = 50) {
  const by = async (col) => (await q(`SELECT ${col} AS k, SUM(cents) AS cents, COUNT(*) AS n, SUM(quantity) AS qty FROM growth_engine_costs WHERE created_at >= $1 GROUP BY ${col} ORDER BY cents DESC`, [sinceTs])).rows.map((r) => ({ key: r.k, cents: Number(r.cents), n: Number(r.n), quantity: Number(r.qty) }));
  const total = Number((await q(`SELECT COALESCE(SUM(cents), 0) AS c FROM growth_engine_costs WHERE created_at >= $1`, [sinceTs])).rows[0].c);
  const perReport = (await q(`SELECT AVG(c) AS avg FROM (SELECT SUM(cents) AS c FROM growth_engine_costs WHERE created_at >= $1 AND report_id IS NOT NULL GROUP BY report_id) t`, [sinceTs])).rows[0];
  const users = (await q(`SELECT c.account_id, u.email, SUM(c.cents) AS cents, COUNT(DISTINCT c.report_id) AS reports FROM growth_engine_costs c LEFT JOIN users u ON u.user_id = c.account_id WHERE c.created_at >= $1 AND c.account_id IS NOT NULL GROUP BY c.account_id, u.email ORDER BY cents DESC LIMIT $2`, [sinceTs, limit])).rows;
  let revenue = [];
  try { revenue = (await q(`SELECT account_id, SUM((props::json->>'amount_cents')::numeric) AS cents FROM growth_engine_events WHERE name IN ('subscribe','unlock') AND account_id IS NOT NULL AND props IS NOT NULL GROUP BY account_id`)).rows; }
  catch (e) { console.warn("[Costs] revenue query failed:", e.message); }
  const rev = Object.fromEntries(revenue.map((r) => [r.account_id, Number(r.cents) || 0]));
  return { total_cents: total, avg_cents_per_report: Number(perReport?.avg || 0), by_kind: await by("kind"), by_provider: await by("provider"), by_feature: await by("feature"), by_model: await by("model"),
    users: users.map((u) => ({ account_id: u.account_id, email: u.email, cost_cents: Number(u.cents), reports: Number(u.reports), revenue_cents: rev[u.account_id] || 0 })) };
}


// ===================== OUTCOMES (spec 1.15) =====================
async function logMove({ accountId, reportId, handle, platform, category, moveKey, done, overall, dims, planDay }) {
  await q(`INSERT INTO growth_engine_move_log (id, account_id, report_id, handle, platform, category, move_key, done, overall_at, dims_at, plan_day, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    ["ml_" + uid(), accountId, reportId, handle || null, platform || null, category || null, moveKey, !!done, overall ?? null, dims ? JSON.stringify(dims) : null, planDay ?? null, Date.now()]);
}
async function recordMoveOutcomes({ accountId, handle, platform, category, moveKeys, before, after, days, fromReport, toReport }) {
  for (const k of moveKeys) {
    await q(`INSERT INTO growth_engine_move_outcomes (id, account_id, handle, platform, category, move_key, moves_done_together, score_before, score_after, dims_before, dims_after, days, from_report, to_report, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      ["mo_" + uid(), accountId, handle || null, platform || null, category || null, k, moveKeys.length, before.overall ?? null, after.overall ?? null, JSON.stringify(before.dims || {}), JSON.stringify(after.dims || {}), days ?? null, fromReport || null, toReport || null, Date.now()]);
  }
}
async function moveOutcomeSummary({ category = null, platform = null } = {}) {
  const where = []; const params = [];
  if (category) { params.push(category); where.push(`category = $${params.length}`); }
  if (platform) { params.push(platform); where.push(`platform = $${params.length}`); }
  const r = await q(`SELECT category, platform, move_key, COUNT(*) AS n, AVG(score_after - score_before) AS avg_delta, AVG(moves_done_together) AS avg_together FROM growth_engine_move_outcomes ${where.length ? "WHERE " + where.join(" AND ") : ""} GROUP BY category, platform, move_key ORDER BY n DESC, avg_delta DESC`, params);
  return r.rows.map((x) => ({ ...x, n: Number(x.n), avg_delta: Number(x.avg_delta), avg_together: Number(x.avg_together) }));
}


// ===================== SHARE CARDS (spec 1.7) =====================
async function createShare({ accountId, reportId, kind, data, ref }) {
  const shareId = crypto.randomBytes(6).toString("base64url");
  await q(`INSERT INTO growth_engine_shares (share_id, account_id, report_id, kind, data, ref, views, created_at) VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`, [shareId, accountId || null, reportId, kind, JSON.stringify(data), ref || null, Date.now()]);
  return getShare(shareId);
}
async function getShare(shareId) {
  const r = (await q(`SELECT * FROM growth_engine_shares WHERE share_id = $1`, [shareId])).rows[0];
  return r ? { shareId: r.share_id, accountId: r.account_id, reportId: r.report_id, kind: r.kind, data: parseJson(r.data) || {}, ref: r.ref, views: Number(r.views), createdAt: Number(r.created_at) } : null;
}
async function bumpShareViews(shareId) { await q(`UPDATE growth_engine_shares SET views = views + 1 WHERE share_id = $1`, [shareId]); }


// ===================== REFERRALS (spec 1.8) =====================
const REF_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newRefCode() { const b = crypto.randomBytes(8); let s = ""; for (let i = 0; i < 8; i++) s += REF_ALPHABET[b[i] % REF_ALPHABET.length]; return s; }
async function ensureRefCode(userId) {
  const u = await getUserById(userId); if (!u) return null;
  if (u.refCode) return u.refCode;
  for (let i = 0; i < 5; i++) { try { await q(`UPDATE users SET ref_code = $1 WHERE user_id = $2 AND ref_code IS NULL`, [newRefCode(), userId]); return (await getUserById(userId)).refCode; } catch { /* collision */ } }
  return null;
}
async function getUserByRefCode(code) { const r = (await q(`SELECT user_id FROM users WHERE ref_code = $1`, [String(code || "").toLowerCase()])).rows[0]; return r ? getUserById(r.user_id) : null; }
async function recordReferralSignup({ refCode, referrerId, referredId }) {
  if (!referrerId || !referredId || referrerId === referredId) return null;
  try { await q(`INSERT INTO growth_engine_referrals (id, ref_code, referrer_id, referred_id, signed_up_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, ["rf_" + uid(), refCode, referrerId, referredId, Date.now(), Date.now()]); return true; } catch { return null; }
}
async function recordReferralPayment({ referredId, cents, product }) {
  await q(`UPDATE growth_engine_referrals SET first_paid_at = $1, first_paid_cents = $2, first_paid_product = $3, payout_status = CASE WHEN payout_status = 'none' THEN 'pending' ELSE payout_status END WHERE referred_id = $4 AND first_paid_at IS NULL`, [Date.now(), Number(cents) || 0, product || null, referredId]);
}
async function referralStats(referrerId) {
  const r = (await q(`SELECT COUNT(*) AS signed_up, SUM(CASE WHEN first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid, SUM(COALESCE(first_paid_cents, 0)) AS cents FROM growth_engine_referrals WHERE referrer_id = $1`, [referrerId])).rows[0] || {};
  return { signed_up: Number(r.signed_up || 0), paid: Number(r.paid || 0), paid_cents: Number(r.cents || 0) };
}
async function adminReferrals(limit = 50) {
  const r = await q(`SELECT r.referrer_id, u.email, MIN(r.ref_code) AS ref_code, COUNT(*) AS signed_up, SUM(CASE WHEN r.first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid, SUM(COALESCE(r.first_paid_cents, 0)) AS cents FROM growth_engine_referrals r LEFT JOIN users u ON u.user_id = r.referrer_id GROUP BY r.referrer_id, u.email ORDER BY paid DESC, signed_up DESC LIMIT $1`, [limit]);
  return r.rows.map((x) => ({ referrer_id: x.referrer_id, email: x.email, ref_code: x.ref_code, signed_up: Number(x.signed_up), paid: Number(x.paid), paid_cents: Number(x.cents) }));
}

// ===================== CATEGORY BASELINES =====================

async function listBaselines() {
  const r = await q(`SELECT category, platform, handle, overall, dimensions, created_at FROM growth_engine_baselines ORDER BY category, platform, handle`);
  return r.rows.map((x) => { const dims = parseJson(x.dimensions) || {}; return { category: x.category, platform: x.platform, handle: x.handle, overall: Number(x.overall), dimensions: Object.entries(dims).map(([label, score]) => ({ label, score })), created_at: Number(x.created_at) }; });
}
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
async function getCategoryBaseline(category, { minN = Number(process.env.BASELINE_MIN_N || 10), platform = null } = {}) {
  const r = platform
    ? await q(`SELECT overall, dimensions FROM growth_engine_baselines WHERE category = $1 AND platform = $2`, [category, platform])
    : await q(`SELECT overall, dimensions FROM growth_engine_baselines WHERE category = $1`, [category]);
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
  const r = await q(`SELECT category, platform, COUNT(*) AS n FROM growth_engine_baselines GROUP BY category, platform`);
  const by_category = {}; const by_platform = {};
  let total = 0;
  for (const row of r.rows) { by_category[row.category] = (by_category[row.category] || 0) + Number(row.n); by_platform[`${row.category}:${row.platform}`] = Number(row.n); total += Number(row.n); }
  return { total, by_category, by_platform };
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
  setEmailPaused,
  isEmailPaused,
  setEmailPrefs,
  insertEmailLog,
  listEmailLog,
  setUserProfile,
  listBusinessAccounts,
  // Jobs
  createJob,
  getJob,
  updateJobStatus,
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
  getEffectiveEntitlement,
  adminOverview,
  adminRecentReports,
  adminFailedJobs,
  adminFindAccount,
  insertEvent, eventFunnel, paidRetention, variantFunnel,
  insertCost, adminCosts, attachReportToCosts,
  logMove, recordMoveOutcomes, moveOutcomeSummary,
  createShare, getShare, bumpShareViews,
  ensureRefCode, getUserByRefCode, recordReferralSignup, recordReferralPayment, referralStats, adminReferrals,
  createPromo, getPromo, listPromos, setPromoActive, hasRedeemed, redeemPromo, listRedemptions,
  setCancelAt,
  setBillingPeriod,
  createPasswordReset,
  consumePasswordReset,
  upgradeTier,
  updateEntitlement,
  getTierHistory,
  // Baselines
  recordBaseline,
  getCategoryBaseline,
  getBaselineSummary,
  listBaselines,
  createBaseline,
  getBaselineStats,
};
