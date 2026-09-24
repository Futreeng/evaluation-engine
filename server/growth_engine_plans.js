// Plans — the one place prices, limits and feature lists live (pricing add-on,
// P.1–P.4). Everything is served through /billing/pricing; the front end
// hardcodes nothing. Env overrides:
//
//   PLAN_PRICES_JSON   {"growth_plan":{"monthly":1900,"annual":19000}, ...}   cents
//   PLAN_LIMITS_JSON   {"growth_plan":{"post_regens_per_week":10}, ...}
//   FOUNDERS_CAP=400   FOUNDERS_GROWTH_MONTHLY=1200   FOUNDERS_GROWTH_ANNUAL=10800
//   LEGACY_GROWTH_PRICE_CENTS=1200   what pre-update subscribers keep paying (P.3)
//   ENABLE_ONE_TIME_UNLOCK=true      the old $15 60-day unlock (off: P.8 earmarks a one-time product)

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const jsonEnv = (k) => { try { return process.env[k] ? JSON.parse(process.env[k]) : {}; } catch { console.warn(`[Plans] ${k} did not parse; using defaults`); return {}; } };
const PRICE_OVERRIDES = jsonEnv("PLAN_PRICES_JSON");
const LIMIT_OVERRIDES = jsonEnv("PLAN_LIMITS_JSON");

// Prices in cents. Annual = 10 × monthly ("2 months free").
const PRICES = {
  social_snapshot: { monthly: 0, annual: 0 },
  maintenance: { monthly: num(process.env.MAINTENANCE_PRICE_CENTS, 500), annual: null },
  growth_plan: { monthly: 1900, annual: 19000 },
  growth_plan_pro: { monthly: 3900, annual: 39000 },
  business_growth: { monthly: 3900, annual: 39000 },
  business_evaluator: { monthly: 9900, annual: 99000 },
  agency: { monthly: 24900, annual: 249000 },
};
for (const [k, v] of Object.entries(PRICE_OVERRIDES)) if (PRICES[k] && v && typeof v === "object") PRICES[k] = { ...PRICES[k], ...v };

// Fair-use limits (P.4). `null` = no access to that feature at all.
const LIMITS = {
  social_snapshot: { post_regens_per_week: null, post_reviews_per_week: null, written_posts_per_week: null, competitor_handles: null, rescore_days: null, platforms: 1 },
  maintenance: { post_regens_per_week: null, post_reviews_per_week: null, written_posts_per_week: null, competitor_handles: null, rescore_days: 7, platforms: 1 },
  growth_plan: { post_regens_per_week: 10, post_reviews_per_week: 7, written_posts_per_week: 6, competitor_handles: 5, rescore_days: 7, platforms: 1 },
  growth_plan_pro: { post_regens_per_week: 25, post_reviews_per_week: 20, written_posts_per_week: 12, competitor_handles: 10, rescore_days: 3, platforms: 99 },
  business_growth: { post_regens_per_week: 10, post_reviews_per_week: 7, written_posts_per_week: 6, competitor_handles: 5, rescore_days: 7, platforms: 1 },
  business_evaluator: { post_regens_per_week: 25, post_reviews_per_week: 20, written_posts_per_week: 12, competitor_handles: 10, rescore_days: 3, platforms: 99 },
  agency: { post_regens_per_week: 50, post_reviews_per_week: 50, written_posts_per_week: 24, competitor_handles: 10, rescore_days: 3, platforms: 99 },
};
for (const [k, v] of Object.entries(LIMIT_OVERRIDES)) if (LIMITS[k] && v && typeof v === "object") LIMITS[k] = { ...LIMITS[k], ...v };

// What each tier includes. `features` are the plain-language page lines; the
// entitlement checks use the `has` set.
const FREE_HAS = ["score", "dimensions", "evidence", "best_times", "first_moves", "roast", "score_card", "share_page"];
const GROWTH_HAS = [...FREE_HAS, "full_plan", "calendar", "written_posts", "weekly_rescore", "score_history", "score_emails", "post_reviews", "monday_move", "levels", "streaks", "records", "milestones", "trend_brief", "competitors", "goal_progress", "annual_offer"];
const PRO_HAS = [...GROWTH_HAS, "all_platforms", "fast_rescore"];
const TIERS = {
  social_snapshot: {
    tier: "social_snapshot", name: "Snapshot", rank: 0, has: FREE_HAS, note: "No card, ever",
    description: "See where your account stands and why.",
    features: ["One free Snapshot per handle", "Your score, the four dimensions, and the posts behind each one", "Best time to post", "The first move of each phase", "Roast mode, all heat levels, with the roast card", "The score card and share page"],
    cta: "Score my account",
  },
  maintenance: {
    tier: "maintenance", name: "Maintenance", rank: 1, has: [...FREE_HAS, "weekly_rescore", "score_history", "score_emails", "levels", "milestones"], hidden: true,
    description: "Keep the weekly rescore and your score history. No plan, no written posts, no reviews, no Monday move.",
    features: ["Re-scored every week", "Score history and trend", "Levels and milestones kept", "No moves, calendar, posts or reviews"],
    cta: "Switch to Maintenance",
  },
  growth_plan: {
    tier: "growth_plan", name: "Growth Plan", rank: 2, has: GROWTH_HAS, popular: true,
    description: "Your full plan, posts written for you every week, and a score that moves.",
    features: ["Your full plan: every move, plus the 12-week posting calendar", "Posts written for you every week — 6, with hooks, captions and scripts", "See your score move every week — history and change emails", "48-hour reviews of every new post", "The Monday move", "Levels, streaks with freezes, personal records and milestone cards", "What's working in your niche, weekly", "Competitor comparison, up to 5 handles", "One platform"],
    cta: "Start Growth Plan",
  },
  growth_plan_pro: {
    tier: "growth_plan_pro", name: "Pro", rank: 3, has: PRO_HAS,
    description: "Every platform you're on, rescored every 3 days, with double the writing.",
    features: ["Everything in Growth Plan", "All supported platforms scored under one plan", "Rescores every 3 days instead of weekly", "12 written posts per week", "Competitor comparison, up to 10 handles", "Higher fair-use limits"],
    cta: "Start Pro",
  },
  business_growth: { tier: "business_growth", name: "Business Growth Plan", rank: 2, has: GROWTH_HAS, business: true, description: "Scored against your category; the plan is written for bookings.", features: ["Everything in Growth Plan", "Category benchmarks for businesses", "Moves written for bookings, not followers"], cta: "Start Business Growth Plan" },
  business_evaluator: { tier: "business_evaluator", name: "Business Evaluator", rank: 3, has: PRO_HAS, business: true, description: "The plan answers to the P&L, not just the feed.", features: ["Everything in Business Growth Plan", "Margin-aware recommendations", "Action plan checklist with owners and dates", "Rescores every 3 days"], cta: "Start Business Evaluator" },
  agency: { tier: "agency", name: "Agency", rank: 4, has: PRO_HAS, business: true, hidden: true, description: "Many accounts, one dashboard.", features: [], cta: "Talk to us" },
};

// Founders pricing (P.2): the first N paid subscribers get Growth at the launch price, locked while active.
const FOUNDERS = {
  cap: num(process.env.FOUNDERS_CAP, 400),
  growth_monthly: num(process.env.FOUNDERS_GROWTH_MONTHLY, 1200),
  growth_annual: num(process.env.FOUNDERS_GROWTH_ANNUAL, 10800),
};
// Move buttons (1.5.1): which action types may render, and what free users see for write_post.
//   CTA_FLAGS_JSON={"write_post":true,"see_example":true,"fix_profile":false,"mark_done":true}
//   FREE_CTA_MODE=paywall|hidden   paywall: free users see write_post and land on pricing; hidden: they don't see it
const CTA = { flags: { write_post: true, see_example: true, fix_profile: false, mark_done: true, ...jsonEnv("CTA_FLAGS_JSON") }, free_mode: process.env.FREE_CTA_MODE === "hidden" ? "hidden" : "paywall" };
const LEGACY_GROWTH_PRICE_CENTS = num(process.env.LEGACY_GROWTH_PRICE_CENTS, 1200);
const ONE_TIME_UNLOCK_ENABLED = process.env.ENABLE_ONE_TIME_UNLOCK === "true";

const TIER_ORDER = ["social_snapshot", "maintenance", "growth_plan", "growth_plan_pro", "business_growth", "business_evaluator", "agency"];
function planFor(tier) { return TIERS[tier] || TIERS.social_snapshot; }
function priceFor(tier, cycle = "monthly") { const p = PRICES[tier] || PRICES.social_snapshot; return cycle === "annual" ? (p.annual ?? p.monthly * 10) : p.monthly; }
function limitFor(tier, key) { const l = LIMITS[tier] || LIMITS.social_snapshot; return l[key] === undefined ? null : l[key]; }
function hasFeature(tier, feature) { return planFor(tier).has.includes(feature); }
function rankOf(tier) { return planFor(tier).rank; }
// The next tier up that raises a given limit — for "upgrade to Pro" prompts.
function upgradeFor(tier, key) {
  const cur = limitFor(tier, key);
  for (const t of ["growth_plan", "growth_plan_pro"]) { const v = limitFor(t, key); if (rankOf(t) > rankOf(tier) && (cur == null || (v != null && v > cur))) return t; }
  return null;
}
// Public view for /billing/pricing: a tier row with prices in dollars.
function publicTier(tier, overrides = {}) {
  const p = planFor(tier);
  const monthly = overrides.monthly ?? priceFor(tier, "monthly"), annual = overrides.annual ?? priceFor(tier, "annual");
  return { tier: p.tier, name: p.name, description: p.description, monthlyPrice: monthly / 100, annualPrice: annual / 100, popular: !!p.popular, note: p.note, features: p.features, cta: p.cta, limits: LIMITS[tier], has: p.has };
}

module.exports = { CTA, PRICES, LIMITS, TIERS, TIER_ORDER, FOUNDERS, LEGACY_GROWTH_PRICE_CENTS, ONE_TIME_UNLOCK_ENABLED, planFor, priceFor, limitFor, hasFeature, rankOf, upgradeFor, publicTier };
