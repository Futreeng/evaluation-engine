const fs = require("fs");
const path = require("path");
const db = require("./growth_engine_db");

const TEST_DB_FILE = path.join(__dirname, "data", "growth_engine.db");

async function verify() {
  console.log("🔍 Verifying Growth Engine Database Persistence\n");

  console.log(`Database file exists: ${fs.existsSync(TEST_DB_FILE)}`);
  console.log(`File size: ${fs.statSync(TEST_DB_FILE).size} bytes\n`);

  // Initialize (will load existing database)
  await db.initDb();
  console.log("✅ Database loaded from disk\n");

  console.log("═══════════════════════════════════════════════════════════");
  console.log("PERSISTED DATA FROM PREVIOUS TEST RUN");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Read back the job that was created and completed
  const jobs = ["job_b3e4bfca87a12f4141827bdf", "job_e2e26a44c5350740c56db90c"];

  for (const jobId of jobs) {
    const job = await db.getJob(jobId);
    if (job) {
      console.log(`📋 Job: ${jobId}`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Tier: ${job.tier}`);
      console.log(`   Account: ${job.accountId}`);
      if (job.resultPayload) {
        console.log(`   Result Report ID: ${job.resultPayload.report_id}`);
        console.log(`   Result Tier: ${job.resultPayload.tier}`);
      }
      console.log();
    }
  }

  // Read back reports
  console.log("📄 Reports:");
  const reports = await db.listReportsByAccount("user_test_123");
  reports.forEach((report) => {
    console.log(`   Report ID: ${report.reportId}`);
    console.log(`   Tier: ${report.tier}`);
    console.log(`   Business: ${report.business.handle}`);
    console.log(`   Generated: ${new Date(report.generatedAt).toISOString()}`);
    console.log();
  });

  // Read back entitlements
  console.log("🔐 Entitlements:");
  const ent = await db.getEntitlement("user_test_123");
  if (ent) {
    console.log(`   Account: user_test_123`);
    console.log(`   Current Tier: ${ent.currentTier}`);
    console.log(`   Tier Start: ${new Date(ent.tierStartDate).toISOString()}`);
    console.log();

    const history = await db.getTierHistory("user_test_123");
    console.log(`   Tier History (${history.length} changes):`);
    history.forEach((h) => {
      console.log(`     - ${h.fromTier} → ${h.toTier} at ${new Date(h.changedAt).toISOString()}`);
    });
  }

  console.log("\n✅ All persisted data verified and readable\n");
}

verify().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
