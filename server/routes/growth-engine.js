const express = require("express");
const { v4: uid } = require("uuid");
const geDb = require("../growth_engine_db");
const { evaluateProfile } = require("../growth_engine_evaluator");
const BillingManager = require("../growth_engine_billing");
const JobQueue = require("../growth_engine_job_queue");

const router = express.Router();
let jobQueue = new JobQueue();
const billingManager = new BillingManager(process.env.STRIPE_API_KEY);

// Middleware: JWT authentication for all endpoints
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing authorization token" });
  try {
    const jwt = require("jsonwebtoken");
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Queue evaluation (no auth for demo, but add authMiddleware for production)
router.post("/evaluate/social-snapshot", async (req, res) => {
  try {
    const { handle, platform, category, email } = req.body;
    const accountId = req.user?.id || "demo-account";

    if (!handle || !platform || !category || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const jobId = uid();
    await jobQueue.queue({
      id: jobId,
      type: "evaluate",
      tier: "social_snapshot",
      input: { handle, platform, category, email, accountId },
    });

    res.json({ job_id: jobId, status: "queued" });
  } catch (err) {
    console.error("[Growth Engine] Queue error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Poll job status
router.get("/job/:jobId", authMiddleware, async (req, res) => {
  try {
    const job = await geDb.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    res.json({
      status: job.status,
      stage: job.stage || job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      error: job.error,
      resultPayload: job.resultPayload,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get report
router.get("/reports/:reportId", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List user reports
router.get("/reports", authMiddleware, async (req, res) => {
  try {
    const accountId = req.user?.id || "demo-account";
    const reports = await geDb.getUserReports(accountId);
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check entitlements
router.get("/entitlements", authMiddleware, async (req, res) => {
  try {
    const accountId = req.user?.id || "demo-account";
    const ent = await geDb.getOrCreateEntitlement(accountId);
    res.json({ account_id: accountId, current_tier: ent.currentTier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pricing
router.get("/billing/pricing", authMiddleware, async (req, res) => {
  try {
    res.json(billingManager.getPricing());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to tier
router.post("/billing/subscribe", authMiddleware, async (req, res) => {
  try {
    const { tier, billingCycle } = req.body;
    const accountId = req.user?.id || "demo-account";

    const result = await billingManager.createSubscription(
      accountId,
      tier,
      null,
      billingCycle || "monthly"
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check access
router.post("/billing/check-access", authMiddleware, async (req, res) => {
  try {
    const { requiredTier } = req.body;
    const accountId = req.user?.id || "demo-account";

    const access = await billingManager.checkEntitlement(accountId, requiredTier);
    if (!access.hasAccess) {
      return res.status(402).json({ error: "Access denied", details: access });
    }

    res.json(access);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estimate cost
router.get("/billing/estimate", authMiddleware, async (req, res) => {
  try {
    const { tier, billingCycle, clientCount } = req.query;
    const cost = billingManager.estimateCost(
      tier,
      billingCycle || "monthly",
      parseInt(clientCount) || 1
    );
    res.json({ tier, cost, billingCycle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook
router.post("/billing/webhook", async (req, res) => {
  try {
    const result = await billingManager.handleWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error("[Growth Engine] Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Queue stats
router.get("/admin/queue-stats", authMiddleware, async (req, res) => {
  try {
    const stats = jobQueue.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
