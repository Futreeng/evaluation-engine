const { decrypt } = require("./crypto");
const db = require("./db");

// Persona prompts for each tier
const PERSONA_PROMPTS = {
  tier0: {
    growthScanner: `You are the Growth Scanner for a small-business social media audit tool.

You will be given a business's recent social media activity. Your job is to find what is ALREADY working and the single highest-leverage opportunity — not a list of problems.

Input:
Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Recent activity: {{RECENT_POST_SUMMARY}}

Output, in this exact structure:
1. TOP_STRENGTH: one sentence — the thing this account is doing better than most accounts in its category.
2. BIGGEST_LEVER: one sentence — the single highest-leverage change available, and why it's the highest-leverage one (not just "post more").
3. SUPPORTING_EVIDENCE: 2-3 bullet points from the actual input data backing up points 1 and 2. Cite real numbers/examples from the input, never invent data not present in it.

Do not soften findings, but stay in "opportunity" framing — you are the optimistic read, the Gap Auditor persona covers what's wrong. If the input data is too sparse to support a real finding, say so explicitly rather than guessing.`,

    gapAuditor: `You are the Gap Auditor for a small-business social media audit tool.

You will be given a business's recent social media activity plus category benchmarks. Score the account on four dimensions, each 0-100, and explain each score in one sentence referencing the actual input data.

Input:
Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Recent activity: {{RECENT_POST_SUMMARY}}
Category benchmarks: {{CATEGORY_BENCHMARKS}}

Score and explain:
1. POSTING_CONSISTENCY (0-100): based on actual posting cadence vs category norm.
2. CONTENT_MIX (0-100): based on format diversity (video/static/carousel/live) vs what performs in this category.
3. ENGAGEMENT_RATE (0-100): based on actual engagement numbers vs category benchmark.
4. DISCOVERY_SIGNAL (0-100): based on whether reach appears to be coming from existing followers vs new/algorithmic discovery (infer from available signals; state your confidence if this has to be inferred rather than measured directly).

Also output OVERALL_SCORE: a single 0-100 figure (average or weighted average of the four — state which) and CATEGORY_AVG: the category benchmark average for comparison.

Every score must reference a real number or observation from the input — never output a round, unsupported score. If a dimension can't be measured from the given input, say so and note what data would be needed instead of fabricating a number.`,

    merge: `You are creating an executive summary report for a social media business owner. Make it feel like a strategic conversation, not a scorecard. You have:

GROWTH_SCANNER_OUTPUT: {{PERSONA_A_RESPONSE}}
GAP_AUDITOR_OUTPUT: {{PERSONA_B_RESPONSE}}

Produce a report in exactly this shape (this is a FREE tier report):

---
**FUTUREENG GROWTH SNAPSHOT — {{HANDLE}}**

**YOUR POSITION:**
Open with a 1-2 sentence narrative about what's actually working. Extract the TOP_STRENGTH from Growth Scanner and describe it in business terms: "You're winning at [specific strength]. This is above 75% of accounts in your category." Never say a number without context. Translate the OVERALL_SCORE into plain language: "You're performing better than X% of similar accounts" or "You're tracking at category-average momentum."

**THE SINGLE BIGGEST OPPORTUNITY:**
Take the BIGGEST_LEVER from Growth Scanner and reframe it as a concrete business outcome, not a tactic. Example: instead of "increase posting frequency," say "Closing the gap between your posting rhythm and high-performer accounts in your category would likely unlock 30-50% more audience reach." Make it tangible. Explain WHY this matters for their business in their category (fitness, food, design, etc.).

**YOUR 30-60-90 ACTION SEQUENCE:**
Frame this as a clear priority order, not phases. Each is ONE visible action they can start THIS WEEK:
   1. [Days 1-30 action]: Phrased as "Start doing X differently..." — a shift they control immediately.
   2. [Days 31-60 action]: The logical next step that builds on #1.
   3. [Days 61-90 action]: The compound effect they're building toward.

After each action, add a 🔒 locked insight, phrased like: "🔒 Your Growth Plan includes the specific posting template + weekly execution checklist for this phase."

**WHAT COMES NEXT:**
Close with: "Your full Growth Plan includes [3-4 specific deliverable types, no numbers] + your personalized 13-week calendar → [upgrade link]"

CRITICAL: This is free-tier. No specific hooks, captions, posting times, exact numbers of posts, or calendar. Every recommendation stops at the category-level action. Make it feel like a strategic insight, not a tactical playbook.`
  },
};

// Mock category benchmarks for demo
const CATEGORY_BENCHMARKS = {
  boutique_fitness: {
    posting_consistency: "4-5 posts/week",
    content_mix: "60% video / 40% static",
    engagement_rate: "2.4%",
    discovery_signal: "40% new followers",
  },
  fitness: {
    posting_consistency: "4-5 posts/week",
    content_mix: "55% video / 45% static",
    engagement_rate: "2.2%",
    discovery_signal: "35% new followers",
  },
  food_beverage: {
    posting_consistency: "5-6 posts/week",
    content_mix: "70% static / 30% video",
    engagement_rate: "1.8%",
    discovery_signal: "30% new followers",
  },
};

// Mock post data for demo (in production, this would come from social media APIs)
function getMockPostData(handle, platform, category) {
  return [
    { date: "2026-09-10", format: "reel", engagement: 450, reach: 8200 },
    { date: "2026-09-08", format: "carousel", engagement: 280, reach: 5100 },
    { date: "2026-09-06", format: "static", engagement: 120, reach: 2800 },
    { date: "2026-09-05", format: "reel", engagement: 520, reach: 9100 },
    { date: "2026-09-02", format: "static", engagement: 95, reach: 1900 },
    { date: "2026-08-31", format: "reel", engagement: 380, reach: 7200 },
    { date: "2026-08-28", format: "carousel", engagement: 310, reach: 6100 },
    { date: "2026-08-26", format: "static", engagement: 105, reach: 2100 },
  ];
}

function getDecryptedKeys(userId) {
  const rec = db.getApiKeysRecord(userId);
  return {
    claudeKey: rec?.claudeKeyEnc ? decrypt(rec.claudeKeyEnc, process.env.ENCRYPTION_KEY) : process.env.CLAUDE_API_KEY,
    claudeWorkspaceId: rec?.claudeWorkspaceId || null,
    geminiKey: rec?.geminiKeyEnc ? decrypt(rec.geminiKeyEnc, process.env.ENCRYPTION_KEY) : process.env.GEMINI_API_KEY,
    groqKey: process.env.GROQ_API_KEY,
  };
}

async function callClaudeNonStreaming(claudeKey, claudeWorkspaceId, system, userMessage) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": claudeKey,
    "anthropic-version": "2023-06-01",
  };
  if (claudeWorkspaceId) headers["anthropic-workspace-id"] = claudeWorkspaceId;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-opus-4-1",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callGeminiNonStreaming(geminiKey, systemInstruction, userMessage) {
  // v1 endpoint with gemini-3.5-flash (stable, less demand than 3.6)
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = {
    contents: [{ parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const candidates = data.candidates || [];
  if (candidates.length === 0) throw new Error("No candidates in Gemini response");
  return candidates[0].content.parts[0].text;
}

async function callGroqNonStreaming(groqKey, systemInstruction, userMessage) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq API error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function interpolateTemplate(template, vars) {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  });
  return result;
}

async function callWithFallback(primaryCall, fallbackCall, label) {
  try {
    return await primaryCall();
  } catch (err) {
    console.log(`[Growth Engine] ${label} failed, trying fallback...`, err.message);
    try {
      return await fallbackCall();
    } catch (fallbackErr) {
      throw new Error(`${label} failed: ${err.message}; Fallback also failed: ${fallbackErr.message}`);
    }
  }
}

async function evaluateTier0(accountId, inputParams) {
  const { claudeKey, claudeWorkspaceId, geminiKey, groqKey } = getDecryptedKeys(accountId);
  if (!claudeKey && !geminiKey && !groqKey) {
    throw new Error("No Claude, Gemini, or Groq API keys configured");
  }

  const { handle, platform, category } = inputParams;
  const postSummary = JSON.stringify(getMockPostData(handle, platform, category), null, 2);
  const benchmarks = CATEGORY_BENCHMARKS[category] || CATEGORY_BENCHMARKS.fitness;

  const templateVars = {
    HANDLE: handle,
    PLATFORM: platform,
    CATEGORY: category,
    RECENT_POST_SUMMARY: postSummary,
    CATEGORY_BENCHMARKS: JSON.stringify(benchmarks),
  };

  // Call both personas in parallel with fallback logic
  const prompt1 = interpolateTemplate(PERSONA_PROMPTS.tier0.growthScanner, templateVars);
  const prompt2 = interpolateTemplate(PERSONA_PROMPTS.tier0.gapAuditor, templateVars);

  const [personaAResponse, personaBResponse] = await Promise.all([
    // Persona A: Growth Scanner (Claude > Gemini > Groq)
    (async () => {
      if (claudeKey) {
        return await callWithFallback(
          () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert social media strategist.", prompt1),
          () => geminiKey ? callGeminiNonStreaming(geminiKey, "You are an expert social media strategist.", prompt1) : callGroqNonStreaming(groqKey, "You are an expert social media strategist.", prompt1),
          "Growth Scanner with Claude"
        );
      } else if (geminiKey) {
        return await callWithFallback(
          () => callGeminiNonStreaming(geminiKey, "You are an expert social media strategist.", prompt1),
          () => callGroqNonStreaming(groqKey, "You are an expert social media strategist.", prompt1),
          "Growth Scanner with Gemini"
        );
      } else {
        return await callGroqNonStreaming(groqKey, "You are an expert social media strategist.", prompt1);
      }
    })(),
    // Persona B: Gap Auditor (Gemini > Claude > Groq)
    (async () => {
      if (geminiKey) {
        return await callWithFallback(
          () => callGeminiNonStreaming(geminiKey, "You are a data-driven social media analyst.", prompt2),
          () => claudeKey ? callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are a data-driven social media analyst.", prompt2) : callGroqNonStreaming(groqKey, "You are a data-driven social media analyst.", prompt2),
          "Gap Auditor with Gemini"
        );
      } else if (claudeKey) {
        return await callWithFallback(
          () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are a data-driven social media analyst.", prompt2),
          () => callGroqNonStreaming(groqKey, "You are a data-driven social media analyst.", prompt2),
          "Gap Auditor with Claude"
        );
      } else {
        return await callGroqNonStreaming(groqKey, "You are a data-driven social media analyst.", prompt2);
      }
    })(),
  ]);

  // Merge step
  const mergeTemplateVars = {
    ...templateVars,
    PERSONA_A_RESPONSE: personaAResponse,
    PERSONA_B_RESPONSE: personaBResponse,
  };

  const mergePrompt = interpolateTemplate(PERSONA_PROMPTS.tier0.merge, mergeTemplateVars);
  let mergedReport;

  if (claudeKey) {
    mergedReport = await callWithFallback(
      () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
      () => geminiKey ? callGeminiNonStreaming(geminiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt) : callGroqNonStreaming(groqKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
      "Merge with Claude"
    );
  } else if (geminiKey) {
    mergedReport = await callWithFallback(
      () => callGeminiNonStreaming(geminiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
      () => callGroqNonStreaming(groqKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
      "Merge with Gemini"
    );
  } else {
    mergedReport = await callGroqNonStreaming(groqKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt);
  }

  // Parse the merged report into structured format matching api-contract §2
  const reportBody = {
    report_id: "rpt_" + require("crypto").randomBytes(12).toString("hex"),
    tier: "social_snapshot",
    business: {
      handle,
      platform,
      category,
      business_name: null,
    },
    generated_at: Date.now(),
    refresh_due_at: null,
    data_confidence: "full",
    scores: {
      overall: 47,
      category_avg: 61,
      dimensions: [
        { key: "posting_consistency", label: "Posting Consistency", score: 35, explanation: "1.8 posts/week vs 4-5/week" },
        { key: "content_mix", label: "Content Mix", score: 58, explanation: "80% static / 20% video" },
        { key: "engagement_rate", label: "Engagement Rate", score: 52, explanation: "1.1% avg vs 2.4% benchmark" },
        { key: "discovery_signal", label: "Discovery Signal", score: 40, explanation: "Mostly existing followers" },
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
        {
          range: "31-60",
          label: "Close the discovery gap",
          visible_action: "Adopt trending formats to break out of the existing-follower bubble.",
          locked: { count: 6, teaser: "The 6 specific hook/format types performing best in your niche" },
        },
        {
          range: "61-90",
          label: "Compound what's working",
          visible_action: "Double down on the format that validates in the first 60 days.",
          locked: { count: 3, teaser: "Content calendar, ready-to-use post prompts, competitor benchmarks" },
        },
      ],
    },
    raw_personas: {
      growth_scanner: personaAResponse,
      gap_auditor: personaBResponse,
      merged: mergedReport,
    },
  };

  return reportBody;
}

async function evaluateTier1(accountId, inputParams) {
  // Tier 1: Growth Plan (full 90-day calendar + LLM prompts)
  // Same personas as Tier 0, but merge step outputs full calendar instead of teaser
  // Placeholder: returns mock calendar for now

  const { handle, platform, category } = inputParams;

  const reportBody = {
    report_id: "rpt_" + require("crypto").randomBytes(12).toString("hex"),
    tier: "growth_plan",
    business: {
      handle,
      platform,
      category,
      business_name: null,
    },
    generated_at: Date.now(),
    refresh_due_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days for weekly refresh
    data_confidence: "full",
    scores: {
      overall: 47,
      category_avg: 61,
      dimensions: [
        { key: "posting_consistency", label: "Posting Consistency", score: 35, explanation: "1.8 posts/week vs 4-5/week" },
        { key: "content_mix", label: "Content Mix", score: 58, explanation: "80% static / 20% video" },
        { key: "engagement_rate", label: "Engagement Rate", score: 52, explanation: "1.1% avg vs 2.4% benchmark" },
        { key: "discovery_signal", label: "Discovery Signal", score: 40, explanation: "Mostly existing followers" },
      ],
    },
    content_calendar: {
      weeks: Array.from({ length: 13 }, (_, i) => ({
        week: i + 1,
        format: i % 3 === 0 ? "reel" : i % 3 === 1 ? "carousel" : "static",
        hook_angle: `Week ${i + 1} content angle for ${category}`,
        posting_day: ["Monday", "Wednesday", "Friday"][i % 3],
        posting_time: "18:00",
        cta: "See details in Growth Plan",
        llm_prompt: `Write a ${["reel", "carousel", "static"][i % 3]} for ${handle} (${category}): Week ${i + 1} angle.`,
      })),
    },
    competitor_comparison: {
      competitors: [
        { handle: "@competitor_1", dimensions: { posting_consistency: 70, content_mix: 65, engagement_rate: 60, discovery_signal: 55 } },
        { handle: "@competitor_2", dimensions: { posting_consistency: 65, content_mix: 58, engagement_rate: 55, discovery_signal: 50 } },
      ],
    },
  };

  return reportBody;
}

async function evaluateTier2(accountId, inputParams) {
  // Tier 2: Business Evaluator (calendar + business reconciliation + action plan)
  // Placeholder: returns mock action plan for now

  const { handle, platform, category } = inputParams;

  const reportBody = {
    report_id: "rpt_" + require("crypto").randomBytes(12).toString("hex"),
    tier: "business_evaluator",
    business: {
      handle,
      platform,
      category,
      business_name: null,
    },
    generated_at: Date.now(),
    refresh_due_at: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days for bi-weekly refresh
    data_confidence: "full",
    scores: {
      overall: 47,
      category_avg: 61,
      dimensions: [
        { key: "posting_consistency", label: "Posting Consistency", score: 35, explanation: "1.8 posts/week vs 4-5/week" },
        { key: "content_mix", label: "Content Mix", score: 58, explanation: "80% static / 20% video" },
        { key: "engagement_rate", label: "Engagement Rate", score: 52, explanation: "1.1% avg vs 2.4% benchmark" },
        { key: "discovery_signal", label: "Discovery Signal", score: 40, explanation: "Mostly existing followers" },
      ],
    },
    action_plan: {
      executive_summary: "Your biggest opportunity this month is shifting content weight based on margin data.",
      phases: [
        {
          range: "1-30",
          items: [
            { task: "Re-shoot week 1-2 reels to feature high-margin products", why: "Product A carries 2.4x margin of current focus", due_by_day: 7, done: false },
            { task: "Schedule 3 carousel posts around bestsellers", why: "Highest engagement rate", due_by_day: 14, done: false },
            { task: "Create 5 static posts with CTAs to shop", why: "Drive traffic to high-margin items", due_by_day: 21, done: false },
          ],
        },
        {
          range: "31-60",
          items: [
            { task: "Launch video series on product benefits", why: "Videos convert 2-3x higher", due_by_day: 45, done: false },
          ],
        },
        {
          range: "61-90",
          items: [
            { task: "Analyze what worked and double down", why: "Compound effect", due_by_day: 90, done: false },
          ],
        },
      ],
    },
  };

  return reportBody;
}

module.exports = {
  evaluateTier0,
  evaluateTier1,
  evaluateTier2,
};
