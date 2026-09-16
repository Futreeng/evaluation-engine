# futureEng Growth Engine — Context Handoff

**Use this to start a fresh chat and maintain direction. Paste this entire document.**

---

## Business Context

**Company:** futureEng LLC (legitimate SaaS startup)  
**Product:** Social media growth auditing engine with AI analysis  
**Team:** 
- You = Backend dev (logic, functionality, AI integrations, APIs, data)
- Haron = Frontend dev (UI, UX, customer-facing presentation)

**Status:** Product-market-validated with real Twitter data, 4-way LLM fallback working, ready for customer accounts

**Current Stage:** Building auth/accounts system so Haron can build landing page + account dashboard

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

## Current Task: Auth/Accounts System

**What you're building:** User registration, login, JWT tokens, account management

**Scope:**
1. ✅ Add `users` table to database (email, password_hash, company_name)
2. 🔄 Create auth functions (signup, login, JWT generation)
3. Add auth endpoints (POST /auth/signup, POST /auth/login, GET /auth/me)
4. Add JWT middleware to protect routes
5. Add account endpoints (GET /account/profile, GET /account/subscription-status, GET /account/reports)
6. Update existing routes to check `req.user` instead of demo account_id

**Why this first:** Haron needs to build landing page → signup flow → dashboard. Can't do that without auth endpoints.

**Next phase (after auth):** Add Instagram/TikTok, then Stripe payments

---

## Environment Setup

**`.env` file** (`server` folder):
```
CLAUDE_API_KEY=sk-ant-...
GEMINI_API_KEY=AQ.Ab8...
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-proj-...
TWITTER_BEARER_TOKEN=AAA...
JWT_SECRET=ca4677fab...  (already exists, don't change)
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
  - Add new functions: `createUser()`, `getUserByEmail()`, `updateUserPassword()`
  - Already has: jobs, reports, entitlements (subscription tier tracking)

### Auth (New)
- `server/auth.js` (CREATE THIS)
  - Functions: signup, login, verifyJWT, generateJWT
  - Use bcrypt for password hashing (npm install bcryptjs if needed)

### Routes
- `server/routes/growth-engine.js` — Update to add auth endpoints
  - Keep existing evaluation routes but protect with JWT middleware
  - Add POST /auth/signup, POST /auth/login, GET /auth/me
  - Add GET /account/profile, GET /account/subscription-status, GET /account/reports

### Frontend Integration
- `server/routes/growth-engine.js` line ~23 has authMiddleware (update it)
- Haron will call: `POST /auth/signup { email, password, company_name }`
- Haron will receive: `{ token, user_id, email }`
- Haron stores token in localStorage, sends as `Authorization: Bearer {token}` header

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

## Next Steps (After Auth/Accounts)

1. **Haron builds UI:**
   - Landing page (describe product simply)
   - Signup/login pages
   - Dashboard (show user's reports, subscription status)
   - Evaluation form (handle, platform, category, email)

2. **You build Instagram:** Copy `twitter_fetcher.js` pattern, add to `getRealPostData()`

3. **You integrate Stripe:** Payment processing for $39/$99/$249/mo tiers

4. **You add entitlement checking:** Limit free tier users to X evaluations/month

---

## How Haron Gets Started

Give him:
1. `TEAM_GUIDE.md` — API reference, report format, status values
2. Tell him: "Auth endpoints coming soon (POST /auth/signup, POST /auth/login, GET /auth/me)"
3. He can mockup signup/login UI while you build it
4. Once auth is live, he plugs in real API calls

---

## File Locations

```
convergence-app/
├── server/
│   ├── growth_engine_evaluator.js (LLM + Twitter analysis)
│   ├── growth_engine_db.js (Database)
│   ├── growth_engine_job_queue.js (Async job processing)
│   ├── twitter_fetcher.js (Real Twitter data)
│   ├── report_saver.js (Markdown report auto-save)
│   ├── auth.js (CREATE THIS - signup/login/JWT)
│   ├── routes/
│   │   └── growth-engine.js (All API endpoints)
│   ├── .env (API keys, secrets)
│   └── data/
│       └── growth_engine.db (SQLite database file)
├── reports/ (Auto-saved markdown reports)
├── public/
│   └── index.html (Haron's landing page / frontend)
├── TEAM_GUIDE.md (For Haron - API reference)
├── BUSINESS_OPS.md (Your personal business checklist)
└── CONTEXT_HANDOFF.md (This file)
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

## Recent Commits

```
a6b46d9 - Add BUSINESS_OPS guide: startup checklist
5ff32fb - Add report auto-save (markdown) + TEAM_GUIDE
cf73803 - Add OpenAI as 4th LLM fallback
186afb3 - Remove Together.ai (paid tier)
875f673 - Add real Twitter data fetcher
```

---

## Current Blocker / Why You're Starting Fresh Chat

Building auth/accounts system. Need to add:
1. Users table to database
2. Auth functions (signup, login, JWT)
3. Auth endpoints (3-4 new routes)
4. Middleware to protect routes
5. Account management endpoints

This is foundational — everything after this depends on it working correctly.

---

**Ready to continue? Pick up at:** `server/growth_engine_db.js` — adding user table functions, then create `server/auth.js`
