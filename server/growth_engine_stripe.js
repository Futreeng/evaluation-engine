/**
 * Stripe Checkout for Scalecraft.
 *
 * The app never sees a card. `POST /billing/checkout` builds a hosted Checkout
 * session and the browser is sent to Stripe; Stripe sends the customer back to
 * `#/checkout/done?session_id=…` and, separately, calls the webhook. Both paths
 * end in `applySession`, which is idempotent: the first one to run grants the
 * plan (or starts the 60-day unlock job) and stamps the Stripe object so the
 * second one is a no-op.
 *
 *   STRIPE_API_KEY          sk_test_… / sk_live_…  (growth_engine_billing.js decides "real")
 *   STRIPE_WEBHOOK_SECRET   whsec_… from the endpoint in Developers → Webhooks
 *   STRIPE_PRICES_JSON      optional. Dashboard Price ids per tier and cycle:
 *                           {"growth_plan":{"monthly":"price_…","annual":"price_…"},
 *                            "growth_plan_founders":{"monthly":"price_…","annual":"price_…"},
 *                            "growth_plan_pro":{"monthly":"price_…","annual":"price_…"},
 *                            "maintenance":{"monthly":"price_…"},"plan_unlock":"price_…"}
 *                           A price id is used only when its amount matches what
 *                           the app quoted; otherwise the session carries the
 *                           amount itself (price_data), so nothing here is required.
 *   STRIPE_PRODUCTS_JSON    optional. Product ids per tier for price_data lines, so
 *                           ad-hoc prices attach to one product instead of creating
 *                           a new product per checkout: {"growth_plan":"prod_…", …}
 */

const geDb = require("./growth_engine_db_select");
const plans = require("./growth_engine_plans");

const jsonEnv = (k) => { try { return process.env[k] ? JSON.parse(process.env[k]) : {}; } catch { console.warn(`[Stripe] ${k} is not valid JSON — ignored`); return {}; } };
const PRICE_IDS = jsonEnv("STRIPE_PRICES_JSON");
const PRODUCT_IDS = jsonEnv("STRIPE_PRODUCTS_JSON");
const APP = (process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "");
const NAMES = { growth_plan: "Scalecraft Growth Plan", growth_plan_pro: "Scalecraft Pro", maintenance: "Scalecraft Maintenance", plan_unlock: "Scalecraft 60-day plan" };

// Stripe Tax is opt-in. Accounts on Managed Payments (Stripe as merchant of
// record) handle tax themselves and reject the parameter, so it's only sent
// when STRIPE_AUTOMATIC_TAX=true.
const taxParams = () => process.env.STRIPE_AUTOMATIC_TAX === "true" ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" } } : {};

// Sessions being applied right now, so a webhook and a browser return that
// land together don't both grant.
const inflight = new Map();

function priceIdFor(tier, cycle, founder) {
  const key = founder && tier === "growth_plan" ? "growth_plan_founders" : tier;
  const v = PRICE_IDS[key];
  if (!v) return null;
  return typeof v === "string" ? v : v[cycle] || null;
}

class StripeCheckout {
  constructor(stripe) { this.stripe = stripe; }

  // One line item: a dashboard price when its amount matches the quote, else the amount itself.
  async lineItem({ tier, cycle, amountCents, founder, oneTime }) {
    const id = priceIdFor(tier, cycle, founder);
    if (id) {
      try {
        const price = await this.stripe.prices.retrieve(id);
        const sameCycle = oneTime ? !price.recurring : price.recurring && price.recurring.interval === (cycle === "annual" ? "year" : "month");
        if (price.active && price.unit_amount === amountCents && price.currency === "usd" && sameCycle) return { price: id, quantity: 1 };
        console.warn(`[Stripe] price ${id} is ${price.unit_amount} ${price.currency}${price.recurring ? "/" + price.recurring.interval : " once"}; app quoted ${amountCents} — using price_data instead`);
      } catch (e) { console.warn(`[Stripe] price ${id} could not be read (${e.message}) — using price_data instead`); }
    }
    const price_data = { currency: "usd", unit_amount: amountCents };
    if (PRODUCT_IDS[tier]) price_data.product = PRODUCT_IDS[tier];
    else price_data.product_data = { name: `${NAMES[tier] || tier}${founder ? " · founders price" : ""}`, tax_code: process.env.STRIPE_TAX_CODE || "txcd_10103000" };
    if (!oneTime) price_data.recurring = { interval: cycle === "annual" ? "year" : "month" };
    return { price_data, quantity: 1 };
  }

  // A Stripe customer per account, created on first checkout and remembered.
  async customerFor(accountId, email) {
    const ent = await geDb.getOrCreateEntitlement(accountId);
    if (ent.stripeCustomerId) return ent.stripeCustomerId;
    const c = await this.stripe.customers.create({ email: email || undefined, metadata: { accountId } });
    await geDb.setStripeIds(accountId, { customerId: c.id });
    return c.id;
  }

  /**
   * Subscription checkout. `quote` is what growth_engine_billing computed:
   * { amount, founder, cycle, tier }. promo: { code, amountCents, freeMonths, stripeCouponId }.
   */
  async subscriptionSession({ accountId, email, tier, quote, promo = null, returnTo = "" }) {
    const customer = await this.customerFor(accountId, email);
    const cycle = quote.cycle;
    const charged = promo && !promo.stripeCouponId && !promo.freeMonths ? promo.amountCents : quote.amount;
    const line = await this.lineItem({ tier, cycle, amountCents: charged, founder: quote.founder, oneTime: false });
    const metadata = { accountId, tier, cycle, founder: quote.founder ? "1" : "0", priceCents: String(quote.amount), promo: promo?.code || "" };
    const params = {
      mode: "subscription", customer, client_reference_id: accountId,
      line_items: [line],
      subscription_data: { metadata },
      metadata: { ...metadata, kind: "subscription" },
      allow_promotion_codes: !promo,
      success_url: `${APP}/#/checkout/done?session_id={CHECKOUT_SESSION_ID}${returnTo ? `&to=${encodeURIComponent(returnTo)}` : ""}`,
      cancel_url: `${APP}/#/pricing?checkout=cancelled`,
      ...taxParams(),
    };
    if (promo?.stripeCouponId) params.discounts = [{ coupon: promo.stripeCouponId }];
    else if (promo?.freeMonths) params.subscription_data.trial_period_days = promo.freeMonths * 30;
    const session = await this.stripe.checkout.sessions.create(params);
    return { url: session.url, sessionId: session.id };
  }

  /** One-time 60-day plan for one report. */
  async oneTimeSession({ accountId, email, reportId, amountCents, promo = null }) {
    const customer = await this.customerFor(accountId, email);
    const charged = promo && !promo.stripeCouponId ? promo.amountCents : amountCents;
    const line = await this.lineItem({ tier: "plan_unlock", cycle: "monthly", amountCents: charged, founder: false, oneTime: true });
    const metadata = { accountId, product: "plan_unlock", reportId, promo: promo?.code || "", kind: "one_time" };
    const params = {
      mode: "payment", customer, client_reference_id: accountId,
      line_items: [line], metadata, payment_intent_data: { metadata },
      success_url: `${APP}/#/checkout/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP}/#/report/${encodeURIComponent(reportId)}?checkout=cancelled`,
      ...taxParams(),
    };
    if (promo?.stripeCouponId) params.discounts = [{ coupon: promo.stripeCouponId }];
    const session = await this.stripe.checkout.sessions.create(params);
    return { url: session.url, sessionId: session.id };
  }

  /** Customer portal: card, invoices, cancel. */
  async portalUrl(accountId, email) {
    const customer = await this.customerFor(accountId, email);
    const s = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${APP}/#/reports` });
    return s.url;
  }

  /**
   * Grant what a paid session bought. Safe to call from the webhook and from
   * the browser's return, in any order, any number of times.
   * `startUnlock(accountId, reportId, paymentId)` is supplied by the route
   * layer and returns { jobId } — it owns the job queue.
   */
  async applySession(sessionOrId, { startUnlock } = {}) {
    const session = typeof sessionOrId === "string"
      ? await this.stripe.checkout.sessions.retrieve(sessionOrId, { expand: ["subscription", "payment_intent"] })
      : sessionOrId;
    if (session.payment_status !== "paid" && !(session.mode === "subscription" && session.status === "complete")) {
      return { applied: false, reason: session.status === "open" ? "not_paid" : session.status, session_status: session.status, payment_status: session.payment_status };
    }
    if (inflight.has(session.id)) return inflight.get(session.id);
    const run = (async () => {
      const md = session.metadata || {};
      const accountId = md.accountId || session.client_reference_id;
      if (!accountId) throw new Error(`[Stripe] session ${session.id} has no accountId`);
      if (session.customer) await geDb.setStripeIds(accountId, { customerId: typeof session.customer === "string" ? session.customer : session.customer.id });

      if (session.mode === "subscription") {
        const sub = typeof session.subscription === "string" ? await this.stripe.subscriptions.retrieve(session.subscription) : session.subscription;
        return this.applySubscription(sub, { accountId, tier: md.tier, cycle: md.cycle, founder: md.founder === "1", priceCents: Number(md.priceCents) || null, promo: md.promo || null });
      }
      // One-time: the PaymentIntent carries the "already started" stamp.
      const pi = typeof session.payment_intent === "string" ? await this.stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
      if (pi.metadata?.scalecraft_job) return { applied: true, already: true, one_time: true, job_id: pi.metadata.scalecraft_job, report_id: md.reportId };
      if (!startUnlock) return { applied: false, reason: "no_unlock_runner", one_time: true };
      const { jobId } = await startUnlock(accountId, md.reportId, pi.id, { amountCents: pi.amount_received ?? pi.amount, promo: md.promo || null });
      await this.stripe.paymentIntents.update(pi.id, { metadata: { ...pi.metadata, scalecraft_job: jobId } }).catch((e) => console.warn("[Stripe] could not stamp payment intent:", e.message));
      return { applied: true, one_time: true, job_id: jobId, report_id: md.reportId, amount_cents: pi.amount_received ?? pi.amount };
    })();
    inflight.set(session.id, run);
    try { return await run; } finally { inflight.delete(session.id); }
  }

  /** Mirror a Stripe subscription onto the entitlement. Idempotent. */
  async applySubscription(sub, meta = {}) {
    const md = { ...(sub.metadata || {}), ...meta };
    const accountId = md.accountId;
    if (!accountId) throw new Error(`[Stripe] subscription ${sub.id} has no accountId`);
    const tier = md.tier || "growth_plan";
    const ent = await geDb.getOrCreateEntitlement(accountId);
    const already = ent.stripeSubscriptionId === sub.id && ent.currentTier === tier;
    if (!already) {
      await geDb.upgradeTier(accountId, tier);
      await geDb.setStripeIds(accountId, { subscriptionId: sub.id, customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id });
      await geDb.setSubscriptionPrice(accountId, { priceCents: Number(md.priceCents) || sub.items?.data?.[0]?.price?.unit_amount || null, cycle: md.cycle || (sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "annual" : "monthly"), founder: md.founder === "1" || md.founder === true ? true : (ent.founder && tier === "growth_plan" ? null : false) });
      console.log(`[Stripe] ${accountId} → ${tier} (${sub.id})`);
    }
    // API versions from 2025-03 keep the period on the subscription item, older ones on the subscription.
    const item = sub.items?.data?.[0] || {};
    const periodStart = sub.current_period_start || item.current_period_start || null;
    const periodEnd = sub.current_period_end || item.current_period_end || null;
    if (periodStart && periodEnd) await geDb.setBillingPeriod(accountId, periodStart * 1000, periodEnd * 1000);
    await geDb.setCancelAt(accountId, sub.cancel_at_period_end && periodEnd ? periodEnd * 1000 : null);
    return { applied: true, already, accountId, tier, amount_cents: Number(md.priceCents) || item.price?.unit_amount || 0, subscription_id: sub.id, current_period_end: periodEnd ? periodEnd * 1000 : null, founder: md.founder === "1" || md.founder === true };
  }

  /** Find the account for a subscription or invoice event. */
  async accountFor(obj) {
    const md = obj.metadata || {};
    if (md.accountId) return md.accountId;
    const customer = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
    const ent = await geDb.getEntitlementByStripeCustomer(customer);
    return ent?.accountId || null;
  }

  /** Verify and handle a webhook. rawBody is the Buffer express.raw() left on req.body. */
  async handleWebhook(rawBody, signature, { startUnlock, onPaymentFailed } = {}) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw Object.assign(new Error("STRIPE_WEBHOOK_SECRET is not set — webhook refused"), { status: 500 });
    let event;
    try { event = this.stripe.webhooks.constructEvent(rawBody, signature, secret); }
    catch (e) { throw Object.assign(new Error(`Webhook signature failed: ${e.message}`), { status: 400 }); }
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const full = await this.stripe.checkout.sessions.retrieve(obj.id, { expand: ["subscription", "payment_intent"] });
        return { type: event.type, ...(await this.applySession(full, { startUnlock })) };
      }
      case "customer.subscription.updated": {
        const accountId = await this.accountFor(obj);
        if (!accountId) return { type: event.type, ignored: "no account" };
        if (obj.status === "active" || obj.status === "trialing" || obj.status === "past_due") return { type: event.type, ...(await this.applySubscription(obj, { accountId })) };
        if (obj.status === "canceled" || obj.status === "unpaid" || obj.status === "incomplete_expired") { await geDb.setCancelAt(accountId, Date.now()); return { type: event.type, ended: true }; }
        if (obj.pause_collection?.resumes_at && geDb.setPausedUntil) { await geDb.setPausedUntil(accountId, obj.pause_collection.resumes_at * 1000); return { type: event.type, paused: true }; }
        return { type: event.type, status: obj.status };
      }
      case "customer.subscription.deleted": {
        const accountId = await this.accountFor(obj);
        if (!accountId) return { type: event.type, ignored: "no account" };
        // The tier reads as free from now; growth_engine_db's effective-entitlement logic handles the lapse.
        await geDb.setCancelAt(accountId, Date.now());
        await geDb.setStripeIds(accountId, { subscriptionId: null });
        return { type: event.type, ended: true };
      }
      case "invoice.payment_failed": {
        const accountId = await this.accountFor(obj);
        if (!accountId) return { type: event.type, ignored: "no account" };
        // Stripe retries on its own schedule; the plan stays until the period end that's already stored.
        if (onPaymentFailed) await onPaymentFailed(accountId, obj);
        return { type: event.type, noted: true };
      }
      default:
        return { type: event.type, ignored: true };
    }
  }
}

module.exports = { StripeCheckout, priceIdFor };
