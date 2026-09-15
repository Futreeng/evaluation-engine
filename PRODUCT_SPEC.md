# Futreeng Growth Engine — Complete Product Specification

**Status:** In Development | **Version:** 1.0

---

## 1. PRODUCT OVERVIEW

**Futreeng Growth Engine** is a tiered SaaS platform that audits social media profiles using dual AI analysis (Claude + Gemini via Convergence app), generates actionable growth strategies, and provides tier-specific features.

**Architecture:**
- Frontend: Haron's existing landing/signup page (public/index.html) ✓
- Convergence: Standalone dual-LLM app (new: public/convergence.html)
- Backend: Node/Express API with job queue for audits
- Database: Session/user data + audit results storage

---

## 2. CUSTOMER TIERS

### Tier 0: Social Snapshot (FREE)
- **Features:**
  - 1 social profile audit per account
  - 4 dimension scores (Authenticity, Engagement, Growth, Consistency)
  - Category benchmarking comparison
  - Basic growth recommendations
- **Delivery:** Single-use, no recurring access
- **User Flow:** Fill form → wait for audit → view report → upsell

### Tier 1: Growth Plan ($39/month)
- **Includes all Tier 0 +**
  - Unlimited audits (any social profile)
  - 90-day content calendar (actionable weekly tasks)
  - LLM-generated content prompts (tied to Convergence: "create 5 captions for this audience")
  - Competitor analysis (compare up to 3 profiles)
  - Weekly refresh/re-audit capability
- **Delivery:** Dashboard with stored audits + calendar
- **Convergence Role:** Powers prompt generation, competitor comparison

### Tier 2: Business Evaluator ($99/month)
- **Includes all Tier 1 +**
  - Margin-aware recommendations (ROI-focused growth tactics)
  - Actionable 30-60-90 checklist (integrated with calendar)
  - Business reconciliation (link audit results to business metrics)
  - Bi-weekly refresh (automatic re-audits)
  - Export reports as PDF/presentation
- **Delivery:** Full dashboard + quarterly strategy reviews
- **Convergence Role:** Generates strategy documents, reconciliation analysis

---

## 3. DATA MODEL / DATABASE SCHEMA

### Users Table
```
id (UUID)
email (string, unique)
passwordHash (string)
stripeCustomerId (string, nullable)
tier (enum: free | growth | business)
createdAt (timestamp)
updatedAt (timestamp)
```

### Social Profiles Table
```
id (UUID)
userId (FK → Users)
handle (string)
platform (enum: instagram | tiktok | x | facebook | linkedin)
category (enum: boutique_fitness | fitness | food_beverage | retail | professional_services)
businessName (string, optional)
businessMetrics (JSON, optional - revenue, followers at time of audit)
createdAt (timestamp)
```

### Audits Table
```
id (UUID)
profileId (FK → Social Profiles)
jobId (string, FK → Jobs)
overallScore (0-100)
scores (JSON):
  {
    authenticity: { score: 0-100, explanation: string },
    engagement: { score: 0-100, explanation: string },
    growth: { score: 0-100, explanation: string },
    consistency: { score: 0-100, explanation: string },
    categoryAverage: 0-100,
    recommendations: [string]
  }
growthPath (JSON):
  {
    phases: [
      {
        range: "1-30",
        visibleAction: string,
        locked: { teaser: string }  // for non-Tier1 users
      },
      { range: "31-60", ... },
      { range: "61-90", ... }
    ]
  }
competitorAnalysis (JSON, optional, Tier1+):
  {
    competitors: [{ handle, platform, score, comparison }]
  }
contentCalendar (JSON, optional, Tier1+):
  {
    weeks: [
      {
        weekOf: date,
        dailyTasks: [{ day, task, contentPrompt }]
      }
    ]
  }
businessReconciliation (JSON, optional, Tier2):
  {
    projectedROI: number,
    estimatedTimeToTarget: string,
    businessImpact: string
  }
createdAt (timestamp)
auditedAt (timestamp)
expiresAt (timestamp, for refresh)
```

### Jobs Table (Async Processing)
```
id (UUID)
userId (FK → Users)
type (enum: audit | refresh | competitor_analysis)
status (enum: queued | processing | complete | failed)
profileId (FK → Social Profiles, nullable)
input (JSON):
  {
    handle: string,
    platform: string,
    category: string,
    businessMetrics: JSON (optional)
  }
result (JSON, null until complete)
error (string, nullable)
convergenceSessionId (string, FK → Convergence sessions, for audit tracking)
createdAt (timestamp)
startedAt (timestamp, nullable)
completedAt (timestamp, nullable)
```

### Content Calendar Entries Table (Tier1+)
```
id (UUID)
profileId (FK → Social Profiles)
taskDate (date)
task (string)
contentPrompt (string)
contentGenerated (string, nullable, after user runs prompt)
status (enum: pending | drafted | published)
createdAt (timestamp)
```

---

## 4. API SPECIFICATION

### Base: `/api/growth-engine/v1`

#### Auth Endpoints
```
POST /auth/register
  body: { email, password }
  response: { userId, token }

POST /auth/login
  body: { email, password }
  response: { userId, token, tier }

POST /auth/logout
  response: { ok: true }
```

#### Audit Endpoints (Public - No Auth)
```
POST /evaluate/social-snapshot
  body: { handle, platform, category, email }
  response: { jobId, estimatedWaitSeconds: 10-15 }

GET /job/:jobId
  response: 
    status: queued | processing | complete | failed
    result: { scores, growthPath, ... } (if complete)
    error: string (if failed)
    progress: { percentComplete, message } (if processing)
```

#### Dashboard Endpoints (Auth Required)
```
GET /dashboard/profiles
  response: [{ id, handle, platform, category, lastAuditScore, lastAuditDate }]

POST /dashboard/profiles
  body: { handle, platform, category, businessName, businessMetrics }
  response: { profileId }

GET /dashboard/audits/:profileId
  response: [{ id, auditDate, overallScore, scores, growthPath }]

GET /dashboard/calendar/:profileId?weekOf=2026-09-15
  response: { weeks: [{ weekOf, dailyTasks }] }

PUT /dashboard/calendar/:taskId
  body: { status, contentGenerated }
  response: { ok: true }

POST /dashboard/refresh/:profileId
  body: { }
  response: { jobId }

POST /dashboard/competitors
  body: { profileId, competitorHandles: [string] }
  response: { jobId }

POST /dashboard/export/:auditId
  body: { format: pdf | markdown }
  response: { downloadUrl }

POST /dashboard/reconciliation/:profileId
  body: { businessMetrics: JSON }
  response: { reconResult: JSON }
```

#### Convergence Integration Endpoints
```
POST /convergence/analyze
  (Internal - called by job processor)
  body: { handle, platform, category, mode: "audit" | "calendar" | "competitor" }
  response: { convergenceSessionId, results: JSON }

GET /convergence/session/:sessionId
  response: { status, turns, transcript }
```

---

## 5. AUDIT ANALYSIS LOGIC (Convergence Role)

**Process:**
1. Job processor queues audit request
2. Creates Convergence session with dual-LLM mode (Claude vs. Gemini)
3. Convergence runs parallel analysis:
   - Claude: Analyzes profile for authenticity, growth trajectory
   - Gemini: Analyzes profile for engagement patterns, consistency
4. Both models compare results, generate consensus scores
5. Convergence session produces JSON: `{ scores, recommendations, growthPath }`
6. Results saved to Audits table
7. Job status updates to "complete"

**Prompts for Convergence:**
```
System (Shared): "You are a social media growth strategist. Analyze the following profile data and score across 4 dimensions: Authenticity (is the brand voice genuine?), Engagement (how well does audience interact?), Growth (trajectory and velocity), Consistency (posting schedule, content quality)."

Dimension 1 - Authenticity:
- Analyze brand voice consistency
- Check for bot/fake engagement signs
- Score: 0-100, plus explanation

Dimension 2 - Engagement:
- Calculate engagement rate
- Analyze comment quality
- Score: 0-100, plus explanation

Dimension 3 - Growth:
- Analyze follower growth curve
- Check for viral moments
- Score: 0-100, plus explanation

Dimension 4 - Consistency:
- Posting frequency analysis
- Content theme consistency
- Score: 0-100, plus explanation
```

**Growth Path Generation (Convergence):**
- Claude: Generates visible actions (what user can do immediately)
- Gemini: Generates locked strategy (premium tier unlock)
- Combined: 30-60-90 day roadmap

---

## 6. INTEGRATION ARCHITECTURE

### File Structure
```
public/
├── index.html                    # Haron's landing page (preserved)
├── convergence.html              # Standalone Convergence dual-LLM app
└── app/
    └── dashboard.html            # Authenticated dashboard (Tier1+)

server/
├── server.js                     # Main Express server
├── routes/
│   ├── auth.js                   # Auth endpoints
│   ├── audit.js                  # Audit/job endpoints
│   ├── dashboard.js              # Dashboard endpoints
│   ├── convergence.js            # Convergence integration
│   └── proxy.js                  # (Existing) LLM proxy
├── services/
│   ├── jobQueue.js               # Job processor (Bull/Redis)
│   ├── convergenceClient.js      # Convergence API client
│   ├── auditAnalyzer.js          # Calls Convergence, saves results
│   └── socialMediaParser.js      # Scrapes/analyzes social profiles
├── models/
│   ├── User.js
│   ├── Profile.js
│   ├── Audit.js
│   ├── Job.js
│   └── Calendar.js
└── db.js                         # (Existing) Flat-file or upgrade to SQLite/Postgres
```

### Integration Flow
```
User submits form (public/index.html)
  ↓
POST /api/growth-engine/v1/evaluate/social-snapshot
  ↓
Job created, queued in Bull/Redis
  ↓
Job Processor picks up job
  ↓
Calls POST /api/growth-engine/v1/convergence/analyze
  ↓
Convergence session spawned (public/convergence.html or headless)
  ↓
Dual analysis (Claude vs Gemini) runs
  ↓
Results returned to Job Processor
  ↓
Results saved to Audits table
  ↓
Job status: complete
  ↓
Frontend polls GET /api/growth-engine/v1/job/:jobId
  ↓
Displays results in report section
```

---

## 7. CONVERGENCE STANDALONE APP (public/convergence.html)

**Features:**
- Fully independent dual-LLM app
- Can be accessed as `/convergence` (embedded in Growth Engine)
- Can be self-hosted independently
- Can be configured for other use cases (e.g., product comparison, document review)

**API Integration Points:**
- Receives task via query params or API: `?task=audit&handle=@username&platform=instagram`
- Stores session in backend (for audit history)
- Can run fully client-side (no backend) if needed
- Exports results as JSON/Markdown

**Adaptation Examples:**
- Change mode to "document-review" for dual editing
- Change to "test-case-generator" (already planned in prior context)
- Change to "competitive-analysis" for product research

---

## 8. IMPLEMENTATION ROADMAP

### Phase 1: Core Backend (Week 1)
- [ ] Database schema setup (SQLite initially, upgrade later)
- [ ] Auth endpoints (register/login/logout)
- [ ] Job queue setup (Bull + Redis or in-memory queue)
- [ ] Social profile scraper (or mock data for MVP)
- [ ] Audit endpoints (POST evaluate, GET job status)

### Phase 2: Convergence Integration (Week 2)
- [ ] Rebuild Convergence as standalone app (public/convergence.html)
- [ ] Convergence API client (calls Convergence sessions)
- [ ] Audit analyzer service (orchestrates dual-LLM analysis)
- [ ] Save results to database
- [ ] Test full audit flow end-to-end

### Phase 3: Dashboard & Tier1 Features (Week 3)
- [ ] Dashboard UI (public/app/dashboard.html)
- [ ] Stored audits display
- [ ] Content calendar generation (via Convergence)
- [ ] Competitor analysis feature
- [ ] Weekly refresh capability

### Phase 4: Tier2 Features & Polish (Week 4)
- [ ] Margin-aware recommendations
- [ ] Business reconciliation
- [ ] PDF export
- [ ] Stripe payment integration
- [ ] Email notifications

### Phase 5: Production Readiness
- [ ] Production database (Postgres)
- [ ] Monitoring/logging
- [ ] CI/CD pipeline
- [ ] Security audit

---

## 9. CRITICAL UNKNOWNS (Research Needed)

1. **Social Media Data Source:**
   - Official APIs: Instagram Graph API, TikTok API, Twitter API v2, Facebook Graph API, LinkedIn API
   - User OAuth flow: User grants Futreeng access to their profile data
   - Rate limits: Plan for tier-based rate limiting per platform
   - **Approach:** Real data via official platform APIs + OAuth authentication

2. **Convergence Session Mode:**
   - Run Convergence as subprocess from backend?
   - Call Convergence via HTTP (if deployed separately)?
   - Embed Convergence client-side and stream results back?
   - **Decision needed:** Architectural approach

3. **Job Queue:**
   - Use Bull + Redis?
   - Use in-memory queue (for MVP)?
   - Use external service (e.g., AWS SQS)?
   - **Decision needed:** MVP vs production

4. **Database:**
   - Continue with flat-file (server/db.js)?
   - Upgrade to SQLite?
   - Use Postgres from start?
   - **Decision needed:** Persistence strategy

5. **Content Calendar Generation:**
   - How detailed? (daily tasks with specific prompts?)
   - How are tasks categorized? (content type, posting time, audience segment?)
   - **Decision needed:** Specification from product perspective

6. **Business Metrics:**
   - What metrics should Tier2 reconciliation track?
   - How to project ROI from social metrics?
   - **Decision needed:** Business logic inputs

---

## 10. NEXT STEPS

**Approval Checklist:**
- [ ] Confirm tier feature breakdown
- [ ] Confirm social media data source approach (MVP: mock data?)
- [ ] Confirm Convergence integration architecture
- [ ] Confirm database persistence strategy
- [ ] Confirm content calendar specification

**Once approved:**
1. Create git branch for Phase 1
2. Rebuild Convergence as standalone app
3. Implement core backend
4. Deploy to test environment
5. User testing
6. Iterate

---

**Questions for User:**
1. Should we use mock social media data for MVP (faster), or real API?
2. Should Convergence run as a subprocess, HTTP client, or client-side?
3. Should we start with SQLite (simpler) or Postgres (scalable)?
4. Any specific category benchmarks or industry data sources?
5. Timeline for launch?

