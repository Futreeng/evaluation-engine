const { v4: uid } = require("uuid");

// Audit Analyzer Service
// Orchestrates dual-LLM analysis via Convergence
// Takes social profile data → runs Convergence session → returns scores/recommendations

class AuditAnalyzer {
  constructor(db, convergenceClient, socialMediaClient) {
    this.db = db;
    this.convergenceClient = convergenceClient;
    this.socialMediaClient = socialMediaClient;
  }

  // Main analysis flow
  async analyze(userId, input) {
    const { handle, platform, category, businessMetrics } = input;

    // Step 1: Fetch social profile data (via platform APIs)
    console.log(`Fetching profile data: @${handle} on ${platform}`);
    const profileData = await this.socialMediaClient.getProfileData(handle, platform);

    // Step 2: Create Convergence session for analysis
    console.log(`Creating Convergence session for ${handle}`);
    const convergenceSessionId = uid();
    const convergenceSession = await this.convergenceClient.createSession(
      userId,
      convergenceSessionId,
      "audit"
    );

    // Step 3: Send profile analysis prompts to Convergence
    // Convergence will run dual analysis: Claude vs Gemini
    console.log(`Running dual-LLM analysis via Convergence`);
    const analysisPrompt = this.buildAnalysisPrompt(profileData, category);

    const analysisResult = await this.convergenceClient.sendPrompt(
      convergenceSessionId,
      analysisPrompt,
      { mode: "parallel" } // Claude vs Gemini parallel analysis
    );

    // Step 4: Parse results from Convergence
    const scores = this.parseScoresFromConvergence(analysisResult);
    const growthPath = this.buildGrowthPath(profileData, scores);

    // Step 5: Save audit results
    const auditResult = {
      overallScore: scores.overall,
      scores: scores,
      growthPath: growthPath,
      convergenceSessionId: convergenceSessionId,
      analyzedAt: new Date().toISOString(),
    };

    console.log(`Audit complete for ${handle}: score ${scores.overall}`);
    return auditResult;
  }

  // Build analysis prompt for Convergence
  buildAnalysisPrompt(profileData, category) {
    return `
Analyze this social media profile and score across 4 dimensions.

**Profile Data:**
Handle: ${profileData.handle}
Platform: ${profileData.platform}
Followers: ${profileData.followers}
Following: ${profileData.following}
Posts: ${profileData.postCount}
Bio: ${profileData.bio}
Recent Posts (5):
${profileData.recentPosts.map(p => `- "${p.caption}" (${p.likes} likes, ${p.comments} comments, ${p.date})`).join("\n")}

**Business Category:** ${category}

**Task (Claude vs Gemini parallel):**

Dimension 1 - AUTHENTICITY:
- Is the brand voice consistent across posts?
- Are there signs of bot activity or fake engagement?
- Score: 0-100
- Explanation: [2-3 sentences]

Dimension 2 - ENGAGEMENT:
- Calculate engagement rate: (likes + comments) / followers
- Is engagement quality high (meaningful comments vs spam)?
- Score: 0-100
- Explanation: [2-3 sentences]

Dimension 3 - GROWTH:
- Is the follower count growing consistently?
- Any viral moments or growth spikes?
- Score: 0-100
- Explanation: [2-3 sentences]

Dimension 4 - CONSISTENCY:
- How frequent are posts (posting schedule)?
- Is content theme consistent or scattered?
- Score: 0-100
- Explanation: [2-3 sentences]

Then compare your analyses and provide:
- CONSENSUS SCORE for each dimension (average of both analyses)
- TOP 3 RECOMMENDATIONS for improvement
- CATEGORY BENCHMARK (how this profile compares to average in ${category})
    `;
  }

  // Parse scores from Convergence results
  parseScoresFromConvergence(convergenceResult) {
    // TODO: Parse Claude vs Gemini consensus from convergenceResult
    // For now, return placeholder structure
    return {
      overall: 65,
      authenticity: { score: 70, explanation: "Consistent brand voice" },
      engagement: { score: 62, explanation: "Moderate engagement rate" },
      growth: { score: 68, explanation: "Steady growth trajectory" },
      consistency: { score: 60, explanation: "Irregular posting schedule" },
      categoryAverage: 72,
      recommendations: [
        "Increase posting frequency to 3x per week",
        "Engage more with community comments",
        "Develop content calendar around trending topics"
      ],
    };
  }

  // Build 30-60-90 growth path
  buildGrowthPath(profileData, scores) {
    return {
      phases: [
        {
          range: "1-30",
          visibleAction: "Post 3x weekly with engagement hooks (ask questions, call-to-action)",
          hidden: {
            teaser: "Content calendar + competitor analysis",
            full: "Detailed content strategy based on platform algorithms"
          }
        },
        {
          range: "31-60",
          visibleAction: "Run engagement campaigns: polls, stories, user-generated content",
          hidden: {
            teaser: "Growth benchmarking report",
            full: "ROI projections for paid ads based on current engagement"
          }
        },
        {
          range: "61-90",
          visibleAction: "Launch collaboration partnerships with complementary accounts",
          hidden: {
            teaser: "Business reconciliation",
            full: "Revenue impact analysis: followers → conversions → revenue"
          }
        }
      ]
    };
  }
}

module.exports = AuditAnalyzer;
