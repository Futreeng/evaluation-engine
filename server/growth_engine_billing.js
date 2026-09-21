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
const TIER_PRICING = {
  social_snapshot: 0, // Free
  growth_plan: 1200, // $12/month — creators
  growth_plan_pro: 2900, // $29/month — creators, every platform scored together
  business_growth: 3900, // $39/month — businesses (phase 2)
  business_evaluator: 9900, // $99/month — businesses
  agency: 24900, // $249/month base
};
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
  async purchaseOneTime(accountId, product, stripeCustomerId = null, promo = null) {
    const list = ONE_TIME_PRICING[product];
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
  async createSubscription(accountId, tier, stripeCustomerId, billingCycle = "monthly", promo = null) {
    if (tier === "social_snapshot") {
      // Free tier: just create entitlement
      return await geDb.upgradeTier(accountId, tier);
    }

    const priceInCents = TIER_PRICING[tier];
    if (!priceInCents) {
      throw new Error(`Unknown tier: ${tier}`);
    }

    // Calculate amount based on billing cycle
    let amount = priceInCents;
    if (billingCycle === "annual") {
      amount = Math.floor(priceInCents * 12 * (1 - ANNUAL_DISCOUNT));
    }

    // Promo already validated by the route: { code, amountCents, freeMonths, description }
    const charged = promo ? promo.amountCents : amount;

    if (this.isProduction && this.stripe) {
      // Production: use real Stripe (pass promo.stripeCouponId as the coupon)
      return await this._createStripeSubscription(accountId, tier, stripeCustomerId, charged, billingCycle, promo);
    }

    // Mock mode: Simulate payment processing
    const r = await this._createMockSubscription(accountId, tier, charged, billingCycle);
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
    const tierHierarchy = ["social_snapshot", "growth_plan", "growth_plan_pro", "business_growth", "business_evaluator", "agency"];
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
  getPricing() {
    const yr = (cents) => Math.floor((cents * 12 * (1 - ANNUAL_DISCOUNT)) / 100);
    return {
      audience: "creators",
      tiers: [
        {
          tier: "social_snapshot",
          name: "Snapshot",
          description: "See where your account stands and why.",
          monthlyPrice: 0,
          annualPrice: 0,
          note: "No card, ever",
          features: [
            "Your score and the four dimensions, explained",
            "Your best and worst posts",
            "The first move of each 30-day phase",
            "One account, once",
          ],
          cta: "Score my account",
        },
        {
          tier: "growth_plan",
          name: "Growth Plan",
          description: "Your account, re-scored every week, with the whole 90 days written from your own posts.",
          monthlyPrice: TIER_PRICING.growth_plan / 100,
          annualPrice: yr(TIER_PRICING.growth_plan),
          popular: true,
          features: [
            "All 90 days: every move, 01 through 13, with the how and a paste-ready example",
            "Your 12-week posting calendar with a brief per post",
            "Written around your next 90 days — time, goal, what you can shoot",
            "Re-scored every week — see what each move changed",
            "Day-30 and day-60 check-ins that reshape the plan if life changes",
            "Up to 5 competitors, scored the same way",
            "Score and follower history, and a fresh plan every 90 days",
          ],
          cta: "Start Growth Plan",
        },
        ...(process.env.ENABLE_GROWTH_PLAN_PRO === "true" ? [{
          tier: "growth_plan_pro",
          name: "Growth Plan Pro",
          description: "Every platform you're on, scored together.",
          monthlyPrice: TIER_PRICING.growth_plan_pro / 100,
          annualPrice: yr(TIER_PRICING.growth_plan_pro),
          optional: true,
          features: [
            "Everything in Growth Plan",
            "All your platforms in one report",
            "Priority refresh",
          ],
          cta: "Start Pro",
        }] : []),
      ],
      // Business tiers are phase 2. Until the business pipeline exists they are
      // listed for the page but not purchasable (see /billing/subscribe).
      support_email: process.env.SUPPORT_EMAIL || null,
      business_checkout_enabled: process.env.ENABLE_BUSINESS_CHECKOUT === "true",
      business: [
        {
          tier: "business_growth",
          name: "Business Growth Plan",
          description: "Scored against your category; the plan is written for bookings.",
          monthlyPrice: TIER_PRICING.business_growth / 100,
          annualPrice: yr(TIER_PRICING.business_growth),
          features: ["Everything in Growth Plan", "Category benchmarks for businesses", "Moves written for bookings, not followers"],
          cta: "Start Business Growth Plan",
        },
        {
          tier: "business_evaluator",
          name: "Business Evaluator",
          description: "The plan answers to the P&L, not just the feed.",
          monthlyPrice: TIER_PRICING.business_evaluator / 100,
          annualPrice: yr(TIER_PRICING.business_evaluator),
          features: ["Everything in Business Growth Plan", "Margin-aware recommendations", "Action plan checklist with owners and dates", "Bi-weekly refresh"],
          cta: "Start Business Evaluator",
        },
      ],
      one_time: [
        {
          product: "plan_unlock",
          name: "60-day plan",
          days: 60,
          description: "Phases 1 and 2 of this report's plan, written once. No subscription, no refresh.",
          price: ONE_TIME_PRICING.plan_unlock / 100,
          features: ["Days 1–60: moves 01 through 09, with the how and examples", "Your 8-week calendar", "Keep it forever"],
          not_included: ["Days 61–90 (phase 3)", "Weekly re-score and what changed", "Day-30 and day-60 check-ins", "Competitors", "Score and follower history", "A fresh plan every 90 days"],
          cta: "Get the 60-day plan",
        },
      ],
      discount: {
        annual: `${Math.round(ANNUAL_DISCOUNT * 100)}% off`,
        note: "Annual billing includes 25% discount",
      },
      refund: "Not useful in the first 7 days? Reply to any email and we refund it.",
    };
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

      if (billingCycle === "annual") {
        return Math.floor(totalMonthly * 12 * (1 - ANNUAL_DISCOUNT));
      }
      return totalMonthly;
    }

    if (billingCycle === "annual") {
      return Math.floor(monthlyPrice * 12 * (1 - ANNUAL_DISCOUNT));
    }
    return monthlyPrice;
  }
}

module.exports = BillingManager;
module.exports.TIER_PRICING = TIER_PRICING;
module.exports.ONE_TIME_PRICING = ONE_TIME_PRICING;
