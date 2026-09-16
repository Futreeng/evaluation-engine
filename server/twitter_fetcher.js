/**
 * Twitter/X Data Fetcher
 * Fetches real user data and metrics for social media evaluation
 */

async function getTwitterUserData(handle) {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) throw new Error("TWITTER_BEARER_TOKEN not configured");

  try {
    // Get user by username
    const userResponse = await fetch(
      `https://api.twitter.com/2/users/by/username/${handle}?user.fields=public_metrics,created_at,description`,
      {
        headers: { Authorization: `Bearer ${bearerToken}` },
      }
    );

    if (!userResponse.ok) {
      if (userResponse.status === 404) {
        throw new Error(`Twitter handle @${handle} not found`);
      }
      throw new Error(`Twitter API error ${userResponse.status}`);
    }

    const userData = await userResponse.json();
    return userData.data;
  } catch (err) {
    console.error("[Twitter Fetcher] User fetch failed:", err.message);
    throw err;
  }
}

async function getTwitterRecentTweets(userId, maxResults = 50) {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) throw new Error("TWITTER_BEARER_TOKEN not configured");

  try {
    const response = await fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?` +
      `max_results=${maxResults}&` +
      `tweet.fields=public_metrics,created_at,author_id&` +
      `expansions=author_id`,
      {
        headers: { Authorization: `Bearer ${bearerToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Twitter API error ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.error("[Twitter Fetcher] Tweets fetch failed:", err.message);
    throw err;
  }
}

async function analyzeTwitterAccount(handle) {
  console.log(`[Twitter Fetcher] Analyzing @${handle}...`);

  // Fetch user and tweets
  const user = await getTwitterUserData(handle);
  const tweets = await getTwitterRecentTweets(user.id);

  if (!tweets || tweets.length === 0) {
    throw new Error(`No recent tweets found for @${handle}`);
  }

  // Calculate metrics
  const metrics = calculateMetrics(user, tweets);

  return {
    handle: user.username,
    user_id: user.id,
    follower_count: user.public_metrics.followers_count,
    following_count: user.public_metrics.following_count,
    tweet_count: user.public_metrics.tweet_count,
    description: user.description,
    created_at: user.created_at,
    recent_tweets: tweets,
    analysis: metrics,
  };
}

function calculateMetrics(user, tweets) {
  const tweetCount = tweets.length;
  if (tweetCount === 0) return {};

  // Engagement metrics
  let totalEngagement = 0;
  let totalReach = 0;
  let postsWithVideo = 0;
  let averageLength = 0;

  tweets.forEach((tweet) => {
    const metrics = tweet.public_metrics;
    totalEngagement += metrics.like_count + metrics.reply_count + metrics.retweet_count;
    totalReach += metrics.impression_count || 0;
    averageLength += tweet.text.length;
  });

  averageLength = Math.round(averageLength / tweetCount);
  const avgEngagementPerTweet = Math.round(totalEngagement / tweetCount);
  const avgReachPerTweet = Math.round(totalReach / tweetCount);
  const engagementRate =
    user.public_metrics.followers_count > 0
      ? (totalEngagement / (tweetCount * user.public_metrics.followers_count) * 100).toFixed(2)
      : 0;

  // Posting frequency
  const dateRange = calculateDateRange(tweets);
  const postsPerDay = (tweetCount / dateRange.days).toFixed(2);
  const postsPerWeek = (tweetCount / (dateRange.days / 7)).toFixed(1);

  return {
    posting_frequency: {
      posts_analyzed: tweetCount,
      posts_per_day: parseFloat(postsPerDay),
      posts_per_week: parseFloat(postsPerWeek),
      date_range_days: dateRange.days,
      last_tweet: dateRange.newest,
      oldest_tweet: dateRange.oldest,
    },
    engagement: {
      total_engagements: totalEngagement,
      avg_engagement_per_tweet: avgEngagementPerTweet,
      engagement_rate_percent: parseFloat(engagementRate),
    },
    reach: {
      total_reach: totalReach,
      avg_reach_per_tweet: avgReachPerTweet,
    },
    content: {
      avg_tweet_length: averageLength,
      total_replies: tweets.reduce((sum, t) => sum + t.public_metrics.reply_count, 0),
      total_retweets: tweets.reduce((sum, t) => sum + t.public_metrics.retweet_count, 0),
      total_likes: tweets.reduce((sum, t) => sum + t.public_metrics.like_count, 0),
    },
    audience: {
      followers: user.public_metrics.followers_count,
      following: user.public_metrics.following_count,
      follower_ratio: (user.public_metrics.followers_count / (user.public_metrics.following_count || 1)).toFixed(2),
    },
  };
}

function calculateDateRange(tweets) {
  if (!tweets || tweets.length === 0) {
    return { days: 0, newest: null, oldest: null };
  }

  const dates = tweets.map((t) => new Date(t.created_at));
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
  analyzeTwitterAccount,
  getTwitterUserData,
  getTwitterRecentTweets,
  calculateMetrics,
};
