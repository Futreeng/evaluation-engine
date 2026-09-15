// End-to-End Test Harness
// Tests complete audit flow: form submission → job processing → Convergence analysis → results

const fetch = require("node-fetch");

const API_BASE = "http://localhost:3001/api/growth-engine/v1";

// Test configuration
const TEST_CASES = [
  {
    name: "Instagram Fitness Profile",
    handle: "@fitnessguru",
    platform: "instagram",
    category: "fitness",
    email: "test@example.com",
  },
  {
    name: "TikTok Food & Beverage",
    handle: "@foodblog",
    platform: "tiktok",
    category: "food_beverage",
    email: "test2@example.com",
  },
  {
    name: "Twitter Professional Services",
    handle: "@consultant",
    platform: "x",
    category: "professional_services",
    email: "test3@example.com",
  },
];

// Helper: Make API call
async function apiCall(method, endpoint, body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

// Helper: Poll job until complete or timeout
async function waitForJob(jobId, maxWaitSeconds = 30) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await apiCall("GET", `/job/${jobId}`);

    console.log(`  [Job ${jobId}] Status: ${result.status}`);

    if (result.status === "complete") {
      return result.result;
    }

    if (result.status === "failed") {
      throw new Error(`Job failed: ${result.error}`);
    }

    // Wait 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Job timeout after ${maxWaitSeconds}s`);
}

// Test: Submit audit and wait for results
async function testAudit(testCase) {
  console.log(`\n📋 Test: ${testCase.name}`);
  console.log(`   Handle: ${testCase.handle}, Platform: ${testCase.platform}`);

  try {
    // Step 1: Submit audit request
    console.log(`   → Submitting audit request...`);
    const submitResponse = await apiCall("POST", "/evaluate/social-snapshot", {
      handle: testCase.handle,
      platform: testCase.platform,
      category: testCase.category,
      email: testCase.email,
    });

    const jobId = submitResponse.jobId;
    console.log(`   → Job queued: ${jobId}`);
    console.log(`   → Estimated wait: ${submitResponse.estimatedWaitSeconds}s`);

    // Step 2: Wait for audit to complete
    console.log(`   → Waiting for analysis...`);
    const auditResult = await waitForJob(jobId, 60);

    // Step 3: Validate results
    console.log(`   ✅ Audit complete!`);
    console.log(`   → Overall Score: ${auditResult.overallScore}/100`);
    console.log(`   → Dimensions:`);
    console.log(`     - Authenticity: ${auditResult.scores.authenticity.score}`);
    console.log(`     - Engagement: ${auditResult.scores.engagement.score}`);
    console.log(`     - Growth: ${auditResult.scores.growth.score}`);
    console.log(`     - Consistency: ${auditResult.scores.consistency.score}`);
    console.log(`   → Category Average: ${auditResult.scores.categoryAverage}`);
    console.log(`   → Recommendations: ${auditResult.scores.recommendations.length}`);
    console.log(`   → Growth Path Phases: ${auditResult.growthPath.phases.length}`);

    return { passed: true, jobId, result: auditResult };
  } catch (error) {
    console.log(`   ❌ Test failed: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

// Run all tests
async function runTests() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Futreeng Growth Engine — End-to-End Test Suite");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

  const results = [];

  for (const testCase of TEST_CASES) {
    const result = await testAudit(testCase);
    results.push(result);

    // Delay between tests
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Test Summary");
  console.log("═══════════════════════════════════════════════════════════════");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed!");
    process.exit(0);
  }
}

// Run tests
runTests().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
