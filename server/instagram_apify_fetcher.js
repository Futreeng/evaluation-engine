/**
 * Instagram Data Fetcher — public profiles via Apify
 *
 * Scores any public Instagram handle. The Graph API fetcher in
 * instagram_fetcher.js can only read business accounts the app owner has
 * connected; this one reads what a visitor to instagram.com/<handle> would
 * see, which is what the free Social Snapshot needs.
 *
 * Actor: apify/instagram-profile-scraper — one dataset row per username with
 * profile fields plus `latestPosts` (~12 most recent). Pay-per-event, about
 * $0.003 per profile.
 *
 * Output matches analyzeInstagramAccount() in instagram_fetcher.js so the
 * evaluator's formatInstagramDataForAnalysis() works unchanged.
 */

const { calculateMetrics } = require("./instagram_fetcher");

const ACTOR = "apify~instagram-profile-scraper";
const RUN_TIMEOUT_SECS = 120;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a retry within a day shouldn't re-bill

const cache = new Map(); // handle -> { at, data }

async function fetchProfileFromApify(handle) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not configured");

  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?timeout=${RUN_TIMEOUT_SECS}&format=json&clean=true`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ usernames: [handle], includeAboutSection: false }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error("Apify token rejected");
    if (response.status === 402) throw new Error("Apify account out of credit");
    throw new Error(`Apify error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const items = await response.json();
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Instagram account @${handle} not found`);
  }
  const profile = items[0];
  if (profile.error) {
    // Actor reports per-username failures as { error, errorDescription }
    const msg = String(profile.errorDescription || profile.error);
    if (/not found|does not exist|404/i.test(msg)) throw new Error(`Instagram account @${handle} not found`);
    throw new Error(`Instagram returned an error for @${handle}: ${msg}`);
  }
  return profile;
}

// Map an Apify post into the Graph-API-shaped post calculateMetrics() reads.
function normalizePost(p) {
  const type = String(p.type || "").toLowerCase(); // "Image" | "Video" | "Sidecar"
  const productType = String(p.productType || "").toLowerCase(); // "clips" = reel
  const media_type = type === "sidecar" ? "CAROUSEL" : type === "video" ? "VIDEO" : "IMAGE";
  return {
    id: p.id,
    caption: p.caption || "",
    media_type,
    is_reel: productType === "clips" || (media_type === "VIDEO" && !!p.videoUrl),
    timestamp: p.timestamp,
    like_count: p.likesCount == null || p.likesCount < 0 ? 0 : p.likesCount, // -1 when hidden
    comments_count: p.commentsCount || 0,
    video_view_count: p.videoViewCount || 0,
    hashtags: p.hashtags || [],
    mentions: p.mentions || [],
    location: p.locationName || null,
    is_pinned: !!p.isPinned,
    permalink: p.url,
  };
}

async function analyzeInstagramAccountViaApify(rawHandle) {
  const handle = String(rawHandle || "").replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error(`"${rawHandle}" is not a valid Instagram handle`);

  const hit = cache.get(handle);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    console.log(`[Instagram/Apify] Cache hit for @${handle}`);
    return hit.data;
  }

  console.log(`[Instagram/Apify] Fetching @${handle}...`);
  const profile = await fetchProfileFromApify(handle);

  if (profile.private) {
    throw new Error(
      `Instagram returned the profile @${handle} as private, so there are no public posts for us to score.`
    );
  }

  const posts = (profile.latestPosts || []).map(normalizePost).filter((p) => p.timestamp);
  if (posts.length === 0) {
    throw new Error(`No public posts found for @${handle}`);
  }

  // Reuse the Graph-API metrics math so both fetchers score the same way.
  const user = {
    followers_count: profile.followersCount || 0,
    follows_count: profile.followsCount || 0,
  };
  // Pinned posts can be months old and sit at the top of the grid; they'd
  // stretch the date range and make a daily poster look dormant. Score cadence
  // on the unpinned feed, engagement on everything.
  const feed = posts.filter((p) => !p.is_pinned);
  const cadenceSet = feed.length >= 3 ? feed : posts;
  const metrics = calculateMetrics(user, posts);
  metrics.posting_frequency = calculateMetrics(user, cadenceSet).posting_frequency;
  metrics.posting_frequency.pinned_excluded = posts.length - cadenceSet.length;
  metrics.posting_frequency.note = "Only the most recent ~12 public posts are sampled; cadence reflects that window.";

  // Signals the Graph fetcher can't see but the free report copy depends on
  // (the bio/link/booking-path read).
  const bio = profile.biography || "";
  metrics.profile_clarity = {
    bio_length: bio.length,
    bio_text: bio.slice(0, 300),
    bio_mentions_location: /\b(brooklyn|manhattan|queens|bronx|nyc|new york|[A-Z][a-z]+, [A-Z]{2}|📍)/i.test(bio) || !!posts.find((p) => p.location),
    bio_mentions_price: /\$\s?\d|\bfree\b|\btrial\b|\bintro\b/i.test(bio),
    bio_has_cta: /\b(book|sign up|join|dm|link below|tap|schedule|reserve)\b/i.test(bio),
    external_url: profile.externalUrl || null,
    external_url_is_booking: /book|schedule|class|trial|sign|join|shop|order|menu|reserve|mindbody|calendly|linktr/i.test(profile.externalUrl || ""),
    highlight_count: profile.highlightReelCount || 0,
    is_business_account: !!profile.isBusinessAccount,
    business_category: profile.businessCategoryName || null,
  };
  metrics.content.reel_posts = posts.filter((p) => p.is_reel).length;
  metrics.content.pinned_posts = posts.filter((p) => p.is_pinned).length;
  metrics.content.posts_with_location = posts.filter((p) => p.location).length;
  metrics.content.avg_hashtags = +(posts.reduce((n, p) => n + p.hashtags.length, 0) / posts.length).toFixed(1);
  metrics.engagement.total_video_views = posts.reduce((n, p) => n + p.video_view_count, 0);

  // Longest silence between consecutive posts — the free report leads with it.
  const times = cadenceSet.map((p) => +new Date(p.timestamp)).sort((a, b) => a - b);
  let longestGap = 0;
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i] - times[i - 1]);
  metrics.posting_frequency.longest_gap_days = Math.round(longestGap / 86400000);
  metrics.posting_frequency.days_since_last_post = Math.round((Date.now() - times[times.length - 1]) / 86400000);

  const data = {
    handle: profile.username || handle,
    user_id: profile.id,
    full_name: profile.fullName || null,
    follower_count: user.followers_count,
    following_count: user.follows_count,
    post_count: profile.postsCount || posts.length,
    biography: bio,
    website: profile.externalUrl || null,
    verified: !!profile.verified,
    recent_posts: posts,
    analysis: metrics,
    source: "apify/instagram-profile-scraper",
  };
  cache.set(handle, { at: Date.now(), data });
  return data;
}

module.exports = { analyzeInstagramAccountViaApify, normalizePost };
