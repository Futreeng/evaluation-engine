const express = require("express");
const { v4: uid } = require("uuid");
const geDb = require("../growth_engine_db");
const { evaluateProfile } = require("../growth_engine_evaluator");
const BillingManager = require("../growth_engine_billing");
const JobQueue = require("../growth_engine_job_queue");
const { signup, login, verifyJWT } = require("../auth");

const router = express.Router();
let jobQueue = new JobQueue();

// Start job queue when routes are loaded
(async () => {
  try {
    await jobQueue.start();
    console.log("[Growth Engine] Job queue started");
  } catch (err) {
    console.error("[Growth Engine] Failed to start job queue:", err);
  }
})();

const billingManager = new BillingManager(process.env.STRIPE_API_KEY);

// Middleware: JWT authentication for protected endpoints
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing authorization token" });

  const user = await verifyJWT(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
};

// ===================== AUTH ENDPOINTS =====================

// POST /auth/signup
router.post("/auth/signup", async (req, res) => {
  try {
    const { email, password, company_name } = req.body;
    const result = await signup(email, password, company_name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// GET /auth/me
router.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await geDb.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      user_id: user.userId,
      email: user.email,
      company_name: user.companyName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== ACCOUNT ENDPOINTS =====================

// GET /account/profile
router.get("/account/profile", authMiddleware, async (req, res) => {
  try {
    const user = await geDb.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      user_id: user.userId,
      email: user.email,
      company_name: user.companyName,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /account/subscription-status
router.get("/account/subscription-status", authMiddleware, async (req, res) => {
  try {
    const ent = await geDb.getOrCreateEntitlement(req.user.id);
    res.json({
      user_id: req.user.id,
      current_tier: ent.currentTier,
      tier_start_date: ent.tierStartDate,
      billing_period_start: ent.billingPeriodStart,
      billing_period_end: ent.billingPeriodEnd,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /account/reports
router.get("/account/reports", authMiddleware, async (req, res) => {
  try {
    const reports = await geDb.listReportsByAccount(req.user.id);
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue evaluation (protected by authMiddleware)
router.post("/evaluate/social-snapshot", authMiddleware, async (req, res) => {
  try {
    const { handle, platform, category, email } = req.body;
    const accountId = req.user.id;

    if (!handle || !platform || !category || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Create job in database
    const jobResult = await geDb.createJob(accountId, "social_snapshot", { handle, platform, category, email });
    const jobId = jobResult.jobId;

    // Process asynchronously (fire-and-forget)
    jobQueue.processJob(jobId, accountId, "social_snapshot", { handle, platform, category, email })
      .catch(err => console.error(`[Growth Engine] Async job ${jobId} error:`, err));

    res.json({ job_id: jobId, status: "queued" });
  } catch (err) {
    console.error("[Growth Engine] Queue error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Poll job status (no auth for demo)
router.get("/job/:jobId", async (req, res) => {
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

// Get report (no auth for demo)
router.get("/reports/:reportId", async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pricing
router.get("/billing/pricing", async (req, res) => {
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
    const accountId = req.user.id;

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
    const accountId = req.user.id;

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
router.get("/billing/estimate", async (req, res) => {
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

// Queue stats (admin endpoint)
router.get("/admin/queue-stats", async (req, res) => {
  try {
    const stats = jobQueue.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
