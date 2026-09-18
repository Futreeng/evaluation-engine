/**
 * Growth Engine Job Queue
 *
 * Simple, dependency-free job queue using Node.js Worker Threads.
 * - No external services (Redis, RabbitMQ) required
 * - Processes jobs in background workers
 * - Persists to database for durability
 * - Matches project's no-native-deps philosophy
 */

const { Worker } = require("worker_threads");
const path = require("path");
const geDb = require("./growth_engine_db");
const { saveReportAsMarkdown } = require("./report_saver");

class JobQueue {
  constructor(numWorkers = 2) {
    this.numWorkers = numWorkers;
    this.workers = [];
    this.isRunning = false;
    this.processingJobs = new Set();
  }

  async start() {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`[JobQueue] Starting with ${this.numWorkers} workers`);

    // Start polling for jobs
    this.pollInterval = setInterval(() => this.pollAndProcess(), 2000);

    return this;
  }

  async stop() {
    if (!this.isRunning) return;

    clearInterval(this.pollInterval);
    this.isRunning = false;
    console.log("[JobQueue] Stopped");
  }

  async pollAndProcess() {
    if (!this.isRunning || this.processingJobs.size >= this.numWorkers) {
      return;
    }

    try {
      // Simple approach: in production, add a proper database query for queued jobs
      // For now, jobs are processed via fire-and-forget in the API route
    } catch (err) {
      console.error("[JobQueue] Error in poll loop:", err.message);
    }
  }

  async processJob(jobId, accountId, tier, inputParams) {
    if (this.processingJobs.has(jobId)) {
      console.log(`[JobQueue] Job ${jobId} already processing`);
      return;
    }

    this.processingJobs.add(jobId);

    try {
      console.log(`[JobQueue] Processing job ${jobId} (${tier})`);

      // Update to running
      await geDb.updateJobStatus(jobId, "running", { stage: "evaluating" });

      // Route to evaluator (in-process for now; could use Worker Threads in future)
      const evaluator = require("./growth_engine_evaluator");
      let reportBody;

      if (tier === "social_snapshot") {
        reportBody = await evaluator.evaluateTier0(accountId, inputParams);
      } else if (tier === "growth_plan") {
        reportBody = await evaluator.evaluateTier1(accountId, inputParams);
      } else if (tier === "business_evaluator") {
        reportBody = await evaluator.evaluateTier2(accountId, inputParams);
      } else {
        throw new Error(`Unknown tier: ${tier}`);
      }

      // Create report record first so the job payload carries the id that
      // GET /reports/:id actually resolves (the evaluator's own report_id is
      // not what the DB stores).
      const { reportId } = await geDb.createReport(accountId, tier, inputParams, reportBody);
      reportBody.report_id = reportId;

      // Mark complete
      await geDb.updateJobStatus(jobId, "complete", {
        resultPayload: reportBody,
        stage: "complete",
      });

      // Save report as markdown file for reference
      try {
        saveReportAsMarkdown(
          inputParams.handle,
          inputParams.platform,
          reportBody.narrative || JSON.stringify(reportBody, null, 2)
        );
      } catch (err) {
        console.warn(`[JobQueue] Warning: Could not save report file:`, err.message);
      }

      console.log(`[JobQueue] ✅ Job ${jobId} completed`);
    } catch (err) {
      console.error(`[JobQueue] ❌ Job ${jobId} failed:`, err.message);

      await geDb.updateJobStatus(jobId, "failed", {
        error: err.message,
        stage: "failed",
      });
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  isProcessing(jobId) {
    return this.processingJobs.has(jobId);
  }

  getStats() {
    return {
      running: this.isRunning,
      numWorkers: this.numWorkers,
      processingCount: this.processingJobs.size,
      capacityRemaining: this.numWorkers - this.processingJobs.size,
    };
  }
}

module.exports = JobQueue;
