# Phase 2: Implementation Guide

**Status:** Scaffolding complete. Ready for implementation.

This guide outlines what's been provided and what YOU need to implement.

---

## WHAT'S PROVIDED (Scaffolding)

### 1. Social Media API Client Skeleton
**File:** `server/services/socialMediaClient.js`

Provides a `SocialMediaClient` class with method stubs for each platform:
- `getInstagramProfile(handle)` — stub
- `getTikTokProfile(handle)` — stub
- `getTwitterProfile(handle)` — stub
- `getFacebookProfile(handle)` — stub
- `getLinkedInProfile(handle)` — stub

Each returns the required data structure:
```javascript
{
  platform: "instagram",
  handle: "@username",
  followers: 0,
  following: 0,
  postCount: 0,
  bio: "",
  recentPosts: [
    { caption: "...", likes: 0, comments: 0, date: "2026-09-15" },
    ...
  ]
}
```

**What You Need to Implement:**
1. Replace each `TODO: Implement` stub with actual API calls
2. Each method should:
   - Use the appropriate platform API (see docs links in comments)
   - Fetch real profile data (followers, posts, engagement)
   - Parse response into the required structure
   - Handle errors (invalid handle, API failures, rate limits)
   - Return the data structure above

**Recommended order:**
1. Start with Twitter (simplest API)
2. Move to Instagram (most popular, more complex)
3. Add TikTok (requires special approval)
4. Add Facebook/LinkedIn (lower priority)

---

### 2. JWT Authentication
**File:** `server/middleware/jwt.js`

Provides ready-to-use JWT functions:
- `generateToken(userId, tier)` — Create token for user
- `verifyToken(token)` — Verify and decode token
- `authMiddleware` — Express middleware for protected routes
- `requireTier(tier)` — Enforce minimum tier (free → growth → business)
- `optionalAuth` — Attach user if token present, but don't require

**How to use in your routes:**
```javascript
const { authMiddleware, requireTier } = require("../middleware/jwt");

// Protected route (any authenticated user)
router.get("/dashboard/profiles", authMiddleware, (req, res) => {
  const userId = req.user.id;
  // ...
});

// Tier-restricted route (Tier1+ only)
router.post("/dashboard/calendar", authMiddleware, requireTier("growth"), (req, res) => {
  // Only growth or business tier users can access
});
```

**What You Need to Implement:**
1. Set `JWT_SECRET` environment variable (long random string)
2. Create login/register endpoints that call `generateToken()`
3. Integrate `authMiddleware` into protected routes in `growth-engine.js`
4. Wire up tier checks for Tier1/Tier2 features

---

### 3. Database Initialization
**File:** `server/db/init.js`

Provides a `Database` class that:
- Initializes SQLite database
- Runs schema from `server/db/schema.sql`
- Provides helper methods (createUser, createProfile, createJob, etc.)
- Can be easily migrated to Postgres

**How to use:**
```javascript
const Database = require("./db/init");

const db = new Database("./server/data/convergence.db");
await db.init();

// Use helper methods
const user = await db.createUser("user@example.com", passwordHash, "free");
const profile = await db.createProfile(user.id, "@handle", "instagram", "fitness");

// Or raw queries
const rows = await db.all("SELECT * FROM users");
```

**What You Need to Implement:**
1. Call `db.init()` on server startup
2. Implement remaining query helpers (getAuditsByProfile, getContentCalendar, etc.)
3. Update growth-engine.js routes to use these helpers
4. Add database transaction support (for multi-step operations)

---

### 4. Environment Configuration
**File:** `.env.example`

Template for all environment variables:
- Server config (PORT, NODE_ENV)
- Database (DB_PATH or DB_HOST for Postgres)
- JWT secret
- Social media API keys
- LLM API keys
- Stripe keys
- Email/SMTP config

**What You Need to Do:**
1. Copy `.env.example` to `.env`
2. Fill in your actual API keys (or use placeholders for MVP)
3. Generate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Configure social media API keys (see platform API docs)

---

### 5. End-to-End Test Harness
**File:** `server/tests/e2e.test.js`

Automated test script that:
- Submits audit requests for multiple social profiles
- Polls job status until complete
- Validates results structure
- Reports pass/fail for each test

**How to run:**
```bash
npm test
```

**What the test does:**
1. Submits Instagram audit
2. Polls job status every 2 seconds
3. Waits up to 60 seconds for results
4. Validates response structure
5. Repeats for TikTok, Twitter
6. Reports pass/fail

---

## IMPLEMENTATION CHECKLIST

### Step 1: Environment & Database
- [ ] Copy `.env.example` → `.env`
- [ ] Fill in JWT_SECRET and LLM API keys
- [ ] Run database initialization on server startup
- [ ] Verify database is created at `server/data/convergence.db`

### Step 2: Social Media API Clients
- [ ] Get API credentials for each platform:
  - [ ] Instagram: Create Meta/Facebook app, get business token
  - [ ] TikTok: Apply for API access
  - [ ] Twitter: Get v2 API key
  - [ ] Facebook: Create app, get access token
  - [ ] LinkedIn: Register app, get credentials
- [ ] Implement `getTwitterProfile()` (start here)
- [ ] Implement `getInstagramProfile()`
- [ ] Implement `getTikTokProfile()`
- [ ] Implement `getFacebookProfile()`
- [ ] Implement `getLinkedInProfile()`
- [ ] Test each implementation locally

### Step 3: Authentication
- [ ] Wire JWT middleware into `growth-engine.js`
- [ ] Create login endpoint (POST /auth/login)
- [ ] Create register endpoint (POST /auth/register)
- [ ] Test token generation and verification
- [ ] Implement tier checks on protected endpoints

### Step 4: Wire Services Together
- [ ] Update `server.js` to initialize Database
- [ ] Update `server.js` to wire Job Queue
- [ ] Update `jobQueue.js` to instantiate socialMediaClient
- [ ] Update `auditAnalyzer.js` to call socialMediaClient.getProfileData()
- [ ] Update `growth-engine.js` to use database helpers
- [ ] Wire `requireAuth` middleware into protected routes

### Step 5: Testing
- [ ] Run e2e test: `npm test`
- [ ] Submit audit for real social profile
- [ ] Wait for job to complete
- [ ] Validate results structure
- [ ] Check database for stored audit

### Step 6: Production Prep
- [ ] Upgrade database to Postgres
- [ ] Upgrade job queue to Bull + Redis
- [ ] Add rate limiting
- [ ] Add error logging
- [ ] Add monitoring

---

## KEY FILES TO MODIFY

**`server/server.js`** (main server)
- Add database initialization
- Wire job queue
- Register growth-engine routes
- Add error handling

**`server/services/socialMediaClient.js`**
- Implement platform-specific methods
- Handle errors and retries
- Cache results if applicable

**`server/services/auditAnalyzer.js`**
- Call socialMediaClient.getProfileData()
- Actually parse results and generate scores
- Currently returns placeholder scores

**`server/routes/growth-engine.js`**
- Wire JWT middleware to routes
- Implement Tier1/Tier2 endpoints
- Connect to database and job queue

**`server/middleware/jwt.js`**
- Already complete, just integrate into routes

---

## TESTING LOCALLY

### 1. Setup
```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

### 2. Start Server
```bash
npm start
# Server runs on http://localhost:3001
```

### 3. Submit Audit (curl)
```bash
curl -X POST http://localhost:3001/api/growth-engine/v1/evaluate/social-snapshot \
  -H "Content-Type: application/json" \
  -d '{"handle":"@instagram_username","platform":"instagram","category":"fitness","email":"test@example.com"}'
```

Response:
```json
{
  "jobId": "uuid-here",
  "status": "queued",
  "estimatedWaitSeconds": 10
}
```

### 4. Poll Job Status
```bash
curl http://localhost:3001/api/growth-engine/v1/job/uuid-here
```

Repeat until status is `complete`.

### 5. Run Automated Tests
```bash
npm test
```

---

## COMMON PITFALLS

1. **API Rate Limits:** Each platform has different rate limits. Implement exponential backoff and caching.
2. **Auth Flows:** Each platform uses different auth (OAuth 2.0, bearer tokens, etc.). Read docs carefully.
3. **Data Parsing:** Platform APIs return different structures. Normalize to required format.
4. **Error Handling:** Network failures, invalid handles, API changes. Log thoroughly, fail gracefully.
5. **Testing:** Test with real profiles early. Mock data doesn't catch platform-specific issues.

---

## DOCUMENTATION LINKS

- **Instagram Graph API:** https://developers.facebook.com/docs/instagram-graph-api
- **TikTok API:** https://developers.tiktok.com/doc/research-api-specs
- **Twitter API v2:** https://developer.twitter.com/en/docs/twitter-api
- **Facebook Graph API:** https://developers.facebook.com/docs/graph-api
- **LinkedIn API:** https://learn.microsoft.com/en-us/linkedin/shared/integrations/integrations-home

---

## NEXT STEPS

1. Review this guide
2. Start with Twitter API (simplest)
3. Test with real social profiles
4. Move to Instagram
5. Add TikTok (requires approval)
6. Integrate Convergence for scoring
7. Hand off to Haron for UI

Questions? Check `PRODUCT_SPEC.md` and `INTEGRATION.md` for more context.
