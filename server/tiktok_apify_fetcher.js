/**
 * TikTok Data Fetcher — public profiles via Apify
 *
 * Actor: clockworks/tiktok-scraper. One dataset row per video, each carrying
 * `authorMeta` (bio, follower count, link). ~$0.004 per video; we pull 15.
 *
 * Output matches the Instagram fetchers (analyzeInstagramAccount /
 * analyzeInstagramAccountViaApify) so growth_engine_scoring.js and the
 * evaluator's formatter work unchanged. TikTok specifics are folded in where
 * the scorer reads them: every post is a video (so Content Mix is judged on
 * slideshow vs video, duration spread and caption substance), and plays,
 * shares and saves feed Engagement Quality.
 */

const { calculateMetrics } = require("./instagram_fetcher");

const ACTOR = "clockworks~tiktok-scraper";
const VIDEOS = 15;
const RUN_TIMEOUT_SECS = 150;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map(); // in-process fallback; the DB cache is authoritative
const geDb = require("./growth_engine_db_select");

async function fetchVideosFromApify(handle) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not configured");
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}&format=json&clean=true`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      profiles: [handle],
      resultsPerPage: VIDEOS,
      profileSorting: "latest",
      profileScrapeSections: ["videos"],
      excludePinnedPosts: false,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      commentsPerPost: 0,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error("Apify token rejected");
    if (response.status === 402) throw new Error("Apify account out of credit");
    throw new Error(`Apify error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const items = await response.json();
  if (!Array.isArray(items) || items.length === 0) throw new Error(`TikTok account @${handle} not found`);
  const err = items.find((it) => it.error || it.errorCode);
  if (err && items.every((it) => it.error || it.errorCode)) {
    const msg = String(err.errorDescription || err.error || err.errorCode);
    if (/not found|does not exist|404|no video/i.test(msg)) throw new Error(`TikTok account @${handle} not found`);
    if (/private/i.test(msg)) throw new Error(`TikTok returned the profile @${handle} as private, so there are no public posts for us to score.`);
    throw new Error(`TikTok returned an error for @${handle}: ${msg}`);
  }
  return items.filter((it) => it.id && it.createTimeISO);
}

function normalizeVideo(v) {
  return {
    id: v.id,
    caption: v.text || "",
    media_type: v.isSlideshow ? "CAROUSEL" : "VIDEO",
    is_reel: !v.isSlideshow,
    timestamp: v.createTimeISO,
    like_count: Number(v.diggCount) || 0,
    comments_count: Number(v.commentCount) || 0,
    video_view_count: Number(v.playCount) || 0,
    share_count: Number(v.shareCount) || 0,
    save_count: Number(v.collectCount) || 0,
    duration: Number(v.videoMeta?.duration) || 0,
    hashtags: (v.hashtags || []).map((h) => h.name).filter(Boolean),
    mentions: v.mentions || [],
    location: v.locationMeta?.city || v.locationMeta?.locationName || null,
    is_pinned: !!v.isPinned,
    permalink: v.webVideoUrl || null,
  };
}

async function analyzeTikTokAccountViaApify(rawHandle) {
  const handle = String(rawHandle || "").replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error(`"${rawHandle}" is not a valid TikTok handle`);

  const hit = cache.get(handle);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) { console.log(`[TikTok/Apify] Cache hit for @${handle}`); return hit.data; }
  try {
    const c = await geDb.getCachedProfile("tiktok", handle, CACHE_TTL_MS);
    if (c) { console.log(`[TikTok/Apify] DB cache hit for @${handle}`); cache.set(handle, { at: c.fetchedAt, data: c.data }); return c.data; }
  } catch { /* cache is best-effort */ }

  console.log(`[TikTok/Apify] Fetching @${handle}...`);
  const items = await fetchVideosFromApify(handle);
  const author = items.find((it) => it.authorMeta)?.authorMeta || {};
  if (author.privateAccount) throw new Error(`TikTok returned the profile @${handle} as private, so there are no public posts for us to score.`);

  const posts = items.map(normalizeVideo);
  if (!posts.length) throw new Error(`No public posts found for @${handle}`);

  const user = { followers_count: Number(author.fans) || 0, follows_count: Number(author.following) || 0 };
  const feed = posts.filter((p) => !p.is_pinned);
  const cadenceSet = feed.length >= 3 ? feed : posts;
  const metrics = calculateMetrics(user, posts);
  metrics.posting_frequency = calculateMetrics(user, cadenceSet).posting_frequency;
  metrics.posting_frequency.pinned_excluded = posts.length - cadenceSet.length;
  metrics.posting_frequency.note = `Only the most recent ${VIDEOS} public videos are sampled; cadence reflects that window.`;

  // TikTok engagement: plays and shares are the reach signals; saves are the
  // "worth keeping" signal. Recompute the rate to include them lightly.
  const totalPlays = posts.reduce((n, p) => n + p.video_view_count, 0);
  const totalShares = posts.reduce((n, p) => n + p.share_count, 0);
  const totalSaves = posts.reduce((n, p) => n + p.save_count, 0);
  metrics.engagement.total_video_views = totalPlays;
  metrics.engagement.total_shares = totalShares;
  metrics.engagement.total_saves = totalSaves;
  metrics.engagement.avg_plays_per_video = Math.round(totalPlays / posts.length);
  metrics.engagement.shares_per_post = +(totalShares / posts.length).toFixed(1);
  metrics.engagement.saves_per_post = +(totalSaves / posts.length).toFixed(1);
  if (user.followers_count > 0) {
    const eng = metrics.engagement.total_engagement + totalShares + totalSaves;
    metrics.engagement.engagement_rate_percent = +((eng / (posts.length * user.followers_count)) * 100).toFixed(2);
  }

  // Content: all video, so mix is judged on slideshows vs video, duration spread, captions
  const durations = posts.map((p) => p.duration).filter((d) => d > 0);
  metrics.content.reel_posts = posts.filter((p) => p.is_reel).length;
  metrics.content.slideshow_posts = posts.filter((p) => !p.is_reel).length;
  metrics.content.avg_duration_s = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  metrics.content.short_videos_under_15s = durations.filter((d) => d < 15).length;
  metrics.content.long_videos_over_60s = durations.filter((d) => d > 60).length;
  metrics.content.pinned_posts = posts.filter((p) => p.is_pinned).length;
  metrics.content.avg_hashtags = +(posts.reduce((n, p) => n + p.hashtags.length, 0) / posts.length).toFixed(1);
  metrics.content.original_sound_share = +(items.filter((it) => it.musicMeta?.musicOriginal).length / items.length).toFixed(2);

  const bio = author.signature || "";
  const link = author.bioLink?.link || author.bioLink || null;
  metrics.profile_clarity = {
    bio_length: bio.length,
    bio_text: bio.slice(0, 300),
    bio_mentions_location: /📍|\b(nyc|la|london|[A-Z][a-z]+, [A-Z]{2})\b/i.test(bio),
    bio_mentions_price: /\$\s?\d|\bfree\b|\btrial\b/i.test(bio),
    bio_has_cta: /\b(follow|subscribe|watch|listen|join|dm|link|shop|new (video|drop|episode))\b/i.test(bio),
    external_url: typeof link === "string" ? link : null,
    external_url_is_booking: /youtu|spotify|substack|beacons|linktr|stan\.store|patreon|gumroad|shop|newsletter|podcast|discord|twitch|book|calendly/i.test(typeof link === "string" ? link : ""),
    highlight_count: 0, // TikTok has no highlights; the creator checklist tolerates 0
    is_business_account: !!author.commerceUserInfo?.commerceUser || !!author.ttSeller,
    business_category: null,
  };

  const times = cadenceSet.map((p) => +new Date(p.timestamp)).sort((a, b) => a - b);
  let longestGap = 0;
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i] - times[i - 1]);
  metrics.posting_frequency.longest_gap_days = Math.round(longestGap / 86400000);
  metrics.posting_frequency.days_since_last_post = Math.round((Date.now() - times[times.length - 1]) / 86400000);

  const data = {
    handle: author.name || handle,
    user_id: author.id,
    full_name: author.nickName || null,
    follower_count: user.followers_count,
    following_count: user.follows_count,
    post_count: Number(author.video) || posts.length,
    total_likes: Number(author.heart) || null,
    biography: bio,
    website: metrics.profile_clarity.external_url,
    verified: !!author.verified,
    recent_posts: posts,
    analysis: metrics,
    source: "clockworks/tiktok-scraper",
  };
  cache.set(handle, { at: Date.now(), data });
  try { await geDb.putCachedProfile("tiktok", handle, data); } catch { /* best-effort */ }
  return data;
}

module.exports = { analyzeTikTokAccountViaApify, normalizeVideo };
