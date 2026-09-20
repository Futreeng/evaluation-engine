const { decrypt } = require("./crypto");
const db = require("./db");
const { analyzeInstagramAccount } = require("./instagram_fetcher");
const { analyzeInstagramAccountViaApify } = require("./instagram_apify_fetcher");
const { TIER_PRICING, ONE_TIME_PRICING } = require("./growth_engine_billing");
const { analyzeTikTokAccountViaApify } = require("./tiktok_apify_fetcher");
const { scoreProfile, rankPosts } = require("./growth_engine_scoring");

// Persona prompts for each tier
const PERSONA_PROMPTS = {
  tier0: {
    growthScanner: `You are the Growth Scanner for Scalecraft, a social media evaluation for small-business owners.

You will be given a business's recent public social media activity. Your job is to find what is ALREADY working and the single highest-leverage opportunity — not a list of problems.

Input:
Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Recent activity: {{RECENT_POST_SUMMARY}}
Best and worst recent posts vs the account's own average: {{POST_INSIGHTS}}

Output, in this exact structure:
1. TOP_STRENGTH: one sentence — the thing this account is doing better than most accounts in its category.
2. BIGGEST_LEVER: one sentence — the single highest-leverage change available, and why it's the highest-leverage one (not just "post more").
3. SUPPORTING_EVIDENCE: 2-3 bullet points from the actual input data backing up points 1 and 2. Cite real numbers/examples from the input (post counts, dates, gaps, formats, likes, comments, bio text, link), never invent data not present in it.

Do not soften findings, but stay in "opportunity" framing — you are the optimistic read, the Gap Auditor persona covers what's wrong. If the input data is too sparse to support a real finding, say so explicitly rather than guessing.`,

    gapAuditor: `You are the Gap Auditor for Scalecraft, a social media evaluation for small-business owners.

The four dimension scores have ALREADY been computed from the account's public data (method below). Your job is to explain each score to the owner in one or two plain sentences that cite the actual numbers, and to say what would move it. Do not change, re-derive or dispute the scores.

Input:
Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Recent activity: {{RECENT_POST_SUMMARY}}
Category targets: {{CATEGORY_BENCHMARKS}}
Computed scores (with the evidence and sub-scores behind each): {{COMPUTED_SCORES}}

Output exactly these lines, one per dimension, in this format — LABEL: score — explanation. Use the score given.
POSTING_CONSISTENCY: <given score> — explanation
CONTENT_MIX: <given score> — explanation
ENGAGEMENT_QUALITY: <given score> — explanation
PROFILE_CLARITY: <given score> — explanation
OVERALL_SCORE: <given overall> — one sentence naming the one or two dimensions that cost the most points.

Write for the owner ("You posted 9 times…"), starting each explanation with a capital letter. Use the sub-scores to understand what cost the points and say it in plain words ("the 42-day gap alone cost you most of this score") — do not quote sub-score numbers or component names. No markdown bold or headings.`,

    merge: `You are writing the free Scalecraft Social Snapshot for a small-business owner. Plain-spoken, specific, no hype. You have two analyses of their account:

GROWTH_SCANNER_OUTPUT: {{PERSONA_A_RESPONSE}}
GAP_AUDITOR_OUTPUT: {{PERSONA_B_RESPONSE}}
POST_INSIGHTS (their best and worst recent posts, ranked against their own average): {{POST_INSIGHTS}}

Write the report in exactly this shape:

**SCALECRAFT SOCIAL SNAPSHOT — @{{HANDLE}}**

**WHERE YOU STAND**
Two or three sentences. Lead with the overall score in plain language and name the one or two things driving most of the gap (or the lead, if the account is strong). Then one sentence on what is already working, from TOP_STRENGTH.

**THE SINGLE BIGGEST OPPORTUNITY**
Take BIGGEST_LEVER and state it as a business outcome for this category (first classes booked, tables filled, enquiries), then why, in one or two sentences grounded in the numbers.

**YOUR 30-60-90 DAY PATH**
Three phases. Each phase has a short label and ONE fully specific first move the owner can start this week — specific means it names the days, the format, the count, the bio wording to change, or the page to link to, derived from this account's own data (e.g. "Pick three fixed posting days — Mon, Wed, Sat — and post a reel on each" or "Rewrite the first line of your bio to name the neighbourhood and the price of a first class"). Follow each move with one or two sentences of reasoning tied to the data. Then a 🔒 line that names a countable set of locked items without revealing them, e.g. "🔒 4 more moves for this phase + your weeks 1–4 posting calendar".
1. **Days 1–30 – [label]:** [move]. [reasoning]
   🔒 …
2. **Days 31–60 – [label]:** [move]. [reasoning]
   🔒 …
3. **Days 61–90 – [label]:** [move]. [reasoning]
   🔒 …
Sequence the phases so the biggest gap is addressed first.
{{PLAN_CONTEXT}}

**WHAT YOUR BEST POSTS HAVE IN COMMON**
Two or three sentences from POST_INSIGHTS: name the top post by date and what it was, say what the top three share (format, subject, day, how the caption opens) and what the bottom three share. Concrete, not "engaging content".

**WHAT THE FULL PLAN ADDS**
One sentence: the remaining moves for all three phases, the week-by-week posting calendar, and content prompts written from their own posts.

Rules: the scores in GAP_AUDITOR_OUTPUT are final — copy them exactly into the JSON block, never round or adjust them. The first move of each phase is free and must be genuinely actionable and specific. Everything beyond that first move — captions, hooks, the calendar itself, the other moves — stays locked. Never invent numbers not in the analyses. No emoji other than the 🔒. No "[upgrade link]" placeholders.

Finally, after the report, output a machine-readable block on its own lines, exactly like this, with real values (no comments, valid JSON):
\`\`\`json
{"overall": 0, "dimensions": [{"label": "Posting Consistency", "score": 0, "explanation": ""}, {"label": "Content Mix", "score": 0, "explanation": ""}, {"label": "Engagement Quality", "score": 0, "explanation": ""}, {"label": "Profile Clarity", "score": 0, "explanation": ""}], "summary": "one sentence naming what drives most of the gap", "best_posts_note": "two sentences: what the top posts share and what the bottom posts share", "phases": [{"range": "1-30", "label": "", "visible_action": "", "detail": "", "locked": {"count": 4, "teaser": ""}}, {"range": "31-60", "label": "", "visible_action": "", "detail": "", "locked": {"count": 4, "teaser": ""}}, {"range": "61-90", "label": "", "visible_action": "", "detail": "", "locked": {"count": 4, "teaser": ""}}]}
\`\`\``
  },
};

// The creator's intake answers, turned into hard rules for every prompt that
// writes moves or calendar slots. Empty string when nothing was answered.
const PLAN_CONTEXT_LABELS = {
  horizon: { usual: "business as usual", fewer_shoots: "fewer new shoots than usual (no trips, off-season, injury or a busy stretch)", launch: "something launching (an event, drop or move)" },
  hours: { lt2: "under 2 hours a week", "2_5": "2–5 hours a week", "5_10": "5–10 hours a week", "10plus": "10+ hours a week" },
  goal: { followers: "more followers", deals: "brand deals and sponsors", sell: "selling something (a guide, coaching, a product)", bookings: "bookings and clients", consistency: "just getting consistent" },
  style: { on_camera: "on camera, talking", behind: "behind the camera (voiceover, b-roll)", photos: "photos and carousels mostly", help: "has help (an editor or team)" },
};
function planContextBlock(ctx, days = 90) {
  if (!ctx || !Object.keys(ctx).some((k) => ctx[k])) return "";
  const L = PLAN_CONTEXT_LABELS;
  const lines = [];
  if (ctx.horizon && L.horizon[ctx.horizon]) lines.push(`- Next ${days} days: ${L.horizon[ctx.horizon]}.`);
  if (ctx.hours && L.hours[ctx.hours]) lines.push(`- Time for content: ${L.hours[ctx.hours]}.`);
  if (ctx.goal && L.goal[ctx.goal]) lines.push(`- What they want from the next ${days} days: ${L.goal[ctx.goal]}.`);
  if (ctx.link) lines.push(`- Their link (use this exact URL in any bio/link move, never a placeholder): ${ctx.link}`);
  if (ctx.contact) lines.push(`- The email brands should use (use it exactly in any bio/contact move, never a placeholder): ${ctx.contact}`);
  if (ctx.style && L.style[ctx.style]) lines.push(`- How they like to make content: ${L.style[ctx.style]}.`);
  if (ctx.notes) lines.push(`- In their words: "${String(ctx.notes).slice(0, 200)}"`);
  const rules = [];
  if (ctx.horizon === "fewer_shoots") rules.push("They will not be shooting much new footage. Every move must be doable from their existing posts (repurposing, re-cuts, throwback carousels, 'what I'd do differently'), from home (talk-to-camera, planning, gear, local content) or with no camera at all. At least 70% of calendar slots must be source 'archive' or 'no_camera'. Never assume a trip, shoot, class or event that is not in their data.");
  if (ctx.horizon === "launch") rules.push("Something is launching. Build the calendar toward it: tease, launch, follow-up. Ask nothing that ignores it.");
  if (ctx.hours === "lt2") rules.push("They have under 2 hours a week. Cadence target is at most 2 posts a week; no move may need more than 30 minutes; prefer once-only moves over ongoing ones.");
  if (ctx.hours === "2_5") rules.push("They have 2–5 hours a week. Cadence target is at most 3 posts a week; keep ongoing moves under 30 minutes each.");
  if (ctx.style === "photos") rules.push("They mostly shoot photos. Lean on carousels and stills; do not prescribe talk-to-camera video.");
  if (ctx.style === "behind") rules.push("They stay behind the camera. Use voiceover, b-roll and text-on-screen; do not prescribe talking to camera.");
  if (ctx.style === "on_camera") rules.push("They are comfortable on camera; talk-to-camera is a strength to use.");
  if (ctx.goal === "deals") rules.push(`Bio, link and pinned-post moves aim at brand deals: a media kit or contact line, a clear niche statement, proof posts pinned.${ctx.contact ? "" : " No contact email was given: tell them to add one and say where, but never invent an address or write a placeholder like email@domain.com."}`);
  if (ctx.goal === "sell") rules.push("Bio, link and CTA moves aim at what they sell; every CTA points at their link.");
  if (ctx.goal === "bookings") rules.push("Bio, link and CTA moves aim at bookings; every CTA points at their link.");
  if (ctx.goal === "followers") rules.push("Optimise for reach and follows: hooks, shareable formats, discovery.");
  if (ctx.goal === "consistency") rules.push("Optimise for a cadence they can keep, not for reach. Fewer, smaller moves.");
  return `\nAbout this creator (answered by them — treat as hard constraints):\n${lines.join("\n")}${rules.length ? `\nRules that follow:\n- ${rules.join("\n- ")}` : ""}\n`;
}

// One call per 30-day phase, run in parallel. Each move carries the how,
// a ready-to-paste example, a done-when check and a time cost — the part a
// creator actually needs to act. Three smaller calls keep each response
// inside the output budget of the fallback models.
const PLAN_PHASE_PROMPT = `You are the Plan Writer for Scalecraft. A creator has paid for their Growth Plan. You have their public account data, category benchmarks, and the free snapshot (scores + the first move of each 30-day phase). Write phase {{PHASE_RANGE}} ("{{PHASE_LABEL}}") in full: implementation detail for its first move, then the {{MOVE_COUNT}} remaining moves (numbered {{MOVE_FIRST}} to {{MOVE_LAST}}).

Be specific to THIS account: use its real posting days, formats, gaps, bio wording, caption themes, best/worst posts and numbers. Every move must cite a specific post, number, day or bio line from the data. No generic advice (no "run a giveaway", "engage with your audience"). Where the profile data shows a field as null or missing, say "empty" or "missing" — never write the word null.

Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Account data: {{RECENT_POST_SUMMARY}}
Best and worst recent posts: {{POST_INSIGHTS}}
Category benchmarks: {{CATEGORY_BENCHMARKS}}
Snapshot (already shown to the owner): {{SNAPSHOT_JSON}}
This phase's first move (already written — do not repeat it as a numbered move): {{FIRST_MOVE}}
{{OTHER_PHASES}}
{{PLAN_CONTEXT}}
Field rules:
- "how": 3 to 5 numbered steps, each under 20 words, concrete to {{PLATFORM}}'s actual screens ("Edit profile → Links → Add external link") and to this account's own posts and wording.
- Never write bracketed placeholders like [Your Link Here] or email@domain.com. If a link or email is needed and none was given, say what to add and where, in plain words.
- "example": ready-to-paste copy the creator can use as a starting point — the literal bio line, highlight names, hook sentence, caption closer, DM script. Written in this account's own voice, taken from its captions. Under 60 words. Use null only when a move has nothing to paste (e.g. a scheduling habit).
- "done_when": one check the creator can verify on their own profile in ten seconds, under 15 words.
- "time": effort in plain words, e.g. "20 min, once", "10 min per post, ongoing", "1 hour this week".

Produce ONLY a JSON object, no prose, no markdown fences:
{"posting_days":["Mon","Wed","Sat"],"posting_time":"7:15am",
 "first_move":{"how":["step","step","step"],"example":"…or null","done_when":"…","time":"…"},
 "moves":[{"n":{{MOVE_FIRST}},"title":"under 6 words","action":"one imperative sentence, under 25 words","why":"one sentence under 25 words tied to a number, post or bio line from the data","how":["…","…","…"],"example":"…or null","done_when":"…","time":"…"}, … {{MOVE_COUNT}} moves total]}
posting_days must match the snapshot's first moves if they name days. Valid JSON only.`;

const PLAN_CALENDAR_PROMPT = `You are the Plan Writer for Scalecraft. Write a 12-week posting calendar for this account, built from its own best-performing formats and subjects.

Handle: {{HANDLE}} ({{PLATFORM}})
Category: {{CATEGORY}}
Best and worst recent posts: {{POST_INSIGHTS}}
Posting days: {{POSTING_DAYS}} at {{POSTING_TIME}}
Phase plan (weeks 1-4 serve phase 1, 5-8 phase 2{{PHASE3_NOTE}}): {{PHASES_JSON}}
{{PLAN_CONTEXT}}
Produce ONLY a JSON array of {{WEEKS}} weeks, no prose, no markdown fences:
[{"week":1,"slots":[{"day":"Mon","format":"reel","source":"new","angle":"what the post is about, under 10 words","prompt":"a shooting/caption brief the owner can follow, under 25 words"},{"day":"Wed",...},{"day":"Sat",...}]}, ... through week {{WEEKS}}]
One slot per posting day per week. Formats: reel, carousel, static, story. "source" is where the material comes from: "new" (needs a new shoot), "archive" (re-cut, repurposed or throwback from existing posts) or "no_camera" (talk-to-camera at home, text, screenshots, planning). Vary subjects across weeks; reuse the account's proven formats. Valid JSON only.`;

// Category benchmarks. These are working assumptions, not measured
// averages — replace with real baselines once enough profiles are scored.
const CATEGORY_BENCHMARKS = {
  boutique_fitness: {
    posting_consistency: "4-5 posts/week on fixed days; gaps over 7 days are unusual",
    content_mix: "60% video (coach explainers, class moments) / 40% static; schedules alone underperform",
    engagement_quality: "2.4% engagement rate; 3+ comments per post from varied accounts",
    profile_clarity: "bio names the neighbourhood and a first-class price; link goes to a trial/booking page",
  },
  fitness: {
    posting_consistency: "4-5 posts/week",
    content_mix: "55% video / 45% static",
    engagement_quality: "2.2% engagement rate",
    profile_clarity: "bio names location and offer; link goes to a sign-up page",
  },
  food_beverage: {
    posting_consistency: "5-6 posts/week",
    content_mix: "70% static (dishes, people) / 30% video",
    engagement_quality: "1.8% engagement rate; saves matter",
    profile_clarity: "bio names neighbourhood, hours and a link to menu/reservations",
  },
  retail: {
    posting_consistency: "4-5 posts/week",
    content_mix: "50% product static / 30% video / 20% people and behind-the-counter",
    engagement_quality: "1.5% engagement rate; saves and shares on product posts",
    profile_clarity: "bio names location or shipping area and a link to shop",
  },
  professional_services: {
    posting_consistency: "2-3 posts/week, consistent days",
    content_mix: "60% expertise (tips, explainers) / 40% people and proof",
    engagement_quality: "1.2% engagement rate; comments and DMs over likes",
    profile_clarity: "bio names who you serve, where, and a link to book a consultation",
  },
};

// Fetch real social media data based on platform
async function getRealPostData(handle, platform, category) {
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

  if (platform === "tiktok") {
    try {
      const data = await analyzeTikTokAccountViaApify(handle);
      return formatInstagramDataForAnalysis({ ...data, platform: "tiktok" });
    } catch (err) {
      console.error("[Growth Engine] TikTok fetch failed:", err.message);
      throw new Error(`Could not fetch TikTok data for @${handle}: ${err.message}`);
    }
  }

  throw new Error(`Platform '${platform}' not yet supported. Available: 'instagram', 'tiktok'.`);
}

function formatInstagramDataForAnalysis(instagramData) {
  // Convert Instagram API response into analysis-friendly format
  return {
    handle: instagramData.handle,
    platform: instagramData.platform || "instagram",
    follower_count: instagramData.follower_count,
    following_count: instagramData.following_count,
    post_count: instagramData.post_count,
    biography: instagramData.biography || null,
    website: instagramData.website || "empty (no link in bio)",
    metrics: instagramData.analysis,
    recent_activity: instagramData.recent_posts.slice(0, 12).map((p) => ({
      date: p.timestamp.split("T")[0],
      engagement: (p.like_count || 0) + (p.comments_count || 0),
      likes: p.like_count || 0,
      comments: p.comments_count || 0,
      media_type: p.is_reel ? (instagramData.platform === "tiktok" ? "VIDEO" : "REEL") : (instagramData.platform === "tiktok" ? "SLIDESHOW" : p.media_type),
      video_views: p.video_view_count || undefined,
      shares: p.share_count || undefined,
      saves: p.save_count || undefined,
      duration_s: p.duration || undefined,
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

// Output budget for the next LLM call(s); the plan writer needs more than a snapshot.
let OUTPUT_TOKENS = 2048;
function withOutputTokens(n, fn) {
  const prev = OUTPUT_TOKENS;
  OUTPUT_TOKENS = n;
  return Promise.resolve().then(fn).finally(() => { OUTPUT_TOKENS = prev; });
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
      max_tokens: OUTPUT_TOKENS,
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
  if (!geminiKey) throw new Error("Gemini API key not configured");
  // Free-tier Gemini sheds load with 503s on the busiest model; walk a short
  // list and retry briefly rather than giving the call away to the next provider.
  const models = [process.env.GEMINI_MODEL || "gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          // 2.5-flash "thinks" out of the same output budget and can return
          // nothing but thoughts; turn that off so the budget goes to text.
          generationConfig: { maxOutputTokens: OUTPUT_TOKENS, ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (text.trim()) return text;
        lastErr = new Error(`Gemini returned an empty completion (${model})`);
        console.warn("[Growth Engine]", lastErr.message, JSON.stringify(data.candidates?.[0]?.finishReason || data.promptFeedback || "").slice(0, 80));
        break;
      }
      const detail = await response.text();
      lastErr = new Error(`Gemini API error ${response.status} (${model}): ${detail.slice(0, 200)}`);
      if (response.status === 503 || response.status === 429) {
        if (attempt === 0) { console.log(`[Growth Engine] Gemini ${response.status} on ${model}, retrying in 4s...`); await new Promise((r) => setTimeout(r, 4000)); continue; }
        break; // next model
      }
      if (response.status === 404) break; // model id gone — next
      throw lastErr; // auth/quota/other: don't burn time
    }
  }
  throw lastErr;
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
          max_tokens: OUTPUT_TOKENS,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) return content;
        // Empty completion (budget spent on hidden reasoning) — try the next model.
        lastErr = new Error(`Groq returned an empty completion (${model})`);
        console.warn("[Growth Engine]", lastErr.message);
        break;
      }
      const detail = await response.text();
      lastErr = new Error(`Groq API error ${response.status} (${model}): ${detail.slice(0, 200)}`);
      if (response.status === 429) {
        // Daily caps say "try again in 5m45s" — don't wait on those, move on.
        const m = /try again in (?:(\d+)m)?([\d.]+)?(m?s)?/i.exec(detail);
        const waitMs = m ? (Number(m[1] || 0) * 60000) + Math.ceil(parseFloat(m[2] || 0) * (m[3] === "ms" ? 1 : 1000)) + 500 : (attempt + 1) * 8000;
        if (/per day|RPD|TPD/i.test(detail)) { console.log(`[Growth Engine] Groq daily cap on ${model}, skipping`); break; }
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
      max_tokens: OUTPUT_TOKENS,
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
      max_tokens: OUTPUT_TOKENS,
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


function clampScore(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
}

// Pull the trailing ```json block out of a merged report.
function splitStructuredBlock(text) {
  const src = String(text || "");
  // Closed fence, or an opening fence the model ran out of budget before closing.
  const m = /```json\s*([\s\S]*?)```\s*$/i.exec(src) || /```json\s*([\s\S]*?)```/i.exec(src) || /```json\s*([\s\S]*)$/i.exec(src);
  if (!m) return { narrative: src.trim(), structured: null };
  let structured = null;
  try {
    structured = JSON.parse(m[1]);
  } catch (err) {
    structured = parseJsonLoose(m[1]); // repairs a truncated document at the last complete element
    if (!structured) console.warn("[Growth Engine] Structured block did not parse:", err.message);
    else console.warn("[Growth Engine] Structured block was truncated; repaired");
  }
  return { narrative: src.replace(m[0], "").trim(), structured };
}

async function runSnapshot(accountId, inputParams, onStage = () => {}) {
  const { claudeKey, claudeWorkspaceId, geminiKey, groqKey } = getDecryptedKeys(accountId);
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!claudeKey && !geminiKey && !groqKey && !openaiKey) {
    throw new Error("No LLM API keys configured (Claude, Gemini, Groq, or OpenAI)");
  }

  const { handle, platform, category } = inputParams;

  // Fetch real social media data
  let postSummary;
  let computed = null;
  let postInsights = null;
  let followers = null;
  let postsLast14d = null;
  try {
    await onStage("finding", 1);
    const realData = await getRealPostData(handle, platform, category);
    await onStage("reading", 2);
    followers = Number.isFinite(realData.follower_count) ? realData.follower_count : null;
    const acts = realData.recent_activity || realData.recent_posts || [];
    postsLast14d = acts.filter((p) => { const t = +new Date(p.date || p.timestamp); return Number.isFinite(t) && Date.now() - t <= 14 * 86400000; }).length;
    postSummary = JSON.stringify(realData); // compact: every token counts against free-tier TPM caps
    computed = scoreProfile(realData, category); // null for fetchers without the metric shape (Twitter)
    postInsights = rankPosts(realData.recent_activity || realData.recent_posts);
  } catch (err) {
    console.warn("[Growth Engine] Real data fetch failed:", err.message);
    // No data, no report. A private/missing profile is the owner's to fix; a
    // network or provider failure is ours — either way the UI says so honestly
    // instead of a "best practices" report that scores nothing real.
    throw err;
  }
  await onStage("scoring", 3);
  const benchmarks = CATEGORY_BENCHMARKS[category] || CATEGORY_BENCHMARKS.fitness;

  const templateVars = {
    HANDLE: handle,
    PLATFORM: platform,
    CATEGORY: category,
    PLAN_CONTEXT: planContextBlock(inputParams.plan_context, inputParams.one_time_unlock ? 60 : 90),
    RECENT_POST_SUMMARY: postSummary,
    CATEGORY_BENCHMARKS: JSON.stringify(benchmarks),
    POST_INSIGHTS: postInsights
      ? JSON.stringify({ avg_engagement: postInsights.avg_engagement, best_format: postInsights.patterns.best_format, best_day: postInsights.patterns.best_day,
          top: postInsights.top.map((p) => ({ date: String(p.date).slice(0, 10), format: p.format, day: p.weekday, vs_avg: p.vs_avg, caption: p.caption })),
          bottom: postInsights.bottom.map((p) => ({ date: String(p.date).slice(0, 10), format: p.format, day: p.weekday, vs_avg: p.vs_avg, caption: p.caption })) })
      : "not available",
    COMPUTED_SCORES: computed
      ? JSON.stringify({ overall: computed.overall, dimensions: computed.dimensions.map((d) => ({ label: d.label, score: d.score, evidence: d.evidence, parts: d.parts })) })
      : "not available for this platform — score each dimension yourself from the data and say so",
  };

  // Call both personas in parallel with fallback logic
  const prompt1 = interpolateTemplate(PERSONA_PROMPTS.tier0.growthScanner, templateVars);
  const prompt2 = interpolateTemplate(PERSONA_PROMPTS.tier0.gapAuditor, templateVars);

  console.log("[Growth Engine] Starting evaluation. Fallback chain: Claude → Gemini → Groq → OpenAI");
  // Sequential, not parallel: two concurrent calls on a free-tier key trip the
  // per-minute token cap and both retry.
  const personaAResponse = await (
    // Persona A: Growth Scanner
    callWithQuadFallback(
      () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert social media strategist.", prompt1),
      () => callGeminiNonStreaming(geminiKey, "You are an expert social media strategist.", prompt1),
      () => callGroqNonStreaming(groqKey, "You are an expert social media strategist.", prompt1),
      () => callOpenAINonStreaming(openaiKey, "You are an expert social media strategist.", prompt1),
      "Growth Scanner"
    ));
  const personaBResponse = await (
    // Persona B: Gap Auditor
    callWithQuadFallback(
      () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are a data-driven social media analyst.", prompt2),
      () => callGeminiNonStreaming(geminiKey, "You are a data-driven social media analyst.", prompt2),
      () => callGroqNonStreaming(groqKey, "You are a data-driven social media analyst.", prompt2),
      () => callOpenAINonStreaming(openaiKey, "You are a data-driven social media analyst.", prompt2),
      "Gap Auditor"
    ));

  // Merge step
  const mergeTemplateVars = {
    ...templateVars,
    PERSONA_A_RESPONSE: personaAResponse,
    PERSONA_B_RESPONSE: personaBResponse,
  };

  await onStage("writing", 4);
  const mergePrompt = interpolateTemplate(PERSONA_PROMPTS.tier0.merge, mergeTemplateVars);

  // Merge: Claude → Gemini → Groq → OpenAI
  const mergedReport = await withOutputTokens(6144, () => callWithQuadFallback(
    () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callGeminiNonStreaming(geminiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callGroqNonStreaming(groqKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    () => callOpenAINonStreaming(openaiKey, "You are an expert at synthesizing independent analyses into clear, customer-facing reports.", mergePrompt),
    "Merge"
  ));

  // The merge ends with a ```json block carrying the structured report
  // (scores + growth path, per FRONTEND_INTEGRATION_GUIDE). Split it out of
  // the prose; if the model skipped or mangled it, the narrative still ships.
  const { narrative, structured } = splitStructuredBlock(mergedReport);

  const reportBody = {
    report_id: "rpt_" + require("crypto").randomBytes(12).toString("hex"),
    tier: "social_snapshot",
    business: {
      handle,
      platform,
      category,
      business_name: null,
      followers,
    },
    generated_at: Date.now(),
    refresh_due_at: null,
    posts_last_14d: postsLast14d,
    data_confidence: structured ? "full" : "narrative_only",
    narrative,
    raw_personas: {
      growth_scanner: personaAResponse,
      gap_auditor: personaBResponse,
      merged: mergedReport,
    },
  };

  if (structured || computed) {
    const dims = Array.isArray(structured?.dimensions) ? structured.dimensions : [];
    const llmScores = {
      overall: clampScore(structured?.overall) ?? (dims.length ? Math.round(dims.reduce((a, d) => a + (clampScore(d.score) || 0), 0) / dims.length) : null),
      dimensions: dims
        .filter((d) => d && d.label)
        .map((d) => ({ label: String(d.label), score: clampScore(d.score), explanation: String(d.explanation || "") })),
    };
    // Computed scores are the source of truth; the model contributes prose only.
    // The Gap Auditor's "LABEL: score — explanation" lines are the primary
    // source (concise, cite the sub-scores); the JSON block is the fallback.
    const auditorExpl = {};
    for (const line of String(personaBResponse || "").split("\n")) {
      const m = /^\s*\**\s*([A-Z_ ]+?)\s*\**\s*:\s*\**\s*\d{1,3}\s*\**\s*[—–-]\s*(.+)$/.exec(line);
      if (m) { const t = m[2].trim(); auditorExpl[m[1].toLowerCase().replace(/[^a-z]/g, "")] = t.charAt(0).toUpperCase() + t.slice(1); }
    }
    const findExpl = (label) => {
      const key = label.toLowerCase().replace(/[^a-z]/g, "");
      if (auditorExpl[key]) return auditorExpl[key];
      const hit = llmScores.dimensions.find((d) => d.label.toLowerCase().replace(/[^a-z]/g, "") === key);
      return hit ? hit.explanation : "";
    };
    const overallLine = auditorExpl["overallscore"] || null;
    reportBody.scores = computed
      ? {
          overall: computed.overall,
          category_avg: null, // filled from measured baselines by the job queue
          summary: typeof structured?.summary === "string" ? structured.summary : overallLine,
          dimensions: computed.dimensions.map((d) => ({ label: d.label, score: d.score, explanation: findExpl(d.label) || d.evidence, evidence: d.evidence, parts: d.parts })),
          method: computed.method,
          niche_known: computed.niche_known,
          creator: computed.creator,
        }
      : { ...llmScores, category_avg: null, summary: typeof structured?.summary === "string" ? structured.summary : null, method: "llm" };
    const phases = Array.isArray(structured?.phases) ? structured.phases : [];
    if (phases.length) {
      reportBody.growth_path = {
        unlocked_steps: phases.length,
        total_steps: phases.reduce((n, p) => n + 1 + (Number(p?.locked?.count) || 4), 0),
        phases: phases.map((p, i) => ({
          range: String(p.range || ["1-30", "31-60", "61-90"][i] || ""),
          label: String(p.label || ""),
          visible_action: String(p.visible_action || ""),
          detail: String(p.detail || ""),
          locked: { count: Number(p?.locked?.count) || 4, teaser: String(p?.locked?.teaser || "") },
        })),
      };
    }
    if (postInsights) {
      reportBody.post_insights = {
        ...postInsights,
        note: typeof structured?.best_posts_note === "string" ? structured.best_posts_note : null,
      };
    }
    reportBody.upsell = {
      cta_label: "Unlock your full Growth Plan",
      target_tier: "growth_plan",
      unlock_count: phases.reduce((n, p) => n + (Number(p?.locked?.count) || 4), 0) || 12,
      monthly_price: TIER_PRICING.growth_plan / 100,
      one_time_price: ONE_TIME_PRICING.plan_unlock / 100,
    };
  }

  return { reportBody, structured, postSummary, benchmarks, keys: { claudeKey, claudeWorkspaceId, geminiKey, groqKey, openaiKey } };
}

async function evaluateTier0(accountId, inputParams, onStage) {
  const { reportBody } = await runSnapshot(accountId, inputParams, onStage);
  return reportBody;
}

async function evaluateTier1(accountId, inputParams, onStage = () => {}) {
  // Tier 1: Growth Plan — the free snapshot plus every locked item, from the same data.
  const { reportBody, structured, postSummary, benchmarks, keys } = await runSnapshot(accountId, inputParams, onStage);
  await onStage("writing", 4);
  const { handle, platform, category } = inputParams;
  const { claudeKey, claudeWorkspaceId, geminiKey, groqKey, openaiKey } = keys;

  const snapshotJson = JSON.stringify({
    overall: reportBody.scores?.overall ?? null,
    dimensions: reportBody.scores?.dimensions ?? [],
    phases: (reportBody.growth_path?.phases ?? []).map((p) => ({ range: p.range, label: p.label, first_move: p.visible_action })),
  });
  // One-time unlock buys phases 1–2 (60 days); phase 3 stays locked as the
  // visible reason to subscribe. Subscribers get all three.
  const PHASES_BOUGHT = inputParams.one_time_unlock ? 2 : 3;
  const WEEKS_BOUGHT = PHASES_BOUGHT * 4;
  const planContext = inputParams.plan_context || null;
  const baseVars = {
    HANDLE: handle, PLATFORM: platform, CATEGORY: category,
    PLAN_CONTEXT: planContextBlock(planContext, PHASES_BOUGHT * 30),
    RECENT_POST_SUMMARY: postSummary, CATEGORY_BENCHMARKS: JSON.stringify(benchmarks), SNAPSHOT_JSON: snapshotJson,
    POST_INSIGHTS: reportBody.post_insights
      ? JSON.stringify({ best_format: reportBody.post_insights.patterns?.best_format, best_day: reportBody.post_insights.patterns?.best_day,
          top: reportBody.post_insights.top.map((p) => ({ date: String(p.date).slice(0, 10), format: p.format, vs_avg: p.vs_avg, caption: p.caption })),
          bottom: reportBody.post_insights.bottom.map((p) => ({ date: String(p.date).slice(0, 10), format: p.format, vs_avg: p.vs_avg, caption: p.caption })) })
      : "not available",
  };
  const sys = "You write specific, data-grounded social media growth plans. Output JSON only.";
  const askJson = async (prompt, label, budget) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await withOutputTokens(budget, () => callWithQuadFallback(
        () => callClaudeNonStreaming(claudeKey, claudeWorkspaceId, sys, prompt),
        () => callGeminiNonStreaming(geminiKey, sys, prompt),
        () => callGroqNonStreaming(groqKey, sys, prompt),
        () => callOpenAINonStreaming(openaiKey, sys, prompt),
        attempt ? `${label} (retry)` : label
      ));
      const parsed = parseJsonLoose(raw);
      if (parsed) return parsed;
      console.warn(`[Growth Engine] ${label} output unusable${attempt ? "" : ", retrying once"}`);
    }
    return null;
  };

  // One call per phase, in parallel. Each phase's moves carry how / example /
  // done_when / time, which is too much output for one call on the fallback
  // models; splitting also means one flaky call loses a phase, not the plan.
  const snapPhases = reportBody.growth_path?.phases ?? [];
  const MOVES_PER_PHASE = 4;
  const phaseResults = await Promise.all(snapPhases.slice(0, PHASES_BOUGHT).map((p, i) => {
    const first = i * MOVES_PER_PHASE + 2;
    const others = snapPhases.filter((_, k) => k !== i).map((q) => `${q.range}: ${q.label} — first move: ${q.visible_action}`);
    return askJson(interpolateTemplate(PLAN_PHASE_PROMPT, {
      ...baseVars,
      PHASE_RANGE: p.range, PHASE_LABEL: p.label || `Phase ${i + 1}`, FIRST_MOVE: p.visible_action || "",
      MOVE_COUNT: MOVES_PER_PHASE, MOVE_FIRST: first, MOVE_LAST: first + MOVES_PER_PHASE - 1,
      OTHER_PHASES: others.length ? `Other phases (do not overlap with them):\n${others.join("\n")}` : "",
    }), `Plan Writer: phase ${i + 1}`, 6144).then((r) => (r && Array.isArray(r.moves) && r.moves.length ? r : null));
  }));
  const gotPhases = phaseResults.filter(Boolean);
  if (!gotPhases.length) throw new Error("Plan Writer returned no usable plan");
  if (gotPhases.length < snapPhases.slice(0, PHASES_BOUGHT).length) {
    // Don't throw the whole paid report away over one flaky call; ship what
    // came back and mark it for an early refresh.
    console.warn(`[Growth Engine] Plan Writer: ${gotPhases.length} of ${snapPhases.length} phases written — shipping partial plan`);
    reportBody.plan_incomplete = true;
  }
  const lead = phaseResults[0] || gotPhases[0];
  const moves = {
    posting_days: lead.posting_days, posting_time: lead.posting_time,
    phases: snapPhases.slice(0, PHASES_BOUGHT).map((p, i) => ({ range: p.range, moves: phaseResults[i]?.moves || [], first_move: phaseResults[i]?.first_move || null })),
  };
  const calendarRaw = await askJson(interpolateTemplate(PLAN_CALENDAR_PROMPT, {
    ...baseVars,
    POSTING_DAYS: (moves.posting_days || []).join(", ") || "Mon, Wed, Fri",
    POSTING_TIME: moves.posting_time || "morning",
    PHASES_JSON: JSON.stringify((reportBody.growth_path?.phases ?? []).slice(0, PHASES_BOUGHT).map((p, i) => ({ range: p.range, label: p.label, first_move: p.visible_action, moves: (moves.phases?.[i]?.moves || []).map((m) => m.title) }))),
    PHASE3_NOTE: PHASES_BOUGHT === 3 ? ", 9-12 phase 3" : "",
    WEEKS: WEEKS_BOUGHT,
  }), "Plan Writer: calendar", 6144);
  const plan = { ...moves, calendar: Array.isArray(calendarRaw) ? calendarRaw : (calendarRaw && Array.isArray(calendarRaw.calendar) ? calendarRaw.calendar : []) };
  if (process.env.GE_DEBUG_PLAN) console.log("[Growth Engine] plan moves raw:", JSON.stringify(moves).slice(0, 600));

  const days = Array.isArray(plan.posting_days) ? plan.posting_days.map(String) : [];
  const SOURCES = new Set(["new", "archive", "no_camera"]);
  const weeks = (Array.isArray(plan.calendar) ? plan.calendar : []).slice(0, WEEKS_BOUGHT).map((w, i) => ({
    week: Number(w.week) || i + 1,
    phase: Math.min(3, Math.floor(i / 4) + 1),
    slots: (Array.isArray(w.slots) ? w.slots : []).map((sl) => ({
      day: String(sl.day || ""), format: String(sl.format || "post"), angle: String(sl.angle || ""), prompt: String(sl.prompt || ""),
      source: SOURCES.has(String(sl.source || "").toLowerCase()) ? String(sl.source).toLowerCase() : "new",
    })),
  }));
  // Normalise whatever phase shape came back: an array of {range, moves},
  // an object keyed by range, or a flat moves list with a phase/range field.
  const normRange = (r) => String(r ?? "").replace(/[–—]/g, "-").replace(/[^0-9-]/g, "");
  let planPhases = [];
  if (Array.isArray(plan.phases)) planPhases = plan.phases;
  else if (plan.phases && typeof plan.phases === "object") planPhases = Object.entries(plan.phases).map(([range, v]) => ({ range, moves: Array.isArray(v) ? v : v?.moves || [] }));
  if (!planPhases.length && Array.isArray(plan.moves)) {
    const byRange = {};
    for (const m of plan.moves) { const r = normRange(m.range || m.phase) || (Number(m.n) <= 5 ? "1-30" : Number(m.n) <= 9 ? "31-60" : "61-90"); (byRange[r] ||= []).push(m); }
    planPhases = Object.entries(byRange).map(([range, moves]) => ({ range, moves }));
  }
  planPhases = planPhases.map((ph) => ({ ...ph, range: normRange(ph.range), moves: Array.isArray(ph.moves) ? ph.moves : [] }));

  reportBody.tier = "growth_plan";
  reportBody.refresh_due_at = inputParams.one_time_unlock ? null : Date.now() + (reportBody.plan_incomplete ? 1 : 7) * 24 * 60 * 60 * 1000;
  if (!reportBody.growth_path) reportBody.growth_path = { phases: [] };
  reportBody.growth_path.phases = reportBody.growth_path.phases.map((p, i) => {
    if (i >= PHASES_BOUGHT) {
      // Not bought: keep the free-report shape (opener visible, rows locked)
      // so the report shows exactly what the subscription adds.
      return { ...p, moves: [], opener: null, locked: { count: Number(p?.locked?.count) || 4, teaser: `Days ${p.range || "61-90"} unlock with the Growth Plan` }, calendar_weeks: [], not_included: true };
    }
    const extra = planPhases.find((x) => x.range === normRange(p.range)) || planPhases[i] || { moves: [] };
    const detail = (m) => ({
      how: Array.isArray(m.how) ? m.how.map((x) => String(x).replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "").trim()).filter(Boolean).slice(0, 6) : [],
      example: m.example && String(m.example).trim() && !/^null$/i.test(String(m.example).trim()) ? String(m.example).trim() : null,
      done_when: m.done_when ? String(m.done_when) : "", time: m.time ? String(m.time) : "",
    });
    const moves = (Array.isArray(extra.moves) ? extra.moves : []).map((m, k) => ({
      n: i * MOVES_PER_PHASE + k + 2, title: String(m.title || ""), action: String(m.action || ""), why: String(m.why || ""), ...detail(m),
    }));
    const opener = extra.first_move && typeof extra.first_move === "object" ? detail(extra.first_move) : null;
    return { ...p, moves, opener, locked: { count: 0, teaser: "" }, calendar_weeks: weeks.filter((w) => w.phase === i + 1) };
  });
  reportBody.growth_path.unlocked_steps = reportBody.growth_path.phases.reduce((n, p) => n + 1 + p.moves.length, 0);
  reportBody.growth_path.total_steps = reportBody.growth_path.unlocked_steps + reportBody.growth_path.phases.reduce((n, p) => n + (p.not_included ? (p.locked?.count || 4) : 0), 0);
  reportBody.calendar = { posting_days: days, posting_time: plan.posting_time ? String(plan.posting_time) : null, weeks };
  reportBody.plan_days = PHASES_BOUGHT * 30;
  reportBody.plan_context = planContext;
  reportBody.upsell = { cta_label: "Upgrade to Business Evaluator", target_tier: "business_evaluator", unlock_count: 0 };
  return reportBody;
}

// LLMs sometimes wrap JSON in fences or prose, or run out of output budget
// mid-array. Find the outermost object; if it doesn't parse, close whatever
// was left open (dropping the last, partial element) and try again.
function parseJsonLoose(text) {
  const src = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src);
  const start = Math.min(...["{", "["].map((c) => src.indexOf(c)).filter((i) => i >= 0), Infinity);
  const body = Number.isFinite(start) ? src.slice(start) : src;
  const candidates = [fenced && fenced[1], body.slice(0, Math.max(body.lastIndexOf("}"), body.lastIndexOf("]")) + 1), body, repairTruncatedJson(body)];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* next */ }
  }
  console.warn("[Growth Engine] Plan JSON did not parse; first 200 chars:", src.slice(0, 200));
  return null;
}

// Close open strings/arrays/objects of a truncated JSON document after
// cutting back to the last complete element.
function repairTruncatedJson(src) {
  let s = String(src || "").replace(/,\s*$/, "");
  // Cut back to the last complete value boundary (a closing brace/bracket or a
  // full "key": value pair). Crude but enough for arrays of objects.
  const cut = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (cut > 0) s = s.slice(0, cut + 1);
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, "");
  while (stack.length) s += stack.pop();
  return s;
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
