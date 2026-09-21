/**
 * Exercises the Postgres module against an in-memory Postgres (pg-mem) so it
 * can run without a database. Run: node growth_engine_db_postgres.test.js
 */
const { newDb } = require("pg-mem");

// Route the module's `require("pg")` to pg-mem's adapter.
const mem = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = mem.adapters.createPg();
require.cache[require.resolve("pg")] = { id: "pg", filename: "pg", loaded: true, exports: { Pool } };
process.env.DATABASE_URL = "postgres://localhost/pgmem";

const db = require("./growth_engine_db_postgres");
const assert = require("assert");

(async () => {
  await db.initDb();

  // users
  const u = await db.createUser("Maya@Sunrise.co", "hash", "Sunrise");
  assert.equal((await db.getUserByEmail("maya@sunrise.co")).userId, u.userId);
  assert.equal((await db.getUserById(u.userId)).companyName, "Sunrise");

  // entitlements
  const e0 = await db.getOrCreateEntitlement(u.userId);
  assert.equal(e0.current_tier, "social_snapshot");
  assert.equal(e0.currentTier, "social_snapshot");
  const e1 = await db.upgradeTier(u.userId, "growth_plan");
  assert.equal(e1.currentTier, "growth_plan");
  assert.equal((await db.getTierHistory(u.userId)).length, 1);

  // jobs — SQLite-style updateJobStatus signature
  const input = { handle: "sunrisefitnessbk", platform: "instagram", category: "boutique_fitness", email: "Maya@Sunrise.co" };
  const { jobId } = await db.createJob(u.userId, "growth_plan", input);
  assert.equal((await db.getJob(jobId)).tier, "growth_plan");
  await db.updateJobStatus(jobId, "running", { stage: "evaluating" });
  const payload = { report_id: "x", scores: { overall: 53, dimensions: [{ label: "Posting Consistency", score: 30 }] } };
  const j = await db.updateJobStatus(jobId, "complete", { resultPayload: payload, stage: "complete" });
  assert.equal(j.status, "complete");
  assert.equal(j.stage, "complete");
  assert.equal(j.resultPayload.scores.overall, 53);
  assert.equal(await db.countFreeSnapshotsByEmail("maya@sunrise.co"), 0); // growth_plan job doesn't count
  await db.createJob("demo-account", "social_snapshot", input);
  assert.equal(await db.countFreeSnapshotsByEmail("maya@sunrise.co"), 1);

  // reports — SQLite-style createReport signature + camelCase shape
  const { reportId } = await db.createReport(u.userId, "growth_plan", input, payload);
  const r = await db.getReport(reportId);
  assert.equal(r.accountId, u.userId);
  assert.equal(r.business.handle, "sunrisefitnessbk");
  assert.equal(r.reportBody.scores.overall, 53);
  assert.equal((await db.listReportsByAccount(u.userId)).length, 1);
  await db.patchReportBody(reportId, { competitors: { rank: { position: 1, of: 2 } } });
  assert.equal((await db.getReport(reportId)).reportBody.competitors.rank.of, 2);

  // history
  await db.createReport(u.userId, "social_snapshot", input, { scores: { overall: 60, dimensions: [{ label: "Posting Consistency", score: 40 }] } });
  const hist = await db.listScoreHistory(u.userId, "SunriseFitnessBK", "instagram");
  assert.deepEqual(hist.map((h) => h.overall), [53, 60]);

  // baselines — upsert on same handle, threshold, summary
  for (let i = 0; i < 21; i++) await db.recordBaseline({ category: "retail", platform: "instagram", handle: "acct" + i, overall: 40 + i, dimensions: [{ label: "Posting Consistency", score: 50 + i }] });
  await db.recordBaseline({ category: "retail", platform: "instagram", handle: "acct0", overall: 99, dimensions: [] });
  const base = await db.getCategoryBaseline("retail");
  assert.equal(base.n, 21);
  assert.equal(base.ready, true);
  assert.ok(base.overall > 50 && base.overall < 65, "avg " + base.overall);
  assert.equal(base.dimensions["Posting Consistency"] > 50, true);
  assert.deepEqual((await db.getCategoryBaseline("fitness")), null);
  assert.equal((await db.getBaselineSummary()).total, 21);

  // plan context — upsert per account+handle+platform
  assert.equal(await db.getPlanContext("acct_a", "Talon", "instagram"), null);
  await db.setPlanContext("acct_a", "Talon", "instagram", { horizon: "fewer_shoots", hours: "2_5" });
  await db.setPlanContext("acct_a", "talon", "instagram", { horizon: "usual", hours: "2_5", goal: "deals" });
  const ctx = await db.getPlanContext("acct_a", "TALON", "instagram");
  assert.equal(ctx.horizon, "usual"); assert.equal(ctx.goal, "deals"); assert.ok(ctx.updated_at > 0);
  assert.equal((await db.listPaidReportsBetween(0, Date.now() + 1)).every((r) => r.tier !== "social_snapshot"), true);

  // cancel at period end → lazy downgrade; password reset tokens are single-use
  await db.upgradeTier("acct_c", "growth_plan");
  await db.setCancelAt("acct_c", Date.now() + 60000);
  assert.equal((await db.getEffectiveEntitlement("acct_c")).currentTier, "growth_plan");
  await db.setCancelAt("acct_c", Date.now() - 1);
  assert.equal((await db.getEffectiveEntitlement("acct_c")).currentTier, "social_snapshot");
  assert.equal((await db.getEntitlement("acct_c")).cancelAt, null);
  await db.createPasswordReset("u1", "hash1", Date.now() + 60000);
  assert.equal(await db.consumePasswordReset("hash1"), "u1");
  assert.equal(await db.consumePasswordReset("hash1"), null);
  await db.createPasswordReset("u1", "hash2", Date.now() - 1);
  assert.equal(await db.consumePasswordReset("hash2"), null);

  // admin aggregates run and have the expected shape
  const ov = await db.adminOverview();
  assert.ok(ov.today && ov.people && typeof ov.people.users === "number");
  assert.ok(Array.isArray(await db.adminRecentReports(5)));
  assert.ok(Array.isArray(await db.adminFailedJobs(5)));
  assert.equal(await db.adminFindAccount("nobody@example.test"), null);

  // promo codes: create, redeem once per account, count, list
  await db.createPromo({ code: "TEST10", kind: "percent", value: 10, applies_to: "any", max_redemptions: 2, expires_at: null, active: true, note: "t" });
  assert.equal((await db.getPromo("test10")).kind, "percent");
  assert.equal(await db.hasRedeemed("TEST10", "acct_a"), false);
  assert.equal((await db.redeemPromo("TEST10", "acct_a", "growth_plan", 120)).redemptions, 1);
  assert.equal(await db.hasRedeemed("TEST10", "acct_a"), true);
  await assert.rejects(() => db.redeemPromo("TEST10", "acct_a", "growth_plan", 120));
  assert.equal((await db.listRedemptions("TEST10")).length, 1);
  assert.equal((await db.setPromoActive("TEST10", false)).active, false);
  assert.equal((await db.listPromos()).length, 1);

  // events + funnel
  await db.insertEvent({ name: "evaluate_started", accountId: null, anon: "a1", ref: "REF1", reportId: null, props: null, ip: null });
  await db.insertEvent({ name: "evaluate_started", accountId: null, anon: "a1", ref: "REF1", reportId: null, props: null, ip: null });
  await db.insertEvent({ name: "signup", accountId: "acct_z", anon: "a1", ref: "REF1", reportId: null, props: null, ip: null });
  const fn = await db.eventFunnel(0, ["evaluate_started", "signup"]);
  assert.equal(fn.steps.evaluate_started.actors, 1); assert.equal(fn.steps.evaluate_started.total, 2); assert.equal(fn.by_ref.REF1.signup, 1);
  assert.equal((await db.paidRetention()).cohort, 0);

  console.log("postgres module: all assertions passed");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
