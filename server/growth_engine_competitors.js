/**
 * Competitor comparison — score up to five other public accounts with the
 * same deterministic scorer and say, in plain terms, what each one does that
 * the owner doesn't. No LLM: fast (one Apify pull per handle), cheap, and the
 * same input always gives the same output.
 */

const { analyzeInstagramAccountViaApify } = require("./instagram_apify_fetcher");
const { scoreProfile } = require("./growth_engine_scoring");

const MAX_COMPETITORS = 5;

function metricsOf(data) {
  const m = data.analysis || data.metrics || {};
  return {
    posts_per_week: Number(m.posting_frequency?.posts_per_week) || 0,
    longest_gap_days: Number(m.posting_frequency?.longest_gap_days) || 0,
    video_share: (() => {
      const c = m.content || {};
      const t = (Number(c.video_posts) || 0) + (Number(c.carousel_posts) || 0) + (Number(c.static_posts) || 0);
      return t ? (Number(c.video_posts) || 0) / t : 0;
    })(),
    engagement_rate: Number(m.engagement?.engagement_rate_percent) || 0,
    comments_per_post: (() => {
      const e = m.engagement || {}; const n = Number(m.posting_frequency?.posts_analyzed) || 0;
      return n ? Math.round((Number(e.total_comments) || 0) / n) : 0;
    })(),
    followers: Number(data.follower_count) || 0,
    bio_location: !!m.profile_clarity?.bio_mentions_location,
    bio_price: !!m.profile_clarity?.bio_mentions_price,
    bio_cta: !!m.profile_clarity?.bio_has_cta,
    booking_link: !!m.profile_clarity?.external_url_is_booking,
    highlights: Number(m.profile_clarity?.highlight_count) || 0,
  };
}

// Plain-English differences, biggest first. Only things the competitor does
// better — the point is "what they do that you don't".
function whatTheyDoDifferently(theirs, mine) {
  const out = [];
  if (theirs.posts_per_week >= mine.posts_per_week * 1.5 && theirs.posts_per_week >= 2)
    out.push({ key: "cadence", text: `Posts ${theirs.posts_per_week}×/week to your ${mine.posts_per_week}×`, weight: theirs.posts_per_week - mine.posts_per_week });
  if (mine.longest_gap_days >= 14 && theirs.longest_gap_days <= 7)
    out.push({ key: "gaps", text: `Never goes more than ${theirs.longest_gap_days} days quiet (your longest gap: ${mine.longest_gap_days})`, weight: (mine.longest_gap_days - theirs.longest_gap_days) / 7 });
  if (theirs.video_share >= mine.video_share + 0.25)
    out.push({ key: "video", text: `${Math.round(theirs.video_share * 100)}% reels/video vs your ${Math.round(mine.video_share * 100)}%`, weight: (theirs.video_share - mine.video_share) * 4 });
  if (theirs.engagement_rate >= mine.engagement_rate * 1.5 && theirs.engagement_rate > 0.5)
    out.push({ key: "engagement", text: `${theirs.engagement_rate}% engagement rate vs your ${mine.engagement_rate}%`, weight: theirs.engagement_rate - mine.engagement_rate });
  if (theirs.comments_per_post >= Math.max(3, mine.comments_per_post * 2))
    out.push({ key: "comments", text: `${theirs.comments_per_post} comments per post vs your ${mine.comments_per_post}`, weight: 1 });
  if (theirs.bio_price && !mine.bio_price) out.push({ key: "price", text: "Bio states a price or offer — yours doesn't", weight: 1.5 });
  if (theirs.bio_location && !mine.bio_location) out.push({ key: "location", text: "Bio names the neighbourhood — yours doesn't", weight: 1.5 });
  if (theirs.bio_cta && !mine.bio_cta) out.push({ key: "cta", text: "Bio tells people what to do next — yours doesn't", weight: 1 });
  if (theirs.booking_link && !mine.booking_link) out.push({ key: "link", text: "Link goes to a booking/offer page, not a homepage", weight: 1.5 });
  if (theirs.highlights >= 3 && mine.highlights < 1) out.push({ key: "highlights", text: `${theirs.highlights} story highlights set up — you have none`, weight: 0.8 });
  return out.sort((a, b) => b.weight - a.weight).slice(0, 4).map((d) => d.text);
}

async function compareCompetitors({ handle, platform, category, handles }) {
  if (platform !== "instagram" && platform !== "ig") throw new Error("Competitor comparison is Instagram-only for now");
  const wanted = [...new Set((handles || []).map((h) => String(h).replace(/^@/, "").trim().toLowerCase()).filter(Boolean))]
    .filter((h) => h !== String(handle).toLowerCase())
    .slice(0, MAX_COMPETITORS);
  if (!wanted.length) throw new Error("Give at least one competitor handle");

  const mineData = await analyzeInstagramAccountViaApify(handle);
  const mine = { handle: mineData.handle, scores: scoreProfile(mineData, category), metrics: metricsOf(mineData) };

  const competitors = [];
  for (const h of wanted) {
    try {
      const data = await analyzeInstagramAccountViaApify(h);
      const scores = scoreProfile(data, category);
      const metrics = metricsOf(data);
      competitors.push({
        handle: data.handle, followers: data.follower_count, ok: true,
        overall: scores.overall,
        dimensions: scores.dimensions.map((d) => ({ label: d.label, score: d.score })),
        metrics,
        does_differently: whatTheyDoDifferently(metrics, mine.metrics),
      });
    } catch (err) {
      competitors.push({ handle: h, ok: false, error: err.message });
    }
  }
  const scored = competitors.filter((c) => c.ok);
  const rank = [mine.scores.overall, ...scored.map((c) => c.overall)].sort((a, b) => b - a).indexOf(mine.scores.overall) + 1;
  return {
    generated_at: Date.now(),
    you: { handle: mine.handle, overall: mine.scores.overall, dimensions: mine.scores.dimensions.map((d) => ({ label: d.label, score: d.score })), metrics: mine.metrics },
    competitors,
    rank: { position: rank, of: scored.length + 1 },
  };
}

module.exports = { compareCompetitors, MAX_COMPETITORS };
