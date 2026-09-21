/**
 * Best time to post (spec 1.10). Deterministic, from the account's own posts:
 * which weekdays and hour blocks beat the account's own median engagement.
 *
 * Engagement per post = likes + comments (+ views/20 for video, so a reel's
 * reach counts without swamping the count). Every bucket is compared with
 * the account's median, so a big account and a small one read the same way.
 *
 * Confidence needs BESTTIME_MIN_POSTS posts overall and BESTTIME_MIN_PER_BUCKET
 * per recommended window; below that we say so and return a labelled
 * starting point (config) instead of pretending.
 */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLOCKS = [[6, 9], [9, 12], [12, 15], [15, 18], [18, 21], [21, 24], [0, 6]]; // local hours
const MIN_POSTS = Number(process.env.BESTTIME_MIN_POSTS || 12);
const MIN_PER_BUCKET = Number(process.env.BESTTIME_MIN_PER_BUCKET || 2);
const MIN_LIFT = Number(process.env.BESTTIME_MIN_LIFT || 1.15);
// Sensible defaults when the data can't say (labelled as a starting point).
const DEFAULTS = { instagram: [{ day: "Tue", block: [18, 21] }, { day: "Thu", block: [18, 21] }, { day: "Sat", block: [9, 12] }], tiktok: [{ day: "Tue", block: [18, 21] }, { day: "Thu", block: [15, 18] }, { day: "Sun", block: [18, 21] }] };

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const engagementOf = (p) => (Number(p.likes) || 0) + (Number(p.comments) || 0) + (p.views ? Number(p.views) / 20 : 0);
const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 || h === 24 ? "am" : "pm"}`;
const blockLabel = ([a, b]) => `${hourLabel(a)}–${hourLabel(b === 24 ? 0 : b)}`;

function localParts(iso, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(iso));
    const day = parts.find((p) => p.type === "weekday")?.value; let hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (hour === 24) hour = 0;
    return { day, hour };
  } catch { return null; }
}
const blockOf = (hour) => BLOCKS.find(([a, b]) => hour >= a && hour < b) || BLOCKS[BLOCKS.length - 1];

function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }

function bestTimes(posts, { tz = "UTC", platform = "instagram" } = {}) {
  const zone = validTz(tz) ? tz : "UTC";
  const rows = (posts || []).filter((p) => p && p.posted_at && !p.is_pinned).map((p) => ({ ...localParts(p.posted_at, zone), e: engagementOf(p) })).filter((r) => r.day);
  const med = median(rows.map((r) => r.e)) || 1;
  const buckets = new Map(); // "Tue|18-21" → [e...]
  for (const r of rows) { const b = blockOf(r.hour); const k = `${r.day}|${b[0]}-${b[1]}`; (buckets.get(k) || buckets.set(k, []).get(k)).push(r.e); }
  const scored = [...buckets.entries()].map(([k, es]) => { const [day, blk] = k.split("|"); const block = blk.split("-").map(Number); return { day, block, n: es.length, vs_avg: +(median(es) / med).toFixed(2) }; })
    .filter((b) => b.n >= MIN_PER_BUCKET && b.vs_avg >= MIN_LIFT).sort((a, b) => b.vs_avg - a.vs_avg || b.n - a.n).slice(0, 3);
  // Day-level view too (bigger buckets, useful even when hour blocks are thin)
  const byDay = new Map();
  for (const r of rows) (byDay.get(r.day) || byDay.set(r.day, []).get(r.day)).push(r.e);
  const days = [...byDay.entries()].map(([day, es]) => ({ day, n: es.length, vs_avg: +(median(es) / med).toFixed(2) })).sort((a, b) => b.vs_avg - a.vs_avg);
  const confident = rows.length >= MIN_POSTS && scored.length >= 1;
  const metric = platform === "tiktok" ? "views and likes" : "likes and comments";
  if (confident) {
    return {
      tz: zone, confident: true, sample: rows.length, metric,
      windows: scored.map((w) => ({ day: w.day, start_hour: w.block[0], end_hour: w.block[1], label: `${w.day} ${blockLabel(w.block)}`, n: w.n, vs_avg: w.vs_avg,
        explanation: `Your ${w.day} ${blockLabel(w.block)} posts average ${w.vs_avg}× your usual ${metric} (${w.n} post${w.n === 1 ? "" : "s"}).` })),
      best_days: days.slice(0, 3).filter((d) => d.vs_avg >= 1).map((d) => ({ day: d.day, n: d.n, vs_avg: d.vs_avg })),
      note: `From your last ${rows.length} posts, in ${zone.replace(/_/g, " ")}. Windows need at least ${MIN_PER_BUCKET} posts and ${MIN_LIFT}× your median to count.`,
    };
  }
  const d = DEFAULTS[platform] || DEFAULTS.instagram;
  const why = rows.length < MIN_POSTS ? `Only ${rows.length} posts to read — we need about ${MIN_POSTS} before your own pattern is trustworthy.` : `Your ${rows.length} posts don't show a window that clearly beats the rest yet.`;
  return {
    tz: zone, confident: false, sample: rows.length, metric,
    windows: d.map((w) => ({ day: w.day, start_hour: w.block[0], end_hour: w.block[1], label: `${w.day} ${blockLabel(w.block)}`, n: 0, vs_avg: null, explanation: "A common strong window for creators on this platform — a starting point, not your data." })),
    best_days: days.slice(0, 2).filter((x) => x.n >= 2 && x.vs_avg > 1).map((x) => ({ day: x.day, n: x.n, vs_avg: x.vs_avg })),
    note: `${why} These are starting points; we'll replace them with your own windows as you post.`,
  };
}
module.exports = { bestTimes, validTz, DAYS, BLOCKS };
