# Scalecraft API Keys Setup Guide

This guide walks you through acquiring and configuring all necessary API keys for Instagram and TikTok evaluation.

---

## Instagram API Keys

### Prerequisites
- A Facebook/Meta Developer account (free)
- An Instagram business account (free, convert at instagram.com/settings/account)

### Step 1: Create a Meta App

1. Go to https://developers.facebook.com/
2. Click **"Create App"** (top right)
3. Select **"Consumer"** as the app type
4. Fill in:
   - **App Name**: "Scalecraft" (or whatever you want)
   - **App Purpose**: Select any option (e.g., "Social Media")
   - **App Contact Email**: your email
5. Click **"Create App"**
6. **Save this:** Copy your **App ID** from App Dashboard → Settings → Basic

### Step 2: Set Up Instagram Basic Display

1. In your app dashboard, go to **Products** (left sidebar)
2. Click **"+ Add Product"**
3. Search for **"Instagram Basic Display"** and click **"Set Up"**
4. Go to **Instagram Basic Display** → **Settings**
5. Under **Instagram Permissions**, make sure these are listed:
   - `instagram_business_content_publishing`
   - `instagram_business_basic`

### Step 3: Create a Test User

1. Go to **Roles** → **Test Users** (left sidebar under Instagram Basic Display)
2. Click **"+ Add Test User"**
3. Select your Instagram business account
4. Click **"Add"** and accept the invitation on Instagram

### Step 4: Get Your Access Token

1. Go back to **Instagram Basic Display** → **Tools**
2. Find your test user and click **"Generate Token"**
3. A long token string appears — **copy this immediately** (it expires after a short time)
4. **Save as:** `INSTAGRAM_ACCESS_TOKEN`

### Step 5: Add to Railway Environment

1. Go to your Railway project: https://railway.app/
2. Go to **Variables** (in your project)
3. Add new variable:
   - **Name:** `INSTAGRAM_ACCESS_TOKEN`
   - **Value:** paste the token from Step 4
4. Click **"Deploy"**

---

## TikTok API Keys (via Apify)

Scalecraft currently uses **Apify** to scrape TikTok (direct TikTok API doesn't provide post-level metrics easily).

### Prerequisites
- An Apify account (free tier available)
- A small amount of Apify credits ($5-10 for testing)

### Step 1: Create an Apify Account

1. Go to https://apify.com/
2. Click **"Sign Up"** (top right)
3. Create account with email/password
4. Verify your email

### Step 2: Get Your Apify API Token

1. Go to **Settings** (avatar → Settings)
2. Click **"API tokens"** (left sidebar)
3. Click **"Create token"**
4. Name it: "Scalecraft"
5. Copy the token
6. **Save as:** `APIFY_TOKEN`

### Step 3: Fund Your Apify Account (Optional but Recommended)

1. Go to **Billing** (Settings → Billing)
2. Add a payment method
3. Top up with at least $5 for testing

*Why?* Free tier has limited actor runs. $5 gets you ~500 TikTok profile fetches.

### Step 4: Add to Railway Environment

1. Go to Railway project → **Variables**
2. Add new variable:
   - **Name:** `APIFY_TOKEN`
   - **Value:** paste your Apify token
3. Click **"Deploy"**

---

## Environment Variables Summary

Your Railway project should have these variables set:

```
INSTAGRAM_ACCESS_TOKEN = <long token from Instagram>
APIFY_TOKEN = <token from Apify>
```

*(Other required vars like JWT_SECRET, DATABASE_URL, etc. should already be set)*

---

## Testing Your Setup

Once keys are added to Railway:

1. Go to https://scalecraft-demo.vercel.app/
2. Enter a real Instagram handle (e.g., `@yourinstagramname`)
3. Select "Instagram" platform
4. Select your niche
5. Enter your email and submit

**What you should see:**
- Report loads in ~40-60 seconds
- Follower count matches your real Instagram followers
- Post data is from your actual recent posts (not mock data)
- Dimension scores are based on real engagement

**If you still see fake data:**
- Check Railway logs: go to **Deployments** → latest deployment → **Logs**
- Look for errors mentioning Instagram API or Apify
- If there's an error, the token may be invalid or expired

---

## Troubleshooting

### "Could not fetch Instagram data"
- Token may have expired (they last ~60 days)
- Solution: Go back to Instagram Basic Display → Tools → generate a new token
- Update `INSTAGRAM_ACCESS_TOKEN` in Railway and redeploy

### "Apify token invalid"
- Token may be expired or wrong
- Solution: Go to Apify Settings → API tokens → create a new one
- Update `APIFY_TOKEN` in Railway and redeploy

### Report still shows fake followers
- Keys are set but backend isn't using them
- Go to Railway **Logs** and search for "Instagram fetch" or "Apify"
- If you see errors, report them

### "Not enough Apify credits"
- You've used up your free tier
- Solution: Add payment method in Apify billing and top up

---

## Notes

- **Instagram tokens expire** after ~60 days. You'll need to refresh them periodically.
- **Apify is paid after free tier**. Monitor usage at https://apify.com/billing
- Both services are needed for the free tier (tier 0) to show real data
- TikTok via Apify is slower (~30-40s per account) than Instagram (~5-10s)

---

Questions? Check Railway logs first — they'll tell you exactly what's wrong.
