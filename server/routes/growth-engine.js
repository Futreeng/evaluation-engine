const express = require("express");
const { v4: uid } = require("uuid");

const router = express.Router();

// Growth Engine API Routes
// POST /api/growth-engine/v1/evaluate/social-snapshot — public audit endpoint
// GET /api/growth-engine/v1/job/:jobId — poll job status
// (Auth required endpoints added later)

module.exports = function(db, jobQueue) {
  // Public: Submit social profile for audit (free tier)
  router.post("/evaluate/social-snapshot", async (req, res) => {
    try {
      const { handle, platform, category, email } = req.body;

      if (!handle || !platform || !category || !email) {
        return res.status(400).json({ error: "Missing required fields: handle, platform, category, email" });
      }

      // Create job (no user auth required for free audit)
      const input = { handle, platform, category, email };
      const job = await jobQueue.createJob(null, "audit", null, input);

      res.json({
        jobId: job.jobId,
        status: "queued",
        estimatedWaitSeconds: 10,
        message: "Your audit is queued. Check back in 10-15 seconds with the jobId.",
      });
    } catch (err) {
      console.error("Audit submission error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Public: Poll job status
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
          percentComplete: jobStatus.status === "complete" ? 100
            : jobStatus.status === "processing" ? 50
            : 0,
          message: `Job status: ${jobStatus.status}`,
        },
        createdAt: jobStatus.createdAt,
        completedAt: jobStatus.completedAt,
      });
    } catch (err) {
      console.error("Job status error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard: Get user's social profiles (auth required, Tier1+)
  router.get("/dashboard/profiles", requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      // TODO: Query user's social profiles from database
      res.json({ profiles: [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard: Create social profile (auth required, Tier1+)
  router.post("/dashboard/profiles", requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const { handle, platform, category, businessName } = req.body;
      const profileId = uid();
      // TODO: Save profile to database
      res.json({ profileId, created: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard: Get audit history for profile (auth required, Tier1+)
  router.get("/dashboard/audits/:profileId", requireAuth, async (req, res) => {
    try {
      const { profileId } = req.params;
      // TODO: Query audits from database
      res.json({ audits: [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard: Trigger refresh (auth required, Tier1+)
  router.post("/dashboard/refresh/:profileId", requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const { profileId } = req.params;
      const job = await jobQueue.createJob(userId, "refresh", profileId, { profileId });
      res.json({ jobId: job.jobId, status: "queued" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Convergence Integration: Analyze social profile
  router.post("/convergence/analyze", async (req, res) => {
    try {
      const { handle, platform, category, businessMetrics } = req.body;

      if (!handle || !platform || !category) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // TODO: Call Convergence session, run dual analysis, return results
      res.json({
        convergenceSessionId: uid(),
        results: {
          overallScore: 65,
          scores: {
            authenticity: 70,
            engagement: 62,
            growth: 68,
            consistency: 60,
          },
          recommendations: ["Increase posting frequency", "Engage more with comments"],
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// Middleware: Auth check (will be implemented)
function requireAuth(req, res, next) {
  // TODO: Verify JWT token
  // For now, allow all
  req.user = { id: "user-123" };
  next();
}
