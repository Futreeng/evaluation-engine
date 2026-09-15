const express = require("express");
const { v4: uid } = require("uuid");
const SocialMediaClient = require("../services/socialMediaClient");
const AuditAnalyzer = require("../services/auditAnalyzer");

const router = express.Router();

// Growth Engine API Routes
// POST /api/growth-engine/v1/evaluate/social-snapshot — public audit endpoint
// GET /api/growth-engine/v1/job/:jobId — poll job status
// GET /api/growth-engine/v1/health — health check

// Service instances (initialized via module.exports.initializeServices)
let db = null;
let jobQueue = null;
let socialMediaClient = null;
let auditAnalyzer = null;

// Initialize services (called from server.js after database is ready)
function initializeServices(database, queue) {
  db = database;
  jobQueue = queue;

  socialMediaClient = new SocialMediaClient({
    twitter: process.env.TWITTER_BEARER_TOKEN,
    instagram: process.env.INSTAGRAM_TOKEN,
    tiktok: process.env.TIKTOK_API_KEY,
    facebook: process.env.FACEBOOK_APP_ID,
    linkedin: process.env.LINKEDIN_CLIENT_ID,
  });

  auditAnalyzer = new AuditAnalyzer(db, null, socialMediaClient);

  console.log("[Growth Engine] Services initialized");
  console.log(`[Growth Engine] Configured platforms: ${socialMediaClient.getConfiguredPlatforms().join(", ")}`);
}

// Public: Submit social profile for audit (free tier)
// POST /api/growth-engine/v1/evaluate/social-snapshot
router.post("/evaluate/social-snapshot", async (req, res) => {
  try {
    const { handle, platform, category, email } = req.body;

    if (!handle || !platform || !category || !email) {
      return res.status(400).json({
        error: "Missing required fields: handle, platform, category, email",
      });
    }

    if (!socialMediaClient || !socialMediaClient.isConfigured(platform)) {
      return res.status(400).json({
        error: `Platform '${platform}' is not configured. Available: ${socialMediaClient ? socialMediaClient.getConfiguredPlatforms().join(", ") : "none"}`,
      });
    }

    // Create job in queue
    const input = { handle, platform, category, email };
    const job = await jobQueue.createJob(null, "audit", null, input);

    res.json({
      jobId: job.jobId,
      status: "queued",
      estimatedWaitSeconds: 20,
      message: `Your ${platform} audit is queued. Check back in 20-30 seconds with the jobId.`,
    });
  } catch (err) {
    console.error("[Growth Engine] Audit submission error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Public: Poll job status
// GET /api/growth-engine/v1/job/:jobId
router.get("/job/:jobId", async (req, res) => {
  try {
    const jobStatus = await jobQueue.getJobStatus(req.params.jobId);

    if (!jobStatus) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      jobId: jobStatus.jobId,
      status: jobStatus.status,
      result: jobStatus.result || null,
      error: jobStatus.error || null,
      progress: {
        percentComplete:
          jobStatus.status === "complete" ? 100 : jobStatus.status === "processing" ? 50 : 0,
        message: `Job status: ${jobStatus.status}`,
      },
      createdAt: jobStatus.createdAt,
      completedAt: jobStatus.completedAt,
    });
  } catch (err) {
    console.error("[Growth Engine] Job status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
// GET /api/growth-engine/v1/health
router.get("/health", async (req, res) => {
  try {
    const dbHealth = await db.health();
    res.json({
      status: "ok",
      database: dbHealth,
      configuredPlatforms: socialMediaClient ? socialMediaClient.getConfiguredPlatforms() : [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.initializeServices = initializeServices;
