const { Pool } = require('pg');
const crypto = require('crypto');

let pool = null;

async function initDb() {
  if (pool) return;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('[Growth Engine DB] Unexpected error on idle client', err);
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('[Growth Engine DB] PostgreSQL connected');
  } finally {
    client.release();
  }

  await initSchema();
  return pool;
}

async function initSchema() {
  const client = await pool.connect();
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        company_name TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    // Growth Engine Jobs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_jobs (
        job_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        input_params JSONB NOT NULL,
        result_payload JSONB,
        error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_account ON growth_engine_jobs (account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON growth_engine_jobs (status)`);

    // Reports table (persists generated reports)
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_reports (
        report_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        platform TEXT NOT NULL,
        category TEXT NOT NULL,
        report_body JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_account ON growth_engine_reports (account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_created ON growth_engine_reports (created_at DESC)`);

    // Category baselines (for benchmarking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_engine_baselines (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        overall INTEGER NOT NULL,
        dimensions JSONB NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_baselines_cat ON growth_engine_baselines (category, platform)`);

    // Entitlements (subscription tiers)
    await client.query(`
      CREATE TABLE IF NOT EXISTS entitlements (
        user_id TEXT PRIMARY KEY,
        current_tier TEXT NOT NULL DEFAULT 'free',
        tier_start_date BIGINT NOT NULL,
        billing_period_start BIGINT,
        billing_period_end BIGINT,
        stripe_subscription_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    console.log('[Growth Engine DB] Schema initialized');
  } finally {
    client.release();
  }
}

// ===================== Users =====================

async function createUser(email, passwordHash, companyName) {
  const client = await pool.connect();
  try {
    const userId = `user_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    await client.query(
      `INSERT INTO users (user_id, email, password_hash, company_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, passwordHash, companyName, now, now]
    );
    return { userId, email, companyName };
  } finally {
    client.release();
  }
}

async function getUserByEmail(email) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getUserById(userId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM users WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

// ===================== Jobs =====================

async function createJob(accountId, jobType, inputParams) {
  const client = await pool.connect();
  try {
    const jobId = `job_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    await client.query(
      `INSERT INTO growth_engine_jobs (job_id, account_id, tier, status, input_params, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [jobId, accountId, 'free', 'queued', JSON.stringify(inputParams), now, now]
    );
    return { jobId, status: 'queued' };
  } finally {
    client.release();
  }
}

async function getJob(jobId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM growth_engine_jobs WHERE job_id = $1`,
      [jobId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function updateJobStatus(jobId, status, stage = null, resultPayload = null, error = null) {
  const client = await pool.connect();
  try {
    const now = Date.now();
    await client.query(
      `UPDATE growth_engine_jobs
       SET status = $1, stage = $2, result_payload = $3, error = $4, updated_at = $5
       WHERE job_id = $6`,
      [status, stage, resultPayload ? JSON.stringify(resultPayload) : null, error, now, jobId]
    );
  } finally {
    client.release();
  }
}

// ===================== Reports =====================

async function createReport(accountId, jobId, handle, platform, category, reportBody) {
  const client = await pool.connect();
  try {
    const reportId = `report_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    await client.query(
      `INSERT INTO growth_engine_reports (report_id, account_id, job_id, handle, platform, category, report_body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [reportId, accountId, jobId, handle, platform, category, JSON.stringify(reportBody), now, now]
    );
    return { reportId, created_at: now };
  } finally {
    client.release();
  }
}

async function getReport(reportId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM growth_engine_reports WHERE report_id = $1`,
      [reportId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      report_body: typeof row.report_body === 'string' ? JSON.parse(row.report_body) : row.report_body,
    };
  } finally {
    client.release();
  }
}

async function listReportsByAccount(accountId, limit = 50) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM growth_engine_reports
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    );
    return result.rows.map(row => ({
      ...row,
      report_body: typeof row.report_body === 'string' ? JSON.parse(row.report_body) : row.report_body,
    }));
  } finally {
    client.release();
  }
}

// ===================== Entitlements (Subscriptions) =====================

async function getOrCreateEntitlement(userId) {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT * FROM entitlements WHERE user_id = $1`,
      [userId]
    );
    if (existing.rows.length) return existing.rows[0];

    const now = Date.now();
    await client.query(
      `INSERT INTO entitlements (user_id, current_tier, tier_start_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'free', now, now, now]
    );
    return { user_id: userId, current_tier: 'free', tier_start_date: now };
  } finally {
    client.release();
  }
}

async function updateEntitlement(userId, tier, stripeSubscriptionId = null) {
  const client = await pool.connect();
  try {
    const now = Date.now();
    const billingPeriodStart = now;
    const billingPeriodEnd = now + (30 * 24 * 60 * 60 * 1000); // 30 days
    await client.query(
      `UPDATE entitlements
       SET current_tier = $1, stripe_subscription_id = $2,
           billing_period_start = $3, billing_period_end = $4, updated_at = $5
       WHERE user_id = $6`,
      [tier, stripeSubscriptionId, billingPeriodStart, billingPeriodEnd, now, userId]
    );
  } finally {
    client.release();
  }
}

async function getEntitlement(userId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM entitlements WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

// ===================== Baselines =====================

async function createBaseline(category, platform, handle, overall, dimensions) {
  const client = await pool.connect();
  try {
    const id = `baseline_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    await client.query(
      `INSERT INTO growth_engine_baselines (id, category, platform, handle, overall, dimensions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, category, platform, handle, overall, JSON.stringify(dimensions), now]
    );
  } finally {
    client.release();
  }
}

async function getBaselineStats(category, platform) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT AVG(overall) as avg_overall, COUNT(*) as count
       FROM growth_engine_baselines
       WHERE category = $1 AND platform = $2`,
      [category, platform]
    );
    return result.rows[0] || { avg_overall: null, count: 0 };
  } finally {
    client.release();
  }
}

module.exports = {
  initDb,
  // Users
  createUser,
  getUserByEmail,
  getUserById,
  // Jobs
  createJob,
  getJob,
  updateJobStatus,
  // Reports
  createReport,
  getReport,
  listReportsByAccount,
  // Entitlements
  getOrCreateEntitlement,
  updateEntitlement,
  getEntitlement,
  // Baselines
  createBaseline,
  getBaselineStats,
};
