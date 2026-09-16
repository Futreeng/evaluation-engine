# futureEng Growth Engine — Context Handoff

**Use this to start a fresh chat and maintain direction. Paste this entire document.**

---

## Business Context

**Company:** futureEng LLC (legitimate SaaS startup)  
**Product:** Social media growth auditing engine with AI analysis  
**Team:** 
- You = Backend dev (logic, functionality, AI integrations, APIs, data)
- Haron = Frontend dev (UI, UX, customer-facing presentation)

**Status:** Auth system + Instagram fetcher complete; mock Stripe ready; awaiting Haron's UI

**Current Stage:** Backend ready for multi-platform evaluations and subscription tiers. Haron builds landing page + signup/login + dashboard

---

## What's Built (Production Ready)

### Backend System
- **Real Twitter/X data fetching** (`server/twitter_fetcher.js`)
  - Fetches actual tweets, engagement metrics, posting frequency
  - Calculates real benchmarks vs mock data
  - Used in `evaluateTier0()` function

- **4-Way LLM Fallback** (in `growth_engine_evaluator.js`)
  - Primary: Claude (costs credits, often exhausted)
  - Secondary: Gemini (free, quota limited)
  - Tertiary: Groq (free, most reliable)
  - Quaternary: OpenAI (free trial credits, then paid)
  - All fall through automatically; returns narrative report when one succeeds

- **Async Job Processing** (`server/growth_engine_job_queue.js`)
  - Fire-and-forget evaluation queue
  - Database-backed (no external Redis/RabbitMQ)
  - Polls every 2 seconds for queued jobs
  - Auto-saves reports as markdown to `/reports` folder

- **Narrative Reports** (not scores)
  - LLM generates client-friendly narrative instead of raw metrics
  - Covers: strengths, biggest opportunity, 30-60-90 action plan
  - Saved as markdown for Haron to display

- **Database** (`server/growth_engine_db.js`)
  - sql.js (pure JavaScript, file-backed at `server/data/growth_engine.db`)
  - Tables: users (NEW - being added), jobs, reports, entitlements, tier_history

### API Routes (in `server/routes/growth-engine.js`)
- `POST /evaluate/social-snapshot` — Queue evaluation
- `GET /job/:jobId` — Poll job status
- `GET /reports/:reportId` — Fetch report
- Currently no auth (demo mode); auth middleware being added

### Frontend Reference
- `TEAM_GUIDE.md` — For Haron; explains API contract, report format, status values
- Real reports saved to `/reports` folder as markdown examples

---

## Current Status: Multi-Tier Foundation Complete

### ✅ Completed This Session

**Auth/Accounts System:**
1. ✅ Users table + functions (createUser, getUserByEmail, getUserById, updateUserPassword)
2. ✅ Auth module (signup, login, generateJWT, verifyJWT) with bcryptjs password hashing
3. ✅ Auth endpoints (POST /auth/signup, POST /auth/login, GET /auth/me)
4. ✅ Account endpoints (GET /account/profile, GET /account/subscription-status, GET /account/reports)
5. ✅ JWT middleware protecting evaluation + account routes
6. ✅ Tokens expire in 7 days; new users auto-enrolled in free 'social_snapshot' tier

**Multi-Platform Support:**
- ✅ Instagram fetcher (`server/instagram_fetcher.js`) - mirrors Twitter pattern
- ✅ Evaluator now supports: `platform: "x"` / `"twitter"` / `"instagram"` / `"ig"`
- Ready to add TikTok, LinkedIn (same pattern)

**Billing/Subscriptions:**
- ✅ Mock Stripe integration in `growth_engine_billing.js`
- ✅ Tracks subscription state (subscriptionId, tier, billingCycle, currentPeriodEnd)
- ✅ createSubscription() with mock payment processing
- ✅ getSubscription() + cancelSubscription() for subscription management
- ✅ Production hook ready: _createStripeSubscription() awaits real Stripe API key

### 🔄 Next Immediate Steps

1. **Haron builds UI** (parallel with any backend work)
   - Landing page (describe product)
   - Signup/login pages
   - Dashboard (show user reports + tier status)
   - Evaluation form

2. **Real Stripe integration** (after UI shows subscription flow)
   - Wire up actual payment processing
   - Customer portal for subscription management
   - Payment webhook handling

3. **Tier enforcement** (backend)
   - Limit free tier to X evaluations/month
   - Check entitlements before allowing evaluation

---

## Environment Setup

**`.env` file** (`server` folder):
```
# LLM APIs (4-way fallback)
CLAUDE_API_KEY=sk-ant-...
GEMINI_API_KEY=AQ.Ab8...
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-proj-...

# Social Media APIs
TWITTER_BEARER_TOKEN=AAA...
INSTAGRAM_ACCESS_TOKEN=IGQVJ...
INSTAGRAM_BUSINESS_ACCOUNT_ID=17...

# Auth & Billing
JWT_SECRET=ca4677fab...  (already exists, don't change)
STRIPE_API_KEY=sk_live_... (add when ready for real payments)

# Server
PORT=3005
```

**Running the backend:**
```bash
cd server
npm start
```

---

## Key Files to Know

### Database
- `server/growth_engine_db.js` — All DB operations
  - User functions: `createUser()`, `getUserByEmail()`, `getUserById()`, `updateUserPassword()`
  - Job/report functions: existing
  - Entitlements tracking: `getOrCreateEntitlement()`, `upgradeTier()`, `getTierHistory()`

### Auth
- `server/auth.js` — User registration & login
  - `signup(email, password, companyName)` → returns token + user
  - `login(email, password)` → returns token + user
  - `generateJWT(userId, email)` → 7-day tokens
  - `verifyJWT(token)` → validates token
  - Uses bcryptjs for password hashing

### Social Data Fetchers
- `server/twitter_fetcher.js` — Twitter/X data (established)
- `server/instagram_fetcher.js` — Instagram data (new, mirrors Twitter pattern)
- Both calculate: posting_frequency, engagement, reach, content metrics, audience

### Evaluator
- `server/growth_engine_evaluator.js` — Platform routing + LLM analysis
  - `getRealPostData(handle, platform, category)` routes to correct fetcher
  - Supports: `platform: "twitter"` or `"x"` or `"instagram"` or `"ig"`
  - Returns analysis-friendly data format

### Billing
- `server/growth_engine_billing.js` — Subscription management
  - `createSubscription(accountId, tier, stripeCustomerId, billingCycle)` with mock payment processing
  - `getSubscription(accountId)` — lookup active subscription
  - `cancelSubscription(subscriptionId)` — downgrade to free
  - Tiers: social_snapshot (free), growth_plan ($39), business_evaluator ($99), agency ($249)
  - Mock mode for development; production hook ready for real Stripe

### Routes
- `server/routes/growth-engine.js` — All API endpoints
  - Auth: `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
  - Account: `GET /account/profile`, `GET /account/subscription-status`, `GET /account/reports`
  - Evaluation: `POST /evaluate/social-snapshot` (requires JWT)
  - Billing: `POST /billing/subscribe`, `POST /billing/check-access`, `GET /billing/pricing`

---

## Database Schema (Current + New)

**Users table (being added):**
```sql
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

**Jobs table (existing, already connects to user via account_id):**
- account_id → user_id after auth added

**Reports table (existing):**
- account_id → user_id after auth added

**Entitlements table (existing, tracks subscription tier):**
- account_id → user_id
- current_tier: 'social_snapshot' (free), 'growth_plan' ($39), 'business_evaluator' ($99), 'enterprise' ($249+)

---

## Technical Decisions Made

1. **sql.js for database** — No external DB setup needed for MVP
2. **JWT for auth** — Stateless, scales easily
3. **Markdown for reports** — Human-readable, version-controllable, Haron can display as formatted text
4. **4-way LLM fallback** — Reliability + cost optimization (don't waste money on expensive LLM if cheap one works)
5. **Fire-and-forget jobs** — Non-blocking API responses, all evaluation happens async in background
6. **Twitter only (for now)** — Instagram/TikTok follow same pattern, added later
7. **No Stripe yet** — Collect payment method later; focus on product-market fit first

---

## Immediate Next Steps

**For Haron (Frontend):**
1. Build landing page (describe product, explain tiers)
2. Build signup/login pages (call `/api/growth-engine/v1/auth/signup` and `/auth/login`)
3. Build dashboard (show user's past reports, current tier, tier features)
4. Build evaluation form (handle, platform picker: "twitter" / "instagram", category, email)
5. Display report results (fetch via `/api/growth-engine/v1/reports/:reportId`)

**For You (Backend):**
1. Add tier enforcement: Check subscription before allowing evaluation (free tier: 1/month, paid: unlimited)
2. Real Stripe integration: Hook `_createStripeSubscription()` when Stripe API key available
3. Add TikTok fetcher: Copy `instagram_fetcher.js`, integrate into evaluator
4. Real industry benchmarks: Replace mock categories with actual data per platform

**Testing:** 
- Frontend can test signup/login with mock account (email: test@example.com, password: password123)
- All API endpoints documented in updated TEAM_GUIDE.md

---

## How Haron Gets Started

Give him:
1. Updated `TEAM_GUIDE.md` — Full API reference (auth endpoints live)
2. Test credentials: email: `test@example.com`, password: `password123` (account already created)
3. Base API URL: `http://localhost:3005/api/growth-engine/v1/`
4. He can now build signup/login/dashboard UI with real API calls

---

## File Locations

```
convergence-app/
├── server/
│   ├── growth_engine_evaluator.js (LLM + multi-platform routing)
│   ├── growth_engine_db.js (Users, jobs, reports, entitlements)
│   ├── growth_engine_billing.js (Mock Stripe subscriptions)
│   ├── growth_engine_job_queue.js (Async evaluation queue)
│   ├── auth.js (Signup/login/JWT with bcryptjs)
│   ├── twitter_fetcher.js (Real Twitter/X data)
│   ├── instagram_fetcher.js (Real Instagram data - NEW)
│   ├── report_saver.js (Markdown report auto-save)
│   ├── routes/
│   │   └── growth-engine.js (Auth + account + evaluation + billing endpoints)
│   ├── .env (API keys for LLM, social, auth, billing)
│   ├── data/
│   │   └── growth_engine.db (SQLite with users table)
│   └── node_modules/ (bcryptjs, jsonwebtoken, etc.)
├── reports/ (Auto-saved markdown reports)
├── public/
│   └── index.html (Haron's landing page / frontend)
├── TEAM_GUIDE.md (Updated: full API reference for Haron)
├── CONTEXT_HANDOFF.md (This file - updated state)
└── BUSINESS_OPS.md (Business checklist)
```

---

## Decision Checkpoints

Before moving forward, confirm:

- [ ] Auth system design sounds right?
- [ ] JWT + bcrypt for passwords (standard SaaS approach)?
- [ ] Entitlements table will track subscription tier?
- [ ] Demo mode (no auth) stays for testing, removed before launch?
- [ ] Haron knows to wait for auth endpoints before building login UI?

---

## Recent Commits (This Session)

```
0f3915b - Add Instagram support + mock Stripe subscription tracking
61a6ac1 - Update TEAM_GUIDE: document auth endpoints and JWT flow for Haron
016b8b3 - Add auth/accounts system: signup, login, JWT, protected routes
```

## What Changed Since Last Handoff

- ✅ Auth system live and tested
- ✅ Instagram fetcher ready (mirrors Twitter pattern)
- ✅ Mock Stripe with subscription state tracking
- ✅ All endpoints protected by JWT middleware
- ✅ Users auto-enrolled in free tier
- 🔄 Waiting for Haron's UI to test end-to-end flow

---

**Next action:** Haron starts building UI (landing page → signup/login → dashboard)
