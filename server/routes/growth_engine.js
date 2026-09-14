const express = require("express");
const { requireAuth } = require("../middleware/auth");
const geDb = require("../growth_engine_db");
const evaluator = require("../growth_engine_evaluator");
const BillingManager = require("../growth_engine_billing");
const JobQueue = require("../growth_engine_job_queue");

const router = express.Router();
router.use(requireAuth);

// Initialize billing and job queue
const billing = new BillingManager(process.env.STRIPE_API_KEY);
const jobQueue = new JobQueue(4); // 4 concurrent workers

// Start job queue on first request
let jobQueueStarted = false;

// =====================================================================
// Tier 0 — Social Snapshot (Free)
// POST /api/growth-engine/v1/evaluate/social-snapshot
// =====================================================================

router.post("/evaluate/social-snapshot", async (req, res) => {
  try {
    const { handle, platform, category, email } = req.body;

    // Email is required for free tier (lead capture)
    if (!email) {
      return res.status(422).json({ error: "email_required" });
    }

    // Validate inputs
    if (!handle || !platform || !category) {
      return res.status(400).json({
        error: "handle, platform, and category are required",
      });
    }

    const accountId = req.user.id;

    // Create job (queued)
    const job = await geDb.createJob(accountId, "social_snapshot", {
      handle,
      platform,
      category,
      email,
    });

    // Queue for background processing (fires and forgets)
    processJobAsync(job.jobId, accountId, "social_snapshot", {
      handle,
      platform,
      category,
    }).catch(err => {
      console.error(`Failed to process job ${job.jobId}:`, err);
    });

    // Return job_id immediately so client can poll
    res.json({
      job_id: job.jobId,
      status: "queued",
      message: "Evaluation queued. Poll /job/{job_id} for status.",
    });
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to process job asynchronously (without blocking response)
async function processJobAsync(jobId, accountId, tier, inputParams) {
  try {
    // Update to running
    await geDb.updateJobStatus(jobId, "running", { stage: "evaluating" });

    // Evaluate
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

    // Mark complete
    await geDb.updateJobStatus(jobId, "complete", {
      resultPayload: reportBody,
      stage: "complete",
    });

    // Create report record for retrieval
    await geDb.createReport(accountId, tier, inputParams, reportBody);

    console.log(`✅ Job ${jobId} completed`);
  } catch (err) {
    console.error(`❌ Job ${jobId} failed:`, err.message);
    await geDb.updateJobStatus(jobId, "failed", {
      error: err.message,
      stage: "failed",
    });
  }
}

// =====================================================================
// Job Status Polling
// GET /api/growth-engine/v1/job/:jobId
// =====================================================================

router.get("/job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const accountId = req.user.id;

    const job = await geDb.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Security: ensure user owns this job
    if (job.accountId !== accountId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Return job status (without full result payload in poll response)
    res.json({
      job_id: job.jobId,
      tier: job.tier,
      status: job.status,
      stage: job.stage,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      error: job.error,
      // resultPayload is fetched separately via GET /reports/:report_id
    });
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Report Retrieval
// GET /api/growth-engine/v1/reports/:reportId
// =====================================================================

router.get("/reports/:reportId", async (req, res) => {
  try {
    const { reportId } = req.params;
    const accountId = req.user.id;

    const report = await geDb.getReport(reportId);

    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Security: ensure user owns this report
    if (report.accountId !== accountId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Return report matching api-contract structure
    const response = {
      report_id: report.reportId,
      tier: report.tier,
      business: report.business,
      generated_at: report.generatedAt,
      refresh_due_at: report.refreshDueAt,
      data_confidence: report.reportBody.data_confidence || "full",
      scores: report.reportBody.scores,
      growth_path: report.reportBody.growth_path,
      upsell: report.tier === "social_snapshot" ? {
        cta_label: "Unlock your full Growth Plan",
        target_tier: "growth_plan",
        unlock_count: 12,
      } : undefined,
    };

    res.json(response);
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// List Reports by Account
// GET /api/growth-engine/v1/reports
// =====================================================================

router.get("/reports", async (req, res) => {
  try {
    const accountId = req.user.id;

    const reports = await geDb.listReportsByAccount(accountId);

    res.json({
      reports: reports.map((r) => ({
        report_id: r.reportId,
        tier: r.tier,
        business: r.business,
        generated_at: r.generatedAt,
        refresh_due_at: r.refreshDueAt,
      })),
    });
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Entitlements
// GET /api/growth-engine/v1/entitlements
// =====================================================================

router.get("/entitlements", async (req, res) => {
  try {
    const accountId = req.user.id;

    const ent = await geDb.getOrCreateEntitlement(accountId);

    res.json({
      account_id: ent.accountId,
      current_tier: ent.currentTier,
      tier_start_date: ent.tierStartDate,
      billing_period_start: ent.billingPeriodStart,
      billing_period_end: ent.billingPeriodEnd,
    });
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Billing: Get Pricing
// GET /api/growth-engine/v1/billing/pricing
// =====================================================================

router.get("/billing/pricing", async (req, res) => {
  try {
    const pricing = billing.getPricing();
    res.json(pricing);
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Billing: Create Subscription
// POST /api/growth-engine/v1/billing/subscribe
// =====================================================================

router.post("/billing/subscribe", async (req, res) => {
  try {
    const accountId = req.user.id;
    const { tier, billingCycle = "monthly" } = req.body;

    if (!tier) {
      return res.status(400).json({ error: "tier is required" });
    }

    // In production: get stripeCustomerId from user record
    const stripeCustomerId = "cus_" + accountId; // Placeholder

    const result = await billing.createSubscription(
      accountId,
      tier,
      stripeCustomerId,
      billingCycle
    );

    res.json(result);
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Billing: Check Entitlement
// POST /api/growth-engine/v1/billing/check-access
// =====================================================================

router.post("/billing/check-access", async (req, res) => {
  try {
    const accountId = req.user.id;
    const { tier } = req.body;

    if (!tier) {
      return res.status(400).json({ error: "tier is required" });
    }

    const result = await billing.checkEntitlement(accountId, tier);

    if (!result.hasAccess) {
      return res.status(402).json({
        error: "tier_required",
        current_tier: result.currentTier,
        required_tier: result.requiredTier,
        message: `Upgrade to ${tier} to access this feature`,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Billing: Estimate Cost
// GET /api/growth-engine/v1/billing/estimate
// =====================================================================

router.get("/billing/estimate", async (req, res) => {
  try {
    const { tier, billingCycle = "monthly", clientCount = 1 } = req.query;

    if (!tier) {
      return res.status(400).json({ error: "tier is required" });
    }

    const cost = billing.estimateCost(tier, billingCycle, parseInt(clientCount));

    res.json({
      tier,
      billingCycle,
      clientCount: parseInt(clientCount),
      totalCost: cost,
      costFormatted: `$${cost.toFixed(2)}`,
    });
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// Billing: Webhook Handler (Stripe)
// POST /api/growth-engine/v1/billing/webhook
// =====================================================================

router.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];

    // In production: verify Stripe signature using STRIPE_WEBHOOK_SECRET
    // const event = stripe.webhooks.constructEvent(req.body, sig, secret);

    // For now, treat as trusted event
    const event = JSON.parse(req.body);

    const result = await billing.handleWebhook(event);
    res.json(result);
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(400).json({ error: err.message });
  }
});

// =====================================================================
// Admin: Job Queue Stats
// GET /api/growth-engine/v1/admin/queue-stats
// =====================================================================

router.get("/admin/queue-stats", async (req, res) => {
  try {
    const stats = jobQueue.getStats();
    res.json(stats);
  } catch (err) {
    console.error("Growth Engine error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
