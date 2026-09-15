// Social Media API Client
// Handles authentication and data fetching from Instagram, TikTok, Twitter, Facebook, LinkedIn
// Each method returns structured profile data for audit analysis

class SocialMediaClient {
  constructor(apiKeys = {}) {
    this.instagramToken = apiKeys.instagram;
    this.tiktokToken = apiKeys.tiktok;
    this.twitterToken = apiKeys.twitter;
    this.facebookToken = apiKeys.facebook;
    this.linkedinToken = apiKeys.linkedin;
  }

  // Main entry point: fetch profile data by handle and platform
  async getProfileData(handle, platform) {
    switch (platform) {
      case "instagram":
        return this.getInstagramProfile(handle);
      case "tiktok":
        return this.getTikTokProfile(handle);
      case "x":
      case "twitter":
        return this.getTwitterProfile(handle);
      case "facebook":
        return this.getFacebookProfile(handle);
      case "linkedin":
        return this.getLinkedInProfile(handle);
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  // Instagram Graph API
  // Requires: Business account, Meta app, OAuth token with instagram_business_profile scope
  // Docs: https://developers.facebook.com/docs/instagram-graph-api
  async getInstagramProfile(handle) {
    console.log(`Fetching Instagram profile: ${handle}`);

    // TODO: Implement
    // Steps:
    // 1. Search for user by username: GET /ig-hashtag-search?user_id=...&fields=id,name
    // 2. Get user profile: GET /{ig_user_id}?fields=id,username,name,biography,followers_count,follows_count,media_count,ig_id
    // 3. Get recent media: GET /{ig_user_id}/media?fields=id,caption,like_count,comments_count,timestamp
    // 4. Parse and return structured data

    return {
      platform: "instagram",
      handle: handle,
      followers: 0,
      following: 0,
      postCount: 0,
      bio: "",
      recentPosts: [], // Array of { caption, likes, comments, date }
    };
  }

  // TikTok API
  // Requires: TikTok developer account, API key, OAuth token
  // Docs: https://developers.tiktok.com/doc/research-api-specs
  async getTikTokProfile(handle) {
    console.log(`Fetching TikTok profile: ${handle}`);

    // TODO: Implement
    // Steps:
    // 1. Get user info: GET /v1/user/info?username={handle}
    // 2. Get user videos: GET /v1/user/{user_id}/videos
    // 3. Get engagement metrics for each video
    // 4. Parse and return structured data

    return {
      platform: "tiktok",
      handle: handle,
      followers: 0,
      following: 0,
      postCount: 0,
      bio: "",
      recentPosts: [],
    };
  }

  // Twitter/X API v2
  // Requires: Twitter API v2 bearer token
  // Docs: https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-by-username-username
  async getTwitterProfile(handle) {
    console.log(`Fetching Twitter/X profile: ${handle}`);

    if (!this.twitterToken) {
      throw new Error("Twitter bearer token not configured");
    }

    try {
      // Step 1: Lookup user by username
      const userResponse = await fetch(
        `https://api.twitter.com/2/users/by/username/${handle}?user.fields=public_metrics,description,created_at`,
        {
          headers: { Authorization: `Bearer ${this.twitterToken}` },
        }
      );

      if (!userResponse.ok) {
        const error = await userResponse.json();
        if (userResponse.status === 404) {
          throw new Error(`Twitter user not found: ${handle}`);
        }
        throw new Error(`Twitter API error: ${error.detail || userResponse.statusText}`);
      }

      const userData = await userResponse.json();
      const user = userData.data;

      if (!user) {
        throw new Error(`No user data returned for ${handle}`);
      }

      // Step 2: Get user's recent tweets
      const tweetsResponse = await fetch(
        `https://api.twitter.com/2/users/${user.id}/tweets?max_results=10&tweet.fields=public_metrics,created_at&expansions=author_id`,
        {
          headers: { Authorization: `Bearer ${this.twitterToken}` },
        }
      );

      if (!tweetsResponse.ok) {
        console.warn(`Could not fetch tweets for ${handle}, using empty list`);
      }

      const tweetsData = await tweetsResponse.json();
      const tweets = tweetsData.data || [];

      // Step 3: Parse and return structured data
      return {
        platform: "x",
        handle: handle,
        followers: user.public_metrics.followers_count,
        following: user.public_metrics.following_count,
        postCount: user.public_metrics.tweet_count,
        bio: user.description || "",
        recentPosts: tweets.map((tweet) => ({
          caption: tweet.text,
          likes: tweet.public_metrics.like_count,
          comments: tweet.public_metrics.reply_count,
          date: new Date(tweet.created_at).toISOString().split("T")[0],
        })),
      };
    } catch (err) {
      console.error(`Twitter API error for ${handle}:`, err.message);
      throw err;
    }
  }

  // Facebook Graph API
  // Requires: Facebook app, OAuth token with public_profile scope
  // Docs: https://developers.facebook.com/docs/facebook-login/userdata
  async getFacebookProfile(handle) {
    console.log(`Fetching Facebook profile: ${handle}`);

    // TODO: Implement
    // Steps:
    // 1. Search for page: GET /?q={handle}&type=page
    // 2. Get page details: GET /{page_id}?fields=username,name,followers_count,likes_count,picture
    // 3. Get feed/posts: GET /{page_id}/feed
    // 4. Parse and return structured data

    return {
      platform: "facebook",
      handle: handle,
      followers: 0,
      following: 0,
      postCount: 0,
      bio: "",
      recentPosts: [],
    };
  }

  // LinkedIn API
  // Requires: LinkedIn app, OAuth token with openid profile email scope
  // Docs: https://learn.microsoft.com/en-us/linkedin/shared/integrations/integrations-home
  async getLinkedInProfile(handle) {
    console.log(`Fetching LinkedIn profile: ${handle}`);

    // TODO: Implement
    // Steps:
    // 1. Search for profile: GET /v2/me (if authenticated as that user)
    // 2. Get profile data: GET /v2/me?projection=(id,firstName,lastName,profilePicture(displayImage))
    // 3. Get posts: GET /v2/me/posts
    // 4. Parse and return structured data

    return {
      platform: "linkedin",
      handle: handle,
      followers: 0,
      following: 0,
      postCount: 0,
      bio: "",
      recentPosts: [],
    };
  }

  // Helper: Validate platform API is configured
  isConfigured(platform) {
    const tokenMap = {
      instagram: this.instagramToken,
      tiktok: this.tiktokToken,
      x: this.twitterToken,
      twitter: this.twitterToken,
      facebook: this.facebookToken,
      linkedin: this.linkedinToken,
    };
    return !!tokenMap[platform];
  }

  // Helper: Get all configured platforms
  getConfiguredPlatforms() {
    return Object.entries({
      instagram: this.instagramToken,
      tiktok: this.tiktokToken,
      x: this.twitterToken,
      facebook: this.facebookToken,
      linkedin: this.linkedinToken,
    })
      .filter(([_, token]) => !!token)
      .map(([platform, _]) => platform);
  }
}

module.exports = SocialMediaClient;
