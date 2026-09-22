const express = require("express");
const { v4: uid } = require("uuid");
const geDb = require("../growth_engine_db_select");
const { evaluateProfile } = require("../growth_engine_evaluator");
const BillingManager = require("../growth_engine_billing");
const JobQueue = require("../growth_engine_job_queue");
const { compareCompetitors, MAX_COMPETITORS } = require("../growth_engine_competitors");
const { signup, login, verifyJWT, requestPasswordReset, resetPassword } = require("../auth");
const mailer = require("../mailer");
const promos = require("../growth_engine_promos");
const events = require("../growth_engine_events");
const costs = require("../growth_engine_costs");
const pricingAB = require("../growth_engine_pricing");
// Which price variant this request sees: the account's stored one, else a
// stable hash of the anonymous browser id (so the same visitor keeps it).
async function variantFor(req) {
  if (req.user?.id) { try { const u = await geDb.getUserById(req.user.id); if (u?.priceVariant && pricingAB.isVariant(u.priceVariant)) return u.priceVariant; } catch { /* fall through */ } }
  return pricingAB.assign(req.get("x-anon-id") || req.ip || "");
}
const { TIER_PRICING, ONE_TIME_PRICING } = require("../growth_engine_billing");

// Resolve a promo code for a product into a quote, or an error string.
// product: growth_plan | plan_unlock. accountId optional (anonymous preview).
async function resolvePromo(code, product, billingCycle, accountId, variantPrices = null) {
  const c = promos.normalizeCode(code);
  if (!c) return { error: "Enter a code." };
  const promo = await geDb.getPromo(c);
  const usable = promos.checkUsable(promo, product, { redeemedByAccount: accountId ? await geDb.hasRedeemed(c, accountId) : false });
  if (!usable.ok) return { error: usable.reason };
  const gp = variantPrices?.growth_plan || TIER_PRICING.growth_plan, ot = variantPrices?.plan_unlock || ONE_TIME_PRICING.plan_unlock;
  const base = product === "growth_plan" ? (billingCycle === "annual" ? Math.floor(gp * 12 * 0.75) : gp) : ot;
  const qte = promos.quote(promo, product, base, billingCycle);
  if (!qte) return { error: "That code doesn't apply here." };
  if (!qte.applicable) return { error: qte.description };
  return { promo, code: c, product, base_cents: base, amount_cents: qte.amountCents, free_months: qte.freeMonths, description: qte.description, stripeCouponId: promo.stripe_coupon_id || null };
}
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
    const profile = { isBusiness: req.body.is_business === true || req.body.is_business === "yes", niche: typeof req.body.niche === "string" ? req.body.niche.slice(0, 40) : undefined, priceVariant: pricingAB.assign(req.get("x-anon-id") || req.ip || "") };
    const result = await signup(email, password, company_name, profile);
    const newId = result?.user?.user_id || null;
    events.track("signup", { ...events.attribution(req), accountId: newId, props: { has_company: !!company_name } });
    // Referral attribution (spec 1.8): the ref code stored on first visit → the referrer's account.
    const refCode = String(req.get("x-ref") || "").toLowerCase();
    if (newId && refCode) { try { const referrer = await geDb.getUserByRefCode(refCode); if (referrer) { await geDb.recordReferralSignup({ refCode, referrerId: referrer.userId, referredId: newId }); events.track("referral_signup", { ...events.attribution(req), accountId: newId, props: { referrer: referrer.userId } }); } } catch (e) { console.warn("[Referral] signup attribution failed:", e.message); } }
    if (newId) geDb.ensureRefCode(newId).catch(() => { });
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
const adminEmails = () => String(process.env.ADMIN_EMAILS || "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const isAdminEmail = (email) => adminEmails().includes(String(email || "").toLowerCase());
router.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await geDb.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      user_id: user.userId,
      email: user.email,
      company_name: user.companyName,
      is_admin: isAdminEmail(user.email),
      is_business: !!user.isBusiness,
      niche: user.niche || null,
      ref_code: user.refCode || null,
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
      email_prefs: await require("../growth_engine_email").prefsFor(req.user.id),
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
// Referrals (spec 1.8): your code, your link, and how many people it brought.
router.get("/account/referrals", authMiddleware, async (req, res) => {
  try {
    const code = await geDb.ensureRefCode(req.user.id);
    const base = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    res.json({ ref_code: code, link: `${base}/?ref=${code}`, ...(await geDb.referralStats(req.user.id)) });
  } catch (err) { sendError(res, 500, "REFERRAL_ERROR", err.message); }
});
router.get("/admin/referrals", requireAdmin, async (req, res) => {
  try { res.json({ referrers: await geDb.adminReferrals(Math.min(200, Number(req.query.limit) || 50)) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Email preferences (spec 1.6): per-type toggles + the master pause.
const emailSvc = require("../growth_engine_email");
router.get("/account/email-prefs", authMiddleware, async (req, res) => {
  try { res.json({ prefs: await emailSvc.prefsFor(req.user.id), types: emailSvc.PREF_TYPES }); } catch (err) { sendError(res, 500, "PREFS_ERROR", err.message); }
});
router.put("/account/email-prefs", authMiddleware, async (req, res) => {
  try {
    const cur = await emailSvc.prefsFor(req.user.id);
    const next = {}; for (const t of emailSvc.PREF_TYPES) next[t] = req.body?.[t] === undefined ? cur[t] !== false : !!req.body[t];
    await geDb.setEmailPrefs(req.user.id, next);
    if (req.body?.paused !== undefined) await geDb.setEmailPaused(req.user.id, !!req.body.paused);
    res.json({ prefs: await emailSvc.prefsFor(req.user.id), types: emailSvc.PREF_TYPES });
  } catch (err) { sendError(res, 500, "PREFS_ERROR", err.message); }
});
// One-click unsubscribe from an email footer: signed, no login. t=all pauses everything but receipts.
router.get("/email/unsubscribe", async (req, res) => {
  const u = String(req.query.u || ""), t = String(req.query.t || "all"), s = String(req.query.s || "");
  const ok = emailSvc.verifyUnsub(u, t, s) && (t === "all" || emailSvc.PREF_TYPES.includes(t));
  if (ok) { try { if (t === "all") await geDb.setEmailPaused(u, true); else { const cur = await emailSvc.prefsFor(u); const next = {}; for (const k of emailSvc.PREF_TYPES) next[k] = cur[k] !== false; next[t] = false; await geDb.setEmailPrefs(u, next); } } catch { /* fall through */ } }
  const app = (process.env.APP_URL || "").replace(/\/$/, "") || "";
  const label = { weekly_score: "weekly score emails", monday_move: "plan check-ins and Monday moves", milestones: "milestone emails", product_news: "product news" }[t] || "all emails except receipts";
  res.type("html").send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scalecraft</title>
<body style="margin:0;background:#FFF6E9;font-family:Helvetica,Arial,sans-serif;color:#2A2118"><div style="max-width:520px;margin:48px auto;padding:28px;background:#FFFDF8;border:1px solid #EADFCB;border-radius:24px">
<h1 style="margin:0;font-size:26px">${ok ? "Unsubscribed." : "That link didn't work."}</h1>
<p style="font-size:16px;line-height:1.6;color:#5B4C3B">${ok ? `You won't get ${label} any more. Your plan keeps running and your reports stay. Change this any time under Email on your reports page.` : "It may have been altered. Sign in and change your email preferences on your reports page instead."}</p>
<a href="${app}/#/reports" style="display:inline-block;margin-top:8px;padding:12px 18px;border-radius:12px;background:#D2603A;color:#FFF6E9;text-decoration:none;font-weight:700">Your reports</a></div>`);
});
router.get("/admin/emails", requireAdmin, async (req, res) => {
  try { res.json({ provider: emailSvc.providerName(), emails: await geDb.listEmailLog(Math.min(500, Number(req.query.limit) || 100)) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// One-tap "Mark done" from the Monday move email (spec 2.6): signed, no login.
router.get("/email/move-done", async (req, res) => {
  const monday = require("../growth_engine_monday");
  const r = String(req.query.r || ""), k = String(req.query.k || ""), s = String(req.query.s || "");
  const app = (process.env.APP_URL || "").replace(/\/$/, "");
  try {
    const report = await geDb.getReport(r);
    if (!report || !monday.verifyDone(r, k, s) || !/^[a-z0-9_-]{1,40}$/i.test(k)) return res.redirect(`${app}/#/reports?done=invalid`);
    const b = report.reportBody || {};
    if (!(b.moves_done || {})[k]) {
      await geDb.patchReportBody(r, { moves_done: { ...(b.moves_done || {}), [k]: Date.now() } });
      const dims = {}; for (const d of b.scores?.dimensions || []) dims[d.label] = d.score;
      geDb.logMove({ accountId: report.accountId || null, reportId: r, handle: b.business?.handle, platform: b.business?.platform, category: b.business?.category, moveKey: k, done: true, overall: b.scores?.overall ?? null, dims, planDay: b.plan_started_at ? Math.round((Date.now() - b.plan_started_at) / 86400000) : null }).catch(() => { });
      events.track("move_done", { accountId: report.accountId || null, reportId: r, props: { key: k, via: "monday_email" } });
      events.track("monday_move_done", { accountId: report.accountId || null, reportId: r, props: { key: k } });
    }
    res.redirect(`${app}/#/report/${encodeURIComponent(r)}?done=${encodeURIComponent(k)}`);
  } catch (err) { sendError(res, 500, "MOVE_ERROR", err.message); }
});
// Report-scoped opt-out for free reports that have no account (CAN-SPAM link in the footer).
router.get("/email/optout", async (req, res) => {
  const monday = require("../growth_engine_monday");
  const r = String(req.query.r || ""), s = String(req.query.s || "");
  const ok = monday.verifyOptOut(r, s);
  if (ok) { try { await geDb.patchReportBody(r, { email_optout: true }); } catch { /* fine */ } }
  const app = (process.env.APP_URL || "").replace(/\/$/, "") || "";
  res.type("html").send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scalecraft</title>
<body style="margin:0;background:#FFF6E9;font-family:Helvetica,Arial,sans-serif;color:#2A2118"><div style="max-width:520px;margin:48px auto;padding:28px;background:#FFFDF8;border:1px solid #EADFCB;border-radius:24px">
<h1 style="margin:0;font-size:26px">${ok ? "Unsubscribed." : "That link didn't work."}</h1>
<p style="font-size:16px;line-height:1.6;color:#5B4C3B">${ok ? "No more emails about this report. It stays online at the same link." : "It may have been altered."}</p>
<a href="${app}/" style="display:inline-block;margin-top:8px;padding:12px 18px;border-radius:12px;background:#D2603A;color:#FFF6E9;text-decoration:none;font-weight:700">Scalecraft</a></div>`);
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
    events.track("cancel", { ...events.attribution(req), props: { reason: (req.body?.reason || "").slice(0, 200) || null, status: r.status } });
    res.json(r);
  } catch (err) { sendError(res, 500, "CANCEL_ERROR", err.message); }
});
router.post("/billing/resume", authMiddleware, async (req, res) => {
  try { const r = await billingManager.resumeSubscription(req.user.id); events.track("resume", events.attribution(req)); res.json(r); }
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

// Browser-side funnel events (report viewed, share clicked, …). Server-side
// events are emitted where they happen. Allowlisted names only.
router.post("/events", optionalAuth, (req, res) => {
  const name = String(req.body?.name || "");
  if (!events.EVENTS.includes(name)) return sendError(res, 400, "UNKNOWN_EVENT", "Unknown event");
  events.track(name, { ...events.attribution(req), reportId: req.body?.report_id ? String(req.body.report_id).slice(0, 60) : null, props: req.body?.props });
  res.json({ ok: true });
});

// Per-IP ceiling on evaluations (spec 1.5): a burst from one address is a
// script, not a creator. Paid runs are already metered per account.
const evaluateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.EVALS_PER_IP_PER_HOUR || 10), standardHeaders: true, legacyHeaders: false, message: { error: "That's a lot of evaluations from one connection. Try again in an hour.", code: "IP_LIMIT_REACHED", status: 429 } });

router.post("/evaluate/social-snapshot", evaluateLimiter, optionalAuth, validateEvaluationRequest, async (req, res) => {
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
      // …and per email (spec 1.5): a handle is the thing that costs money, but
      // one person scoring twenty accounts on one address is the same leak.
      const perEmail = Number(process.env.FREE_SNAPSHOTS_PER_EMAIL || 1);
      if (email && Number.isFinite(perEmail) && perEmail > 0) {
        const used = await geDb.countFreeSnapshotsByEmail(email);
        if (used >= perEmail) {
          const prior = await geDb.latestFreeSnapshotForEmail(email).catch(() => null);
          return res.status(402).json({
            error: `That email has already had its free Snapshot. Open your report, or start a Growth Plan to score more accounts.`,
            code: "FREE_LIMIT_REACHED",
            status: 402,
            report_id: prior?.reportId || null,
            generated_at: prior?.generatedAt || null,
            upgrade_tier: "growth_plan",
          });
        }
      }
    }

    // Intake answers: the free form may send just the 90-day horizon; paid
    // runs carry the full set (sent now, or saved earlier).
    const plan_context = await resolvePlanContext(req, accountId, handle, platform);
    const isBusiness = req.body.is_business === true || req.body.is_business === "yes";
    const tz = typeof req.body.tz === "string" && require("../growth_engine_besttime").validTz(req.body.tz) ? req.body.tz : null;
    const input = { handle, platform, category, email, competitors, plan_context, is_business: isBusiness, tz };
    if (req.user?.id && (isBusiness || category)) geDb.setUserProfile(req.user.id, { isBusiness, niche: category }).catch(() => { });
    if (req.body.rerun_of && typeof req.body.rerun_of === "string") input.rerun_of = req.body.rerun_of.slice(0, 60);

    // Create job in database
    const attr = events.attribution(req);
    input.attribution = { anon: attr.anon, ref: attr.ref };
    const jobResult = await geDb.createJob(accountId, tier, input);
    const jobId = jobResult.jobId;
    events.track("evaluate_started", { ...attr, props: { tier, platform, category, horizon: plan_context?.horizon || null } });

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

    res.json(report);
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
    const comparison = await costs.run({ accountId: req.user.id, reportId: report.reportId, feature: "competitors" }, () => compareCompetitors({
      handle: report.business.handle, platform: report.business.platform, category: report.business.category, handles,
    }));
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

    let promo = null;
    if (req.body?.promo_code) {
      const r = await resolvePromo(req.body.promo_code, "plan_unlock", "monthly", req.user.id, pricingAB.prices(await variantFor(req)));
      if (r.error) return sendError(res, 400, "PROMO_INVALID", r.error);
      promo = { code: r.code, amountCents: r.amount_cents, description: r.description };
    }
    const vpu = pricingAB.prices(await variantFor(req));
    const payment = await billingManager.purchaseOneTime(req.user.id, "plan_unlock", null, promo, vpu.plan_unlock);
    if (payment.status !== "succeeded" && !payment.mock) return res.status(402).json({ error: "Payment did not complete", code: "PAYMENT_INCOMPLETE", status: 402, payment });
    if (promo) { try { await geDb.redeemPromo(promo.code, req.user.id, "plan_unlock", ONE_TIME_PRICING.plan_unlock - promo.amountCents); } catch (e) { console.warn("[Promo] redemption record failed:", e.message); } }

    const b = report.business || {};
    const plan_context = await resolvePlanContext(req, req.user.id, b.handle, b.platform);
    const input = { handle: b.handle, platform: b.platform, category: b.category, email: req.user.email || null, one_time_unlock: true, unlock_of: report.reportId, payment_id: payment.paymentId, plan_context, tz: report.reportBody?.tz || null };
    const { jobId } = await geDb.createJob(req.user.id, "growth_plan", input);
    jobQueue.processJob(jobId, req.user.id, "growth_plan", input).catch((err) => console.error(`[Unlock] job ${jobId} failed:`, err.message));
    events.track("unlock", { ...events.attribution(req), reportId: report.reportId, props: { amount_cents: payment.amountInCents, promo: promo?.code || null, variant: vpu.variant } });
    geDb.recordReferralPayment({ referredId: req.user.id, cents: payment.amountInCents ?? 0, product: "plan_unlock" }).catch(() => { });
    if (promo) events.track("promo_applied", { ...events.attribution(req), props: { code: promo.code, product: "plan_unlock" } });
    res.json({ job_id: jobId, status: "queued", tier: "growth_plan", one_time: true, payment: { id: payment.paymentId, amount: payment.amountFormatted } });
  } catch (err) {
    sendError(res, 500, "UNLOCK_ERROR", err.message);
  }
});

// Share card (spec 1.7): snapshot the score card for a report. Anonymous free
// reports can be shared by whoever holds the report id; paid ones by the owner.
router.post("/reports/:reportId/share", optionalAuth, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    const anon = !report.accountId || report.accountId === "demo-account";
    if (!anon && report.accountId !== req.user?.id) return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    const cards = require("../growth_engine_cards");
    const kind = cards.KINDS.includes(req.body?.kind) ? req.body.kind : "score";
    let data;
    if (kind === "moment") {
      // Only a moment this report actually earned can be carded.
      const m = (report.reportBody?.moments || []).find((x) => x.key === String(req.body?.moment_key || ""));
      if (!m) return sendError(res, 404, "NO_MOMENT", "That moment isn't on this report");
      data = cards.momentDataFrom(report.reportBody || {}, m);
      events.track("moment_shared", { ...events.attribution(req), reportId: report.reportId, props: { key: m.key } });
    } else if (kind === "roast") {
      if (!report.reportBody?.roast?.lines?.length) return sendError(res, 404, "NO_ROAST", "This report hasn't been roasted");
      data = cards.roastDataFrom(report.reportBody);
      events.track("roast_shared", { ...events.attribution(req), reportId: report.reportId, props: { heat: data.heat_label } });
    } else data = cards.scoreDataFrom(report.reportBody || {}, { thenNow: !!req.body?.then_now });
    if (!Number.isFinite(data.overall)) return sendError(res, 400, "NO_SCORE", "This report has no score to share");
    const ref = req.user?.id ? await geDb.ensureRefCode(req.user.id).catch(() => null) : null;
    const share = await geDb.createShare({ accountId: anon ? null : report.accountId, reportId: report.reportId, kind, data, ref });
    const base = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    events.track("share_clicked", { ...events.attribution(req), reportId: report.reportId, props: { kind, share_id: share.shareId } });
    res.json({ share_id: share.shareId, url: `${base}/s/${share.shareId}`, png: { story: `${base}/cards/${share.shareId}.png?size=story`, square: `${base}/cards/${share.shareId}.png?size=square` } });
  } catch (err) { sendError(res, 500, "SHARE_ERROR", err.message); }
});

// Roast my account (spec 2.1): opt-in, free for everyone, only on your own
// report (free reports are anonymous — the unguessable id is the ownership).
const roastLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.ROASTS_PER_IP_PER_HOUR || 6), standardHeaders: true, legacyHeaders: false, message: { error: "That's a lot of roasts from one connection. Try again in an hour.", code: "IP_LIMIT_REACHED", status: 429 } });
router.post("/reports/:reportId/roast", roastLimiter, optionalAuth, async (req, res) => {
  try {
    const roastSvc = require("../growth_engine_roast");
    if (!roastSvc.ENABLED) return sendError(res, 404, "ROAST_OFF", "Roast mode is off");
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    const anon = !report.accountId || report.accountId === "demo-account";
    if (!anon && report.accountId !== req.user?.id) return sendError(res, req.user ? 403 : 401, "NOT_YOUR_REPORT", "Only the account that was scored can be roasted");
    const body = report.reportBody || {};
    const heat = String(req.body?.heat || "medium");
    if (body.roast && !roastSvc.canReroast(body.roast) && body.roast.heat === heat) return res.json({ roast: body.roast, cached: true });
    if (body.roast && !roastSvc.canReroast(body.roast) && req.body?.reroast) return res.status(429).json({ error: `Roast me again opens ${roastSvc.REROAST_DAYS} days after the last one.`, code: "REROAST_TOO_SOON", status: 429, reroast_after: body.roast.reroast_after });
    events.track("roast_opened", { ...events.attribution(req), reportId: report.reportId, props: { heat } });
    const accountId = anon ? null : report.accountId;
    const out = await costs.run({ accountId, reportId: report.reportId, feature: "roast" }, () => roastSvc.roast(accountId, report, heat));
    if (out.unavailable) return res.json({ unavailable: out.unavailable });
    // Keep the old one so a re-roast can compare then and now.
    const history = [...(body.roast_history || []), ...(body.roast ? [{ generated_at: body.roast.generated_at, overall: body.roast.overall, heat: body.roast.heat }] : [])].slice(-6);
    await geDb.patchReportBody(report.reportId, { roast: out.roast, roast_history: history });
    res.json({ roast: out.roast });
  } catch (err) { sendError(res, 500, "ROAST_ERROR", err.message); }
});
router.get("/admin/roast-rejections", requireAdmin, async (req, res) => {
  try { res.json({ rejections: await geDb.listRoastRejections(Math.min(500, Number(req.query.limit) || 100)) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});

// Your next posts (spec 1.12): rewrite one post. Paid reports only; metered.
router.post("/reports/:reportId/posts/regenerate", authMiddleware, async (req, res) => {
  try {
    const report = await geDb.getReport(req.params.reportId);
    if (!report) return sendError(res, 404, "REPORT_NOT_FOUND", "Report not found");
    if (report.accountId !== req.user.id) return sendError(res, 403, "NOT_YOUR_REPORT", "This report belongs to another account");
    const body = report.reportBody || {};
    if (!report.tier || report.tier === "social_snapshot") return res.status(402).json({ error: "Post writing is part of the Growth Plan.", code: "UPGRADE_REQUIRED", required_tier: "growth_plan", status: 402 });
    const index = Number(req.body?.index);
    if (!Array.isArray(body.next_posts) || !Number.isInteger(index) || index < 0 || index >= body.next_posts.length) return sendError(res, 400, "INVALID_INDEX", "index must point at an existing post");
    const limit = Number(process.env.POST_REGENS_PER_DAY || 20);
    const used = await geDb.getUsage(req.user.id, "post_regen");
    if (used >= limit) return res.status(429).json({ error: `That's ${used} rewrites today; the limit is ${limit}. Try again tomorrow.`, code: "REGEN_LIMIT_REACHED", status: 429 });
    await geDb.bumpUsage(req.user.id, "post_regen");
    const { rewriteOnePost } = require("../growth_engine_evaluator");
    const post = await costs.run({ accountId: req.user.id, reportId: report.reportId, feature: "post_writing" }, () => rewriteOnePost(req.user.id, body, index));
    const next = [...body.next_posts]; next[index] = post;
    await geDb.patchReportBody(report.reportId, { next_posts: next });
    events.track("post_regenerated", { ...events.attribution(req), reportId: report.reportId, props: { index } });
    res.json({ post, index });
  } catch (err) { sendError(res, 500, "REGEN_ERROR", err.message); }
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
    events.track("checkin_answered", { ...events.attribution(req), reportId: report.reportId, props: { key, changed: !!req.body.changed } });
    if (!req.body.changed || !ctx) return res.json({ ok: true, checkins });
    // Rewrite the plan against the new answers. Counts as a paid run.
    const limit = Number(process.env.PAID_RUNS_PER_DAY || 5);
    const used = await geDb.getUsage(req.user.id, "eval");
    if (used >= limit) return res.status(429).json({ error: `You've run ${used} evaluations today; the plan will pick up your answers at the next weekly refresh.`, code: "RUN_LIMIT_REACHED", status: 429, checkins });
    await geDb.bumpUsage(req.user.id, "eval");
    const b = body.business || {};
    const input = { handle: b.handle, platform: b.platform, category: b.category, email: req.user.email || null, plan_context: ctx, rerun_of: report.reportId, checkins, tz: body.tz || null };
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
    require("../growth_engine_thumbs").remove(req.user.id).catch(() => { }); // their stored thumbnails go too (spec 1.4)
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
    // Founders band: hand out the founders code while it lasts.
    let code = null;
    if (platform === "founders" && process.env.FOUNDERS_PROMO_CODE) {
      const p = await geDb.getPromo(process.env.FOUNDERS_PROMO_CODE).catch(() => null);
      if (p && promos.checkUsable(p, "growth_plan").ok) code = { code: p.code, description: promos.quote(p, "growth_plan", TIER_PRICING.growth_plan, "monthly")?.description || "" };
    }
    res.json({ ok: true, platform, promo: code });
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
    { const b = report.reportBody || {}; const dims = {}; for (const d of b.scores?.dimensions || []) dims[d.label] = d.score;
      geDb.logMove({ accountId: req.user.id, reportId: report.reportId, handle: b.business?.handle, platform: b.business?.platform, category: b.business?.category, moveKey: key, done: !!req.body.done, overall: b.scores?.overall ?? null, dims, planDay: b.plan_started_at ? Math.floor((Date.now() - b.plan_started_at) / 86400000) : null }).catch((e) => console.warn("[Outcomes] move log failed:", e.message)); }
    if (req.body.done) events.track("move_done", { ...events.attribution(req), reportId: report.reportId, props: { key } });
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
// Score bands + milestone thresholds (spec 2.2, 2.5) — config, so the app
// never hardcodes them. Public: the pricing and sample pages show ranks too.
router.get("/levels", (_req, res) => {
  const m = require("../growth_engine_moments");
  res.json({ levels: m.LEVELS, milestones: m.MILESTONES });
});

router.get("/billing/pricing", optionalAuth, async (req, res) => {
  try {
    res.json(billingManager.getPricing(pricingAB.prices(await variantFor(req))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to tier
// Preview a code (pricing page, intake). Signed-in users also get the
// "already used" check.
router.post("/billing/promo/check", optionalAuth, async (req, res) => {
  const product = req.body?.product === "plan_unlock" ? "plan_unlock" : "growth_plan";
  const cycle = req.body?.billingCycle === "annual" ? "annual" : "monthly";
  const r = await resolvePromo(req.body?.code, product, cycle, req.user?.id, pricingAB.prices(await variantFor(req))).catch((e) => ({ error: e.message }));
  if (r.error) return res.status(200).json({ valid: false, reason: r.error });
  res.json({ valid: true, code: r.code, product, description: r.description, base_cents: r.base_cents, amount_cents: r.amount_cents, free_months: r.free_months });
});

router.post("/billing/subscribe", authMiddleware, validateSubscriptionRequest, async (req, res) => {
  try {
    const { tier, billingCycle } = req.body;
    const accountId = req.user.id;
    let promo = null;
    if (req.body.promo_code) {
      const r = await resolvePromo(req.body.promo_code, tier === "growth_plan" ? "growth_plan" : "other", billingCycle || "monthly", accountId, pricingAB.prices(await variantFor(req)));
      if (r.error) return sendError(res, 400, "PROMO_INVALID", r.error);
      promo = { code: r.code, amountCents: r.amount_cents, freeMonths: r.free_months, description: r.description, stripeCouponId: r.stripeCouponId };
    }

    const vp = pricingAB.prices(await variantFor(req));
    const result = await billingManager.createSubscription(accountId, tier, null, billingCycle || "monthly", promo, vp.growth_plan);
    events.track("subscribe", { ...events.attribution(req), props: { tier, billingCycle: billingCycle || "monthly", promo: promo?.code || null, amount_cents: result.amountInCents ?? null, variant: vp.variant } });
    geDb.recordReferralPayment({ referredId: accountId, cents: result.amountInCents ?? 0, product: tier }).catch(() => { });
    if (promo) events.track("promo_applied", { ...events.attribution(req), props: { code: promo.code, product: "growth_plan" } });
    if (promo) { try { await geDb.redeemPromo(promo.code, accountId, "growth_plan", (TIER_PRICING[tier] || 0) - promo.amountCents); } catch (e) { console.warn("[Promo] redemption record failed:", e.message); } }

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
// Admin: a signed-in account whose email is in ADMIN_EMAILS, or the
// ADMIN_TOKEN header for scripts. Neither configured → routes 404.
async function requireAdmin(req, res, next) {
  const want = process.env.ADMIN_TOKEN;
  const got = req.get("x-admin-token") || req.query.token;
  if (want && got === want) { req.admin = { via: "token" }; return next(); }
  if (!adminEmails().length && !want) return sendError(res, 404, "NOT_FOUND", "Not found");
  const token = req.headers.authorization?.split(" ")[1];
  const user = token ? await verifyJWT(token) : null;
  if (user && isAdminEmail(user.email)) { req.user = user; req.admin = { via: "email" }; return next(); }
  return sendError(res, user ? 403 : 401, user ? "NOT_ADMIN" : "MISSING_TOKEN", user ? "This account is not an admin" : "Sign in as an admin");
}
router.get("/admin/overview", requireAdmin, async (req, res) => {
  try { res.json({ ...(await geDb.adminOverview()), caps: { free_runs_per_day_global: Number(process.env.FREE_RUNS_PER_DAY_GLOBAL || 500), paid_runs_per_day: Number(process.env.PAID_RUNS_PER_DAY || 5), competitor_pulls_per_day: Number(process.env.COMPETITOR_PULLS_PER_DAY || 15) }, cost: { instagram: 0.003, tiktok: 0.06 }, queue: jobQueue.getStats(), outcomes: await geDb.getOutcomeSummary().catch(() => null), baselines: await geDb.getBaselineSummary().catch(() => null), mail: { configured: mailer.configured() } }); }
  catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/reports", requireAdmin, async (req, res) => {
  try { res.json({ reports: await geDb.adminRecentReports(Math.min(200, Number(req.query.limit) || 50)) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/failed-jobs", requireAdmin, async (req, res) => {
  try { res.json({ jobs: await geDb.adminFailedJobs(Math.min(200, Number(req.query.limit) || 30)) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/account", requireAdmin, async (req, res) => {
  try { const a = await geDb.adminFindAccount(String(req.query.q || "")); if (!a) return sendError(res, 404, "NOT_FOUND", "No account matches that email or handle"); res.json(a); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Account actions: resend the latest report email, comp a month, delete.
router.post("/admin/account/:userId/resend", requireAdmin, async (req, res) => {
  try {
    const user = await geDb.getUserById(req.params.userId); if (!user) return sendError(res, 404, "NOT_FOUND", "No such account");
    const reports = await geDb.listReportsByAccount(user.userId); const r = reports[0]; if (!r) return sendError(res, 404, "NO_REPORT", "No reports for this account");
    const b = r.reportBody || {}; const first = b.growth_path?.phases?.[0];
    const out = await mailer.reportReady({ to: user.email, handle: r.business?.handle, reportId: r.reportId, overall: b.scores?.overall, grade: b.scores?.overall >= 70 ? "Strong" : b.scores?.overall >= 40 ? "Fair" : "Weak", summary: b.scores?.summary, firstMove: first ? { action: first.visible_action, why: first.detail } : null, paid: r.tier !== "social_snapshot" });
    res.json({ ok: true, sent: out });
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.post("/admin/account/:userId/comp", requireAdmin, async (req, res) => {
  try {
    const user = await geDb.getUserById(req.params.userId); if (!user) return sendError(res, 404, "NOT_FOUND", "No such account");
    const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
    const ent = await geDb.getEffectiveEntitlement(user.userId);
    if (ent.currentTier === "social_snapshot") await geDb.upgradeTier(user.userId, "growth_plan");
    const end = Math.max(ent.billingPeriodEnd || 0, Date.now()) + days * 86400000;
    await geDb.setBillingPeriod(user.userId, Date.now(), end); await geDb.setCancelAt(user.userId, end);
    console.log(`[Admin] ${req.admin.via} comped ${days}d to ${user.email}`);
    res.json({ ok: true, tier: "growth_plan", until: end });
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.delete("/admin/account/:userId", requireAdmin, async (req, res) => {
  try { const user = await geDb.getUserById(req.params.userId); if (!user) return sendError(res, 404, "NOT_FOUND", "No such account"); console.log(`[Admin] ${req.admin.via} deleted ${user.email}`); res.json(await geDb.deleteAccount(user.userId)); }
  catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Baselines: export the seeded set from one database, import it into another
// (local → Render) so a niche average doesn't cost a second Apify run.
router.get("/admin/baselines/export", requireAdmin, async (req, res) => {
  try { res.json({ exported_at: Date.now(), rows: await geDb.listBaselines() }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.post("/admin/baselines/import", requireAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 5000) return sendError(res, 400, "INVALID", "rows[] required (max 5000)");
    let n = 0;
    for (const r of rows) { if (r && r.category && r.platform && r.handle && Number.isFinite(Number(r.overall))) { await geDb.recordBaseline({ category: String(r.category), platform: String(r.platform), handle: String(r.handle), overall: Number(r.overall), dimensions: Array.isArray(r.dimensions) ? r.dimensions : [] }); n++; } }
    console.log(`[Admin] ${req.admin.via} imported ${n} baseline rows`);
    res.json({ imported: n, summary: await geDb.getBaselineSummary() });
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Funnel: distinct actors per step and step-to-step conversion, by-ref
// attribution, month-two paid retention.
// Costs: totals by kind/provider/feature/model, average per report, and
// cost vs revenue per user.
router.get("/admin/costs", requireAdmin, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json({ days, ...(await geDb.adminCosts(Date.now() - days * 86400000, Math.min(200, Number(req.query.limit) || 50))), rates: costs.RATES });
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/funnel", requireAdmin, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = Date.now() - days * 86400000;
    const fn = await geDb.eventFunnel(since, events.EVENTS);
    const steps = events.FUNNEL.map((name, i) => { const a = fn.steps[name]?.actors || 0; const prev = i ? (fn.steps[events.FUNNEL[i - 1]]?.actors || 0) : null; return { name, actors: a, total: fn.steps[name]?.total || 0, from_previous: prev ? a / prev : null }; });
    res.json({ days, steps, other: Object.fromEntries(Object.entries(fn.steps).filter(([k]) => !events.FUNNEL.includes(k))), by_ref: fn.by_ref, retention_month_two: await geDb.paidRetention(), by_variant: await geDb.variantFunnel(since), variants: pricingAB.names().map((n) => ({ name: n, ...pricingAB.prices(n) })), testing: pricingAB.testing() });
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Phase-2 waitlist: business-flagged accounts and reports, JSON or CSV.
router.get("/admin/business-accounts", requireAdmin, async (req, res) => {
  try {
    const data = await geDb.listBusinessAccounts();
    if (req.query.format === "csv") {
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [["source", "email", "handle", "platform", "niche", "score", "date"].join(",")];
      for (const u of data.users) rows.push(["account", u.email, "", "", u.niche, "", new Date(u.created_at).toISOString().slice(0, 10)].map(esc).join(","));
      for (const r of data.reports) rows.push(["report", r.email, r.handle, r.platform, r.category, r.overall, new Date(r.generated_at).toISOString().slice(0, 10)].map(esc).join(","));
      res.setHeader("content-type", "text/csv"); res.setHeader("content-disposition", `attachment; filename="business-accounts-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(rows.join("\n"));
    }
    res.json(data);
  } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
// Outcomes: which moves raise scores in which niche (spec 1.15; no UI yet).
router.get("/admin/move-outcomes", requireAdmin, async (req, res) => {
  try { res.json({ rows: await geDb.moveOutcomeSummary({ category: req.query.category || null, platform: req.query.platform || null }) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/promos", requireAdmin, async (req, res) => {
  try { res.json({ promos: await geDb.listPromos() }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.post("/admin/promos", requireAdmin, async (req, res) => {
  try {
    const shape = promos.validateShape(req.body || {});
    if (await geDb.getPromo(shape.code)) return sendError(res, 409, "EXISTS", `${shape.code} already exists`);
    console.log(`[Admin] ${req.admin.via} created promo ${shape.code} (${shape.kind} ${shape.value})`);
    res.json({ promo: await geDb.createPromo(shape) });
  } catch (err) { sendError(res, 400, "INVALID_PROMO", err.message); }
});
router.patch("/admin/promos/:code", requireAdmin, async (req, res) => {
  try { const p = await geDb.setPromoActive(req.params.code, !!req.body?.active); if (!p) return sendError(res, 404, "NOT_FOUND", "No such code"); res.json({ promo: p }); }
  catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/promos/:code/redemptions", requireAdmin, async (req, res) => {
  try { res.json({ redemptions: await geDb.listRedemptions(req.params.code) }); } catch (err) { sendError(res, 500, "ADMIN_ERROR", err.message); }
});
router.get("/admin/queue-stats", requireAdmin, async (req, res) => {
  try {
    const stats = jobQueue.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
