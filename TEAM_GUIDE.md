# futureEng Growth Engine — Team Guide

**For:** Backend dev (you) + Frontend dev (Haron)  
**What it does:** Analyzes real Twitter/X accounts, generates AI-powered growth reports  
**Status:** Working end-to-end with real data + 4-way LLM fallback

---

## Quick Start

### For Backend (you)

**Running the backend:**
```bash
cd server
npm start
```
Runs on `http://localhost:3005`

**Adding features:**
- LLM calls: [`server/growth_engine_evaluator.js`](server/growth_engine_evaluator.js)
- Database: [`server/growth_engine_db.js`](server/growth_engine_db.js)
- Social data fetching: [`server/twitter_fetcher.js`](server/twitter_fetcher.js)
- API routes: [`server/routes/growth-engine.js`](server/routes/growth-engine.js)

**Key flows:**
1. Frontend submits: `POST /evaluate/social-snapshot` → `{ handle, platform, category, email }`
2. Backend queues job, returns `{ job_id }`
3. Frontend polls: `GET /job/:jobId` every 2s
4. When ready: `GET /reports/:reportId` fetches markdown report

**Adding new platforms:**
1. Create fetcher: `server/{platform}_fetcher.js` (copy `twitter_fetcher.js`)
2. Update `getRealPostData()` in evaluator to call it
3. Add platform option to frontend form

### For Frontend (Haron)

**API Base URL:** Read from `?api=` query param, fallback to localStorage

**Auth endpoints (NEW):**
- `POST /auth/signup` — Register new account
  - Body: `{ email, password, company_name }`
  - Returns: `{ token, user: { user_id, email, company_name } }`
- `POST /auth/login` — Login
  - Body: `{ email, password }`
  - Returns: `{ token, user: { user_id, email, company_name } }`
- `GET /auth/me` — Get current user (requires token)
  - Header: `Authorization: Bearer {token}`
  - Returns: `{ user_id, email, company_name }`

**Account endpoints (NEW):**
- `GET /account/profile` — Get user profile (requires token)
  - Returns: `{ user_id, email, company_name, created_at, updated_at }`
- `GET /account/subscription-status` — Check tier (requires token)
  - Returns: `{ user_id, current_tier, tier_start_date, billing_period_start, billing_period_end }`
- `GET /account/reports` — List user's reports (requires token)
  - Returns: `{ reports: [...] }`

**Protected evaluation endpoints:**
- `POST /evaluate/social-snapshot` — Queue evaluation (requires token)
  - Body: `{ handle, platform, category, email }`
  - Returns: `{ job_id, status }`
- `GET /job/:jobId` — Poll status (no auth needed, job lookup is public)
  - Returns: `{ status, stage, error, resultPayload }`
- `GET /reports/:reportId` — Fetch report (no auth needed, report lookup is public)
  - Returns: full report object

**Report format:**
Generated reports are **narrative markdown**, saved to `/reports` folder. Example:
```
# Social Media Audit Report

@handle on twitter
Generated: 2026-09-16

---

You're winning at [strength]. This is above X% of similar accounts.

The single biggest opportunity: [outcome-focused opportunity]

Your 30-60-90 Action Sequence:
1. [Days 1-30]: Action description
2. [Days 31-60]: Next step
3. [Days 61-90]: Compound effect
```

**Status values:**
- `queued` → processing hasn't started
- `running` → evaluation in progress (stage: `evaluating`)
- `complete` → done; check `resultPayload.narrative`
- `failed` → error in `error` field

**JWT Token Flow:**
1. User signs up/logs in: `POST /auth/signup` or `POST /auth/login`
2. Store returned `token` in `localStorage.setItem('token', token)`
3. For all protected endpoints, add header: `Authorization: Bearer ${token}`
4. Tokens expire in 7 days; user must re-login when expired
5. Handle 401 response → redirect to login page

---

## Environment Setup

**`.env` file (server folder):**
```
CLAUDE_API_KEY=sk-ant-...          # Anthropic Claude
GEMINI_API_KEY=AQ.Ab8...           # Google Gemini
GROQ_API_KEY=gsk_...               # Groq (free, reliable)
OPENAI_API_KEY=sk-proj-...         # OpenAI (fallback)
TWITTER_BEARER_TOKEN=AAA...        # Twitter/X API v2
PORT=3005
```

**LLM Fallback Chain:**
1. Claude (costs credits)
2. Gemini (free, quota limits)
3. Groq (free, reliable)
4. OpenAI (free trial, then paid)

If all fail → error message shows which LLM failed last

---

## Database

**Backed by sql.js** (pure JavaScript SQL, no external DB needed)  
Located: `server/data/growth_engine.db`

**Tables:**
- `users` — customer accounts (email, password_hash, company_name, created_at, updated_at)
- `growth_engine_jobs` — async job tracking (account_id, status, input_params, result_payload)
- `growth_engine_reports` — generated reports (account_id, business_handle, report_body)
- `entitlements` — subscription tiers (account_id, current_tier: 'social_snapshot'|'growth_plan'|'business_evaluator'|'enterprise')
- `tier_history` — tier change audit log

**To inspect:**
```bash
node -e "const db = require('./server/growth_engine_db'); db.initDb().then(() => console.log('Ready'))"
```

---

## Reports & Output

**Reports are saved automatically** to `/reports` folder as markdown.  
Format: `{handle}_{platform}_{date}.md`

Example: `@elonmusk_twitter_2026-09-16.md`

**Contains:**
- Real Twitter metrics (posting frequency, engagement, reach)
- AI analysis (strengths, opportunities, 30-60-90 action plan)
- Client-friendly narrative (not raw scores)

---

## Known Limitations

1. **Twitter only for now** — Instagram/TikTok/LinkedIn can be added (copy `twitter_fetcher.js`)
2. **Free tier quota limits** — Gemini + Claude have free account limits; Groq is most reliable
3. **Mock category benchmarks** — Using sample fitness/food benchmarks; should be real industry data
4. **No payment integration** — Subscription tiers tracked in database, but Stripe not wired up yet

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Twitter handle not found" | Handle doesn't exist or private account | Try public account |
| All LLMs fail with 429 | Rate limited on all providers | Wait 10 min, try again |
| No report generating | Job stuck in "running" | Check server logs |
| Frontend can't reach backend | CORS or port issue | Add `?api=http://localhost:3005` to URL |

---

## What's Next

**Backend priorities (coming):**
1. ✅ Auth/accounts system (DONE)
2. Add Instagram fetcher (reuse Twitter pattern)
3. Add real industry benchmarks (replace mock data)
4. Integrate Stripe for billing (payment processing)
5. Add subscription tier enforcement (limit free tier evaluations)

**Frontend priorities (for Haron):**
1. 🔄 Build signup/login pages
2. 🔄 Build dashboard (show user's reports & tier status)
3. Build evaluation form (connected to real API)
4. Display narrative report with formatting
5. Add handle history / saved audits
6. Add social sharing for reports

---

## Handing Off Work

**Before you hand something off:**
- Push to `main` branch
- Check `/reports` folder has recent markdown examples
- Server logs show evaluation completing
- Frontend can poll and retrieve report

**Test flow:**
```
1. Hard refresh browser (Ctrl+Shift+R)
2. Enter handle: @twitter
3. Platform: X
4. Category: any
5. Wait ~30-60 sec
6. Check /reports folder for markdown file
7. Verify frontend displays report
```

---

**Questions?** Check server logs: `tail -f server.log`
