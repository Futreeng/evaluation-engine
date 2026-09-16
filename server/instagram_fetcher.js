/**
 * Instagram Data Fetcher
 * Fetches real user data and metrics for social media evaluation
 * Uses Instagram Graph API (Business Account)
 */

async function getInstagramUserData(handle) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) throw new Error("INSTAGRAM_ACCESS_TOKEN not configured");

  try {
    // Search for user by username
    const searchResponse = await fetch(
      `https://graph.instagram.com/ig_hashtag_search?` +
      `user_id=${process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID}&` +
      `fields=id,name&` +
      `access_token=${accessToken}`,
      { method: "GET" }
    );

    if (!searchResponse.ok) {
      if (searchResponse.status === 404) {
        throw new Error(`Instagram account @${handle} not found`);
      }
      throw new Error(`Instagram API error ${searchResponse.status}`);
    }

    // For MVP: use business account ID directly if configured
    // In production: implement full account lookup
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    if (!accountId) {
      throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID not configured");
    }

    // Fetch user insights
    const userResponse = await fetch(
      `https://graph.instagram.com/${accountId}?` +
      `fields=id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url&` +
      `access_token=${accessToken}`
    );

    if (!userResponse.ok) {
      throw new Error(`Instagram API error ${userResponse.status}`);
    }

    const userData = await userResponse.json();
    return { ...userData, handle: userData.username };
  } catch (err) {
    console.error("[Instagram Fetcher] User fetch failed:", err.message);
    throw err;
  }
}

async function getInstagramRecentPosts(accountId, maxResults = 50) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) throw new Error("INSTAGRAM_ACCESS_TOKEN not configured");

  try {
    const response = await fetch(
      `https://graph.instagram.com/${accountId}/media?` +
      `fields=id,caption,media_type,timestamp,like_count,comments_count,insights.metric(engagement,impressions,reach)&` +
      `limit=${maxResults}&` +
      `access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`Instagram API error ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.error("[Instagram Fetcher] Posts fetch failed:", err.message);
    throw err;
  }
}

async function analyzeInstagramAccount(handle) {
  console.log(`[Instagram Fetcher] Analyzing @${handle}...`);

  // Fetch user and posts
  const user = await getInstagramUserData(handle);
  const posts = await getInstagramRecentPosts(user.id);

  if (!posts || posts.length === 0) {
    throw new Error(`No recent posts found for @${handle}`);
  }

  // Calculate metrics
  const metrics = calculateMetrics(user, posts);

  return {
    handle: user.username,
    user_id: user.id,
    follower_count: user.followers_count,
    following_count: user.follows_count,
    post_count: user.media_count,
    biography: user.biography,
    website: user.website,
    recent_posts: posts,
    analysis: metrics,
  };
}

function calculateMetrics(user, posts) {
  const postCount = posts.length;
  if (postCount === 0) return {};

  // Engagement metrics
  let totalLikes = 0;
  let totalComments = 0;
  let totalEngagement = 0;
  let totalImpressions = 0;
  let totalReach = 0;
  let carouselPosts = 0;
  let videosPosts = 0;
  let averageCaptionLength = 0;

  posts.forEach((post) => {
    totalLikes += post.like_count || 0;
    totalComments += post.comments_count || 0;
    totalEngagement += (post.like_count || 0) + (post.comments_count || 0);

    // Extract insights data if available
    if (post.insights) {
      post.insights.data.forEach((insight) => {
        if (insight.name === "impressions") totalImpressions += insight.values?.[0]?.value || 0;
        if (insight.name === "reach") totalReach += insight.values?.[0]?.value || 0;
        if (insight.name === "engagement") totalEngagement += insight.values?.[0]?.value || 0;
      });
    }

    if (post.media_type === "CAROUSEL") carouselPosts++;
    if (post.media_type === "VIDEO") videosPosts++;
    if (post.caption) averageCaptionLength += post.caption.length;
  });

  averageCaptionLength = Math.round(averageCaptionLength / postCount);
  const avgEngagementPerPost = Math.round(totalEngagement / postCount);
  const avgLikesPerPost = Math.round(totalLikes / postCount);
  const engagementRate =
    user.followers_count > 0
      ? (totalEngagement / (postCount * user.followers_count) * 100).toFixed(2)
      : 0;

  // Posting frequency (estimate from available posts)
  const dateRange = calculateDateRange(posts);
  const postsPerDay = (postCount / Math.max(1, dateRange.days)).toFixed(2);
  const postsPerWeek = (postCount / (Math.max(1, dateRange.days) / 7)).toFixed(1);

  return {
    posting_frequency: {
      posts_analyzed: postCount,
      posts_per_day: parseFloat(postsPerDay),
      posts_per_week: parseFloat(postsPerWeek),
      date_range_days: dateRange.days,
      last_post: dateRange.newest,
      oldest_post: dateRange.oldest,
    },
    engagement: {
      total_likes: totalLikes,
      total_comments: totalComments,
      total_engagement: totalEngagement,
      avg_engagement_per_post: avgEngagementPerPost,
      avg_likes_per_post: avgLikesPerPost,
      engagement_rate_percent: parseFloat(engagementRate),
    },
    reach: {
      total_impressions: totalImpressions,
      total_reach: totalReach,
      avg_impressions_per_post: totalImpressions > 0 ? Math.round(totalImpressions / postCount) : 0,
      avg_reach_per_post: totalReach > 0 ? Math.round(totalReach / postCount) : 0,
    },
    content: {
      avg_caption_length: averageCaptionLength,
      carousel_posts: carouselPosts,
      video_posts: videosPosts,
      static_posts: postCount - carouselPosts - videosPosts,
      video_rate_percent: ((videosPosts / postCount) * 100).toFixed(1),
    },
    audience: {
      followers: user.followers_count,
      following: user.follows_count,
      follower_ratio: (user.followers_count / (user.follows_count || 1)).toFixed(2),
    },
  };
}

function calculateDateRange(posts) {
  if (!posts || posts.length === 0) {
    return { days: 0, newest: null, oldest: null };
  }

  const dates = posts.map((p) => new Date(p.timestamp));
  const newest = new Date(Math.max(...dates));
  const oldest = new Date(Math.min(...dates));
  const daysDiff = (newest - oldest) / (1000 * 60 * 60 * 24);

  return {
    days: Math.max(1, Math.round(daysDiff)),
    newest: newest.toISOString().split("T")[0],
    oldest: oldest.toISOString().split("T")[0],
  };
}

module.exports = {
  analyzeInstagramAccount,
  getInstagramUserData,
  getInstagramRecentPosts,
  calculateMetrics,
};
