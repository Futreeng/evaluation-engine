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
  growth_plan: 3900, // $39/month
  business_evaluator: 9900, // $99/month
  agency: 24900, // $249/month base
};

// Annual discounts (25% off)
const ANNUAL_DISCOUNT = 0.25;

// Mock subscriptions store (in production, this would be Stripe API + database)
const mockSubscriptions = new Map();

class BillingManager {
  constructor(stripeApiKey) {
    this.stripeApiKey = stripeApiKey;
    this.isProduction = !!stripeApiKey;

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
   * Create subscription for user
   * Mock mode: Simulates payment processing (for development)
   * Production: Uses real Stripe API
   */
  async createSubscription(accountId, tier, stripeCustomerId, billingCycle = "monthly") {
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

    if (this.isProduction && this.stripe) {
      // Production: use real Stripe
      return await this._createStripeSubscription(accountId, tier, stripeCustomerId, amount, billingCycle);
    }

    // Mock mode: Simulate payment processing
    return await this._createMockSubscription(accountId, tier, amount, billingCycle);
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

    // Upgrade tier in database
    const ent = await geDb.upgradeTier(accountId, tier);

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
  async _createStripeSubscription(accountId, tier, customerId, amountInCents, billingCycle) {
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
   * Cancel subscription (downgrade to free tier)
   */
  async cancelSubscription(subscriptionId) {
    const sub = mockSubscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Downgrade user to free tier
    const ent = await geDb.upgradeTier(sub.accountId, "social_snapshot");

    // Mark subscription as canceled
    sub.status = "canceled";
    sub.canceledAt = Date.now();
    mockSubscriptions.set(subscriptionId, sub);

    console.log(`[Billing] Subscription canceled: ${subscriptionId}`);

    return {
      subscriptionId,
      status: "canceled",
      downgradedTo: ent.currentTier,
    };
  }

  /**
   * Check if user has access to tier
   */
  async checkEntitlement(accountId, requiredTier) {
    const ent = await geDb.getOrCreateEntitlement(accountId);

    // Tier hierarchy: social_snapshot < growth_plan < business_evaluator < agency
    const tierHierarchy = ["social_snapshot", "growth_plan", "business_evaluator", "agency"];
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
    return {
      tiers: [
        {
          tier: "social_snapshot",
          name: "Social Snapshot",
          description: "Free tier - 1 evaluation",
          monthlyPrice: 0,
          annualPrice: 0,
          features: [
            "1 social profile audit",
            "4 dimension scores",
            "3-phase growth preview",
            "Teased recommendations",
            "Email capture",
          ],
        },
        {
          tier: "growth_plan",
          name: "Growth Plan",
          description: "Full social growth strategy",
          monthlyPrice: 39,
          annualPrice: Math.floor((3900 * 12 * (1 - ANNUAL_DISCOUNT)) / 100),
          features: [
            "Unlimited audits",
            "Full 90-day content calendar",
            "13 weeks of post ideas",
            "LLM production prompts",
            "Competitor comparison",
            "Weekly refresh",
          ],
        },
        {
          tier: "business_evaluator",
          name: "Business Evaluator",
          description: "Cross-functional growth plan",
          monthlyPrice: 99,
          annualPrice: Math.floor((9900 * 12 * (1 - ANNUAL_DISCOUNT)) / 100),
          features: [
            "Everything in Growth Plan",
            "Margin-aware recommendations",
            "Action plan checklist",
            "Business reconciliation",
            "Bi-weekly refresh",
            "Inventory impact analysis",
          ],
        },
        {
          tier: "agency",
          name: "Agency / Done-For-You",
          description: "Multi-client management",
          monthlyPrice: 249,
          features: [
            "Everything in Business Evaluator",
            "Manage unlimited clients",
            "White-label reports",
            "API access",
            "Bulk content generation",
            "Custom integrations",
          ],
          note: "Base price + $25/client/month",
        },
      ],
      discount: {
        annual: `${Math.round(ANNUAL_DISCOUNT * 100)}% off`,
        note: "Annual billing includes 25% discount",
      },
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
