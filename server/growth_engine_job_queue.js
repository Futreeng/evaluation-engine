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
const moments = require("./growth_engine_moments");
const events = require("./growth_engine_events");
const costs = require("./growth_engine_costs");
const thumbs = require("./growth_engine_thumbs");

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
    const hasPlan = tier !== "social_snapshot" && tier !== "maintenance"; // plan-only features (moves, posts, streak, competitors)
    const feature = inputParams.scheduled ? "rescore" : inputParams.rerun_of ? "rerun" : inputParams.one_time_unlock ? "unlock" : tier === "social_snapshot" ? "free_report" : "paid_report";
    return costs.run({ accountId: accountId !== "demo-account" ? accountId : null, jobId, feature }, () => this._processJob(jobId, accountId, tier, inputParams));
  }
  async _processJob(jobId, accountId, tier, inputParams) {
    (this._started ||= new Map()).set(jobId, Date.now());
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
      if (tier === "social_snapshot" || tier === "maintenance") {
        // Maintenance (spec 4.2): weekly score + history only, no plan.
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
            // Percentile rank inside the niche (spec 1.11), only when the niche is ready.
            try { const pct = await geDb.nichePercentile(inputParams.category, inputParams.platform, sc.overall); if (pct) sc.category_percentile = pct; } catch { /* optional */ }
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
      if (hasPlan) {
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
                if (prevReport?.reportBody?.moments_seen) reportBody.moments_seen = prevReport.reportBody.moments_seen;
                if (prevReport?.reportBody?.annual_offer_at) reportBody.annual_offer_at = prevReport.reportBody.annual_offer_at;
              }
              // Weekly streak (spec 2.3) — paid plans only; carried and evaluated at each rescore.
              if (hasPlan) { let pause = null; try { const ent = await geDb.getEffectiveEntitlement(accountId); pause = ent?.pauseEndedAt ? { ended_at: ent.pauseEndedAt } : null; } catch { /* fine */ } reportBody.streak = moments.computeStreak(reportBody, prevReport?.reportBody || null, { pause }); }
              // Rank-ups, milestones, records (spec 2.2, 2.4, 2.5): only when a rescore shows the change.
              const found = moments.detectMoments(reportBody, prevReport?.reportBody || null);
              if (found.length) {
                reportBody.moments = found;
                reportBody.moments_seen = [...(reportBody.moments_seen || []), ...found.map((m) => ({ key: m.key, at: m.at }))];
                for (const m of found) events.track(m.kind === "rank_up" ? "rank_up" : m.kind === "record" ? "record" : "milestone", { accountId, reportId: null, props: { key: m.key, handle: inputParams.handle } });
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
            // Per-move outcome rows (spec 1.15): each move done since the last
            // report, with the score before and after, for later analysis.
            if (movesDone.length) {
              const dimsAfter = {}; for (const d of reportBody.scores.dimensions || []) dimsAfter[d.label] = d.score;
              try { await geDb.recordMoveOutcomes({ accountId, handle: inputParams.handle, platform: inputParams.platform, category: inputParams.category, moveKeys: movesDone, before: { overall: prev.overall, dims }, after: { overall: reportBody.scores.overall, dims: dimsAfter }, days: Math.round((Date.now() - prev.generated_at) / 86400000), fromReport: prev.report_id, toReport: null }); } catch (e) { console.warn("[Outcomes] move outcomes failed:", e.message); }
            }
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
        if (hasPlan) {
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

      // Goal (spec 3.3) rides on the report for the progress bar; carried from the plan context or the account.
      if (!reportBody.goal && reportBody.plan_context?.goal) { reportBody.goal = reportBody.plan_context.goal; reportBody.goal_target = reportBody.plan_context.goal_target ?? null; }
      // Level is just a name for the score band — always attached (spec 2.2).
      if (reportBody.scores && Number.isFinite(reportBody.scores.overall)) reportBody.scores.level = moments.levelFor(reportBody.scores.overall);
      if (hasPlan && !reportBody.streak) reportBody.streak = moments.computeStreak(reportBody, null);
      // Win-back rescore (spec 4.4): marked so the milestone can't fire twice.
      if (inputParams.winback) reportBody.winback = inputParams.winback;
      // Annual offer (spec 4.5): once, after the first score increase on a monthly plan.
      let annualOfferNow = false;
      if (hasPlan && !reportBody.one_time_unlock && !inputParams.winback && reportBody.history?.delta_overall > 0 && !reportBody.annual_offer_at) {
        try {
          const BM = require("./growth_engine_billing"); const pr = new BM(process.env.STRIPE_API_KEY).getPricing();
          const gp = (pr?.tiers || []).find((t) => t.tier === "growth_plan");
          if (gp && gp.annualPrice) { reportBody.annual_offer_at = Date.now(); reportBody.offers = { ...(reportBody.offers || {}), annual: { tier: "growth_plan", monthly: gp.monthlyPrice, annual: gp.annualPrice, saves: Math.round(gp.monthlyPrice * 12 - gp.annualPrice), at: Date.now() } }; annualOfferNow = true; }
        } catch { /* optional */ }
      }

      // Thumbnails (spec 1.4): our own resized copies, keyed by owner/job so
      // they can be removed with the account or by the 90-day cleanup.
      await geDb.updateJobStatus(jobId, "running", { stage: "writing", step: 4 }).catch(() => { });
      await thumbs.processReport(reportBody, `${accountId && accountId !== "demo-account" ? accountId : "anon"}/${jobId}`);

      const { reportId } = await geDb.createReport(accountId, tier, inputParams, reportBody);
      reportBody.report_id = reportId;
      costs.setReport(reportId);
      geDb.attachReportToCosts(jobId, reportId).catch((e) => console.warn("[Costs] attach failed:", e.message));
      events.track("evaluate_completed", { accountId: accountId !== "demo-account" ? accountId : null, anon: inputParams.attribution?.anon || null, ref: inputParams.attribution?.ref || null, reportId, props: { tier, platform: inputParams.platform, category: inputParams.category, overall: reportBody.scores?.overall ?? null, scheduled: !!inputParams.scheduled, ms: Date.now() - (this._started?.get?.(jobId) || Date.now()) } });

      // Emails: report ready on a fresh run; score changed on a weekly refresh.
      try {
        const to = inputParams.email || null;
        const first = reportBody.growth_path?.phases?.[0];
        const firstMove = first ? { action: first.visible_action, why: first.detail } : null;
        const grade = reportBody.scores?.overall >= 70 ? "Strong" : reportBody.scores?.overall >= 40 ? "Fair" : "Weak";
        if (inputParams.winback && reportBody.scores) {
          const base = inputParams.winback_base || {};
          await mailer.winback({ to, userId: accountId, handle: inputParams.handle, reportId, oldScore: base.overall, newScore: reportBody.scores.overall, since: base.generated_at, milestone: inputParams.winback });
          events.track("winback_sent", { accountId, reportId, props: { milestone: inputParams.winback, delta: Number.isFinite(base.overall) ? reportBody.scores.overall - base.overall : null } });
        } else if (inputParams.scheduled && reportBody.history) {
          const h = reportBody.history;
          const biggest = (h.delta_dimensions || []).filter((d) => d.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
          for (const m of reportBody.moments || []) await mailer.moment({ to, userId: accountId, handle: inputParams.handle, reportId, moment: m });
          if (h.delta_overall !== 0 || reportBody.nudge) {
            let brief = null; try { brief = await require("./growth_engine_briefs").getBrief(inputParams.category, inputParams.platform); } catch { /* optional */ }
            await mailer.scoreChanged({ to, userId: accountId, handle: inputParams.handle, reportId, oldScore: h.previous.overall, newScore: reportBody.scores.overall, dimension: biggest?.label || "Overall", delta: biggest?.delta ?? h.delta_overall, movesDone: (h.moves_done_since || []).length, nudge: reportBody.nudge || null, brief });
          }
          if (annualOfferNow && reportBody.offers?.annual) { await mailer.annualOffer({ to, userId: accountId, handle: inputParams.handle, reportId, offer: reportBody.offers.annual, oldScore: h.previous.overall, newScore: reportBody.scores.overall }); events.track("annual_offer_shown", { accountId, reportId, props: { annual: reportBody.offers.annual.annual } }); }
        } else if (!inputParams.rerun_of && reportBody.scores) {
          await mailer.reportReady({ to, handle: inputParams.handle, reportId, overall: reportBody.scores.overall, grade, summary: reportBody.scores.summary, firstMove, paid: hasPlan });
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
      events.track("evaluate_failed", { accountId: accountId !== "demo-account" ? accountId : null, anon: inputParams.attribution?.anon || null, ref: inputParams.attribution?.ref || null, props: { tier, platform: inputParams.platform, error: String(err.message).slice(0, 200) } });

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
