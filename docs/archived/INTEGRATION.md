# Futreeng Growth Engine — Integration Guide

**Phase 1 Complete:** Backend architecture, Convergence standalone app, API contracts established.

---

## ARCHITECTURE OVERVIEW

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│  Futreeng Growth Engine (Landing Page)                          │
│  public/index.html (UI/Design by Haron)                         │
│  - Hero section                                                 │
│  - Pricing tiers                                               │
│  - Evaluation form                                             │
└────────────────┬────────────────────────────────────────────────┘
                 │ POST /api/growth-engine/v1/evaluate/social-snapshot
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  Growth Engine Backend                                          │
│  server/routes/growth-engine.js                                 │
│  - Job queue (Bull + Redis, or in-memory MVP)                  │
│  - Audit analyzer orchestration                                │
│  - Social media API clients                                    │
│  - Database persistence (SQLite MVP → Postgres)                │
└────────────────┬────────────────────────────────────────────────┘
                 │ Calls Convergence analyzer
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  Convergence Dual-LLM App                                       │
│  public/convergence.html (Standalone + API)                     │
│  - Dual-LLM analysis (Claude vs Gemini/Groq)                   │
│  - Parallel/sequential/dialogue modes                          │
│  - Session management                                          │
│  - Export/import                                               │
└────────────────┬────────────────────────────────────────────────┘
                 │ Calls LLM proxy endpoints
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  LLM Proxy (Existing)                                           │
│  server/routes/proxy.js                                         │
│  - /api/proxy/claude/stream                                    │
│  - /api/proxy/gemini/stream                                    │
│  - /api/proxy/groq/stream                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## DATA FLOW

### Free Audit Flow (Public, No Auth)

```
1. User submits form on public/index.html
   Input: { handle, platform, category, email }

2. Frontend calls POST /api/growth-engine/v1/evaluate/social-snapshot
   Response: { jobId, estimatedWaitSeconds: 10 }

3. Growth Engine creates Job record (status: "queued")
   Job is added to in-memory queue

4. Job Processor picks up job
   - Calls socialMediaClient.getProfileData(handle, platform)
     → Fetches real data from platform APIs (Instagram, TikTok, etc.)
   - Calls Convergence analyzer
     → Creates Convergence session
     → Sends profile data + analysis prompt
     → Claude and Gemini run parallel analysis
     → Returns scores, recommendations, growth path

5. Results saved to Audits table
   Job status updated to "complete"
   Results stored: { overallScore, scores, growthPath, recommendations }

6. Frontend polls GET /api/growth-engine/v1/job/:jobId
   Eventually returns: { status: "complete", result: {...} }

7. Frontend displays audit report
   Shows: scores, growth path (with Tier1+ content locked)
   Upsell: "Upgrade to Growth Plan for detailed calendar"
```

### Authenticated Flow (Dashboard, Tier1+)

```
1. User logs in to authenticated dashboard (public/app/dashboard.html, built by Haron)
   - Shows stored profiles
   - Shows past audits
   - Shows content calendar
   - Shows competitor analysis (Tier1+)
   - Shows reconciliation (Tier2)

2. User can:
   - Create new profile: POST /api/growth-engine/v1/dashboard/profiles
     → Stores in socialProfiles table
   - Refresh audit: POST /api/growth-engine/v1/dashboard/refresh/:profileId
     → Creates new Job (type: "refresh")
   - Compare competitors: POST /api/growth-engine/v1/dashboard/competitors
     → Creates Job (type: "competitor_analysis")
   - Generate content calendar: (uses Convergence internally)
   - Export report: POST /api/growth-engine/v1/dashboard/export/:auditId

3. All authenticated requests require JWT token
   - Verify in auth middleware
   - Check user tier (free → Growth → Business)
   - Enforce tier restrictions
```

---

## KEY FILES & RESPONSIBILITIES

### Frontend (UI/Design by Haron)
- `public/index.html` — Landing page, form, report display (PRESERVE)
- `public/app/dashboard.html` — Authenticated dashboard (TO BUILD)
- `public/convergence.html` — Dual-LLM standalone app (LOGIC ONLY, design by Haron)

### Backend (Logic by User)
- `server/routes/growth-engine.js` — Growth Engine API endpoints
- `server/services/auditAnalyzer.js` — Orchestrates Convergence analysis
- `server/services/convergenceClient.js` — Bridge to Convergence app
- `server/services/jobQueue.js` — Async job processing
- `server/models/User.js` — User CRUD
- `server/db/schema.sql` — Database schema

### Database
- `server/db.js` — (Existing) Initialize schema, provide query interface
- Tables: `users`, `socialProfiles`, `jobs`, `audits`, `contentCalendar`, `convergenceSessions`

---

## API CONTRACTS

### Public Endpoints (No Auth)

#### POST /api/growth-engine/v1/evaluate/social-snapshot
Free audit submission.
```
Request:
  {
    handle: "@username",
    platform: "instagram" | "tiktok" | "x" | "facebook" | "linkedin",
    category: "boutique_fitness" | "fitness" | "food_beverage" | "retail" | "professional_services",
    email: "user@example.com"
  }

Response (202 Accepted):
  {
    jobId: "uuid",
    status: "queued",
    estimatedWaitSeconds: 10,
    message: "..."
  }
```

#### GET /api/growth-engine/v1/job/:jobId
Poll job status.
```
Response:
  {
    jobId: "uuid",
    status: "queued" | "processing" | "complete" | "failed",
    result: {
      overallScore: 0-100,
      scores: {
        authenticity: { score: 0-100, explanation: "..." },
        engagement: { score: 0-100, explanation: "..." },
        growth: { score: 0-100, explanation: "..." },
        consistency: { score: 0-100, explanation: "..." },
        categoryAverage: 0-100,
        recommendations: ["...", "...", "..."]
      },
      growthPath: {
        phases: [
          {
            range: "1-30",
            visibleAction: "...",
            locked: { teaser: "...", full: "..." }
          },
          ...
        ]
      }
    },
    error: null,
    progress: { percentComplete: 0-100, message: "..." }
  }
```

### Dashboard Endpoints (Auth Required)

#### GET /api/growth-engine/v1/dashboard/profiles
List user's social profiles.
```
Response:
  {
    profiles: [
      {
        id: "uuid",
        handle: "@username",
        platform: "instagram",
        category: "fitness",
        lastAuditScore: 65,
        lastAuditDate: "2026-09-15T10:30:00Z"
      },
      ...
    ]
  }
```

#### POST /api/growth-engine/v1/dashboard/profiles
Create new profile.
```
Request:
  {
    handle: "@username",
    platform: "instagram",
    category: "fitness",
    businessName: "...",
    businessMetrics: { ... }
  }

Response:
  { profileId: "uuid", created: true }
```

#### GET /api/growth-engine/v1/dashboard/audits/:profileId
Get audit history for profile.
```
Response:
  {
    audits: [
      {
        id: "uuid",
        auditDate: "2026-09-15T10:30:00Z",
        overallScore: 65,
        scores: { ... },
        growthPath: { ... }
      },
      ...
    ]
  }
```

---

## IMPLEMENTATION ROADMAP

### Phase 1 (DONE)
- [x] Database schema (schema.sql)
- [x] User model (User.js)
- [x] Job queue skeleton (jobQueue.js)
- [x] Audit analyzer skeleton (auditAnalyzer.js)
- [x] Convergence client (convergenceClient.js)
- [x] Convergence standalone app (convergence.html)
- [x] Growth Engine routes skeleton (growth-engine.js)
- [x] API contract documentation (this file)

### Phase 2 (YOU OWN)
- [ ] Implement social media API clients (Instagram, TikTok, Twitter, Facebook, LinkedIn)
- [ ] Implement socialMediaClient.getProfileData() to fetch real data
- [ ] Wire jobQueue into server.js
- [ ] Wire auditAnalyzer into jobQueue
- [ ] Implement JWT auth
- [ ] Implement database initialization (run schema.sql on startup)
- [ ] Test end-to-end audit flow
- [ ] Implement Tier 1 features (content calendar, competitor analysis)
- [ ] Implement Tier 2 features (reconciliation, business metrics)

### Phase 3 (HARON BUILDS)
- [ ] Create public/app/dashboard.html (authenticated dashboard UI)
- [ ] Design form, report display, calendar, competitor view
- [ ] Add styling/theming
- [ ] Build Stripe payment integration (frontend side)

### Phase 4 (SHARED)
- [ ] Production database setup (Postgres)
- [ ] Monitoring, logging, error tracking
- [ ] CI/CD pipeline
- [ ] Performance optimization

---

## CRITICAL NOTES FOR YOU (USER)

1. **Real Data Only:** All social profile data must come from official platform APIs (Instagram Graph API, TikTok API, etc.). No mock data.

2. **Convergence Integration:** The auditAnalyzer calls Convergence via convergenceClient. The Convergence app runs its dual-LLM analysis and returns scores/recommendations. You'll need to:
   - Implement the Convergence session API endpoint that accepts prompts
   - Parse Claude vs Gemini results and merge them
   - Return consensus scores to auditAnalyzer

3. **Job Queue:** Currently in-memory (fine for MVP). For production, upgrade to Bull + Redis for reliability and scalability.

4. **Database:** Schema is written for SQLite (easy to iterate). When ready for production, migrate to Postgres (all SQL is compatible).

5. **Social Media APIs:** Each platform has different auth flows, rate limits, and data availability:
   - **Instagram Graph API:** Requires business account, Facebook app, OAuth flow
   - **TikTok API:** Beta, requires approval, rate limits strict
   - **Twitter/X API:** v2, requires authentication, limited free tier
   - **Facebook Graph API:** Part of Meta ecosystem
   - **LinkedIn API:** Requires special access
   - Start with one platform, expand after MVP works

6. **Convergence Standalone:** Lives at `/convergence`. Can be:
   - Used standalone by users (compare Claude vs Gemini on any topic)
   - Called by Growth Engine backend for audits
   - Forked/adapted for other use cases (test case generator, document review, etc.)
   - NO UI/DESIGN in convergence.html (that's Haron's job)

---

## NEXT STEPS

1. Review this document and product spec
2. Implement Phase 2 (social media API clients, auth, database)
3. Hand off to Haron for Phase 3 (dashboard UI)
4. Test end-to-end
5. Deploy

Questions? Check PRODUCT_SPEC.md for full feature breakdown.
