// Roast my account (spec 2.1) — the report's facts, told funny.
//
// Same data as the report (scores, explanations, evidence posts, cadence),
// written in a brutal voice at a heat the user picks. Every line has to lean
// on a fact from the inputs; numbers are checked against the inputs the way
// dimension explanations are (1.4). Then two guardrails before anyone sees it:
//
//   1. a deterministic screen for appearance / identity words
//   2. a second LLM pass that flags jokes about the person instead of the content
//
// A roast that fails either is logged for review and regenerated once; if the
// second try fails too the caller falls back to the normal report. Accounts
// whose bio reads as under 18 never get a roast at all.
//
// Config: ROAST_ENABLED, ROAST_LINES, ROAST_REROAST_DAYS, ROASTS_PER_IP_PER_HOUR,
//         ROAST_MINOR_PATTERNS (extra regex alternatives), ROAST_BLOCK_PATTERNS.

const { llmJson } = require("./growth_engine_evaluator");
const { allowedNumbers, validateExplanation } = require("./growth_engine_evidence");
const geDb = require("./growth_engine_db_select");
const events = require("./growth_engine_events");

const ENABLED = String(process.env.ROAST_ENABLED || "true") !== "false";
const LINES = Math.max(3, Math.min(10, Number(process.env.ROAST_LINES || 6)));
const REROAST_DAYS = Number(process.env.ROAST_REROAST_DAYS || 30);

const HEATS = {
  mild: { label: "Mild", voice: "gentle ribbing — a friend who's rooting for them and can't resist a dig" },
  medium: { label: "Medium", voice: "a stand-up set about their feed — sharp, specific, no mercy for the content, warmth underneath" },
  extra_crispy: { label: "Extra Crispy", voice: "scorched earth on the content — merciless, deadpan, every line lands like a stat with a punchline" },
};

// Under-18 signals in a bio. Conservative on purpose: any hit skips the roast.
const MINOR_RE = new RegExp([
  "\\b(1[0-7])\\s*(yo|y\\/o|yrs?|years?\\s*old)\\b", "\\bage[d]?\\s*:?\\s*1[0-7]\\b", "\\b(high|middle|secondary)\\s*school\\b", "\\b(freshman|sophomore|junior|senior)\\s*(year|at)\\b",
  "\\b(\\d{1,2})(st|nd|rd|th)\\s*grade\\b", "\\bgrade\\s*\\d{1,2}\\b", "\\bteen(ager)?\\b", "\\bminor\\b", "\\bclass of 20(2[7-9]|3\\d)\\b", "\\b(my )?(mom|dad|parents?) (run|manage)s? this\\b",
  ...(process.env.ROAST_MINOR_PATTERNS ? [process.env.ROAST_MINOR_PATTERNS] : []),
].join("|"), "i");

// Appearance and protected characteristics — a line that touches these is out,
// whatever the joke was. Word-boundary matches; content words like "body copy"
// are avoided by keeping the list to the ways people insult people.
const BLOCK_RE = new RegExp([
  "\\b(ugly|hideous|fat|obese|chubby|skinny|scrawny|anorexic|bald|balding|wrinkl\\w*|acne|pimpl\\w*|crooked teeth|your (face|body|weight|nose|teeth|hair|skin|looks|figure|belly|chin|forehead|thighs|arms|legs))\\b",
  "\\b(black|white|asian|brown|latino|latina|hispanic|arab|jewish|jew|muslim|christian|hindu|catholic|indian|african|mexican|chinese) (people|guy|girl|woman|man|dude|chick)\\b",
  "\\b(gay|lesbian|queer|trans|transgender|homo\\w*|dyke|fag\\w*|tranny)\\b", "\\b(retard\\w*|cripple\\w*|spaz\\w*|autis\\w*|disabled|wheelchair|handicap\\w*|dyslexi\\w*)\\b",
  "\\b(boomer|geriatric|grandpa|grandma|old (man|woman|lady)|senile|too old|so old|your age|for your age|midlife)\\b", "\\b(race|racial|ethnic\\w*|religion|religious|gender|sexuality|pronouns?)\\b",
  "\\b(slut|whore|bitch|thot|incel|virgin|simp)\\b",
  ...(process.env.ROAST_BLOCK_PATTERNS ? [process.env.ROAST_BLOCK_PATTERNS] : []),
].join("|"), "i");

function looksMinor(reportBody) {
  const bio = String(reportBody.bio || reportBody.profile?.biography || "");
  const name = String(reportBody.business?.business_name || "");
  return MINOR_RE.test(bio) || MINOR_RE.test(name);
}

// Only what the roast may talk about. Also the allowed-numbers set for the validator.
function inputsFrom(reportBody) {
  const s = reportBody.scores || {}; const pi = reportBody.post_insights || {};
  const post = (p) => ({ date: String(p.date || p.posted_at || "").slice(0, 10), format: p.format || p.type, likes: p.likes, comments: p.comments, views: p.views, vs_avg: p.vs_avg, caption: String(p.caption || "").slice(0, 140) });
  return {
    handle: reportBody.business?.handle, platform: reportBody.business?.platform, niche: reportBody.business?.category, followers: reportBody.business?.followers ?? null,
    overall: s.overall, level: s.level?.name || null, niche_avg: s.category_avg ?? null,
    dimensions: (s.dimensions || []).map((d) => ({ label: d.label, score: d.score, niche_avg: d.category_avg ?? null, what_we_saw: String(d.explanation || "").slice(0, 400), evidence: (d.evidence_posts || []).slice(0, 2).map((e) => ({ date: String(e.posted_at || "").slice(0, 10), type: e.type, caption: String(e.caption || "").slice(0, 120), metric: e.metric })) })),
    posts_sampled: pi.sample ?? reportBody.posts_sampled ?? null, avg_engagement: pi.avg_engagement ?? null,
    best_format: pi.patterns?.best_format || null, best_day: pi.patterns?.best_day || null,
    top_posts: (pi.top || []).slice(0, 3).map(post), bottom_posts: (pi.bottom || []).slice(0, 3).map(post),
    bio: String(reportBody.bio || "").slice(0, 300) || null,
    data_window: reportBody.data_window || null,
  };
}

function firstMove(reportBody) {
  const p = reportBody.growth_path?.phases?.[0];
  return p ? { action: p.visible_action || p.action || "", why: p.detail || "" } : null;
}

const SYSTEM = "You write roasts of social media accounts for a scoring product. You roast the CONTENT and the NUMBERS, never the person. Output JSON only.";
function prompt(inputs, heat, previous) {
  return `Roast @${inputs.handle}'s ${inputs.platform} account. Heat: ${HEATS[heat].label} — ${HEATS[heat].voice}.

THE ONLY FACTS YOU MAY USE (nothing else exists):
${JSON.stringify(inputs)}
${previous ? `\nTHEY WERE ROASTED BEFORE, on ${new Date(previous.generated_at).toISOString().slice(0, 10)} at score ${previous.overall}. This is the re-roast: compare then and now in at least two lines.` : ""}

Rules:
- Exactly ${LINES} lines. Each line is one joke, 12–30 words, and must be built on a specific fact above (a number, a date, a caption, a gap, a format count). Quote numbers exactly as given.
- Roast the posting habits, the captions, the formats, the bio copy, the engagement. NEVER the person: no jokes about appearance, body, weight, race, ethnicity, gender, sexuality, age, religion, disability, family, or anything about who they are rather than what they posted.
- No slurs, no profanity stronger than "hell".
- Vary the targets: don't hit the same dimension twice in a row.
- No compliments, no "keep it up", no "nice try" — a strength gets roasted too (what they did with the one thing that worked).
- Funny beats mean. The reader should laugh and then want to fix it.

Return: {"lines":[{"text":"…","fact":"the fact this leans on, in a few words"}]}`;
}

const CHECK_SYSTEM = "You are a safety reviewer for comedy about social media accounts. Output JSON only.";
function checkPrompt(lines) {
  return `Review these roast lines. Flag any line that jokes about the PERSON rather than their content: appearance, body, weight, race, ethnicity, gender, sexuality, age, religion, disability, family, health, or that uses a slur or reads as harassment. Lines about posting habits, captions, formats, engagement numbers, bio wording or the niche are fine, however harsh.

${lines.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}

Return: {"ok": true|false, "flagged": [line numbers], "reason": "short"}`;
}

async function logRejection({ reportId, accountId, heat, reason, flagged, lines }) {
  try { await geDb.insertRoastRejection({ reportId, accountId, heat, reason, flagged: JSON.stringify(flagged || []), text: JSON.stringify(lines || []).slice(0, 4000) }); } catch (e) { console.warn("[Roast] rejection log failed:", e.message); }
  events.track("roast_rejected", { accountId, reportId, props: { heat, reason } });
}

// One generation + both guardrails. Returns { lines } or { rejected: reason }.
async function attempt(accountId, reportBody, heat, previous, ctx) {
  const inputs = inputsFrom(reportBody);
  const out = await llmJson(accountId, SYSTEM, prompt(inputs, heat, previous), `Roast (${heat})`, 2048);
  const raw = Array.isArray(out?.lines) ? out.lines : Array.isArray(out) ? out : null;
  if (!raw || !raw.length) return { rejected: "llm_empty" };
  // Numbers must come from the inputs (same validator as the explanations).
  const allowed = allowedNumbers(inputs);
  let lines = raw.map((l) => ({ text: String(l?.text || l || "").trim(), fact: String(l?.fact || "").trim().slice(0, 120) })).filter((l) => l.text.length > 8)
    .filter((l) => validateExplanation(l.text, allowed).ok);
  if (lines.length < 3) { await logRejection({ ...ctx, heat, reason: "numbers_not_in_inputs", lines: raw }); return { rejected: "numbers" }; }
  // Guardrail 1: deterministic screen.
  const hard = lines.map((l, i) => (BLOCK_RE.test(l.text) ? i + 1 : 0)).filter(Boolean);
  if (hard.length) { await logRejection({ ...ctx, heat, reason: "blocklist", flagged: hard, lines }); return { rejected: "safety" }; }
  // Guardrail 2: second model pass. If it can't run, fail safe.
  const check = await llmJson(accountId, CHECK_SYSTEM, checkPrompt(lines), "Roast check", 512);
  if (!check || check.ok !== true) { await logRejection({ ...ctx, heat, reason: check ? "reviewer_flagged" : "reviewer_unavailable", flagged: check?.flagged || [], lines }); return { rejected: check ? "safety" : "llm" }; }
  return { lines: lines.slice(0, LINES) };
}

// The whole thing. Never throws for content reasons; returns
//   { roast } or { unavailable: "minor" | "safety" | "llm" | "disabled" }.
async function roast(accountId, report, heat = "medium") {
  if (!ENABLED) return { unavailable: "disabled" };
  const body = report.reportBody || {};
  if (!HEATS[heat]) heat = "medium";
  if (looksMinor(body)) { events.track("roast_skipped_minor", { accountId, reportId: report.reportId }); return { unavailable: "minor" }; }
  const previous = body.roast && body.roast.generated_at ? { generated_at: body.roast.generated_at, overall: body.roast.overall } : null;
  const ctx = { reportId: report.reportId, accountId };
  let last = null;
  for (let i = 0; i < 2; i++) {
    const r = await attempt(accountId, body, heat, previous, ctx);
    if (r.lines) {
      const fm = firstMove(body);
      const out = { heat, heat_label: HEATS[heat].label, lines: r.lines, closer: "Okay, here's how we fix it", first_move: fm, overall: body.scores?.overall ?? null, handle: body.business?.handle, generated_at: Date.now(), previous, reroast_after: Date.now() + REROAST_DAYS * 86400000 };
      events.track("roast_generated", { accountId, reportId: report.reportId, props: { heat, lines: r.lines.length, reroast: !!previous } });
      return { roast: out };
    }
    last = r.rejected;
    if (last === "llm_empty" || last === "llm") break; // no point retrying a dead provider
  }
  return { unavailable: last === "numbers" || last === "safety" ? "safety" : "llm" };
}

function canReroast(existing) { return !existing || !existing.generated_at || Date.now() - existing.generated_at >= REROAST_DAYS * 86400000; }

module.exports = { roast, HEATS, looksMinor, canReroast, REROAST_DAYS, ENABLED, _test: { BLOCK_RE, MINOR_RE, inputsFrom } };
