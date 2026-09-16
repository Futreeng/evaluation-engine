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

### For Frontend (Haron) — Development Setup

**⚠️ IMPORTANT: LLM API Keys Required**

The backend needs **at least ONE LLM API key** to generate reports. We don't have Claude/Gemini credits yet, so you'll need to set up your own for testing.

**Cheapest options for development:**
1. **Groq** (FREE, recommended for testing)
   - Get key: https://console.groq.com/keys
   - 100% free, no credit card, unlimited (rate limited)
   - Use this for testing

2. **Gemini** (FREE tier, limited)
   - Get key: https://aistudio.google.com/app/apikey
   - Free tier: 60 requests/minute
   - Good for testing, but will hit limits

3. **OpenAI** (Free trial credits)
   - Get key: https://platform.openai.com/account/api-keys
   - Free trial has ~$5 in credits (enough for 500+ evaluations)
   - After trial, costs money

4. **Claude** (Anthropic, paid)
   - Costs money immediately
   - Skip this for now

**Setup steps:**
```bash
cd server
cp .env.example .env
# Edit .env and add at least one LLM key (use Groq for free testing)
npm start
```

**Test it worked:**
```bash
curl http://localhost:3005/api/growth-engine/v1/health
# Should show your LLM keys as "configured"
```

**Building the UI:**
- You can build all UI flows without worrying about LLMs
- When testing evaluation (queue → poll → retrieve), the backend will process it
- If no LLM keys: evaluation hangs on "running" forever (no error, just waiting)
- So: **add at least Groq API key to .env before testing evaluation flow**

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
  - Returns: `{ reportId, accountId, tier, business: { handle, platform, category }, generatedAt, reportBody }`
  - `reportBody` is a JSON object (NOT plain text) with the narrative report

**Report Response Format (Example):**
```json
{
  "reportId": "rpt_abc123",
  "accountId": "demo-account",
  "tier": "social_snapshot",
  "business": {
    "handle": "twitter",
    "platform": "x",
    "category": "tech"
  },
  "generatedAt": 1726504444000,
  "reportBody": {
    "narrative": "You're winning at [strength]...",
    "strengths": "...",
    "opportunities": "...",
    "actionPlan": "..."
  }
}
```

**Report Display:**
Generated reports are **narrative text**, displayed as markdown. Access via `reportBody` from the API response (NOT from `/reports` folder). Example narrative:
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

## Error Codes & Responses

All errors return a standardized JSON format:
```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "status": 400,
  "timestamp": "2026-09-16T12:00:00Z"
}
```

**Auth Errors:**
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_EMAIL` | 400 | Email is missing, invalid format, or too long |
| `INVALID_PASSWORD` | 400 | Password is missing, too short (<6 chars), or too long |
| `INVALID_COMPANY_NAME` | 400 | Company name is not a string or too long |
| `EMAIL_EXISTS` | 409 | Email already registered (use login instead) |
| `AUTH_FAILED` | 401 | Email/password combination is incorrect |
| `MISSING_TOKEN` | 401 | Authorization header missing token |
| `INVALID_TOKEN` | 401 | Token is invalid or expired (re-login needed) |

**Evaluation Errors:**
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_HANDLE` | 400 | Handle is missing or too long |
| `INVALID_PLATFORM` | 400 | Platform not one of: twitter, x, instagram, ig |
| `INVALID_CATEGORY` | 400 | Category is missing or too long |
| `JOB_QUEUE_ERROR` | 500 | Backend job processing failed |

**Subscription Errors:**
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_TIER` | 400 | Tier not one of: social_snapshot, growth_plan, business_evaluator, agency |
| `INVALID_BILLING_CYCLE` | 400 | Billing cycle must be 'monthly' or 'annual' |
| `SUBSCRIPTION_ERROR` | 500 | Stripe or subscription processing failed |

**How to Handle:**
```javascript
// Example error handling in frontend
try {
  const response = await fetch('/api/growth-engine/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  
  if (!response.ok) {
    // Standardized error
    if (data.code === 'EMAIL_EXISTS') {
      // Show: "Email already registered. Try logging in instead."
    } else if (data.code === 'AUTH_FAILED') {
      // Show: "Email or password incorrect. Try again."
    } else {
      // Show: data.error
    }
  }
} catch (err) {
  // Network error (not API error)
}
```

---

## Health Check

Check backend status at: `GET /health`

Returns:
```json
{
  "status": "ok",
  "db": "ok",
  "apis": {
    "claude": "configured",
    "gemini": "configured",
    "groq": "configured",
    "openai": "missing",
    "twitter": "configured",
    "instagram": "missing"
  }
}
```

Use this to debug when evaluations aren't working.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 400 `INVALID_EMAIL` | Email format wrong | Use valid email like user@example.com |
| 400 `INVALID_PASSWORD` | Password too short | Use at least 6 characters |
| 409 `EMAIL_EXISTS` | Already signed up | Use login endpoint instead |
| 401 `INVALID_TOKEN` | Token expired (7 days) | Re-login to get new token |
| 401 `MISSING_TOKEN` | Forgot Authorization header | Add: `Authorization: Bearer {token}` |
| 400 `INVALID_PLATFORM` | Platform typo | Use: "twitter", "x", "instagram", or "ig" |
| 500 `JOB_QUEUE_ERROR` | Server error | Check server logs, verify LLM API keys |
| Twitter handle not found | Account doesn't exist/private | Try a public account |
| Evaluation stuck on "running" | LLM processing taking time | Wait 30-60 sec, check health endpoint |
| Frontend can't reach backend | CORS or wrong port | Add `?api=http://localhost:3005` to URL |

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
