// Weekly trend brief (spec 3.4) — "What's working in {niche}" from our own
// data: the formats, hook styles, days and cadence of the posts that beat
// their own account's median, across every account we've scored in the
// niche. Aggregated and anonymised: no handle, caption or number that could
// point at one account ever leaves this module. Published for a niche only
// once it has BASELINE_MIN_N accounts (same gate as the niche average).
//
// Built once per ISO week per niche+platform and cached in
// growth_engine_niche_briefs so the app and the weekly email say the same
// thing. Deterministic — no LLM — so it costs nothing and can't invent a trend.

const geDb = require("./growth_engine_db_select");
const { weekKey } = require("./growth_engine_monday");

const MIN_N = Number(process.env.BASELINE_MIN_N || 10);
const WINDOW_DAYS = Number(process.env.BRIEF_WINDOW_DAYS || 90);
const TOP_LIFT = Number(process.env.BRIEF_TOP_LIFT || 1.5); // a "top" post beats its own account's median by this
const DAY = 86400000;

const eng = (p) => Number(p.likes || 0) + Number(p.comments || 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// First line of a caption → a hook style. Order matters: the first match wins.
const HOOKS = [
  ["question", "a question", (l) => /\?\s*$/.test(l) || /^(why|how|what|when|where|who|which|do you|did you|have you|ever)\b/i.test(l)],
  ["number", "a number up front", (l) => /^\d|^(\d+|one|two|three|four|five|six|seven|ten)\s+(things|ways|tips|reasons|places|days|mistakes)/i.test(l)],
  ["how_to", "a how-to promise", (l) => /^how (to|i|we)\b|^the (easiest|fastest|only) way\b|step[- ]by[- ]step/i.test(l)],
  ["pov", "POV / you-framing", (l) => /^pov\b|^you\b|^your\b|^if you\b|^when you\b/i.test(l)],
  ["story", "a first-person story", (l) => /^(i|we|my|our)\b/i.test(l)],
  ["punch", "a short punchline", (l) => l.split(/\s+/).length <= 5],
  ["statement", "a plain statement", () => true],
];
function hookOf(caption) {
  const line = String(caption || "").split(/\n/).map((s) => s.trim()).find(Boolean) || "";
  if (!line) return "none";
  return HOOKS.find(([, , t]) => t(line))[0];
}
const hookLabel = (k) => (HOOKS.find(([key]) => key === k) || [])[1] || k;

function localParts(iso, tz) {
  try { const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: false }); const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return { day: p.weekday, hour: Number(p.hour) % 24 }; }
  catch { return localParts(iso, "UTC"); }
}
const slotOf = (h) => (h < 6 ? "night" : h < 11 ? "morning" : h < 15 ? "midday" : h < 19 ? "afternoon" : "evening");
const SLOT_LABEL = { night: "overnight", morning: "mornings (6–11)", midday: "midday (11–15)", afternoon: "afternoons (15–19)", evening: "evenings (19–24)" };

// One niche+platform → the aggregate. Returns { ready:false, n } below the gate.
async function buildBrief(category, platform) {
  const rows = await geDb.listReportsByCategorySince(category, platform, Date.now() - WINDOW_DAYS * DAY);
  const latest = new Map();
  for (const r of rows) { const k = String(r.business?.handle || "").toLowerCase(); if (k && (!latest.has(k) || latest.get(k).generatedAt < r.generatedAt)) latest.set(k, r); }
  const accounts = [...latest.values()].filter((r) => Array.isArray(r.reportBody?.posts) && r.reportBody.posts.length >= 5);
  const n = accounts.length;
  if (n < MIN_N) return { ready: false, n, min_n: MIN_N, category, platform };

  const tally = () => ({});
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const fmtAll = tally(), fmtTop = tally(), dayTop = tally(), dayAll = tally(), slotTop = tally(), slotAll = tally(), hookAll = tally(), hookTop = tally();
  let nAll = 0, nTop = 0, wordsAll = 0, wordsTop = 0;
  const cadence = [];
  for (const r of accounts) {
    const b = r.reportBody; const posts = b.posts.filter((p) => !p.is_pinned);
    const med = median(posts.map(eng)); const tz = b.tz || null;
    // Cadence: posts per week over the account's window, paired with its score for the quartile split.
    const times = posts.map((p) => Date.parse(p.posted_at || 0)).filter(Boolean);
    if (times.length >= 2) { const span = Math.max(7, (Math.max(...times) - Math.min(...times)) / DAY); cadence.push({ per_week: (posts.length / span) * 7, overall: b.scores?.overall ?? 0 }); }
    for (const p of posts) {
      const top = med > 0 && eng(p) >= med * TOP_LIFT;
      const f = String(p.type || "image").toLowerCase().replace("video", "reel");
      const { day, hour } = localParts(p.posted_at, tz); const slot = slotOf(hour);
      const hk = hookOf(p.caption); const words = String(p.caption || "").split(/\s+/).filter(Boolean).length;
      nAll++; bump(fmtAll, f); bump(dayAll, day); bump(slotAll, slot); bump(hookAll, hk); wordsAll += words;
      if (top) { nTop++; bump(fmtTop, f); bump(dayTop, day); bump(slotTop, slot); bump(hookTop, hk); wordsTop += words; }
    }
  }
  const share = (top, all, k) => ({ key: k, share_top: pct(top[k] || 0, nTop), share_all: pct(all[k] || 0, nAll), lift: all[k] && nTop ? Math.round(((top[k] || 0) / nTop) / ((all[k] || 0) / nAll) * 100) / 100 : null });
  const formats = Object.keys(fmtAll).map((k) => share(fmtTop, fmtAll, k)).sort((a, b) => b.share_top - a.share_top);
  const days = Object.keys(dayAll).map((k) => share(dayTop, dayAll, k)).sort((a, b) => b.share_top - a.share_top);
  const slots = Object.keys(slotAll).map((k) => share(slotTop, slotAll, k)).sort((a, b) => b.share_top - a.share_top);
  const hooks = Object.keys(hookAll).filter((k) => k !== "none").map((k) => ({ ...share(hookTop, hookAll, k), label: hookLabel(k) })).sort((a, b) => (b.lift || 0) - (a.lift || 0));
  const q = cadence.sort((a, b) => b.overall - a.overall); const topQ = q.slice(0, Math.max(1, Math.round(q.length / 4)));
  const cad = { top_quartile_per_week: Math.round(median(topQ.map((c) => c.per_week)) * 10) / 10, all_per_week: Math.round(median(q.map((c) => c.per_week)) * 10) / 10 };
  const captionWords = { top_avg: nTop ? Math.round(wordsTop / nTop) : null, all_avg: nAll ? Math.round(wordsAll / nAll) : null };

  // Plain sentences the app and the email both show. Each names a comparison, never an account.
  const lines = [];
  const bestFmt = formats.find((f) => f.lift && f.lift >= 1.15 && f.share_top >= 20);
  if (bestFmt) lines.push(`${cap(bestFmt.key)}s are ${bestFmt.share_all}% of what gets posted but ${bestFmt.share_top}% of the posts that beat their account's average (${bestFmt.lift}× lift).`);
  const bestHook = hooks.find((h) => h.lift && h.lift >= 1.2 && h.share_top >= 10);
  if (bestHook) lines.push(`Openers with ${bestHook.label} show up ${bestHook.lift}× more often among top posts (${bestHook.share_top}% vs ${bestHook.share_all}%).`);
  const topDays = days.filter((d) => d.lift && d.lift >= 1.15).slice(0, 2).map((d) => d.key);
  const topSlot = slots.find((s) => s.lift && s.lift >= 1.15);
  if (topDays.length || topSlot) lines.push(`Top posts land ${topDays.length ? `on ${topDays.join(" and ")}` : ""}${topDays.length && topSlot ? ", " : ""}${topSlot ? SLOT_LABEL[topSlot.key] : ""} more than the rest.`);
  if (cad.top_quartile_per_week && cad.all_per_week && cad.top_quartile_per_week > cad.all_per_week) lines.push(`The top quarter of ${label(category)} accounts post ${cad.top_quartile_per_week}× a week; the median is ${cad.all_per_week}×.`);
  if (captionWords.top_avg && captionWords.all_avg && Math.abs(captionWords.top_avg - captionWords.all_avg) >= 15) lines.push(`Captions on top posts run about ${captionWords.top_avg} words, against ${captionWords.all_avg} on average — ${captionWords.top_avg > captionWords.all_avg ? "longer" : "shorter"} is winning right now.`);
  if (!lines.length) lines.push(`No single format, opener or day stands out this week across ${n} ${label(category)} accounts — consistency is doing the work.`);

  return { ready: true, n, min_n: MIN_N, category, platform, week: weekKey(Date.now()), window_days: WINDOW_DAYS, posts: nAll, top_posts: nTop, formats, hooks, days: days.slice(0, 7), slots, cadence: cad, caption_words: captionWords, lines, built_at: Date.now() };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (c) => String(c || "").replace(/_/g, " ");

// Weekly cache. `force` rebuilds (admin / tests).
async function getBrief(category, platform, { force = false } = {}) {
  const week = weekKey(Date.now());
  if (!force) { try { const hit = await geDb.getNicheBrief(category, platform, week); if (hit) return hit; } catch { /* build */ } }
  const brief = await buildBrief(category, platform);
  try { await geDb.upsertNicheBrief({ category, platform, week, n: brief.n, body: brief }); } catch (e) { console.warn("[Briefs] cache write failed:", e.message); }
  return brief;
}

module.exports = { buildBrief, getBrief, hookOf, MIN_N, _test: { HOOKS, slotOf } };
