/**
 * Evidence on every claim (spec 1.4).
 *
 * pickEvidence(): for each dimension, the 1–3 posts that support the score,
 * chosen deterministically from the account's own posts — the post before
 * the longest gap, the top-engaging reel, the underused format — each with
 * the metric that makes the point ("44k views", "19-day gap after this").
 *
 * validateExplanation(): the model may only cite numbers that were in its
 * input. Any figure in an explanation that isn't in the allowed set gets the
 * explanation replaced by the scorer's own evidence sentence, and the
 * rejection is recorded on the report.
 */
const DAY = 86400000;
const k = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n); };
const eng = (p) => (Number(p.likes) || 0) + (Number(p.comments) || 0);
const item = (p, metric) => ({ post_id: p.id, permalink: p.permalink || null, type: p.type || "image", posted_at: p.posted_at, caption: (p.caption || "").slice(0, 80), metric, thumbnail_url: p.thumbnail_url || null });
const isVideo = (p) => ["reel", "video"].includes(String(p.type));
const metricLabel = (p) => isVideo(p) && p.views ? `${k(p.views)} views` : `${k(p.likes)} likes · ${k(p.comments)} comments`;

function pickEvidence(label, posts, { cadenceDays = Number(process.env.CADENCE_WINDOW_DAYS || 90) } = {}) {
  const all = (posts || []).filter((p) => p && p.posted_at);
  if (!all.length) return [];
  const feed = all.filter((p) => !p.is_pinned).sort((a, b) => +new Date(b.posted_at) - +new Date(a.posted_at));
  const byEng = [...all].sort((a, b) => eng(b) - eng(a));
  switch (label) {
    case "Posting Consistency": {
      const recent = feed.filter((p) => Date.now() - +new Date(p.posted_at) <= cadenceDays * DAY);
      const set = recent.length >= 3 ? recent : feed.slice(0, 12);
      let gap = 0, before = null;
      for (let i = 0; i < set.length - 1; i++) { const g = (+new Date(set[i].posted_at) - +new Date(set[i + 1].posted_at)) / DAY; if (g > gap) { gap = g; before = set[i + 1]; } }
      const out = [];
      if (before && gap >= 4) out.push(item(before, `${Math.round(gap)}-day gap after this`));
      if (set[0]) { const since = Math.round((Date.now() - +new Date(set[0].posted_at)) / DAY); out.push(item(set[0], since === 0 ? "posted today" : `last post, ${since} day${since === 1 ? "" : "s"} ago`)); }
      return out.slice(0, 3);
    }
    case "Content Mix": {
      const counts = {}; for (const p of all) counts[p.type] = (counts[p.type] || 0) + 1;
      const types = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const out = [];
      const [topType, topN] = types[0];
      const bestOfTop = byEng.find((p) => p.type === topType);
      if (bestOfTop) out.push(item(bestOfTop, `${topN} of ${all.length} are ${topType}s · ${metricLabel(bestOfTop)}`));
      const rare = types.length > 1 ? types[types.length - 1] : null;
      if (rare && rare[0] !== topType) { const bestOfRare = byEng.find((p) => p.type === rare[0]); if (bestOfRare) out.push(item(bestOfRare, `only ${rare[1]} ${rare[0]}${rare[1] === 1 ? "" : "s"} · ${metricLabel(bestOfRare)}`)); }
      return out.slice(0, 3);
    }
    case "Engagement Quality": {
      const med = [...all.map(eng)].sort((a, b) => a - b)[Math.floor(all.length / 2)] || 1;
      return byEng.slice(0, 3).map((p) => item(p, `${metricLabel(p)} · ${(eng(p) / med).toFixed(1)}× your median`));
    }
    default:
      return []; // Profile Clarity is about the bio, not a post
  }
}

// Numbers the model was given: everything numeric in the scoring inputs.
function allowedNumbers(inputs) {
  const set = new Set();
  const add = (n) => {
    if (!Number.isFinite(n)) return;
    set.add(String(n)); set.add(String(Math.round(n))); set.add(n.toFixed(1)); set.add(n.toFixed(2));
    if (n >= 1000) { set.add((n / 1000).toFixed(1).replace(/\.0$/, "")); set.add(String(Math.round(n / 1000))); }
    // fractions are quoted as percentages ("63% video" for 0.633)
    if (n > 0 && n < 1) { set.add(String(Math.round(n * 100))); set.add((n * 100).toFixed(1)); set.add((n * 100).toFixed(2)); }
    // and percentages sometimes as fractions
    if (n > 1 && n <= 100) { set.add((n / 100).toFixed(2)); }
  };
  const walk = (v) => { if (v == null) return; if (typeof v === "number") add(v); else if (typeof v === "string") { for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/g)) add(Number(m[0].replace(/,/g, ""))); } else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === "object") Object.values(v).forEach(walk); };
  walk(inputs);
  for (let i = 0; i <= 12; i++) set.add(String(i)); // "three formats", "4 weeks": small counts are never a fabrication risk
  set.add("100"); set.add("0");
  return set;
}
function validateExplanation(text, allowed) {
  const cited = [...String(text || "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
  const bad = cited.filter((n) => { const num = Number(n); return !(allowed.has(n) || allowed.has(String(num)) || allowed.has(num.toFixed(1)) || allowed.has(num.toFixed(2)) || (n.endsWith("%") ? allowed.has(n.slice(0, -1)) : false)); });
  return { ok: bad.length === 0, bad: [...new Set(bad)] };
}
module.exports = { pickEvidence, allowedNumbers, validateExplanation };
