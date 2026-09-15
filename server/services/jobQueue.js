const { v4: uid } = require("uuid");

// Job Queue Service for Futreeng Growth Engine
// Manages async audit processing, refresh, competitor analysis jobs
// Uses in-memory queue (MVP); upgrade to Bull + Redis for production

class JobQueue {
  constructor(db, auditAnalyzer = null) {
    this.db = db;
    this.auditAnalyzer = auditAnalyzer;
    this.queue = [];
    this.processing = false;
  }

  // Set audit analyzer (can be called after construction)
  setAuditAnalyzer(auditAnalyzer) {
    this.auditAnalyzer = auditAnalyzer;
  }

  // Create and queue a new job
  async createJob(userId, type, profileId, input) {
    const jobId = uid();
    const inputJson = JSON.stringify(input);

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO jobs (id, userId, type, status, profileId, inputJson, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [jobId, userId, type, "queued", profileId, inputJson],
        function(err) {
          if (err) return reject(err);

          // Add to in-memory queue
          this.queue.push({ jobId, userId, type, profileId, input });
          this.processQueue();

          resolve({ jobId, status: "queued" });
        }.bind(this)
      );
    });
  }

  // Get job status
  async getJobStatus(jobId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM jobs WHERE id = ?`,
        [jobId],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);

          resolve({
            jobId: row.id,
            status: row.status,
            result: row.resultJson ? JSON.parse(row.resultJson) : null,
            error: row.error,
            createdAt: row.createdAt,
            completedAt: row.completedAt,
          });
        }
      );
    });
  }

  // Update job with result
  async completeJob(jobId, result, error = null) {
    const resultJson = result ? JSON.stringify(result) : null;
    const status = error ? "failed" : "complete";

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE jobs
         SET status = ?, resultJson = ?, error = ?, completedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [status, resultJson, error, jobId],
        function(err) {
          if (err) reject(err);
          else resolve({ jobId, status });
        }
      );
    });
  }

  // Process queue (FIFO)
  processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const job = this.queue.shift();

    this.executeJob(job)
      .then(() => {
        this.processing = false;
        setImmediate(() => this.processQueue());
      })
      .catch((err) => {
        console.error("Job error:", err);
        this.completeJob(job.jobId, null, err.message);
        this.processing = false;
        setImmediate(() => this.processQueue());
      });
  }

  // Execute a single job (calls analyzer)
  async executeJob(job) {
    // Mark as processing
    await this.updateJobStatus(job.jobId, "processing");

    // Dispatch based on type
    switch (job.type) {
      case "audit":
        return this.runAudit(job);
      case "refresh":
        return this.runRefresh(job);
      case "competitor_analysis":
        return this.runCompetitorAnalysis(job);
      case "reconciliation":
        return this.runReconciliation(job);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  // Audit analysis (calls auditAnalyzer which fetches data and runs analysis)
  async runAudit(job) {
    try {
      // auditAnalyzer is injected from outside
      // It will fetch social profile data and run scoring
      if (!this.auditAnalyzer) {
        throw new Error("Audit analyzer not initialized");
      }

      const result = await this.auditAnalyzer.analyze(job.userId, job.input);
      const resultJson = JSON.stringify(result);
      await this.completeJob(job.jobId, resultJson);
    } catch (err) {
      console.error(`Audit job ${job.jobId} failed:`, err);
      await this.completeJob(job.jobId, null, err.message);
    }
  }

  // Refresh existing audit
  async runRefresh(job) {
    console.log(`Refresh job: ${job.jobId} for profile ${job.profileId}`);
    // Similar to audit but uses cached data
    // TODO: implement refresh logic
  }

  // Competitor analysis
  async runCompetitorAnalysis(job) {
    console.log(`Competitor analysis job: ${job.jobId}`);
    // TODO: implement competitor analysis
  }

  // Business reconciliation
  async runReconciliation(job) {
    console.log(`Reconciliation job: ${job.jobId}`);
    // TODO: implement reconciliation
  }

  // Update job status without result
  updateJobStatus(jobId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE jobs SET status = ? WHERE id = ?`,
        [status, jobId],
        function(err) {
          if (err) reject(err);
          else resolve({ jobId, status });
        }
      );
    });
  }
}

module.exports = JobQueue;
