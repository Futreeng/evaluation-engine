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

    // Mock mode grants a paid tier without taking a payment. That is correct
    // for development and a giveaway in production, so refuse paid flows there
    // rather than hand out the product. Free tiers and $0 promos still work.
    this.mockInProduction = !looksReal && process.env.NODE_ENV === "production";
    if (this.mockInProduction) console.warn("[Billing] production without a real Stripe key — paid flows will be refused, not mocked");

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
    if (this.mockInProduction) throw Object.assign(new Error("Billing isn't available yet — no payment can be taken, so we won't unlock this."), { code: "BILLING_UNAVAILABLE", status: 503 });
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
    if (this.mockInProduction) throw Object.assign(new Error("Billing isn't available yet — no payment can be taken, so we won't start a plan."), { code: "BILLING_UNAVAILABLE", status: 503 });
    const cycle = billingCycle === "annual" ? "annual" : "monthly";

    // P.3: a current subscriber who re-subscribes without lapsing keeps their price.
    // P.2: founders pricing for Growth while spots remain (excluded from A/B variants).
    // Otherwise the plan price (a variant may override Growth's monthly).
    const ent = await geDb.getOrCreateEntitlement(accountId);
    let amount, founder = false;
    // A locked price only carries over on the same cycle: a monthly founder asking for annual gets the annual founders price, not $12 a year.
    const keeps = ent.currentTier === tier && ent.priceCents != null && !ent.lapsedAt && (!ent.billingCycle || ent.billingCycle === cycle);
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
      const r = await this._createStripeSubscription(accountId, tier, stripeCustomerId, charged, cycle, promo, founder);
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
  // Stripe Checkout, hosted. The card never touches this server, so the PCI
  // surface stays near zero and 3DS/SCA is Stripe's problem, not ours.
  //
  // This grants nothing. It returns a URL to send the customer to; the
  // entitlement is granted in handleWebhook when Stripe confirms payment. The
  // redirect back is not proof of anything — the customer can close the tab,
  // and the success_url can be visited by hand.
  // One Stripe customer per account, created on first checkout and remembered
  // on the entitlement, so the portal, receipts and later charges all land on
  // the same customer.
  async stripeCustomerFor(accountId) {
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (ent.stripeCustomerId) {
      // A remembered id can point at a customer deleted in the dashboard (or a different mode's key). Check, and start over if so.
      try { const c = await this.stripe.customers.retrieve(ent.stripeCustomerId); if (!c.deleted) return ent.stripeCustomerId; }
      catch (e) { if (e.code !== "resource_missing") throw e; }
      console.warn(`[Billing] Stripe customer ${ent.stripeCustomerId} for ${accountId} no longer exists — creating a new one`);
    }
    const user = await geDb.getUserById(accountId).catch(() => null);
    const c = await this.stripe.customers.create({ email: user?.email || undefined, metadata: { accountId } });
    if (geDb.setStripeIds) await geDb.setStripeIds(accountId, { customerId: c.id });
    return c.id;
  }

  // The line item for a checkout. A dashboard Price (STRIPE_PRICES_JSON, from
  // scripts/stripe_products.js) is used when its amount and interval match what
  // the app quoted; otherwise the amount rides on the session itself, attached
  // to the catalogue product (STRIPE_PRODUCTS_JSON) or an ad-hoc one. Every
  // product carries a tax code: Managed Payments (Stripe as merchant of record,
  // the default on our account) refuses a line without one.
  async stripeLineItem(tier, cycle, amountInCents, founder = false) {
    const jsonEnv = (k) => { try { return process.env[k] ? JSON.parse(process.env[k]) : {}; } catch { console.warn(`[Billing] ${k} is not valid JSON — ignored`); return {}; } };
    const priceIds = jsonEnv("STRIPE_PRICES_JSON"), productIds = jsonEnv("STRIPE_PRODUCTS_JSON");
    const key = founder && tier === "growth_plan" ? "growth_plan_founders" : tier;
    const id = typeof priceIds[key] === "string" ? priceIds[key] : priceIds[key]?.[cycle];
    if (id) {
      try {
        const price = await this.stripe.prices.retrieve(id);
        if (price.active && price.unit_amount === amountInCents && price.currency === "usd" && price.recurring?.interval === (cycle === "annual" ? "year" : "month")) return { price: id, quantity: 1 };
        console.warn(`[Billing] Stripe price ${id} is ${price.unit_amount}/${price.recurring?.interval}; app quoted ${amountInCents}/${cycle} — sending the amount instead`);
      } catch (e) { console.warn(`[Billing] Stripe price ${id} unreadable (${e.message}) — sending the amount instead`); }
    }
    const price_data = { currency: "usd", unit_amount: amountInCents, recurring: { interval: cycle === "annual" ? "year" : "month" } };
    if (productIds[key] || productIds[tier]) price_data.product = productIds[key] || productIds[tier];
    else price_data.product_data = { name: `Scalecraft Social — ${plans.TIERS?.[tier]?.name || tier}${founder ? " · founders price" : ""}`, tax_code: process.env.STRIPE_TAX_CODE || "txcd_10103000" };
    return { price_data, quantity: 1 };
  }

  // Stripe's customer portal: card on file, invoices, cancel.
  async portalUrl(accountId) {
    if (!this.isProduction || !this.stripe) throw Object.assign(new Error("Billing isn't running through Stripe here"), { code: "NOT_STRIPE", status: 404 });
    const app = String(process.env.APP_URL || "").replace(/\/$/, "");
    const customer = await this.stripeCustomerFor(accountId);
    const s = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${app}/#/reports` });
    return s.url;
  }

  async _createStripeSubscription(accountId, tier, customerId, amountInCents, billingCycle, promo = null, founder = false) {
    const cycle = billingCycle === "annual" ? "annual" : "monthly";
    const app = String(process.env.APP_URL || "").replace(/\/$/, "");
    if (!app) throw Object.assign(new Error("APP_URL is not set, so Stripe has nowhere to send the customer back to."), { code: "APP_URL_MISSING", status: 500 });

    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: accountId,
      customer: customerId || (await this.stripeCustomerFor(accountId)),
      allow_promotion_codes: promo?.stripeCouponId ? undefined : true,
      discounts: promo?.stripeCouponId ? [{ coupon: promo.stripeCouponId }] : undefined,
      line_items: [await this.stripeLineItem(tier, cycle, amountInCents, founder)],
      // Both places: the session metadata covers checkout.session.completed,
      // the subscription metadata covers every later invoice and cancellation,
      // which arrive without any reference to the original session.
      metadata: { accountId, tier, cycle },
      subscription_data: { metadata: { accountId, tier, cycle } },
      success_url: `${app}/#/plan-setup?checkout=success`,
      cancel_url: `${app}/#/pricing?checkout=cancelled`,
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      status: "pending",
      accountId, tier, billingCycle: cycle,
      amountInCents,
      amountFormatted: `$${(amountInCents / 100).toFixed(2)}`,
    };
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

  // Stripe is the only trustworthy source of "they paid". Every grant and every
  // downgrade happens here, never on the redirect back from Checkout — that
  // redirect can be skipped, replayed, or typed in by hand.
  //
  // The event is already signature-verified by the route before it gets here.
  async handleWebhook(event) {
    const obj = event?.data?.object || {};
    const eventId = event?.id || "unknown";

    // Stripe retries until it sees a 2xx and can deliver the same event twice
    // even after one succeeded. Claim it once; a redelivery is a no-op.
    try {
      if (event?.id && !(await geDb.claimWebhookEvent(event.id, event.type))) {
        console.log(`[Billing] webhook ${eventId} (${event.type}) already handled — skipping`);
        return { received: true, duplicate: true };
      }
    } catch (e) {
      // A ledger failure must not swallow a payment. Log loudly and carry on:
      // acting twice on a grant is recoverable, silently dropping one is not.
      console.error(`[Billing] webhook ledger failed for ${eventId}: ${e.message} — processing anyway`);
    }

    // accountId and tier ride on metadata set at Checkout. Subscription events
    // carry the subscription's copy; invoices only reference the subscription,
    // so fall back to looking it up.
    const metaOf = async (o) => {
      if (o?.metadata?.accountId) return o.metadata;
      const subId = typeof o?.subscription === "string" ? o.subscription : (typeof o?.id === "string" ? o.id : null);
      if (subId && this.stripe && subId.startsWith("sub_")) {
        try { return (await this.stripe.subscriptions.retrieve(subId))?.metadata || {}; } catch { return {}; }
      }
      return {};
    };

    switch (event.type) {
      // Payment taken and the subscription exists. This is the grant.
      case "checkout.session.completed": {
        const accountId = obj.client_reference_id || obj.metadata?.accountId;
        const tier = obj.metadata?.tier;
        if (!accountId || !tier) { console.error(`[Billing] ${eventId}: checkout completed without accountId/tier metadata — cannot grant`); break; }
        if (obj.payment_status && obj.payment_status !== "paid" && obj.payment_status !== "no_payment_required") {
          console.warn(`[Billing] ${eventId}: checkout completed but payment_status=${obj.payment_status} — not granting`);
          break;
        }
        await geDb.upgradeTier(accountId, tier, typeof obj.subscription === "string" ? obj.subscription : null);
        console.log(`[Billing] granted ${tier} to ${accountId} (sub ${obj.subscription || "none"})`);
        break;
      }

      // Renewals, and the safety net if checkout.session.completed was missed.
      case "invoice.payment_succeeded": {
        const meta = await metaOf(obj);
        if (!meta.accountId || !meta.tier) { console.warn(`[Billing] ${eventId}: invoice paid but no accountId/tier metadata — skipping`); break; }
        await geDb.upgradeTier(meta.accountId, meta.tier, typeof obj.subscription === "string" ? obj.subscription : null);
        console.log(`[Billing] renewed ${meta.tier} for ${meta.accountId}`);
        break;
      }

      // Cancelled, or lapsed after Stripe gave up retrying. Back to free.
      case "customer.subscription.deleted": {
        const meta = await metaOf(obj);
        if (!meta.accountId) { console.warn(`[Billing] ${eventId}: subscription deleted with no accountId metadata — skipping`); break; }
        await geDb.upgradeTier(meta.accountId, "social_snapshot", null);
        console.log(`[Billing] downgraded ${meta.accountId} to social_snapshot (subscription ended)`);
        break;
      }

      // Card declined. Stripe retries on its own schedule; the plan stays on
      // until it gives up and sends subscription.deleted. Logged so this is
      // visible before the cancellation rather than after.
      case "invoice.payment_failed": {
        const meta = await metaOf(obj);
        console.warn(`[Billing] payment failed for ${meta.accountId || "unknown account"} (invoice ${obj.id}) — Stripe will retry`);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
        console.log(`[Billing] ${event.type}: ${obj.id}`);
        break;

      default:
        console.log(`[Billing] unhandled webhook event: ${event.type}`);
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
      // false while production has no real Stripe key: nothing can be charged, so the
      // app shows "join the waitlist" instead of Start buttons. Real checkout replaces it.
      billing_available: !this.mockInProduction,
      // "stripe": subscribe returns a hosted Checkout URL and the webhook grants. "mock": subscribe grants directly.
      checkout: this.isProduction && this.stripe ? "stripe" : "mock",
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
