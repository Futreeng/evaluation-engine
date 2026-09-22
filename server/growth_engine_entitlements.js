// Central entitlement checks (pricing add-on, P.5). Every paid feature asks
// here — nothing scatters `tier !== "social_snapshot"` any more.
//
//   const ent = await entitlements.effective(accountId)   → tier, plan, limits, founder, locked price, pending downgrade, pause
//   entitlements.has(ent, "post_reviews")                  → boolean
//   await entitlements.checkLimit(accountId, "post_regens_per_week") → { ok, used, limit, resets_at, upgrade }
//   await entitlements.use(accountId, "post_regens_per_week", n)     → bumps usage (daily rows summed per ISO week)
//
// A limit hit is logged as a `limit_hit` event so we can see whether the
// numbers are set too tight. The core report is never gated by a limit.

const geDb = require("./growth_engine_db_select");
const plans = require("./growth_engine_plans");
const events = require("./growth_engine_events");

const DAY = 86400000;
// Weekly windows reset Monday 00:00 UTC.
function weekStart(now = Date.now()) { const d = new Date(now); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY; }
function weekEnd(now = Date.now()) { return weekStart(now) + 7 * DAY; }

// Usage kinds ↔ limit keys. Usage rows are per day; a weekly limit sums the week.
const USAGE_KIND = { post_regens_per_week: "post_regen", post_reviews_per_week: "post_review", written_posts_per_week: "written_posts" };

async function effective(accountId) {
  if (!accountId || accountId === "demo-account") return { tier: "social_snapshot", plan: plans.planFor("social_snapshot"), limits: plans.LIMITS.social_snapshot, founder: false, price_cents: 0, billing_cycle: null, pending_tier: null, paused: false, anonymous: true };
  const ent = await geDb.getEffectiveEntitlement(accountId);
  const tier = ent?.currentTier || "social_snapshot";
  const paid = tier !== "social_snapshot";
  // P.3: subscribers from before the price update carry no stored price → they keep the legacy price.
  // No stored price: a founder back on Growth pays the founders price; anyone else from before the update keeps the legacy price.
  const cycle = ent?.billingCycle || "monthly";
  const price = paid ? (ent.priceCents ?? (tier === "growth_plan" ? (ent.founder ? (cycle === "annual" ? plans.FOUNDERS.growth_annual : plans.FOUNDERS.growth_monthly) : plans.LEGACY_GROWTH_PRICE_CENTS) : plans.priceFor(tier, cycle))) : 0;
  return {
    tier, plan: plans.planFor(tier), limits: plans.LIMITS[tier] || plans.LIMITS.social_snapshot,
    founder: !!ent?.founder, price_cents: price, billing_cycle: ent?.billingCycle || (paid ? "monthly" : null),
    pending_tier: ent?.pendingTier || null, pending_at: ent?.pendingTierAt || null,
    paused: !!(ent?.pausedUntil && ent.pausedUntil > Date.now()), paused_until: ent?.pausedUntil || null,
    cancel_at: ent?.cancelAt || null, period_end: ent?.billingPeriodEnd || null, raw: ent,
  };
}

const has = (ent, feature) => plans.hasFeature(ent.tier, feature);
const hasPlan = (ent) => has(ent, "full_plan");

// { ok, used, limit, resets_at, upgrade }. limit === null → the tier has no access at all (ok:false, code UPGRADE_REQUIRED).
async function checkLimit(accountId, key, { need = 1, now = Date.now() } = {}) {
  const ent = await effective(accountId);
  const limit = plans.limitFor(ent.tier, key);
  const upgrade = plans.upgradeFor(ent.tier, key);
  if (limit == null) return { ok: false, code: "UPGRADE_REQUIRED", used: 0, limit: null, resets_at: null, upgrade, tier: ent.tier };
  const kind = USAGE_KIND[key];
  const used = kind ? await geDb.getUsageSince(accountId, kind, weekStart(now)) : 0;
  const ok = used + need <= limit;
  if (!ok) events.track("limit_hit", { accountId, props: { key, used, limit, tier: ent.tier, upgrade } });
  return { ok, code: ok ? null : "LIMIT_REACHED", used, limit, resets_at: weekEnd(now), upgrade, tier: ent.tier };
}
async function use(accountId, key, n = 1) { const kind = USAGE_KIND[key]; if (kind) await geDb.bumpUsage(accountId, kind, n); }

// The friendly 429/402 body for a failed check.
function denial(check, what) {
  if (check.code === "UPGRADE_REQUIRED") {
    const t = plans.planFor(check.upgrade || "growth_plan");
    return { status: 402, body: { error: `${what} is part of ${t.name}.`, code: "UPGRADE_REQUIRED", required_tier: check.upgrade || "growth_plan", status: 402 } };
  }
  const reset = new Date(check.resets_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  const up = check.upgrade ? plans.planFor(check.upgrade) : null;
  return { status: 429, body: { error: `That's ${check.used} of ${check.limit} ${what.toLowerCase()} this week. It resets ${reset}${up ? `, or ${up.name} raises it to ${plans.limitFor(check.upgrade, keyOf(what)) ?? "more"}` : ""}.`, code: "LIMIT_REACHED", used: check.used, limit: check.limit, resets_at: check.resets_at, upgrade: check.upgrade, status: 429 } };
}
const keyOf = (what) => ({ "post rewrites": "post_regens_per_week", "post reviews": "post_reviews_per_week", "written posts": "written_posts_per_week", "competitor handles": "competitor_handles" }[String(what).toLowerCase()] || null);

// Express helper: sends the denial and returns false, or returns the check.
async function gate(res, accountId, key, what, opts) {
  const c = await checkLimit(accountId, key, opts);
  if (c.ok) return c;
  const d = denial(c, what); res.status(d.status).json(d.body); return null;
}

module.exports = { effective, has, hasPlan, checkLimit, use, denial, gate, weekStart, weekEnd, USAGE_KIND };
