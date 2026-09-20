const express = require("express");
const { v4: uid } = require("uuid");
const geDb = require("../growth_engine_db_select");
const { evaluateProfile } = require("../growth_engine_evaluator");
const BillingManager = require("../growth_engine_billing");
const JobQueue = require("../growth_engine_job_queue");
const { compareCompetitors, MAX_COMPETITORS } = require("../growth_engine_competitors");
const { signup, login, verifyJWT, requestPasswordReset, resetPassword } = require("../auth");
const mailer = require("../mailer");
const rateLimit = require("express-rate-limit");
// Sign-in, sign-up and reset: 20 attempts per IP per 15 minutes. The router
// already sits under the general 120/min limiter; this is the brute-force one.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in 15 minutes.", code: "RATE_LIMITED", status: 429 } });
const {
  sendError,
  validateAuthRequest,
  validateEvaluationRequest,
  validateSubscriptionRequest,
} = require("../middleware");

const router = express.Router();
let jobQueue = new JobQueue();

// Start job queue when routes are loaded
(async () => {
  try {
    await jobQueue.start();
    console.log("[Growth Engine] Job queue started");
    require("../growth_engine_refresh").start(jobQueue);
  } catch (err) {
    console.error("[Growth Engine] Failed to start job queue:", err);
  }
})();

const billingManager = new BillingManager(process.env.STRIPE_API_KEY);

// Middleware: JWT authentication for protected endpoints
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return sendError(res, 401, "MISSING_TOKEN", "Missing authorization token");

  const user = await verifyJWT(token);
  if (!user) return sendError(res, 401, "INVALID_TOKEN", "Invalid or expired token");
  // A JWT outlives the account it was issued for (deleted, or password
  // reset elsewhere) unless we check the account still exists.
  try { const row = await geDb.getUserById(user.id); if (!row) return sendError(res, 401, "INVALID_TOKEN", "This account no longer exists"); }
  catch { /* DB hiccup: fall through on the signed token */ }

  req.user = user;
  next();
};

// ===================== HEALTH CHECK =====================

// GET /health
router.get("/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    apis: {},
    db: "ok",
  };

  // Check database
  try {
    await geDb.getEntitlement("test-health-check");
    health.db = "ok";
  } catch (err) {
    health.db = "error: " + err.message;
    health.status = "degraded";
  }

  // Check LLM availability (just list what's configured)
  health.apis.claude = process.env.CLAUDE_API_KEY ? "configured" : "missing";
  health.apis.gemini = process.env.GEMINI_API_KEY ? "configured" : "missing";
  health.apis.groq = process.env.GROQ_API_KEY ? "configured" : "missing";
  health.apis.openai = process.env.OPENAI_API_KEY ? "configured" : "missing";

  // Check social media APIs
  health.apis.twitter = process.env.TWITTER_BEARER_TOKEN ? "configured" : "missing";
  health.apis.instagram = process.env.INSTAGRAM_ACCESS_TOKEN ? "configured" : "missing";

  res.json(health);
});

// ===================== AUTH ENDPOINTS =====================

// POST /auth/signup
router.post("/auth/signup", authLimiter, validateAuthRequest, async (req, res) => {
  try {
    const { email, password, company_name } = req.body;
    const result = await signup(email, password, company_name);
    res.json(result);
  } catch (err) {
    if (err.message.includes("already registered")) {
      return sendError(res, 409, "EMAIL_EXISTS", err.message);
    }
    sendError(res, 400, "SIGNUP_FAILED", err.message);
  }
});

// Password reset. Same reply whether or not the email exists; 5 requests
// per email per hour, in-process (enough to blunt abuse of the mailer).
const resetHits = new Map();
router.post("/auth/forgot", authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const ok = { ok: true, message: "If that email has an account, a reset link is on its way." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(ok);
    const now = Date.now();
    const hits = (resetHits.get(email) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (hits.length >= 5) return res.json(ok);
    hits.push(now); resetHits.set(email, hits);
    const r = await requestPasswordReset(email);
    if (r) await mailer.passwordReset({ to: r.email, resetUrl: `${(process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "")}/#/reset?token=${r.token}` });
    res.json(ok);
  } catch (err) { console.error("[Auth] forgot failed:", err.message); res.json({ ok: true, message: "If that email has an account, a reset link is on its way." }); }
});
router.post("/auth/reset", authLimiter, async (req, res) => {
  try {
    const password = String(req.body?.password || "");
    if (password.length < 6) return sendError(res, 400, "INVALID_PASSWORD", "Password must be at least 6 characters");
    if (password.length > 255) return sendError(res, 400, "INVALID_PASSWORD", "Password is too long");
    const r = await resetPassword(String(req.body?.token || ""), password);
    res.json(r);
  } catch (err) { sendError(res, 400, "RESET_INVALID", err.message); }
});

// POST /auth/login
router.post("/auth/login", authLimiter, validateAuthRequest, async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    sendError(res, 401, "AUTH_FAILED", err.message);
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
    const ent = await geDb.getEffectiveEntitlement(req.user.id);
    const pricing = billingManager.getPricing();
    const tierInfo = [...(pricing.tiers || []), ...(pricing.business || [])].find((t) => t.tier === ent.currentTier) || null;
    res.json({
      user_id: req.user.id,
      current_tier: ent.currentTier,
      tier_name: tierInfo?.name || (ent.currentTier === "social_snapshot" ? "Free Snapshot" : ent.currentTier),
      monthly_price: tierInfo?.monthlyPrice ?? 0,
      tier_start_date: ent.tierStartDate,
      billing_period_start: ent.billingPeriodStart,
      billing_period_end: ent.billingPeriodEnd,
      cancel_at: ent.cancelAt || null,
      status: ent.currentTier === "social_snapshot" ? "free" : ent.cancelAt ? "cancel_pending" : "active",
      email_paused: !!(await geDb.getUserById(req.user.id))?.emailPaused,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// "Pause these emails" from an email footer: signed link, no login. Report-
// ready and password-reset emails still send; check-ins and score changes stop.
router.get("/email/pause", async (req, res) => {
  const u = String(req.query.u || ""), sig = String(req.query.s || "");
  const ok = u && sig && sig === mailer.pauseSig(u);
  if (ok) { try { await geDb.setEmailPaused(u, true); } catch { /* fall through */ } }
  const app = (process.env.APP_URL || "").replace(/\/$/, "") || "";
  res.type("html").send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scalecraft</title>
<body style="margin:0;background:#FFF6E9;font-family:Helvetica,Arial,sans-serif;color:#2A2118"><div style="max-width:520px;margin:48px auto;padding:28px;background:#FFFDF8;border:1px solid #EADFCB;border-radius:24px">
<h1 style="margin:0;font-size:26px">${ok ? "Paused." : "That link didn't work."}</h1>
<p style="font-size:16px;line-height:1.6;color:#5B4C3B">${ok ? "Check-ins and score updates are off. Your plan keeps running and your reports stay. Resume any time from your reports page." : "It may have been altered. Sign in and use the plan card on your reports page instead."}</p>
<a href="${app}/#/reports" style="display:inline-block;margin-top:8px;padding:12px 18px;border-radius:12px;background:#D2603A;color:#FFF6E9;text-decoration:none;font-weight:700">Your reports</a></div>`);
});
router.post("/account/email/pause", authMiddleware, async (req, res) => {
  try { const u = await geDb.setEmailPaused(req.user.id, !!req.body.paused); res.json({ email_paused: !!u.emailPaused }); }
  catch (err) { sendError(res, 500, "PAUSE_ERROR", err.message); }
});

// Cancel at period end — one call, no questions. Reports and history stay.
router.post("/billing/cancel", authMiddleware, async (req, res) => {
  try {
    const r = await billingManager.cancelSubscription(req.user.id);
    if (req.body && typeof req.body.reason === "string" && req.body.reason.trim()) console.log(`[Billing] cancel reason from ${req.user.id}: ${req.body.reason.trim().slice(0, 200)}`);
    res.json(r);
  } catch (err) { sendError(res, 500, "CANCEL_ERROR", err.message); }
});
router.post("/billing/resume", authMiddleware, async (req, res) => {
  try { res.json(await billingManager.resumeSubscription(req.user.id)); }
  catch (err) { sendError(res, 500, "RESUME_ERROR", err.message); }
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

// Queue evaluation (TEMP: no auth for frontend testing; add authMiddleware back once Haron builds login)
// Reads the bearer token if one is sent, without requiring it — the free
// snapshot is anonymous, but a signed-in subscriber gets their paid tier.
const optionalAuth = async (req, _res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    const user = await verifyJWT(token);
    if (user) req.user = user;
  }
  next();
};

// Which evaluator runs for an account. business_evaluator maps to the
// growth_plan pipeline until tier 2 has its own.
async function evaluationTierFor(accountId) {
  if (!accountId || accountId === "demo-account") return "social_snapshot";
  try {
    const ent = await geDb.getEffectiveEntitlement(accountId);
    const t = ent?.current_tier || ent?.currentTier || "social_snapshot";
    if (t && t !== "social_snapshot") return "growth_plan"; // every paid tier runs the plan pipeline today
  } catch (err) {
    console.warn("[Growth Engine] Entitlement lookup failed, defaulting to snapshot:", err.message);
  }
  return "social_snapshot";
}

// The four intake answers (plus optional link and notes). Anything else is dropped.
const CTX_ENUM = {
  horizon: ["usual", "fewer_shoots", "launch"],
  hours: ["lt2", "2_5", "5_10", "10plus"],
  goal: ["followers", "deals", "sell", "bookings", "consistency"],
  style: ["on_camera", "behind", "photos", "help"],
};
function cleanPlanContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [k, vals] of Object.entries(CTX_ENUM)) if (vals.includes(raw[k])) out[k] = raw[k];
  if (typeof raw.link === "string" && raw.link.trim()) { const l = raw.link.trim().slice(0, 200); out.link = /^https?:\/\//i.test(l) ? l : `https://${l}`; }
  if (typeof raw.notes === "string" && raw.notes.trim()) out.notes = raw.notes.trim().slice(0, 140);
  if (typeof raw.contact === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.contact.trim())) out.contact = raw.contact.trim().slice(0, 120);
  return Object.keys(out).length ? out : null;
}
// Saved context for this account + handle, or the one sent with the request.
async function resolvePlanContext(req, accountId, handle, platform) {
  const sent = cleanPlanContext(req.body.plan_context);
  if (sent && accountId && accountId !== "demo-account") { try { await geDb.setPlanContext(accountId, handle, platform, sent); } catch { /* best-effort */ } return sent; }
  if (sent) return sent;
  if (accountId && accountId !== "demo-account") { try { return await geDb.getPlanContext(accountId, handle, platform); } catch { return null; } }
  return null;
}

router.get("/account/plan-context", authMiddleware, async (req, res) => {
  try {
    const { handle, platform } = req.query;
    if (!handle || !platform) return sendError(res, 400, "MISSING", "handle and platform are required");
    res.json({ plan_context: await geDb.getPlanContext(req.user.id, String(handle), String(platform)) });
  } catch (err) { sendError(res, 500, "CONTEXT_ERROR", err.message); }
});
router.put("/account/plan-context", authMiddleware, async (req, res) => {
  try {
    const { handle, platform } = req.body;
    if (!handle || !platform) return sendError(res, 400, "MISSING", "handle and platform are required");
    const ctx = cleanPlanContext(req.body.plan_context);
    if (!ctx) return sendError(res, 400, "INVALID_CONTEXT", "No valid answers");
    res.json({ plan_context: await geDb.setPlanContext(req.user.id, String(handle), String(platform), ctx) });
  } catch (err) { sendError(res, 500, "CONTEXT_ERROR", err.message); }
});

router.post("/evaluate/social-snapshot", optionalAuth, validateEvaluationRequest, async (req, res) => {
  try {
    const { handle, platform, category } = req.body;
    const email = req.body.email || req.user?.email || null;
    // Optional competitor handles from the form. Stored with the job; the
    // comparison itself is a Growth Plan feature and runs after the report.
    const competitors = (Array.isArray(req.body.competitors) ? req.body.competitors : [])
      .map((h) => String(h || "").replace(/^@/, "").trim().toLowerCase())
      .filter((h) => /^[a-z0-9._-]{1,60}$/.test(h) && h !== String(handle).toLowerCase())
      .slice(0, MAX_COMPETITORS);
    const accountId = req.user?.id || "demo-account";
    const tier = await evaluationTierFor(accountId);

    // (2) Paid on-demand runs are metered per day; the weekly refresh is scheduled
    // and doesn't count. Every run is a fresh Apify pull (cached 24h) plus five
    // LLM calls, so an unmetered "run again" button is an open tab on the bill.
    if (tier !== "social_snapshot" && !req.body.scheduled) {
      const limit = Number(process.env.PAID_RUNS_PER_DAY || 5);
      const used = await geDb.getUsage(accountId, "eval");
      if (used >= limit) {
        return res.status(429).json({ error: `You've run ${used} evaluations today. The plan refreshes itself weekly — or try again tomorrow.`, code: "RUN_LIMIT_REACHED", status: 429, used, limit });
      }
      await geDb.bumpUsage(accountId, "eval");
    }
    // Global free-tier ceiling so a share-card spike can't run up the bill overnight.
    if (tier === "social_snapshot") {
      const cap = Number(process.env.FREE_RUNS_PER_DAY_GLOBAL || 500);
      const used = await geDb.getUsage("__global__", "free_eval");
      if (used >= cap) {
        return res.status(503).json({ error: "We've hit today's limit for free scores. Try again tomorrow, or sign in for a plan.", code: "GLOBAL_CAP", status: 503 });
      }
      await geDb.bumpUsage("__global__", "free_eval");
    }

    // The free Snapshot is one per account (handle + platform), not per email —
    // an email is free to invent, a handle is the thing that costs us money.
    // If it's already been scored we point at that report instead of a wall.
    if (tier === "social_snapshot" && process.env.FREE_SNAPSHOTS_PER_EMAIL !== "unlimited") {
      const existing = await geDb.findFreeSnapshotForHandle(handle, platform);
      if (existing && existing.reportId) {
        return res.status(402).json({
          error: `@${handle} has already been scored for free. Open that report, or start a Growth Plan to score it again and watch it change.`,
          code: "FREE_LIMIT_REACHED",
          status: 402,
          report_id: existing.reportId,
          generated_at: existing.generatedAt,
          upgrade_tier: "growth_plan",
        });
      }
      if (existing && existing.jobId) {
        // Same account is being scored right now — hand back that job.
        return res.json({ job_id: existing.jobId, status: "queued", tier, deduplicated: true });
      }
    }

    // Intake answers: the free form may send just the 90-day horizon; paid
    // runs carry the full set (sent now, or saved earlier).
    const plan_context = await resolvePlanContext(req, accountId, handle, platform);
    const input = { handle, platform, category, email, competitors, plan_context };
    if (req.body.rerun_of && typeof req.body.rerun_of === "string") input.rerun_of = req.body.rerun_of.slice(0, 60);

    // Create job in database
    const jobResult = await geDb.createJob(accountId, tier, input);
    const jobId = jobResult.jobId;

    // Process asynchronously (fire-and-forget)
    jobQueue.processJob(jobId, accountId, tier, input)
      .catch(err => console.error(`[Growth Engine] Async job ${jobId} error:`, err));

    res.json({ job_id: jobId, status: "queued", tier });
  } catch (err) {
    console.error("[Growth Engine] Queue error:", err);
    sendError(res, 500, "JOB_QUEUE_ERROR", err.message);
  }
});

// Poll job status (no auth for demo)
router.get("/job/:jobId", async (req, res) => {
  try {
    const job = await geDb.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const stageMatch = /^(finding|reading|scoring|writing):(\d)$/.exec(job.stage || "");
    const response = {
      status: job.status,
      stage: stageMatch ? stageMatch[1] : (job.stage || job.status),
      step: stageMatch ? Number(stageMatch[2]) : (job.status === "running" ? 1 : null),
      total_steps: 4,
      created_at: job.created_at,
      updated_at: job.updated_at,
      error: job.error,
      resultPayload: job.resultPayload,
    };

    // Compatibility: add `overall` field for frontend testing
    // Extract from report narrative if available
    if (job.resultPayload?.reportBody?.narrative) {
      response.overall = job.resultPayload.reportBody.narrative;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get report (no auth for demo)
router.get("/reports/:reportId", optionalAuth, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    // Free snapshots are link-shareable (the id is unguessable). Paid reports
    // belong to the account that paid for them.
    if (report.tier && report.tier !== "social_snapshot" && report.accountId !== req.user?.id) {
      return sendError(res, req.user ? 403 : 401, req.user ? "NOT_YOUR_REPORT" : "MISSING_TOKEN", "Sign in to view this report");
    }

    // Compatibility: add `overall` field for frontend testing
    // Frontend looks for result.overall; we mirror reportBody.narrative here
    const responseReport = {
      ...report,
      overall: report.reportBody?.narrative || "Report generated successfully"
    };

    res.json(responseReport);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Competitor comparison — Growth Plan and above. Scores up to five handles
// with the same deterministic scorer and stores the result on the report.
router.post("/reports/:reportId/competitors", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    if (report.accountId !== req.user.id) return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    const access = await billingManager.checkEntitlement(req.user.id, "growth_plan");
    if (!access.hasAccess) return res.status(402).json({ error: "Competitor comparison is part of the Growth Plan.", code: "UPGRADE_REQUIRED", required_tier: "growth_plan", status: 402 });
    const handles = Array.isArray(req.body.handles) ? req.body.handles : [];
    if (!handles.length || handles.length > MAX_COMPETITORS) return sendError(res, 400, "INVALID_HANDLES", `Provide 1–${MAX_COMPETITORS} competitor handles`);
    // (8) Competitor pulls are metered per day; the 24h profile cache means
    // re-running the same set is free, so this only bites on churning handles.
    const climit = Number(process.env.COMPETITOR_PULLS_PER_DAY || 15);
    const cused = await geDb.getUsage(req.user.id, "competitor");
    if (cused + handles.length > climit) return res.status(429).json({ error: `That's ${cused + handles.length} competitor pulls today; the limit is ${climit}. Try again tomorrow.`, code: "COMPETITOR_LIMIT_REACHED", status: 429 });
    await geDb.bumpUsage(req.user.id, "competitor", handles.length);
    const comparison = await compareCompetitors({
      handle: report.business.handle, platform: report.business.platform, category: report.business.category, handles,
    });
    // The owner's row should match the report they're looking at, not a re-pull.
    const own = report.reportBody?.scores;
    if (own && Number.isFinite(own.overall)) {
      comparison.you.overall = own.overall;
      comparison.you.dimensions = (own.dimensions || []).map((d) => ({ label: d.label, score: d.score }));
      const scored = comparison.competitors.filter((c) => c.ok);
      comparison.rank = { position: [own.overall, ...scored.map((c) => c.overall)].sort((a, b) => b - a).indexOf(own.overall) + 1, of: scored.length + 1 };
    }
    await geDb.patchReportBody(report.reportId, { competitors: comparison });
    res.json(comparison);
  } catch (err) {
    sendError(res, 500, "COMPETITOR_ERROR", err.message);
  }
});

// Score history for a handle (signed-in accounts only — anonymous runs aren't linked)
router.get("/account/history", authMiddleware, async (req, res) => {
  try {
    const { handle, platform } = req.query;
    if (!handle) return sendError(res, 400, "INVALID_HANDLE", "handle is required");
    res.json({ handle, platform: platform || "instagram", history: await geDb.listScoreHistory(req.user.id, handle, platform || "instagram") });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time unlock: the full plan for one report, no subscription.
// Runs the plan pipeline once for the report's handle; the result is a new
// growth_plan-tier report with refresh_due_at cleared and unlock metadata.
router.post("/reports/:reportId/unlock", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    // A free report is anonymous until adopted; adopt-on-signup covers most
    // cases, and an explicit unlock from the owner's email covers the rest.
    if (report.accountId !== req.user.id && report.accountId !== "demo-account") return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    if (report.tier && report.tier !== "social_snapshot") return res.json({ already_unlocked: true, report_id: report.reportId });

    const payment = await billingManager.purchaseOneTime(req.user.id, "plan_unlock");
    if (payment.status !== "succeeded" && !payment.mock) return res.status(402).json({ error: "Payment did not complete", code: "PAYMENT_INCOMPLETE", status: 402, payment });

    const b = report.business || {};
    const plan_context = await resolvePlanContext(req, req.user.id, b.handle, b.platform);
    const input = { handle: b.handle, platform: b.platform, category: b.category, email: req.user.email || null, one_time_unlock: true, unlock_of: report.reportId, payment_id: payment.paymentId, plan_context };
    const { jobId } = await geDb.createJob(req.user.id, "growth_plan", input);
    jobQueue.processJob(jobId, req.user.id, "growth_plan", input).catch((err) => console.error(`[Unlock] job ${jobId} failed:`, err.message));
    res.json({ job_id: jobId, status: "queued", tier: "growth_plan", one_time: true, payment: { id: payment.paymentId, amount: payment.amountFormatted } });
  } catch (err) {
    sendError(res, 500, "UNLOCK_ERROR", err.message);
  }
});

// Phase check-in (day 30 / 60): "nothing changed" records the answer; "changed"
// saves new answers and rewrites the plan. Also used to accept a nudge.
router.post("/reports/:reportId/checkin", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    if (report.accountId !== req.user.id) return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    const body = report.reportBody || {};
    if (!report.tier || report.tier === "social_snapshot" || body.one_time_unlock) return res.status(402).json({ error: "Check-ins and plan updates are part of the Growth Plan subscription.", code: "UPGRADE_REQUIRED", required_tier: "growth_plan", status: 402 });
    const phase = Number(req.body.phase) || (body.nudge ? body.nudge.phase : 0);
    const key = req.body.nudge ? `nudge_${String(req.body.nudge).slice(0, 30)}` : `p${phase}`;
    const checkins = { ...(body.checkins || {}), [key]: { at: Date.now(), changed: !!req.body.changed } };
    const patch = { checkins };
    if (req.body.nudge) patch.nudge = null;
    let ctx = null;
    if (req.body.changed) {
      const merged = { ...(body.plan_context || {}), ...(cleanPlanContext(req.body.plan_context) || {}), ...(req.body.nudge && body.nudge?.apply ? body.nudge.apply : {}) };
      ctx = cleanPlanContext(merged);
      if (ctx) await geDb.setPlanContext(req.user.id, body.business?.handle, body.business?.platform, ctx);
    }
    await geDb.patchReportBody(report.reportId, patch);
    if (!req.body.changed || !ctx) return res.json({ ok: true, checkins });
    // Rewrite the plan against the new answers. Counts as a paid run.
    const limit = Number(process.env.PAID_RUNS_PER_DAY || 5);
    const used = await geDb.getUsage(req.user.id, "eval");
    if (used >= limit) return res.status(429).json({ error: `You've run ${used} evaluations today; the plan will pick up your answers at the next weekly refresh.`, code: "RUN_LIMIT_REACHED", status: 429, checkins });
    await geDb.bumpUsage(req.user.id, "eval");
    const b = body.business || {};
    const input = { handle: b.handle, platform: b.platform, category: b.category, email: req.user.email || null, plan_context: ctx, rerun_of: report.reportId, checkins };
    const { jobId } = await geDb.createJob(req.user.id, "growth_plan", input);
    jobQueue.processJob(jobId, req.user.id, "growth_plan", input).catch((err) => console.error(`[Checkin] job ${jobId} failed:`, err.message));
    res.json({ ok: true, checkins, job_id: jobId, status: "queued", tier: "growth_plan" });
  } catch (err) {
    sendError(res, 500, "CHECKIN_ERROR", err.message);
  }
});

// Delete account + everything written for it (settings → "Delete my account")
router.delete("/account", authMiddleware, async (req, res) => {
  try {
    res.json(await geDb.deleteAccount(req.user.id));
  } catch (err) {
    sendError(res, 500, "DELETE_ERROR", err.message);
  }
});

// Coming-soon platform waitlist
router.post("/waitlist", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const platform = String(req.body.platform || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, "INVALID_EMAIL", "Email is required");
    if (!/^[a-z]{1,30}$/.test(platform)) return sendError(res, 400, "INVALID_PLATFORM", "Platform is required");
    await geDb.addWaitlist(email, platform);
    res.json({ ok: true, platform });
  } catch (err) {
    sendError(res, 500, "WAITLIST_ERROR", err.message);
  }
});

// Mark a move done / not done on a report the caller owns
router.post("/reports/:reportId/moves", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    if (report.accountId !== req.user.id) return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    const key = String(req.body.key || "");
    if (!/^[a-z0-9_-]{1,40}$/i.test(key)) return sendError(res, 400, "INVALID_MOVE", "key is required");
    const done = { ...(report.reportBody?.moves_done || {}) };
    if (req.body.done) done[key] = Date.now(); else delete done[key];
    await geDb.patchReportBody(report.reportId, { moves_done: done });
    res.json({ moves_done: done });
  } catch (err) {
    sendError(res, 500, "MOVE_ERROR", err.message);
  }
});

// Does doing the moves move the score? Aggregate only — no handles.
router.get("/outcomes", async (req, res) => {
  try { res.json(await geDb.getOutcomeSummary()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Category baseline status (public; powers the "N profiles scored" copy)
router.get("/baselines", async (req, res) => {
  try {
    res.json(await geDb.getBaselineSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/baselines/:category", async (req, res) => {
  try {
    const base = await geDb.getCategoryBaseline(req.params.category, { platform: req.query.platform || null });
    res.json(base || { n: 0, min_n: 20, ready: false });
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
router.post("/billing/subscribe", authMiddleware, validateSubscriptionRequest, async (req, res) => {
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
    sendError(res, 500, "SUBSCRIPTION_ERROR", err.message);
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
  const want = process.env.ADMIN_TOKEN;
  const got = req.get("x-admin-token") || req.query.token;
  if (!want || got !== want) return sendError(res, want ? 401 : 404, want ? "UNAUTHORIZED" : "NOT_FOUND", want ? "Admin token required" : "Not found");
  try {
    const stats = jobQueue.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
