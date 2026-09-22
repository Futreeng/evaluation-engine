// 48-hour post review (spec 3.1) — paid plans only.
//
// Every POST_REVIEW_CHECK_HOURS the sweep re-reads each paid account's
// profile (one cheap profile pull; the 24h cache absorbs repeats), finds
// posts that weren't in the report when it was scored, and once a post is
// about POST_REVIEW_AGE_HOURS old writes a short review: how it did against
// the account's own average, the likely reason (hook, format, timing) and
// what to repeat or change. Numbers are checked against the inputs the same
// way explanations are; if the model is unavailable the review is written
// from the rules alone, so a review always ships.
//
// Reviews live on the latest report body (`post_reviews`, newest first) and
// go out by email under the `post_reviews` preference.

const geDb = require("./growth_engine_db_select");
const costs = require("./growth_engine_costs");
const events = require("./growth_engine_events");
const mailer = require("./mailer");
const { allowedNumbers, validateExplanation } = require("./growth_engine_evidence");
const { hookOf } = require("./growth_engine_briefs");

const ENABLED = String(process.env.POST_REVIEW_ENABLED || "true") !== "false";
const CHECK_HOURS = Number(process.env.POST_REVIEW_CHECK_HOURS || 60);
const AGE_HOURS = Number(process.env.POST_REVIEW_AGE_HOURS || 48);
const MAX_AGE_DAYS = Number(process.env.POST_REVIEW_MAX_AGE_DAYS || 14);
const PER_CHECK = Number(process.env.POST_REVIEW_PER_CHECK || 2);
const KEEP = 10;
const H = 3600000, DAY = 86400000;

const eng = (p) => Number(p.likes || 0) + Number(p.comments || 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// Fresh posts from the scraper, in the report's post shape.
async function fetchPosts(handle, platform) {
  const data = platform === "tiktok" ? await require("./tiktok_apify_fetcher").analyzeTikTokAccountViaApify(handle) : await require("./instagram_apify_fetcher").analyzeInstagramAccountViaApify(handle);
  return (data.recent_posts || []).map((p) => ({
    id: String(p.id || p.short_code || ""), posted_at: p.timestamp,
    type: p.is_reel ? (platform === "tiktok" ? "video" : "reel") : String(p.media_type || "").toLowerCase() === "carousel" ? "carousel" : String(p.media_type || "").toLowerCase() === "video" ? "video" : "image",
    caption: (p.caption || "").slice(0, 300), likes: p.like_count || 0, comments: p.comments_count || 0, views: p.video_view_count || null, permalink: p.permalink || null, is_pinned: !!p.is_pinned,
  })).filter((p) => p.id && p.posted_at);
}

function localParts(iso, tz) {
  try { const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "long", hour: "numeric", hour12: true }); const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.weekday} ${p.hour}${p.dayPeriod || ""}`.toLowerCase(); }
  catch { return new Date(iso).toUTCString().slice(0, 22); }
}

// Everything the review may cite.
function statsFor(post, body) {
  const known = (body.posts || []).filter((p) => !p.is_pinned);
  const avg = mean(known.map(eng)), med = median(known.map(eng));
  const sameType = known.filter((p) => p.type === post.type);
  const typeAvg = sameType.length ? mean(sameType.map(eng)) : null;
  const views = post.views || null; const viewAvg = mean(known.map((p) => p.views || 0).filter(Boolean)) || null;
  const bt = body.best_times?.windows?.[0] ? `${body.best_times.windows[0].day} ${String(body.best_times.windows[0].label || "").split(" ").slice(1).join(" ")}` : null;
  return {
    handle: body.business?.handle, platform: body.business?.platform, niche: body.business?.category,
    post: { type: post.type, posted: localParts(post.posted_at, body.tz), caption_first_line: String(post.caption || "").split(/\n/).find((l) => l.trim()) || "", caption_words: String(post.caption || "").split(/\s+/).filter(Boolean).length, hook_style: hookOf(post.caption), likes: post.likes, comments: post.comments, views: views },
    account: { posts_compared: known.length, avg_engagement: Math.round(avg), median_engagement: Math.round(med), same_format_avg: typeAvg != null ? Math.round(typeAvg) : null, avg_views: viewAvg ? Math.round(viewAvg) : null, best_time: bt, best_format: body.post_insights?.patterns?.best_format?.format || null },
    vs_avg: avg ? round1(eng(post) / avg) : null, vs_same_format: typeAvg ? round1(eng(post) / typeAvg) : null, vs_views: views && viewAvg ? round1(views / viewAvg) : null,
  };
}

// Deterministic review used when the model is out, and as the frame for the model's.
function rulesReview(st) {
  const x = st.vs_avg;
  const perf = x == null ? "Not enough history to compare yet." : x >= 1.5 ? `Strong: ${x}× your average engagement.` : x >= 1.05 ? `Above your average (${x}×).` : x >= 0.8 ? `About your usual (${x}×).` : `Below your average (${x}×).`;
  const why = [];
  if (st.vs_same_format && Math.abs(st.vs_same_format - (st.vs_avg || 1)) >= 0.2) why.push(`${st.post.type}s ${st.vs_same_format >= 1 ? "do well" : "run cold"} for you (${st.vs_same_format}× your ${st.post.type} average)`);
  if (st.account.best_time) why.push(`posted ${st.post.posted}; your best window is ${st.account.best_time}`);
  if (st.post.hook_style && st.post.hook_style !== "none") why.push(`the opener is ${st.post.hook_style.replace("_", " ")}-style`);
  const next = x != null && x >= 1.05 ? `Repeat the ${st.post.type} + this opener next week in your best window.` : `Try the same idea as a ${st.account.best_format || "reel"} in your best window, first line as a question or a number.`;
  return { performance: perf, likely_reason: why.length ? why.join("; ") + "." : "Timing and format look normal for you — the topic did the work.", next };
}

const SYSTEM = "You review one social media post for its creator: honest, specific, two short fields. Only use the facts given. Output JSON only.";
function prompt(st) {
  return `Review this post against the account's own history. FACTS (the only numbers you may use):
${JSON.stringify(st)}

Write two fields, each one or two complete sentences under 35 words, plain and specific:
- likely_reason: the most likely reason it did what it did — hook, format, or timing — tied to a fact above (quote numbers exactly as given, or use none)
- next: one thing to repeat or change on the next post
Return: {"likely_reason":"…","next":"…"}`;
}

async function writeReview(accountId, st) {
  const base = rulesReview(st);
  try {
    const { llmJson } = require("./growth_engine_evaluator");
    const out = await llmJson(accountId, SYSTEM, prompt(st), "Post review", 900);
    if (!out) return { ...base, source: "rules" };
    // The multiplier line stays deterministic; the model only explains and suggests,
    // and only with numbers that appear in the inputs, in complete sentences.
    const allowed = allowedNumbers(st);
    const pick = (k) => { const t = String(out[k] || "").trim(); return t && t.length <= 400 && /[.!?]$/.test(t) && validateExplanation(t, allowed).ok ? t : base[k]; };
    const likely = pick("likely_reason"), next = pick("next");
    return { performance: base.performance, likely_reason: likely, next, source: likely === base.likely_reason && next === base.next ? "rules" : "model" };
  } catch { return { ...base, source: "rules" }; }
}

// Review the new posts on one report row. Returns the reviews written.
async function reviewReport(report, { now = Date.now(), posts = null, room = null } = {}) {
  const body = report.reportBody || {};
  const handle = body.business?.handle, platform = body.business?.platform || "instagram";
  const fresh = posts || await fetchPosts(handle, platform);
  const known = new Set((body.posts || []).map((p) => String(p.id)));
  const reviewed = new Set((body.post_reviews || []).map((r) => String(r.post_id)));
  const candidates = fresh.filter((p) => !known.has(String(p.id)) && !reviewed.has(String(p.id)) && !p.is_pinned)
    .filter((p) => { const age = now - Date.parse(p.posted_at); return age >= AGE_HOURS * H && age <= MAX_AGE_DAYS * DAY; })
    .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at)).slice(0, Math.max(0, Math.min(PER_CHECK, room ?? PER_CHECK)));
  const written = [];
  for (const post of candidates) {
    const st = statsFor(post, body);
    const review = await writeReview(report.accountId, st);
    written.push({ post_id: post.id, posted_at: post.posted_at, type: post.type, caption: String(post.caption || "").slice(0, 140), permalink: post.permalink, metrics: { likes: post.likes, comments: post.comments, views: post.views, vs_avg: st.vs_avg, vs_same_format: st.vs_same_format }, review, reviewed_at: now });
  }
  const patch = { post_check_at: now };
  if (written.length) { patch.post_reviews = [...written, ...(body.post_reviews || [])].slice(0, KEEP); if (report.accountId) { try { await require("./growth_engine_entitlements").use(report.accountId, "post_reviews_per_week", written.length); } catch { /* fine */ } } }
  await geDb.patchReportBody(report.reportId, patch);
  for (const w of written) {
    events.track("post_reviewed", { accountId: report.accountId, reportId: report.reportId, props: { post_id: w.post_id, vs_avg: w.metrics.vs_avg, source: w.review.source } });
    if (body.email) await mailer.postReview({ to: body.email, userId: report.accountId, handle, reportId: report.reportId, review: w }).catch(() => { });
  }
  return written;
}

// The sweep entry: every paid account whose last check is older than CHECK_HOURS.
async function checkPaidAccounts({ now = Date.now(), limit = Number(process.env.POST_REVIEW_BATCH || 10) } = {}) {
  if (!ENABLED) return 0;
  const rows = await geDb.listPaidReportsBetween(now - 100 * DAY, now);
  const latest = new Map();
  for (const r of rows) { const k = `${r.accountId}|${r.business?.platform}|${String(r.business?.handle || "").toLowerCase()}`; if (!latest.has(k) || latest.get(k).generatedAt < r.generatedAt) latest.set(k, r); }
  let done = 0;
  for (const r of latest.values()) {
    if (done >= limit) break;
    const b = r.reportBody || {};
    if (!r.accountId || r.accountId === "demo-account" || !b.business?.handle) continue;
    if (now - (b.post_check_at || r.generatedAt) < CHECK_HOURS * H) continue;
    if (b.one_time_unlock && (now - (b.plan_started_at || r.generatedAt)) / DAY > (b.plan_days || 60)) continue;
    const E = require("./growth_engine_entitlements");
    try { const ent = await E.effective(r.accountId); if (!b.one_time_unlock && (!E.has(ent, "post_reviews") || ent.paused)) continue; } catch { continue; }
    // Fair use (P.4): reviews per week by tier; the check is logged when it bites.
    const lim = await E.checkLimit(r.accountId, "post_reviews_per_week", { now }); if (!lim.ok) { await geDb.patchReportBody(r.reportId, { post_check_at: now }).catch(() => { }); continue; }
    try {
      const n = (await costs.run({ accountId: r.accountId, reportId: r.reportId, feature: "post_review" }, () => reviewReport(r, { now, room: lim.limit != null ? lim.limit - lim.used : null }))).length;
      done++; if (n) console.log(`[PostReview] @${b.business.handle}: ${n} review${n === 1 ? "" : "s"}`);
    } catch (err) { console.warn(`[PostReview] @${b.business?.handle} failed:`, err.message); }
  }
  return done;
}

module.exports = { checkPaidAccounts, reviewReport, ENABLED, _test: { statsFor, rulesReview, fetchPosts } };
