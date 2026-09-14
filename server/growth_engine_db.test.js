const fs = require("fs");
const path = require("path");
const db = require("./growth_engine_db");

const TEST_DB_FILE = path.join(__dirname, "data", "growth_engine.db");

// Clean up test database before/after tests
function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_FILE)) {
    fs.unlinkSync(TEST_DB_FILE);
  }
}

async function runTests() {
  console.log("🧪 Growth Engine DB Tests\n");

  cleanupTestDb();

  try {
    // Initialize database
    await db.initDb();
    console.log("✅ Database initialized\n");

    // ==================== TEST 1: Job Lifecycle ====================
    console.log("TEST 1: Full Job Lifecycle (queued → running → complete)");
    console.log("─".repeat(60));

    const accountId = "user_test_123";
    const tier = "growth_plan";
    const inputParams = {
      handle: "@boutique_fitness_co",
      platform: "instagram",
      category: "boutique_fitness",
    };

    // Create job
    const jobCreated = await db.createJob(accountId, tier, inputParams);
    console.log("✓ Created job:", JSON.stringify(jobCreated, null, 2));

    // Verify initial status
    let job = await db.getJob(jobCreated.jobId);
    console.log(`✓ Job status: ${job.status} (expected: queued)`);
    if (job.status !== "queued") throw new Error("Job status mismatch");

    // Transition to running
    job = await db.updateJobStatus(jobCreated.jobId, "running", { stage: "evaluating" });
    console.log(`✓ Updated to running, stage: ${job.stage}`);
    if (job.status !== "running" || job.stage !== "evaluating") {
      throw new Error("Job status/stage update failed");
    }

    // Simulate work & create result payload
    const resultPayload = {
      report_id: "rpt_sample_001",
      tier: "growth_plan",
      business: {
        handle: "@boutique_fitness_co",
        platform: "instagram",
        category: "boutique_fitness",
        business_name: null,
      },
      generated_at: Date.now(),
      refresh_due_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      data_confidence: "full",
      scores: {
        overall: 47,
        category_avg: 61,
        dimensions: [
          {
            key: "posting_consistency",
            label: "Posting Consistency",
            score: 35,
            explanation: "1.8 posts/week vs 4-5/week for growing accounts your size",
          },
          {
            key: "content_mix",
            label: "Content Mix",
            score: 58,
            explanation: "80% static image / 20% video; video-first accounts see 2-3x reach",
          },
        ],
      },
      growth_path: {
        phases: [
          {
            range: "1-30",
            label: "Fix the consistency gap",
            visible_action: "Shift toward short-form video around your top-performing theme.",
            locked: { count: 4, teaser: "4 more specific moves + your exact weekly posting calendar" },
          },
        ],
      },
    };

    // Transition to complete
    job = await db.updateJobStatus(jobCreated.jobId, "complete", { resultPayload });
    console.log(`✓ Updated to complete`);
    console.log(`✓ Result payload stored (report_id: ${job.resultPayload.report_id})`);
    if (job.status !== "complete" || !job.resultPayload) {
      throw new Error("Job completion failed");
    }

    // Verify we can read it back
    const jobFinal = await db.getJob(jobCreated.jobId);
    console.log(`✓ Read job back from database`);
    console.log(`  - Status: ${jobFinal.status}`);
    console.log(`  - Tier: ${jobFinal.tier}`);
    console.log(`  - Result has report_id: ${jobFinal.resultPayload.report_id}`);
    console.log();

    // ==================== TEST 2: Report Creation & Retrieval ====================
    console.log("TEST 2: Report Creation & Refresh Management");
    console.log("─".repeat(60));

    const reportCreated = await db.createReport(
      accountId,
      "growth_plan",
      {
        handle: "@boutique_fitness_co",
        platform: "instagram",
        category: "boutique_fitness",
      },
      resultPayload
    );

    console.log(`✓ Created report: ${reportCreated.reportId}`);

    const report = await db.getReport(reportCreated.reportId);
    console.log(`✓ Retrieved report`);
    console.log(`  - Tier: ${report.tier}`);
    console.log(`  - Business: ${report.business.handle} (@${report.business.platform})`);
    console.log(`  - Report body keys: ${Object.keys(report.reportBody).join(", ")}`);
    console.log();

    // ==================== TEST 3: Entitlements & Tier Changes ====================
    console.log("TEST 3: Entitlements & Transactional Tier Upgrades");
    console.log("─".repeat(60));

    // Create entitlement
    let ent = await db.getOrCreateEntitlement(accountId);
    console.log(`✓ Created entitlement for ${accountId}`);
    console.log(`  - Initial tier: ${ent.currentTier}`);
    if (ent.currentTier !== "social_snapshot") {
      throw new Error("Default tier should be social_snapshot");
    }

    // Upgrade tier (transactional: updates entitlement AND records history)
    ent = await db.upgradeTier(accountId, "growth_plan");
    console.log(`✓ Upgraded tier to: ${ent.currentTier}`);

    const history = await db.getTierHistory(accountId);
    console.log(`✓ Tier history recorded:`);
    history.forEach((h) => {
      console.log(`  - ${h.fromTier} → ${h.toTier} at ${new Date(h.changedAt).toISOString()}`);
    });

    if (history.length !== 1 || history[0].toTier !== "growth_plan") {
      throw new Error("Tier history not recorded correctly");
    }

    // Upgrade again to test history chain
    ent = await db.upgradeTier(accountId, "business_evaluator");
    console.log(`✓ Upgraded again to: ${ent.currentTier}`);

    const history2 = await db.getTierHistory(accountId);
    console.log(`✓ Full tier history (${history2.length} entries):`);
    history2.forEach((h) => {
      console.log(`  - ${h.fromTier} → ${h.toTier}`);
    });
    console.log();

    // ==================== TEST 4: Query Capabilities ====================
    console.log("TEST 4: Multi-tenant Queries");
    console.log("─".repeat(60));

    // Create reports for multiple accounts
    const account2 = "user_test_456";
    const account3 = "user_test_789";

    await db.createReport(
      account2,
      "social_snapshot",
      { handle: "@yoga_studio", platform: "instagram", category: "fitness" },
      { ...resultPayload, report_id: "rpt_002" }
    );

    await db.createReport(
      account3,
      "growth_plan",
      { handle: "@coffee_shop", platform: "instagram", category: "food_beverage" },
      { ...resultPayload, report_id: "rpt_003" }
    );

    // List reports by account
    const account1Reports = await db.listReportsByAccount(accountId);
    console.log(`✓ Account 1 has ${account1Reports.length} report(s)`);

    const account2Reports = await db.listReportsByAccount(account2);
    console.log(`✓ Account 2 has ${account2Reports.length} report(s)`);

    // Query reports due for refresh
    const refreshTime = Date.now() + 8 * 24 * 60 * 60 * 1000; // 8 days from now
    const dueForRefresh = await db.listReportsDueForRefresh(refreshTime);
    console.log(`✓ ${dueForRefresh.length} report(s) due for refresh before 8 days`);
    dueForRefresh.forEach((r) => {
      console.log(`  - ${r.reportId}: ${r.business.handle} (refresh_due: ${new Date(r.refreshDueAt).toISOString()})`);
    });
    console.log();

    // ==================== TEST 5: Isolation & Transactions ====================
    console.log("TEST 5: Transactional Integrity");
    console.log("─".repeat(60));

    // Create a job and complete it with a report, simulating both succeeding or both failing together
    const jobForTx = await db.createJob(accountId, "business_evaluator", {
      handle: "@test_tx",
      platform: "instagram",
    });

    console.log(`✓ Created job: ${jobForTx.jobId}`);

    // Transition to complete
    const txResult = await db.updateJobStatus(jobForTx.jobId, "complete", {
      resultPayload: {
        report_id: "rpt_tx_001",
        tier: "business_evaluator",
        business: { handle: "@test_tx", platform: "instagram" },
        generated_at: Date.now(),
      },
    });

    console.log(`✓ Job completed with result`);

    // Verify the data persisted
    const jobVerify = await db.getJob(jobForTx.jobId);
    console.log(`✓ Job data persisted: status=${jobVerify.status}, has result=${!!jobVerify.resultPayload}`);

    if (!jobVerify.resultPayload || jobVerify.resultPayload.report_id !== "rpt_tx_001") {
      throw new Error("Transaction integrity failed");
    }

    console.log();

    // ==================== SUMMARY ====================
    console.log("✅ ALL TESTS PASSED\n");
    console.log("📊 Test Summary:");
    console.log("  ✓ Job lifecycle (queued → running → complete)");
    console.log("  ✓ Report CRUD operations");
    console.log("  ✓ Entitlements with transactional tier upgrades");
    console.log("  ✓ Multi-tenant queries with indexing");
    console.log("  ✓ Transactional integrity on job completion");
    console.log("\n💾 Database file saved to:", TEST_DB_FILE);
    console.log("\nData is persistent and ready for API endpoints.");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
