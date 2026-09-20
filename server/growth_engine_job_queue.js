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
const geDb = require("./growth_engine_db_select");
const { compareCompetitors } = require("./growth_engine_competitors");
const { saveReportAsMarkdown } = require("./report_saver");
const mailer = require("./mailer");

// Weekly refresh: does what the creator told us still match what they're
// doing? At most one nudge per phase; the report and the score-changed
// email carry it, one tap accepts it.
function detectNudge(reportBody, prevReport, inputParams) {
  const ctx = reportBody.plan_context;
  if (!ctx || !inputParams.scheduled) return null;
  const posts = Array.isArray(reportBody.recent_posts_dates) ? reportBody.recent_posts_dates : null;
  const newPosts = Number(reportBody.posts_last_14d);
  const movesDone = Object.keys(prevReport?.reportBody?.moves_done || {}).length;
  const phase = Math.min(3, Math.floor((Date.now() - (reportBody.plan_started_at || Date.now())) / (30 * 86400000)) + 1);
  const already = (prevReport?.reportBody?.nudges_sent || []).some((n) => n.phase === phase);
  if (already) return null;
  if (ctx.horizon === "fewer_shoots" && Number.isFinite(newPosts) && newPosts >= 6) {
    return { key: "shooting_again", phase, title: "Looks like you're shooting again.", text: `${newPosts} new posts in two weeks — your plan was written for fewer shoots. Want it to use new footage?`, cta: "Yes, use new footage", apply: { horizon: "usual" } };
  }
  if ((ctx.hours === "5_10" || ctx.hours === "10plus") && Number.isFinite(newPosts) && newPosts === 0 && movesDone === 0) {
    return { key: "slow", phase, title: "Slow fortnight.", text: "No posts and no moves marked done in two weeks. Want a lighter plan for the next 30 days?", cta: "Yes, lighten the plan", apply: { hours: "2_5" } };
  }
  void posts;
  return null;
}

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

      const onStage = async (stage, step) => {
        try { await geDb.updateJobStatus(jobId, "running", { stage: `${stage}:${step}` }); } catch { /* cosmetic */ }
      };
      if (tier === "social_snapshot") {
        reportBody = await evaluator.evaluateTier0(accountId, inputParams, onStage);
      } else if (tier === "growth_plan") {
        reportBody = await evaluator.evaluateTier1(accountId, inputParams, onStage);
      } else if (tier === "business_evaluator") {
        reportBody = await evaluator.evaluateTier2(accountId, inputParams);
      } else {
        throw new Error(`Unknown tier: ${tier}`);
      }

      // Create report record first so the job payload carries the id that
      // GET /reports/:id actually resolves (the evaluator's own report_id is
      // not what the DB stores).
      // Feed the category baseline and, if it has enough profiles, attach the
      // measured averages so the report can show "vs your category".
      try {
        const sc = reportBody.scores;
        if (sc && Number.isFinite(sc.overall)) {
          await geDb.recordBaseline({
            category: inputParams.category, platform: inputParams.platform, handle: inputParams.handle,
            overall: sc.overall, dimensions: sc.dimensions,
          });
          const base = await geDb.getCategoryBaseline(inputParams.category, { platform: inputParams.platform });
          if (base && base.ready) {
            sc.category_avg = base.overall;
            sc.category_top_quartile = base.top_quartile;
            sc.category_sample_size = base.n;
            for (const d of sc.dimensions || []) if (base.dimensions[d.label] != null) d.category_avg = base.dimensions[d.label];
          } else if (base) {
            sc.category_sample_size = base.n;
            sc.category_baseline_pending = { n: base.n, min_n: base.min_n };
          }
        }
      } catch (err) {
        console.warn("[Growth Engine] Baseline update failed:", err.message);
      }

      // One-time unlock: a 60-day plan that never refreshes and says so.
      if (inputParams.one_time_unlock) {
        reportBody.refresh_due_at = null;
        reportBody.one_time_unlock = { of: inputParams.unlock_of || null, payment_id: inputParams.payment_id || null, days: 60 };
      }
      // When a plan started: a refresh or re-run inherits the original start
      // so day-30/60 check-ins and the 60-day end are measured from purchase.
      if (tier !== "social_snapshot") {
        let started = Date.now();
        if (inputParams.refresh_of || inputParams.rerun_of) {
          try { const src = await geDb.getReport(inputParams.refresh_of || inputParams.rerun_of); if (src?.reportBody?.plan_started_at) started = src.reportBody.plan_started_at; } catch { /* keep now */ }
        }
        reportBody.plan_started_at = started;
        if (inputParams.checkins) reportBody.checkins = inputParams.checkins;
        // Recipient for scheduled emails (check-ins, plan ended). Owner-only
        // reports, so this never leaves the account that owns it.
        if (inputParams.email) reportBody.email = inputParams.email;
      }

      // (6) Followers on every report — the number a creator checks first.
      if (reportBody.business && reportBody.business.followers == null) {
        const f = reportBody.followers ?? reportBody.raw_followers;
        if (Number.isFinite(f)) reportBody.business.followers = f;
      }

      // Score history: compare with this account's last report for the handle,
      // and record what they did in between — the evidence the plan works.
      try {
        if (accountId && accountId !== "demo-account" && reportBody.scores) {
          const prior = await geDb.listScoreHistory(accountId, inputParams.handle, inputParams.platform);
          const prev = prior[prior.length - 1];
          if (prev) {
            const dims = {};
            for (const d of prev.dimensions || []) dims[d.label] = d.score;
            let movesDone = [];
            try { const prevReport = await geDb.getReport(prev.report_id); movesDone = Object.keys(prevReport?.reportBody?.moves_done || {}); } catch { /* fine */ }
            const followerDelta = Number.isFinite(prev.followers) && Number.isFinite(reportBody.business?.followers) ? reportBody.business.followers - prev.followers : null;
            // Refreshes carry check-ins and nudge history forward.
            try {
              const prevReport = await geDb.getReport(prev.report_id);
              if (inputParams.scheduled || inputParams.rerun_of) {
                if (prevReport?.reportBody?.checkins && !reportBody.checkins) reportBody.checkins = prevReport.reportBody.checkins;
                if (prevReport?.reportBody?.nudges_sent) reportBody.nudges_sent = prevReport.reportBody.nudges_sent;
                if (prevReport?.reportBody?.emails_sent) reportBody.emails_sent = prevReport.reportBody.emails_sent;
                if (prevReport?.reportBody?.moves_done && !reportBody.moves_done) reportBody.moves_done = prevReport.reportBody.moves_done;
              }
              const nudge = detectNudge(reportBody, prevReport, inputParams);
              if (nudge) { reportBody.nudge = nudge; reportBody.nudges_sent = [...(reportBody.nudges_sent || []), { key: nudge.key, phase: nudge.phase, at: Date.now() }]; }
            } catch { /* best-effort */ }
            reportBody.history = {
              runs: prior.length + 1,
              previous: { report_id: prev.report_id, generated_at: prev.generated_at, overall: prev.overall, followers: prev.followers ?? null },
              delta_overall: reportBody.scores.overall - prev.overall,
              delta_followers: followerDelta,
              delta_dimensions: (reportBody.scores.dimensions || []).map((d) => ({ label: d.label, delta: dims[d.label] != null ? d.score - dims[d.label] : null })),
              moves_done_since: movesDone,
              series: [...prior.map((r) => ({ generated_at: r.generated_at, overall: r.overall, followers: r.followers ?? null })), { generated_at: Date.now(), overall: reportBody.scores.overall, followers: reportBody.business?.followers ?? null }],
            };
            // Evidence row: what they did → what changed. Aggregated later for
            // "creators who did ≥3 moves gained N points" and the review cards.
            try { await geDb.recordOutcome({ accountId, handle: inputParams.handle, platform: inputParams.platform, category: inputParams.category, movesDone: movesDone.length, scoreDelta: reportBody.history.delta_overall, followerDelta, days: Math.round((Date.now() - prev.generated_at) / 86400000) }); } catch { /* best-effort */ }
          }
        }
      } catch (err) {
        console.warn("[Growth Engine] History lookup failed:", err.message);
      }

      // Paid tiers: competitor handles given on the form are compared now, so
      // the report arrives complete. Free tier keeps them for the teaser.
      const wanted = Array.isArray(inputParams.competitors) ? inputParams.competitors : [];
      if (wanted.length) {
        reportBody.competitor_handles = wanted;
        if (tier !== "social_snapshot") {
          try {
            await geDb.updateJobStatus(jobId, "running", { stage: "comparing competitors" });
            const comparison = await compareCompetitors({ handle: inputParams.handle, platform: inputParams.platform, category: inputParams.category, handles: wanted });
            const own = reportBody.scores;
            if (own && Number.isFinite(own.overall)) {
              comparison.you.overall = own.overall;
              comparison.you.dimensions = (own.dimensions || []).map((d) => ({ label: d.label, score: d.score }));
              const scored = comparison.competitors.filter((c) => c.ok);
              comparison.rank = { position: [own.overall, ...scored.map((c) => c.overall)].sort((a, b) => b - a).indexOf(own.overall) + 1, of: scored.length + 1 };
            }
            reportBody.competitors = comparison;
          } catch (err) {
            console.warn("[Growth Engine] Competitor comparison failed:", err.message);
          }
        }
      }

      const { reportId } = await geDb.createReport(accountId, tier, inputParams, reportBody);
      reportBody.report_id = reportId;

      // Emails: report ready on a fresh run; score changed on a weekly refresh.
      try {
        const to = inputParams.email || null;
        const first = reportBody.growth_path?.phases?.[0];
        const firstMove = first ? { action: first.visible_action, why: first.detail } : null;
        const grade = reportBody.scores?.overall >= 70 ? "Strong" : reportBody.scores?.overall >= 40 ? "Fair" : "Weak";
        if (inputParams.scheduled && reportBody.history) {
          const h = reportBody.history;
          const biggest = (h.delta_dimensions || []).filter((d) => d.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
          if (h.delta_overall !== 0 || reportBody.nudge) {
            await mailer.scoreChanged({ to, handle: inputParams.handle, reportId, oldScore: h.previous.overall, newScore: reportBody.scores.overall, dimension: biggest?.label || "Overall", delta: biggest?.delta ?? h.delta_overall, movesDone: (h.moves_done_since || []).length, nudge: reportBody.nudge || null });
          }
        } else if (!inputParams.rerun_of && reportBody.scores) {
          await mailer.reportReady({ to, handle: inputParams.handle, reportId, overall: reportBody.scores.overall, grade, summary: reportBody.scores.summary, firstMove, paid: tier !== "social_snapshot" });
        }
      } catch (err) {
        console.warn("[JobQueue] email failed:", err.message);
      }

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
