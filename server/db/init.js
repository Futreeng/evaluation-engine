const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

// Database Initialization
// Sets up SQLite database with schema on first run
// Provides query helper functions

class Database {
  constructor(dbPath = "./server/data/convergence.db") {
    this.dbPath = dbPath;
    this.db = null;
  }

  // Initialize database: create connection and run schema
  async init() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Create/open database
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) return reject(err);

        console.log(`[DB] Connected to ${this.dbPath}`);

        // Run schema
        this.runSchema()
          .then(() => {
            console.log("[DB] Schema initialized");
            resolve(this);
          })
          .catch(reject);
      });
    });
  }

  // Read and execute schema.sql
  async runSchema() {
    return new Promise((resolve, reject) => {
      const schemaPath = path.join(__dirname, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf8");

      this.db.exec(schema, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Run a single SQL statement with parameters
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  // Get a single row
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  // Get all matching rows
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Execute callback-based function (for multiple statements)
  exec(sql, callback) {
    this.db.exec(sql, callback);
  }

  // Close database connection
  close() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Helper: Create user
  async createUser(email, passwordHash, tier = "free") {
    const { v4: uid } = require("uuid");
    const id = uid();
    await this.run(
      `INSERT INTO users (id, email, passwordHash, tier) VALUES (?, ?, ?, ?)`,
      [id, email, passwordHash, tier]
    );
    return { id, email, tier };
  }

  // Helper: Find user by email
  async findUserByEmail(email) {
    return this.get(`SELECT * FROM users WHERE email = ?`, [email]);
  }

  // Helper: Find user by ID
  async findUserById(id) {
    return this.get(`SELECT * FROM users WHERE id = ?`, [id]);
  }

  // Helper: Create social profile
  async createProfile(userId, handle, platform, category, businessName = null) {
    const { v4: uid } = require("uuid");
    const id = uid();
    await this.run(
      `INSERT INTO socialProfiles (id, userId, handle, platform, category, businessName)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, handle, platform, category, businessName]
    );
    return { id, userId, handle, platform, category, businessName };
  }

  // Helper: Create job
  async createJob(userId, type, profileId, inputJson) {
    const { v4: uid } = require("uuid");
    const id = uid();
    await this.run(
      `INSERT INTO jobs (id, userId, type, status, profileId, inputJson)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, type, "queued", profileId, inputJson]
    );
    return { id, status: "queued" };
  }

  // Helper: Get job by ID
  async getJob(jobId) {
    const job = await this.get(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
    if (job && job.inputJson) job.inputJson = JSON.parse(job.inputJson);
    if (job && job.resultJson) job.resultJson = JSON.parse(job.resultJson);
    return job;
  }

  // Helper: Update job with result
  async completeJob(jobId, resultJson, error = null) {
    const status = error ? "failed" : "complete";
    await this.run(
      `UPDATE jobs SET status = ?, resultJson = ?, error = ?, completedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, resultJson, error, jobId]
    );
    return { jobId, status };
  }

  // Helper: Save audit
  async saveAudit(profileId, jobId, overallScore, scoresJson, growthPathJson) {
    const { v4: uid } = require("uuid");
    const id = uid();
    await this.run(
      `INSERT INTO audits (id, profileId, jobId, overallScore, scoresJson, growthPathJson, auditedAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, profileId, jobId, overallScore, scoresJson, growthPathJson]
    );
    return { id, profileId, jobId, overallScore };
  }

  // Health check
  async health() {
    try {
      await this.get("SELECT 1");
      return { ok: true, status: "connected" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = Database;
