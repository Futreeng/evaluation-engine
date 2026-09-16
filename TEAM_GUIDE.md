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

**Key endpoints:**
- `POST /evaluate/social-snapshot` — Queue evaluation
- `GET /job/:jobId` — Poll status (returns `{ status, stage, error, resultPayload }`)
- `GET /reports/:reportId` — Fetch report

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
- `growth_engine_jobs` — async job tracking
- `growth_engine_reports` — generated reports
- `entitlements` — subscription tiers (not yet implemented)

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
4. **No auth** — Demo mode; add JWT auth for production

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

**Backend priorities:**
1. Add Instagram fetcher (reuse Twitter pattern)
2. Add real industry benchmarks (replace mock data)
3. Implement subscription tier checking
4. Add Stripe integration for billing

**Frontend priorities:**
1. Display narrative report with formatting
2. Add handle history / saved audits
3. Add social sharing for reports
4. Show LLM model used in final report

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
