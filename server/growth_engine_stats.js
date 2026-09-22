// Aggregated, anonymised niche stats (spec 5.3, 5.4).
//
// One pass over the latest report per account+handle in a window, grouped by
// niche+platform: score distribution, posting frequency, format mix,
// engagement rate. Nothing per account leaves this module — only counts,
// medians, quartiles and shares — and a niche only appears once it has
// BASELINE_MIN_N accounts, the same gate as the niche average.
//
//   nicheStats()            → every niche (admin export; State of Small Creators)
//   benchmark(cat, plat)    → one niche, the public read-only shape for the marketing site

const geDb = require("./growth_engine_db_select");
const MIN_N = Number(process.env.BASELINE_MIN_N || 10);
const WINDOW_DAYS = Number(process.env.STATS_WINDOW_DAYS || 180);
const DAY = 86400000;

const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 10) / 10; };
const mean = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
const eng = (p) => Number(p.likes || 0) + Number(p.comments || 0);

function perAccount(r) {
  const b = r.reportBody || {}; const posts = (b.posts || []).filter((p) => !p.is_pinned);
  const times = posts.map((p) => Date.parse(p.posted_at || 0)).filter(Boolean);
  const span = times.length >= 2 ? Math.max(7, (Math.max(...times) - Math.min(...times)) / DAY) : null;
  const followers = Number(b.business?.followers) || null;
  const fmt = {}; for (const p of posts) { const k = String(p.type || "image").toLowerCase().replace("video", "reel"); fmt[k] = (fmt[k] || 0) + 1; }
  return {
    overall: b.scores?.overall, dims: Object.fromEntries((b.scores?.dimensions || []).map((d) => [d.label, d.score])),
    posts_per_week: span ? Math.round((posts.length / span) * 7 * 10) / 10 : null,
    video_share: posts.length ? Math.round(((fmt.reel || 0) / posts.length) * 100) : null,
    formats: fmt, n_posts: posts.length,
    engagement_rate: followers && posts.length ? Math.round((mean(posts.map(eng)) / followers) * 10000) / 100 : null,
    followers,
  };
}

function aggregate(rows) {
  const accts = rows.map(perAccount).filter((a) => Number.isFinite(a.overall));
  const n = accts.length;
  if (n < MIN_N) return { ready: false, n, min_n: MIN_N };
  const scores = accts.map((a) => a.overall);
  const bands = { "0-39": 0, "40-54": 0, "55-69": 0, "70-84": 0, "85-100": 0 };
  for (const s of scores) bands[s < 40 ? "0-39" : s < 55 ? "40-54" : s < 70 ? "55-69" : s < 85 ? "70-84" : "85-100"]++;
  const dimNames = [...new Set(accts.flatMap((a) => Object.keys(a.dims)))];
  const fmtTot = {}; let postsTot = 0; for (const a of accts) { postsTot += a.n_posts; for (const [k, v] of Object.entries(a.formats)) fmtTot[k] = (fmtTot[k] || 0) + v; }
  const ppw = accts.map((a) => a.posts_per_week).filter((x) => x != null);
  const er = accts.map((a) => a.engagement_rate).filter((x) => x != null && x < 100);
  const fol = accts.map((a) => a.followers).filter((x) => x);
  return {
    ready: true, n, min_n: MIN_N,
    score: { mean: mean(scores), median: q(scores, 0.5), p25: q(scores, 0.25), p75: q(scores, 0.75), bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, Math.round((v / n) * 100)])) },
    dimensions: Object.fromEntries(dimNames.map((d) => [d, mean(accts.map((a) => a.dims[d]).filter(Number.isFinite))])),
    posting: { posts_per_week_median: q(ppw, 0.5), posts_per_week_p75: q(ppw, 0.75), video_share_median: q(accts.map((a) => a.video_share).filter((x) => x != null), 0.5) },
    formats: Object.fromEntries(Object.entries(fmtTot).map(([k, v]) => [k, Math.round((v / Math.max(1, postsTot)) * 100)])),
    engagement: { rate_median_pct: q(er, 0.5), rate_p75_pct: q(er, 0.75) },
    audience: { followers_median: q(fol, 0.5), followers_p25: q(fol, 0.25), followers_p75: q(fol, 0.75) },
    posts_sampled: postsTot,
  };
}

// Latest report per account+handle, grouped by niche+platform.
async function groupedRows() {
  const since = Date.now() - WINDOW_DAYS * DAY;
  const rows = await geDb.listReportsSince(since);
  const latest = new Map();
  for (const r of rows) { const k = `${r.accountId || "anon"}|${r.business?.platform}|${String(r.business?.handle || "").toLowerCase()}`; if (!latest.has(k) || latest.get(k).generatedAt < r.generatedAt) latest.set(k, r); }
  const groups = new Map();
  for (const r of latest.values()) { const g = `${r.business?.category || "other"}|${r.business?.platform || "instagram"}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  return groups;
}

async function nicheStats() {
  const groups = await groupedRows();
  const out = [];
  for (const [g, rows] of groups) { const [category, platform] = g.split("|"); out.push({ category, platform, ...aggregate(rows) }); }
  return { generated_at: Date.now(), window_days: WINDOW_DAYS, min_n: MIN_N, niches: out.sort((a, b) => (b.n || 0) - (a.n || 0)) };
}

// Public shape: only ready niches, only aggregates.
async function benchmark(category, platform) {
  const groups = await groupedRows();
  const rows = groups.get(`${category}|${platform}`) || [];
  const a = aggregate(rows);
  if (!a.ready) return { ready: false, category, platform, n: a.n, min_n: MIN_N };
  const { posts_sampled, ...rest } = a; void posts_sampled;
  return { category, platform, window_days: WINDOW_DAYS, generated_at: Date.now(), ...rest };
}

module.exports = { nicheStats, benchmark, aggregate, MIN_N, WINDOW_DAYS };
