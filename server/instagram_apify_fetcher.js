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

const cache = new Map(); // in-process fallback; the DB cache is authoritative
const geDb = require("./growth_engine_db_select");

// How many recent posts to score on (spec 1.3). The profile scraper returns
// ~12; anything beyond that comes from the post scraper (per-result price).
const SCRAPE_POSTS = Math.max(12, Math.min(50, Number(process.env.SCRAPE_POSTS || 30)));
const POST_ACTOR = "apify~instagram-scraper";

async function fetchPostsFromApify(handle, limit) {
  const token = process.env.APIFY_TOKEN;
  const url = `https://api.apify.com/v2/acts/${POST_ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}&format=json&clean=true`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ directUrls: [`https://www.instagram.com/${handle}/`], resultsType: "posts", resultsLimit: limit, addParentData: false }),
  });
  if (!response.ok) throw new Error(`Apify post scraper error ${response.status}`);
  const items = await response.json();
  return Array.isArray(items) ? items.filter((p) => p && p.id && p.timestamp && !p.error) : [];
}

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
    // Stored per post (spec 1.3). Saves aren't public on Instagram → null.
    save_count: null,
    thumbnail_url: p.displayUrl || null,
    short_code: p.shortCode || null,
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
  try {
    const c = await geDb.getCachedProfile("instagram", handle, CACHE_TTL_MS);
    // A cache entry from before the deeper scrape holds ~12 posts; refetch.
    if (c && (c.data?.recent_posts?.length || 0) >= Math.min(SCRAPE_POSTS, c.data?.post_count || SCRAPE_POSTS)) { console.log(`[Instagram/Apify] DB cache hit for @${handle}`); cache.set(handle, { at: c.fetchedAt, data: c.data }); return c.data; }
  } catch { /* cache is best-effort */ }

  console.log(`[Instagram/Apify] Fetching @${handle}...`);
  require("./growth_engine_costs").scrape({ unit: "apify:instagram-profile", quantity: 1, handle, platform: "instagram" });
  const profile = await fetchProfileFromApify(handle);

  if (profile.private) {
    throw new Error(
      `Instagram returned the profile @${handle} as private, so there are no public posts for us to score.`
    );
  }

  let posts = (profile.latestPosts || []).map(normalizePost).filter((p) => p.timestamp);
  if (posts.length === 0) {
    throw new Error(`No public posts found for @${handle}`);
  }
  // Deeper scrape: top up to SCRAPE_POSTS from the post scraper. Never fail
  // the report over it — 12 posts is still a report.
  if (posts.length < SCRAPE_POSTS && (profile.postsCount || SCRAPE_POSTS) > posts.length) {
    try {
      const more = await fetchPostsFromApify(handle, SCRAPE_POSTS);
      require("./growth_engine_costs").scrape({ unit: "apify:instagram-post", quantity: Math.max(1, more.length), handle, platform: "instagram" });
      const seen = new Set(posts.map((p) => p.id));
      for (const raw of more) { const p = normalizePost(raw); if (p.timestamp && !seen.has(p.id)) { posts.push(p); seen.add(p.id); } }
      posts.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
      posts = posts.slice(0, SCRAPE_POSTS);
      console.log(`[Instagram/Apify] @${handle}: ${posts.length} posts after deeper scrape`);
    } catch (err) { console.warn(`[Instagram/Apify] deeper scrape failed for @${handle}: ${err.message} — scoring on ${posts.length} posts`); }
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
  // Cadence is judged on a fixed recent window so scrape depth doesn't move
  // the score: 30 posts from a sparse account can span years. Falls back to
  // the latest posts when the window holds fewer than 3.
  const CADENCE_DAYS = Number(process.env.CADENCE_WINDOW_DAYS || 90);
  const recent = feed.filter((p) => Date.now() - +new Date(p.timestamp) <= CADENCE_DAYS * 86400000);
  const cadenceSet = recent.length >= 3 ? recent : (feed.length >= 3 ? feed.slice(0, 12) : posts.slice(0, 12));
  const metrics = calculateMetrics(user, posts);
  metrics.posting_frequency = calculateMetrics(user, cadenceSet).posting_frequency;
  metrics.posting_frequency.pinned_excluded = posts.length - feed.length;
  metrics.posting_frequency.window_days = CADENCE_DAYS;
  metrics.posting_frequency.posts_in_window = recent.length;
  metrics.posting_frequency.note = `Only the most recent ${posts.length} public posts are sampled; cadence reflects that window.`;
  metrics.posts_sampled = posts.length;

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
  try { await geDb.putCachedProfile("instagram", handle, data); } catch { /* best-effort */ }
  return data;
}

module.exports = { analyzeInstagramAccountViaApify, normalizePost };
