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
    db = new SQL.Database();
    initSchema();
    saveDb();
  }

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
    createdAt: row[columns.indexOf("created_at")],
    updatedAt: row[columns.indexOf("updated_at")],
  };
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
  };
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
  upgradeTier,
  getTierHistory,
  // Users
  createUser,
  getUserByEmail,
  getUserById,
  updateUserPassword,
};
