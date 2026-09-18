const { decrypt } = require("./crypto");
const db = require("./db");
const { analyzeTwitterAccount } = require("./twitter_fetcher");
const { analyzeInstagramAccount } = require("./instagram_fetcher");
const { analyzeInstagramAccountViaApify } = require("./instagram_apify_fetcher");

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
**futureEng GROWTH SNAPSHOT — {{HANDLE}}**

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

// Fetch real social media data based on platform
async function getRealPostData(handle, platform, category) {
  if (platform === "x" || platform === "twitter") {
    try {
      const twitterData = await analyzeTwitterAccount(handle);
      return formatTwitterDataForAnalysis(twitterData);
    } catch (err) {
      console.error("[Growth Engine] Twitter fetch failed:", err.message);
      throw new Error(`Could not fetch Twitter data for @${handle}: ${err.message}`);
    }
  }

  if (platform === "instagram" || platform === "ig") {
    try {
      // Apify reads any public profile; the Graph API only reads accounts we own.
      const instagramData = process.env.APIFY_TOKEN
        ? await analyzeInstagramAccountViaApify(handle)
        : await analyzeInstagramAccount(handle);
      return formatInstagramDataForAnalysis(instagramData);
    } catch (err) {
      console.error("[Growth Engine] Instagram fetch failed:", err.message);
      throw new Error(`Could not fetch Instagram data for @${handle}: ${err.message}`);
    }
  }

  // Add TikTok, LinkedIn, etc. here
  throw new Error(`Platform '${platform}' not yet supported. Available: 'twitter' (x), 'instagram' (ig).`);
}

function formatTwitterDataForAnalysis(twitterData) {
  // Convert Twitter API response into analysis-friendly format
  return {
    handle: twitterData.handle,
    platform: "twitter",
    follower_count: twitterData.follower_count,
    tweet_count: twitterData.tweet_count,
    metrics: twitterData.analysis,
    recent_activity: twitterData.recent_tweets.slice(0, 10).map((t) => ({
      date: t.created_at.split("T")[0],
      engagement: t.public_metrics.like_count + t.public_metrics.reply_count + t.public_metrics.retweet_count,
      reach: t.public_metrics.impression_count || 0,
      likes: t.public_metrics.like_count,
      retweets: t.public_metrics.retweet_count,
      replies: t.public_metrics.reply_count,
      text_preview: t.text.substring(0, 100),
    })),
  };
}

function formatInstagramDataForAnalysis(instagramData) {
  // Convert Instagram API response into analysis-friendly format
  return {
    handle: instagramData.handle,
    platform: "instagram",
    follower_count: instagramData.follower_count,
    following_count: instagramData.following_count,
    post_count: instagramData.post_count,
    biography: instagramData.biography || null,
    website: instagramData.website || null,
    metrics: instagramData.analysis,
    recent_activity: instagramData.recent_posts.slice(0, 12).map((p) => ({
      date: p.timestamp.split("T")[0],
      engagement: (p.like_count || 0) + (p.comments_count || 0),
      likes: p.like_count || 0,
      comments: p.comments_count || 0,
      media_type: p.is_reel ? "REEL" : p.media_type,
      video_views: p.video_view_count || undefined,
      location: p.location || undefined,
      caption_preview: p.caption ? p.caption.substring(0, 100) : "",
    })),
  };
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
  // groq/compound routes to a large model with an 8k TPM cap on the free tier.
  // A single evaluation makes three calls, so honour Retry-After on 429 and
  // fall back to a smaller model before giving up.
  const models = [process.env.GROQ_MODEL || "groq/compound", "openai/gpt-oss-20b", "groq/compound-mini"];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userMessage },
          ],
          max_tokens: 2048,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message.content;
      }
      const detail = await response.text();
      lastErr = new Error(`Groq API error ${response.status} (${model}): ${detail.slice(0, 200)}`);
      if (response.status === 429) {
        const m = /try again in ([\d.]+)(m?s)/i.exec(detail);
        const waitMs = m ? Math.ceil(parseFloat(m[1]) * (m[2] === "ms" ? 1 : 1000)) + 500 : (attempt + 1) * 8000;
        if (waitMs <= 45000) {
          console.log(`[Growth Engine] Groq 429 on ${model}, waiting ${waitMs}ms...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
      }
      break; // non-retryable for this model → next model
    }
  }
  throw lastErr;
}

async function callTogetherNonStreaming(togetherKey, system, userMessage) {
  if (!togetherKey) throw new Error("Together API key not configured");

  const response = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${togetherKey}`,
    },
    body: JSON.stringify({
      model: "meta-llama/Llama-3-70b-chat-hf",
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Together API error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOpenAINonStreaming(openaiKey, system, userMessage) {
  if (!openaiKey) throw new Error("OpenAI API key not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${detail.slice(0, 200)}`);
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

// 4-way fallback: try all four LLMs in sequence
async function callWithQuadFallback(primaryCall, secondaryCall, tertiaryCall, quaternaryCall, label) {
  try {
    console.log(`[Growth Engine] ${label}: trying primary LLM (Claude)...`);
    return await primaryCall();
  } catch (err1) {
    console.log(`[Growth Engine] ${label} (primary) failed, trying secondary...`, err1.message);
    try {
      console.log(`[Growth Engine] ${label}: trying secondary LLM (Gemini)...`);
      return await secondaryCall();
    } catch (err2) {
      console.log(`[Growth Engine] ${label} (secondary) failed, trying tertiary...`, err2.message);
      try {
        console.log(`[Growth Engine] ${label}: trying tertiary LLM (Groq)...`);
        return await tertiaryCall();
      } catch (err3) {
        console.log(`[Growth Engine] ${label} (tertiary) failed, trying quaternary (OpenAI)...`, err3.message);
        try {
          console.log(`[Growth Engine] ${label}: trying quaternary LLM (OpenAI)...`);
          return await quaternaryCall();
        } catch (err4) {
          console.log(`[Growth Engine] ${label} (quaternary) also failed - all LLMs exhausted`, err4.message);
          throw new Error(`${label} failed: primary: ${err1.message}; secondary: ${err2.message}; tertiary: ${err3.message}; quaternary: ${err4.message}`);
        }
      }
    }
  }
}

async function evaluateTier0(accountId, inputParams) {
  const { claudeKey, claudeWorkspaceId, geminiKey, groqKey } = getDecryptedKeys(accountId);
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!claudeKey && !geminiKey && !groqKey && !openaiKey) {
    throw new Error("No LLM API keys configured (Claude, Gemini, Groq, or OpenAI)");
  }

  const { handle, platform, category } = inputParams;

  // Fetch real social media data
  let postSummary;
  try {
    const realData = await getRealPostData(handle, platform, category);
    postSummary = JSON.stringify(realData); // compact: every token counts against free-tier TPM caps
  } catch (err) {
    console.warn("[Growth Engine] Real data fetch failed:", err.message);
    // A private, missing or malformed profile is not something to write a
    // report around — fail the job so the UI can say so honestly.
    if (/private|not found|not a valid|no public posts|not yet supported/i.test(err.message)) throw err;
    postSummary = JSON.stringify({
      handle,
      platform,
      note: `Could not fetch real data: ${err.message}. Analyze based on platform best practices.`,
    });
  }
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

  console.log("[Growth Engine] Starting evaluation. Fallback chain: Claude → Gemini → Groq → OpenAI");
  const [personaAResponse, personaBResponse] = await Promise.all([
    // Persona A: Growth Scanner
    callWithQuadFallback(
      () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert social media strategist.", prompt1),
      () => callGeminiNonStreaming(geminiKey, "You are an expert social media strategist.", prompt1),
      () => callGroqNonStreaming(groqKey, "You are an expert social media strategist.", prompt1),
      () => callOpenAINonStreaming(openaiKey, "You are an expert social media strategist.", prompt1),
      "Growth Scanner"
    ),
    // Persona B: Gap Auditor
    callWithQuadFallback(
      () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are a data-driven social media analyst.", prompt2),
      () => callGeminiNonStreaming(geminiKey, "You are a data-driven social media analyst.", prompt2),
      () => callGroqNonStreaming(groqKey, "You are a data-driven social media analyst.", prompt2),
      () => callOpenAINonStreaming(openaiKey, "You are a data-driven social media analyst.", prompt2),
      "Gap Auditor"
    ),
  ]);

  // Merge step
  const mergeTemplateVars = {
    ...templateVars,
    PERSONA_A_RESPONSE: personaAResponse,
    PERSONA_B_RESPONSE: personaBResponse,
  };

  const mergePrompt = interpolateTemplate(PERSONA_PROMPTS.tier0.merge, mergeTemplateVars);

  // Merge: Claude → Gemini → Groq → OpenAI
  const mergedReport = await callWithQuadFallback(
    () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callGeminiNonStreaming(geminiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callGroqNonStreaming(groqKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callOpenAINonStreaming(openaiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    "Merge"
  );

  // Use the actual LLM-generated narrative report, not mock data
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
    narrative: mergedReport,
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
