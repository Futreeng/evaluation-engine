/**
 * Deterministic dimension scoring.
 *
 * The four Scalecraft scores are computed here from the fetched metrics, so
 * the same profile on the same day always gets the same number. The LLM
 * personas receive these scores and write the explanations and moves; they
 * never set or adjust the numbers.
 *
 * Each dimension is 0-100 and built from named sub-scores with fixed weights,
 * so an explanation can point at exactly what cost the points.
 */

// Numeric targets per category. Working assumptions until the measured
// baselines (growth_engine_baselines) are large enough to derive them.
const TARGETS = {
  boutique_fitness:      { posts_per_week: 4.5, max_gap_days: 7, video_share: 0.6, engagement_rate: 2.4, comment_share: 0.04, profile: { location: 25, price: 20, cta: 15, link: 10, booking_link: 20, highlights: 10 } },
  fitness:               { posts_per_week: 4.5, max_gap_days: 7, video_share: 0.55, engagement_rate: 2.2, comment_share: 0.04, profile: { location: 25, price: 15, cta: 20, link: 10, booking_link: 20, highlights: 10 } },
  food_beverage:         { posts_per_week: 5.5, max_gap_days: 5, video_share: 0.3, engagement_rate: 1.8, comment_share: 0.03, profile: { location: 30, price: 10, cta: 15, link: 10, booking_link: 25, highlights: 10 } },
  retail:                { posts_per_week: 4.5, max_gap_days: 7, video_share: 0.3, engagement_rate: 1.5, comment_share: 0.03, profile: { location: 20, price: 15, cta: 15, link: 10, booking_link: 30, highlights: 10 } },
  professional_services: { posts_per_week: 2.5, max_gap_days: 10, video_share: 0.4, engagement_rate: 1.2, comment_share: 0.05, profile: { location: 20, price: 10, cta: 25, link: 10, booking_link: 25, highlights: 10 } },
};
const DEFAULT_TARGET = TARGETS.fitness;

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const pct = (x) => Math.round(clamp01(x) * 100);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Linear ramp: 1 at `good`, 0 at `bad` (works in either direction).
function ramp(value, good, bad) {
  if (good === bad) return value >= good ? 1 : 0;
  return clamp01((value - bad) / (good - bad));
}

// Captions that only announce schedules/promos don't build trust. Rough
// keyword read; the LLM gets the captions too and can be more nuanced.
const PROMO_RE = /\b(schedule|class times?|this week'?s classes|sale|% ?off|promo|book now|sign ?up|link in bio|discount|offer ends)\b/i;

function scorePostingConsistency(pf, t) {
  const ppw = num(pf.posts_per_week);
  const gap = num(pf.longest_gap_days, 0);
  const since = num(pf.days_since_last_post, 0);
  const cadence = ramp(ppw, t.posts_per_week, 0);              // 60
  const gaps = ramp(gap, t.max_gap_days, t.max_gap_days * 4);   // 25: full at target, zero at 4×
  const recency = ramp(since, 7, 30);                           // 15
  const score = pct(cadence * 0.6 + gaps * 0.25 + recency * 0.15);
  return {
    label: "Posting Consistency", score,
    evidence: `${num(pf.posts_analyzed)} posts over ${num(pf.date_range_days)} days (${ppw}/week vs ${t.posts_per_week}/week target); longest gap ${gap} days; last post ${since} day${since === 1 ? "" : "s"} ago`,
    parts: { cadence: pct(cadence), gaps: pct(gaps), recency: pct(recency) },
  };
}

function scoreContentMix(content, posts, t) {
  const total = num(content.video_posts) + num(content.carousel_posts) + num(content.static_posts);
  if (!total) return { label: "Content Mix", score: 0, evidence: "no posts to classify", parts: {} };
  const videoShare = num(content.video_posts) / total;
  const closeness = 1 - clamp01(Math.abs(videoShare - t.video_share) / Math.max(t.video_share, 1 - t.video_share)); // 50
  const formats = ["video_posts", "carousel_posts", "static_posts"].filter((k) => num(content[k]) > 0).length;
  const diversity = formats >= 3 ? 1 : formats === 2 ? 0.7 : 0.3;                                                // 25
  const captions = Array.isArray(posts) ? posts.map((p) => p.caption || "") : [];
  const promoShare = captions.length ? captions.filter((c) => PROMO_RE.test(c)).length / captions.length : 0;
  const substance = ramp(num(content.avg_caption_length), 80, 10) * 0.5 + (1 - promoShare) * 0.5;                // 25
  const score = pct(closeness * 0.5 + diversity * 0.25 + substance * 0.25);
  return {
    label: "Content Mix", score,
    evidence: `${Math.round(videoShare * 100)}% video vs ${Math.round(t.video_share * 100)}% target; ${formats} of 3 formats in use; ${Math.round(promoShare * 100)}% of captions are schedule/promo; avg caption ${num(content.avg_caption_length)} chars`,
    parts: { mix: pct(closeness), diversity: pct(diversity), substance: pct(substance) },
  };
}

function scoreEngagementQuality(eng, aud, content, t) {
  const er = num(eng.engagement_rate_percent);
  const likes = num(eng.total_likes), comments = num(eng.total_comments);
  const commentShare = likes + comments > 0 ? comments / (likes + comments) : 0;
  const followers = num(aud.followers);
  const videos = num(content.video_posts);
  const viewsPerFollower = followers > 0 && videos > 0 ? num(eng.total_video_views) / videos / followers : null;
  const rate = ramp(er, t.engagement_rate, 0);                                  // 60
  const conversation = ramp(commentShare, t.comment_share, 0);                  // 25
  const reach = viewsPerFollower == null ? 0.5 : ramp(viewsPerFollower, 0.3, 0); // 15 (neutral if no video)
  const score = pct(rate * 0.6 + conversation * 0.25 + reach * 0.15);
  return {
    label: "Engagement Quality", score,
    evidence: `${er}% engagement rate vs ${t.engagement_rate}% target; comments are ${(commentShare * 100).toFixed(1)}% of interactions${viewsPerFollower != null ? `; video views per post ≈ ${Math.round(viewsPerFollower * 100)}% of followers` : ""}`,
    parts: { rate: pct(rate), conversation: pct(conversation), reach: pct(reach) },
  };
}

function scoreProfileClarity(pc, t) {
  const w = t.profile;
  let s = 0;
  const hits = [], misses = [];
  const check = (ok, key, name) => { if (ok) { s += w[key]; hits.push(name); } else misses.push(name); };
  check(!!pc.bio_mentions_location, "location", "location in bio");
  check(!!pc.bio_mentions_price, "price", "price or offer in bio");
  check(!!pc.bio_has_cta, "cta", "a next step in bio");
  check(!!pc.external_url, "link", "a link");
  check(!!pc.external_url_is_booking, "booking_link", "link goes to booking/offer");
  check(num(pc.highlight_count) >= 1, "highlights", "story highlights");
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const score = pct(s / total);
  return {
    label: "Profile Clarity", score,
    evidence: `has: ${hits.join(", ") || "none"}; missing: ${misses.join(", ") || "nothing"}`,
    parts: Object.fromEntries(Object.keys(w).map((k) => [k, pc[{ location: "bio_mentions_location", price: "bio_mentions_price", cta: "bio_has_cta", link: "external_url", booking_link: "external_url_is_booking", highlights: "highlight_count" }[k]] ? w[k] : 0])),
  };
}

/**
 * @param realData  output of an *_fetcher analyze function (needs .analysis)
 * @returns {null | { overall, dimensions: [...], targets, method }}
 */
function scoreProfile(realData, category) {
  // Accepts either a fetcher result ({ analysis, recent_posts }) or the
  // evaluator's formatted view of it ({ metrics, recent_activity }).
  const m = realData && (realData.analysis || realData.metrics);
  if (!m || !m.posting_frequency || !m.engagement || !m.content) return null;
  const t = TARGETS[category] || DEFAULT_TARGET;
  const pc = m.profile_clarity || {};
  const posts = (realData.recent_posts || realData.recent_activity || []).map((p) => ({ caption: p.caption ?? p.caption_preview ?? "" }));
  const dims = [
    scorePostingConsistency(m.posting_frequency, t),
    scoreContentMix(m.content, posts, t),
    scoreEngagementQuality(m.engagement, m.audience || { followers: realData.follower_count }, m.content, t),
    scoreProfileClarity(pc, t),
  ];
  const overall = Math.round(dims.reduce((a, d) => a + d.score, 0) / dims.length);
  return { overall, dimensions: dims, targets: t, method: "deterministic-v1" };
}

/**
 * Best and worst posts, ranked by engagement relative to the account's own
 * average (so a 12M-follower account and a 900-follower studio rank the same
 * way). Also the format/day patterns behind them.
 *
 * @param posts  fetcher posts (recent_posts) or formatted recent_activity
 */
function rankPosts(posts, { top = 3, bottom = 3 } = {}) {
  const rows = (posts || [])
    .map((p) => {
      const likes = num(p.like_count ?? p.likes);
      const comments = num(p.comments_count ?? p.comments);
      const views = num(p.video_view_count ?? p.video_views);
      const date = p.timestamp || p.date || null;
      const format = p.is_reel || String(p.media_type || "").toUpperCase() === "REEL" ? "reel"
        : String(p.media_type || "").toUpperCase() === "VIDEO" ? "video"
        : String(p.media_type || "").toUpperCase() === "CAROUSEL" ? "carousel" : "static";
      return {
        date, format,
        weekday: date ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date).getDay()] : null,
        likes, comments, views,
        engagement: likes + comments,
        caption: String(p.caption ?? p.caption_preview ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
        url: p.permalink || p.url || null,
        pinned: !!p.is_pinned,
      };
    })
    .filter((r) => r.date);
  if (rows.length < 2) return null;
  const avg = rows.reduce((a, r) => a + r.engagement, 0) / rows.length;
  for (const r of rows) r.vs_avg = avg > 0 ? +(r.engagement / avg).toFixed(2) : 1;
  const sorted = [...rows].sort((a, b) => b.engagement - a.engagement);
  const byFormat = {};
  for (const r of rows) { (byFormat[r.format] ||= []).push(r.engagement); }
  const format_avg = Object.fromEntries(Object.entries(byFormat).map(([k, v]) => [k, { posts: v.length, avg_engagement: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }]));
  const byDay = {};
  for (const r of rows) { (byDay[r.weekday] ||= []).push(r.engagement); }
  const day_avg = Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
  const bestFormat = Object.entries(format_avg).filter(([, v]) => v.posts >= 2).sort((a, b) => b[1].avg_engagement - a[1].avg_engagement)[0];
  const bestDay = Object.entries(day_avg).sort((a, b) => b[1] - a[1])[0];
  return {
    sample: rows.length,
    avg_engagement: Math.round(avg),
    top: sorted.slice(0, top),
    bottom: sorted.slice(-bottom).reverse(),
    patterns: {
      best_format: bestFormat ? { format: bestFormat[0], ...bestFormat[1], vs_avg: +(bestFormat[1].avg_engagement / avg).toFixed(2) } : null,
      best_day: bestDay ? { day: bestDay[0], avg_engagement: bestDay[1] } : null,
      format_avg, day_avg,
    },
  };
}

module.exports = { scoreProfile, rankPosts, TARGETS };
