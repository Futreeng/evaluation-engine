/**
 * Growth Engine Billing
 *
 * Stripe integration for subscription management.
 * - Create/manage subscriptions
 * - Enforce tier entitlements
 * - Track billing cycles
 * - Handle failed payments
 *
 * Development: Uses mock payment processing
 * Production: Integrates with real Stripe API
 */

const geDb = require("./growth_engine_db_select");
const crypto = require("crypto");

// Tier pricing (in cents, monthly)
// Prices live in growth_engine_plans.js (pricing add-on); this map keeps the old import shape.
const plans = require("./growth_engine_plans");
const TIER_PRICING = Object.fromEntries(plans.TIER_ORDER.map((t) => [t, plans.priceFor(t, "monthly")]));
// One-time products (not subscriptions)
const ONE_TIME_PRICING = {
  plan_unlock: 1500, // $15 — the full plan for one report, no refresh, no competitors. Priced so a second unlock costs more than a month of the plan.
};

// Annual discounts (25% off)
const ANNUAL_DISCOUNT = 0.25;

// Mock subscriptions store (in production, this would be Stripe API + database)
const mockSubscriptions = new Map();

class BillingManager {
  constructor(stripeApiKey) {
    // A placeholder like "sk_test_YOUR_KEY" must not switch billing to live
    // mode — every charge would 500. Real keys are sk_live_/sk_test_ plus a
    // long random body with no underscores or "KEY".
    const looksReal = /^sk_(live|test)_[A-Za-z0-9]{24,}$/.test(String(stripeApiKey || "")) && !/YOUR|KEY|XXX|PLACEHOLDER/i.test(String(stripeApiKey));
    if (stripeApiKey && !looksReal) console.warn(`[Billing] STRIPE_API_KEY doesn't look like a real key (${String(stripeApiKey).slice(0, 8)}…) — running in mock mode`);
    this.stripeApiKey = looksReal ? stripeApiKey : null;
    this.isProduction = looksReal;

    if (this.isProduction) {
      // Initialize Stripe SDK in production
      try {
        this.stripe = require('stripe')(stripeApiKey);
      } catch (err) {
        console.warn("[Billing] Stripe SDK not available, using mock mode");
        this.isProduction = false;
      }
    }
  }

  /**
   * One-time purchase against a report (no entitlement change).
   * Mock mode records a charge; production goes through Stripe PaymentIntents.
   */
  async purchaseOneTime(accountId, product, stripeCustomerId = null, promo = null, listOverride = null) {
    const list = listOverride || ONE_TIME_PRICING[product];
    if (!list) throw new Error(`Unknown product: ${product}`);
    // promo = { code, amountCents, description } already validated by the route
    const cents = promo ? promo.amountCents : list;
    const fmt = `$${(cents / 100).toFixed(2)}`;
    if (cents === 0) {
      const paymentId = "pay_free_" + require("crypto").randomBytes(8).toString("hex");
      console.log(`[Billing] ${product} free via ${promo?.code} for ${accountId}`);
      return { paymentId, product, amountInCents: 0, amountFormatted: "$0.00", status: "succeeded", free: true, promo: promo?.code || null };
    }
    if (this.isProduction && this.stripe) {
      const intent = await this.stripe.paymentIntents.create({ amount: cents, currency: "usd", customer: stripeCustomerId || undefined, metadata: { accountId, product, promo: promo?.code || "" } });
      return { paymentId: intent.id, product, amountInCents: cents, amountFormatted: fmt, status: intent.status, promo: promo?.code || null };
    }
    const paymentId = "pay_mock_" + require("crypto").randomBytes(8).toString("hex");
    console.log(`[Billing] Mock one-time charge ${paymentId}: ${product} ${fmt}${promo ? ` (${promo.code})` : ""} for ${accountId}`);
    return { paymentId, product, amountInCents: cents, amountFormatted: fmt, status: "succeeded", mock: true, promo: promo?.code || null };
  }

  /**
   * Create subscription for user
   * Mock mode: Simulates payment processing (for development)
   * Production: Uses real Stripe API
   */
  async createSubscription(accountId, tier, stripeCustomerId, billingCycle = "monthly", promo = null, priceOverride = null) {
    if (tier === "social_snapshot") {
      // Free tier: just create entitlement
      return await geDb.upgradeTier(accountId, tier);
    }

    if (!TIER_PRICING[tier]) throw new Error(`Unknown tier: ${tier}`);
    const cycle = billingCycle === "annual" ? "annual" : "monthly";

    // P.3: a current subscriber who re-subscribes without lapsing keeps their price.
    // P.2: founders pricing for Growth while spots remain (excluded from A/B variants).
    // Otherwise the plan price (a variant may override Growth's monthly).
    const ent = await geDb.getOrCreateEntitlement(accountId);
    let amount, founder = false;
    const keeps = ent.currentTier === tier && ent.priceCents != null && !ent.lapsedAt;
    if (keeps) amount = ent.priceCents;
    else if (tier === "growth_plan" && (await this.foundersLeft()) > 0) { amount = cycle === "annual" ? plans.FOUNDERS.growth_annual : plans.FOUNDERS.growth_monthly; founder = true; }
    else if (tier === "growth_plan" && priceOverride && cycle === "monthly") amount = priceOverride;
    else if (tier === "growth_plan" && priceOverride && cycle === "annual") amount = priceOverride * 10;
    else amount = plans.priceFor(tier, cycle);

    // Promo already validated by the route: { code, amountCents, freeMonths, description }
    const charged = promo ? promo.amountCents : amount;
    const lock = async () => { await geDb.setSubscriptionPrice(accountId, { priceCents: amount, cycle, founder: founder ? true : (ent.founder && tier === "growth_plan" ? null : false) }); };

    if (this.isProduction && this.stripe) {
      // Production: use real Stripe (pass promo.stripeCouponId as the coupon).
      // New Price objects per price (P.3) — never edit existing ones.
      const r = await this._createStripeSubscription(accountId, tier, stripeCustomerId, charged, cycle, promo);
      await lock();
      return { ...r, founder, priceCents: amount };
    }

    // Mock mode: Simulate payment processing
    const r = await this._createMockSubscription(accountId, tier, charged, cycle);
    await lock();
    r.founder = founder; r.priceCents = amount;
    if (promo) {
      r.promo = { code: promo.code, description: promo.description, listAmountInCents: amount };
      // Free months: the paid-through date is pushed out by the free period.
      if (promo.freeMonths) { const end = Date.now() + (promo.freeMonths + 1) * 30 * 24 * 60 * 60 * 1000; await geDb.setBillingPeriod(accountId, Date.now(), end); r.currentPeriodEnd = end; }
    }
    return r;
  }

  /**
   * Mock payment processing (development only)
   * Simulates Stripe subscription creation
   */
  async _createMockSubscription(accountId, tier, amountInCents, billingCycle) {
    const now = Date.now();
    const subscriptionId = "sub_mock_" + crypto.randomBytes(8).toString("hex");

    // Calculate billing period
    const billingPeriodStart = now;
    let billingPeriodEnd;
    if (billingCycle === "monthly") {
      billingPeriodEnd = now + (30 * 24 * 60 * 60 * 1000);
    } else if (billingCycle === "annual") {
      billingPeriodEnd = now + (365 * 24 * 60 * 60 * 1000);
    }

    // Create mock subscription record
    const mockSub = {
      subscriptionId,
      accountId,
      tier,
      billingCycle,
      amountInCents,
      status: "active",
      currentPeriodStart: billingPeriodStart,
      currentPeriodEnd: billingPeriodEnd,
      createdAt: now,
      lastPayment: now,
    };

    mockSubscriptions.set(subscriptionId, mockSub);

    // Upgrade tier in database; period end is what "cancel at period end" keys off
    const ent = await geDb.upgradeTier(accountId, tier);
    if (geDb.setBillingPeriod) await geDb.setBillingPeriod(accountId, billingPeriodStart, billingPeriodEnd);
    if (geDb.setCancelAt) await geDb.setCancelAt(accountId, null);

    console.log(`[Billing] Mock subscription created: ${subscriptionId} for ${tier} (${billingCycle})`);

    return {
      subscriptionId,
      accountId,
      tier: ent.currentTier,
      billingCycle,
      amountInCents,
      amountFormatted: `$${(amountInCents / 100).toFixed(2)}`,
      status: "active",
      currentPeriodStart: new Date(billingPeriodStart).toISOString(),
      currentPeriodEnd: new Date(billingPeriodEnd).toISOString(),
      message: "[MOCK MODE] Using simulated payment processing",
    };
  }

  /**
   * Real Stripe integration (production)
   * TODO: Implement when Stripe keys are configured
   */
  async _createStripeSubscription(accountId, tier, customerId, amountInCents, billingCycle, promo = null) {
    throw new Error("[Stripe] Real Stripe integration not yet implemented. Use mock mode for development.");
  }

  /**
   * Get subscription details for user
   */
  async getSubscription(accountId) {
    // Search mock subscriptions for active subscription
    for (const [subId, sub] of mockSubscriptions) {
      if (sub.accountId === accountId && sub.status === "active") {
        return sub;
      }
    }
    return null;
  }

  /**
   * Cancel at period end. The tier stays until the paid-through date, then
   * reads as free (geDb.getEffectiveEntitlement applies it lazily). Nothing
   * is refunded and nothing is deleted; reports stay.
   */
  async cancelSubscription(accountId) {
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (!ent || ent.currentTier === "social_snapshot") return { status: "none", currentTier: "social_snapshot" };
    if (ent.cancelAt) return { status: "cancel_pending", currentTier: ent.currentTier, endsAt: ent.cancelAt };
    if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
      await this.stripe.subscriptions.update(ent.stripeSubscriptionId, { cancel_at_period_end: true });
    }
    const sub = await this.getSubscription(accountId);
    if (sub) { sub.cancelAtPeriodEnd = true; mockSubscriptions.set(sub.subscriptionId, sub); }
    // Paid-through date: the subscription's period end, else the entitlement's, else 30 days.
    const endsAt = sub?.currentPeriodEnd || ent.billingPeriodEnd || Date.now() + 30 * 24 * 60 * 60 * 1000;
    await geDb.setCancelAt(accountId, endsAt);
    console.log(`[Billing] Cancel at period end for ${accountId}: ${new Date(endsAt).toISOString()}`);
    return { status: "cancel_pending", currentTier: ent.currentTier, endsAt };
  }

  /**
   * Pause instead of cancel (spec 4.1): 1–3 months, collection paused, tier
   * kept, history and streak kept (the streak is frozen while paused).
   * Stripe: pause_collection with resumes_at; mock: paused_until on the entitlement.
   */
  async pauseSubscription(accountId, months) {
    const m = Math.max(1, Math.min(Number(process.env.PAUSE_MAX_MONTHS || 3), Math.round(Number(months) || 1)));
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (!ent || ent.currentTier === "social_snapshot") return { status: "none", currentTier: "social_snapshot" };
    const until = Date.now() + m * 30 * 24 * 60 * 60 * 1000;
    if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
      await this.stripe.subscriptions.update(ent.stripeSubscriptionId, { pause_collection: { behavior: "void", resumes_at: Math.floor(until / 1000) }, cancel_at_period_end: false });
    }
    const sub = await this.getSubscription(accountId);
    if (sub) { sub.cancelAtPeriodEnd = false; sub.pausedUntil = until; mockSubscriptions.set(sub.subscriptionId, sub); }
    await geDb.setPause(accountId, until);
    console.log(`[Billing] Paused ${accountId} for ${m} month(s) until ${new Date(until).toISOString()}`);
    return { status: "paused", currentTier: ent.currentTier, pausedUntil: until, months: m };
  }
  async unpauseSubscription(accountId) {
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (!ent.pausedUntil) return { status: ent.currentTier === "social_snapshot" ? "none" : "active", currentTier: ent.currentTier };
    if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
      await this.stripe.subscriptions.update(ent.stripeSubscriptionId, { pause_collection: "" });
    }
    const sub = await this.getSubscription(accountId);
    if (sub) { delete sub.pausedUntil; mockSubscriptions.set(sub.subscriptionId, sub); }
    await geDb.setPause(accountId, null);
    return { status: "active", currentTier: ent.currentTier };
  }
  /**
   * Move a subscriber between growth_plan and the maintenance tier (spec 4.2).
   * Stripe: swap the subscription item's price (Joe wires the price ids);
   * mock: a fresh mock subscription at the new price.
   */
  async switchTier(accountId, tier) {
    if (!["maintenance", "growth_plan", "growth_plan_pro"].includes(tier)) throw new Error("Only maintenance, growth_plan and growth_plan_pro can be switched to");
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (ent.currentTier === "social_snapshot") throw new Error("Start a plan first");
    if (ent.currentTier === tier) { if (ent.pendingTier) await geDb.setPendingTier(accountId, null, null); return { status: "active", currentTier: tier, unchanged: true }; }
    const cycle = ent.billingCycle || "monthly";
    // P.5: downgrades take effect at the end of the paid period; extra data is kept, just hidden.
    if (plans.rankOf(tier) < plans.rankOf(ent.currentTier)) {
      const at = ent.billingPeriodEnd || Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
        throw new Error("[Stripe] Downgrade not wired yet: schedule the subscription item swap to the new price id at period end");
      }
      await geDb.setPendingTier(accountId, tier, at);
      await geDb.setCancelAt(accountId, null);
      console.log(`[Billing] ${accountId} downgrade ${ent.currentTier} → ${tier} at ${new Date(at).toISOString()}`);
      return { status: "downgrade_pending", currentTier: ent.currentTier, pendingTier: tier, effectiveAt: at };
    }
    if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
      throw new Error("[Stripe] Upgrade not wired yet: update the subscription item to the new price id with proration");
    }
    const amount = plans.priceFor(tier, cycle);
    const r = await this._createMockSubscription(accountId, tier, amount, cycle);
    await geDb.setCancelAt(accountId, null);
    // Founder status survives an upgrade (they never cancelled); it only ends when the subscription lapses.
    await geDb.setSubscriptionPrice(accountId, { priceCents: amount, cycle, founder: null });
    console.log(`[Billing] ${accountId} switched ${ent.currentTier} → ${tier}`);
    return { ...r, status: "active", currentTier: tier, from: ent.currentTier };
  }

  /** Founders spots left (P.2). Never faked: counts entitlements flagged founder. */
  async foundersLeft() {
    const taken = await geDb.countFounders();
    return Math.max(0, plans.FOUNDERS.cap - taken);
  }

  /** Undo a pending cancellation before the period ends. */
  async resumeSubscription(accountId) {
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (!ent.cancelAt) return { status: ent.currentTier === "social_snapshot" ? "none" : "active", currentTier: ent.currentTier };
    if (ent.cancelAt <= Date.now()) return { status: "ended", currentTier: "social_snapshot" };
    if (this.isProduction && this.stripe && ent.stripeSubscriptionId) {
      await this.stripe.subscriptions.update(ent.stripeSubscriptionId, { cancel_at_period_end: false });
    }
    const sub = await this.getSubscription(accountId);
    if (sub) { sub.cancelAtPeriodEnd = false; mockSubscriptions.set(sub.subscriptionId, sub); }
    await geDb.setCancelAt(accountId, null);
    return { status: "active", currentTier: ent.currentTier, renewsAt: ent.billingPeriodEnd };
  }

  /**
   * Check if user has access to tier
   */
  async checkEntitlement(accountId, requiredTier) {
    const ent = await (geDb.getEffectiveEntitlement || geDb.getOrCreateEntitlement)(accountId);

    // Tier hierarchy: social_snapshot < growth_plan < business_evaluator < agency
    const tierHierarchy = ["social_snapshot", "maintenance", "growth_plan", "growth_plan_pro", "business_growth", "business_evaluator", "agency"];
    const requiredIndex = tierHierarchy.indexOf(requiredTier);
    const currentIndex = tierHierarchy.indexOf(ent.currentTier);

    const hasAccess = currentIndex >= requiredIndex;

    return {
      accountId,
      currentTier: ent.currentTier,
      requiredTier,
      hasAccess,
    };
  }

  /**
   * Handle webhook from Stripe (payment succeeded, failed, subscription canceled, etc.)
   */
  async handleWebhook(event) {
    const eventId = event.data?.object?.id || "unknown";

    switch (event.type) {
      case "customer.subscription.created":
        // Subscription started
        console.log(`[Billing] Subscription created: ${eventId}`);
        break;

      case "customer.subscription.updated":
        // Subscription updated (tier change)
        console.log(`[Billing] Subscription updated: ${eventId}`);
        break;

      case "customer.subscription.deleted":
        // Subscription canceled
        console.log(`[Billing] Subscription canceled: ${eventId}`);
        // Downgrade user to free tier
        break;

      case "invoice.payment_succeeded":
        // Payment succeeded
        console.log(`[Billing] Payment succeeded: ${eventId}`);
        break;

      case "invoice.payment_failed":
        // Payment failed
        console.log(`[Billing] Payment failed: ${eventId}`);
        // Send retry email to user
        break;

      default:
        console.log(`[Billing] Unhandled webhook event: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * Get pricing information
   */
  // variantPrices: { variant, growth_plan, plan_unlock } from growth_engine_pricing
  // Everything the pricing page and the app need, from growth_engine_plans.js.
  // `founders` is async (live count) — see getPricingAsync; this sync version omits it.
  getPricing(variantPrices = null, founders = null) {
    const GP = variantPrices?.growth_plan || plans.priceFor("growth_plan", "monthly");
    const OT = variantPrices?.plan_unlock || ONE_TIME_PRICING.plan_unlock;
    const growth = plans.publicTier("growth_plan", { monthly: GP, annual: GP * 10 });
    const free = plans.publicTier("social_snapshot");
    const pro = plans.publicTier("growth_plan_pro");
    return {
      audience: "creators",
      pause: { months: Array.from({ length: Number(process.env.PAUSE_MAX_MONTHS || 3) }, (_, i) => i + 1) },
      maintenance: { ...plans.publicTier("maintenance"), hidden: true },
      tiers: [free, growth, pro],
      founders: founders ? { cap: plans.FOUNDERS.cap, taken: founders.taken, left: founders.left, monthlyPrice: plans.FOUNDERS.growth_monthly / 100, annualPrice: plans.FOUNDERS.growth_annual / 100, tier: "growth_plan" } : null,
      limits: Object.fromEntries(["social_snapshot", "growth_plan", "growth_plan_pro", "maintenance"].map((t) => [t, plans.LIMITS[t]])),
      support_email: process.env.SUPPORT_EMAIL || null,
      variant: variantPrices?.variant || "control",
      business_checkout_enabled: process.env.ENABLE_BUSINESS_CHECKOUT === "true",
      business: [plans.publicTier("business_growth"), plans.publicTier("business_evaluator")],
      one_time: plans.ONE_TIME_UNLOCK_ENABLED ? [{
        product: "plan_unlock", name: "60-day plan", days: 60,
        description: "Phases 1 and 2 of this report's plan, written once. No subscription, no refresh.",
        price: OT / 100,
        features: ["Days 1–60: moves 01 through 09, with the how and examples", "Your 8-week calendar", "Keep it forever"],
        not_included: ["Days 61–90 (phase 3)", "Weekly re-score and what changed", "Day-30 and day-60 check-ins", "Competitors", "Score and follower history", "A fresh plan every 90 days"],
        cta: "Get the 60-day plan",
      }] : [],
      discount: { annual: "2 months free", note: "Annual is 10 months' price for 12" },
      refund: "Not useful in the first 7 days? Reply to any email and we refund it.",
    };
  }
  async getPricingAsync(variantPrices = null) {
    const left = await this.foundersLeft();
    return this.getPricing(variantPrices, { taken: plans.FOUNDERS.cap - left, left });
  }

  /**
   * Estimate total cost
   */
  estimateCost(tier, billingCycle, clientCount = 1) {
    const monthlyPrice = TIER_PRICING[tier] / 100;

    if (tier === "agency") {
      const baseMonthly = monthlyPrice;
      const perClientMonthly = 25;
      const totalMonthly = baseMonthly + perClientMonthly * clientCount;

      if (billingCycle === "annual") return totalMonthly * 10; // annual = 10 months
      return totalMonthly;
    }
    if (billingCycle === "annual") return plans.priceFor(tier, "annual") / 100;
    return monthlyPrice;
  }
}

module.exports = BillingManager;
module.exports.TIER_PRICING = TIER_PRICING;
module.exports.ONE_TIME_PRICING = ONE_TIME_PRICING;
