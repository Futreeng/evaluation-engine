// Stripe Checkout glue against a fake Stripe client: what a paid session
// grants, and that the webhook and the browser's return can't grant twice.
//   node server/growth_engine_stripe.test.js
process.env.APP_URL = "https://scalecraft.test";
const assert = require("assert");
const path = require("path");
const fs = require("fs");

// sql.js file backend on a scratch DB.
process.env.GROWTH_ENGINE_DB = path.join(require("os").tmpdir(), `sc-stripe-test-${process.pid}.db`);
delete process.env.DATABASE_URL;
const geDb = require("./growth_engine_db_select");
const { StripeCheckout } = require("./growth_engine_stripe");

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.log(`✗ ${name}\n  ${e.stack}`); process.exitCode = 1; } }

// The parts of the Stripe SDK the module touches.
function fakeStripe() {
  const state = { customers: [], sessions: {}, subs: {}, pis: {}, updates: [] };
  return {
    state,
    customers: { create: async (o) => { const c = { id: `cus_${state.customers.length + 1}`, ...o }; state.customers.push(c); return c; } },
    prices: { retrieve: async () => { throw new Error("no such price"); } },
    checkout: { sessions: {
      create: async (p) => { const id = `cs_test_${Object.keys(state.sessions).length + 1}`; state.sessions[id] = { id, url: `https://checkout.stripe.com/${id}`, status: "open", payment_status: "unpaid", ...p }; return state.sessions[id]; },
      retrieve: async (id) => state.sessions[id],
    } },
    subscriptions: { retrieve: async (id) => state.subs[id] },
    paymentIntents: { retrieve: async (id) => state.pis[id], update: async (id, o) => { state.pis[id].metadata = o.metadata; state.updates.push(id); return state.pis[id]; } },
    billingPortal: { sessions: { create: async ({ customer }) => ({ url: `https://billing.stripe.com/${customer}` }) } },
    webhooks: { constructEvent: (raw, sig) => { if (sig !== "good") throw new Error("bad sig"); return JSON.parse(raw.toString()); } },
  };
}

(async () => {
  await geDb.initDb();
  const stripe = fakeStripe();
  const co = new StripeCheckout(stripe);
  const accountId = "acct_test_1";

  await test("subscription session carries the quote and account, and remembers the customer", async () => {
    const r = await co.subscriptionSession({ accountId, email: "a@b.co", tier: "growth_plan", quote: { amount: 1200, founder: true, cycle: "monthly", tier: "growth_plan" } });
    assert.match(r.url, /checkout\.stripe\.com/);
    const s = stripe.state.sessions[r.sessionId];
    assert.equal(s.mode, "subscription");
    assert.equal(s.line_items[0].price_data.unit_amount, 1200);
    assert.equal(s.line_items[0].price_data.recurring.interval, "month");
    assert.equal(s.subscription_data.metadata.accountId, accountId);
    assert.equal(s.subscription_data.metadata.founder, "1");
    assert.ok(s.success_url.includes("#/checkout/done?session_id={CHECKOUT_SESSION_ID}"));
    const ent = await geDb.getEntitlement(accountId);
    assert.equal(ent.stripeCustomerId, "cus_1");
    const again = await co.customerFor(accountId, "a@b.co");
    assert.equal(again, "cus_1");
    assert.equal(stripe.state.customers.length, 1);
  });

  await test("an unpaid session grants nothing", async () => {
    const r = await co.applySession("cs_test_1");
    assert.equal(r.applied, false);
    assert.equal((await geDb.getEntitlement(accountId)).currentTier, "social_snapshot");
  });

  await test("a paid subscription session grants the tier once, from either path", async () => {
    const s = stripe.state.sessions.cs_test_1;
    s.status = "complete"; s.payment_status = "paid"; s.customer = "cus_1"; s.subscription = "sub_1";
    stripe.state.subs.sub_1 = { id: "sub_1", customer: "cus_1", status: "active", metadata: s.subscription_data.metadata, current_period_start: 1700000000, current_period_end: 1702592000, cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 1200, recurring: { interval: "month" } } }] } };
    const [a, b] = await Promise.all([co.applySession("cs_test_1"), co.applySession("cs_test_1")]);
    assert.equal(a.applied, true); assert.equal(b.applied, true);
    const c = await co.applySession("cs_test_1");
    assert.equal(c.already, true);
    const ent = await geDb.getEntitlement(accountId);
    assert.equal(ent.currentTier, "growth_plan");
    assert.equal(ent.stripeSubscriptionId, "sub_1");
    assert.equal(ent.priceCents, 1200);
    assert.equal(ent.founder, true);
    assert.equal(ent.billingPeriodEnd, 1702592000 * 1000);
    assert.equal(ent.cancelAt, null);
  });

  await test("webhook: bad signature is refused, subscription.deleted ends the plan", async () => {
    await assert.rejects(() => co.handleWebhook(Buffer.from("{}"), "good"), /STRIPE_WEBHOOK_SECRET/);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    await assert.rejects(() => co.handleWebhook(Buffer.from("{}"), "bad"), /signature/);
    const ev = { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", metadata: {}, current_period_end: 1702592000 } } };
    const r = await co.handleWebhook(Buffer.from(JSON.stringify(ev)), "good");
    assert.equal(r.ended, true);
    const ent = await geDb.getEntitlement(accountId);
    assert.equal(ent.stripeSubscriptionId, null);
    assert.ok(ent.cancelAt && ent.cancelAt <= Date.now());
  });

  await test("one-time session starts the unlock job exactly once", async () => {
    const r = await co.oneTimeSession({ accountId, email: "a@b.co", reportId: "rpt_1", amountCents: 1500 });
    const s = stripe.state.sessions[r.sessionId];
    assert.equal(s.mode, "payment");
    assert.equal(s.line_items[0].price_data.unit_amount, 1500);
    assert.equal(s.line_items[0].price_data.recurring, undefined);
    s.status = "complete"; s.payment_status = "paid"; s.payment_intent = "pi_1";
    stripe.state.pis.pi_1 = { id: "pi_1", amount: 1500, amount_received: 1500, metadata: { accountId, product: "plan_unlock", reportId: "rpt_1" } };
    let starts = 0;
    const startUnlock = async (a, rid, pid) => { starts++; assert.equal(a, accountId); assert.equal(rid, "rpt_1"); assert.equal(pid, "pi_1"); return { jobId: "job_1" }; };
    const first = await co.applySession(r.sessionId, { startUnlock });
    const second = await co.applySession(r.sessionId, { startUnlock });
    assert.equal(first.job_id, "job_1"); assert.equal(second.job_id, "job_1"); assert.equal(second.already, true);
    assert.equal(starts, 1);
    assert.deepEqual(stripe.state.updates, ["pi_1"]);
  });

  await test("webhook: checkout.session.completed applies through the same path", async () => {
    const ev = { type: "checkout.session.completed", data: { object: { id: "cs_test_2" } } };
    const r = await co.handleWebhook(Buffer.from(JSON.stringify(ev)), "good", { startUnlock: async () => { throw new Error("must not start twice"); } });
    assert.equal(r.already, true);
  });

  console.log(`${passed} passed`);
  try { fs.unlinkSync(process.env.GROWTH_ENGINE_DB); } catch { /* fine */ }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
