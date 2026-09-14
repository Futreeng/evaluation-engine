# Frontend Integration Guide for Haron's Team

**Status:** Backend is complete and production-ready. Frontend must follow these patterns to avoid breaking backend functionality.

---

## ✅ What the Backend Guarantees

- **All endpoints are rate-limited** (120 req/min per user)
- **All endpoints require JWT authentication**
- **Job queue handles concurrent requests** (4 workers by default)
- **Database is transactionally safe** (ACID guarantees)
- **Subscriptions are enforced at the API level** (no way to bypass tiers)

---

## ⚠️ What the Frontend MUST Do Correctly

### 1. Implement Polling Correctly
**DO:**
```javascript
// Poll every 2 seconds until complete
GET /api/growth-engine/v1/job/{job_id}
// Wait 2 seconds between requests
// Stop when status === "complete" or "failed"
```

**DON'T:**
- Poll faster than 1 second (will hit rate limit)
- Keep polling indefinitely after job completes
- Assume job completes in < 5 seconds (might be processing)

### 2. Use Proper Error Handling
**DO:**
```javascript
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  // Use data...
} catch (error) {
  console.error('API error:', error);
  // Show user-friendly error
}
```

**DON'T:**
- Assume requests will always succeed
- Ignore HTTP error codes (402, 404, 429, 500)
- Try to "fix" responses that don't match expected shape

### 3. Respect Rate Limits
**DO:**
- Queue requests sequentially when possible
- Show loading state while polling
- Limit concurrent requests to 5-10 per user

**DON'T:**
- Send multiple requests in rapid succession
- Keep polling if rate limit hit (429 error)
- Ignore "429 Too Many Requests" responses

### 4. Handle All Job States
**DO:**
```javascript
const job = await fetch(`/api/growth-engine/v1/job/${jobId}`);
const data = await job.json();

switch (data.status) {
  case 'queued':
    // Show: "Waiting in queue..."
    break;
  case 'running':
    // Show: "Evaluating your profile..."
    break;
  case 'complete':
    // Fetch report: GET /reports/{report_id}
    break;
  case 'failed':
    // Show error: data.error
    break;
}
```

**DON'T:**
- Assume only "running" and "complete" states exist
- Ignore "queued" state and assume running immediately
- Treat failed jobs as transient (they won't recover)

### 5. Access Report Data Safely
**DO:**
```javascript
const report = await fetch(`/api/growth-engine/v1/reports/{report_id}`);
const data = await report.json();

// All of these will always exist:
data.report_id
data.tier                    // 'social_snapshot', 'growth_plan', etc.
data.scores.overall          // 0-100 number
data.scores.category_avg     // 0-100 number
data.scores.dimensions       // Array of dimension objects
data.growth_path.phases      // Array of 3 phases
```

**DON'T:**
- Assume data.scores.dimension_count exists (it doesn't)
- Try to parse report.id instead of report_id
- Access report.business.name if report is Tier 0 (might not exist)

### 6. Implement Subscription Flow Correctly
**DO:**
```javascript
// 1. Check current tier
GET /api/growth-engine/v1/entitlements
// Returns: { account_id, current_tier }

// 2. Show pricing
GET /api/growth-engine/v1/billing/pricing
// Returns all tiers + features

// 3. Subscribe to tier
POST /api/growth-engine/v1/billing/subscribe
// Body: { tier: "growth_plan", billingCycle: "monthly" }
// Returns: { tier, amountFormatted, status }

// 4. Check access before showing locked content
POST /api/growth-engine/v1/billing/check-access
// Body: { requiredTier: "growth_plan" }
// Returns 402 if user doesn't have access
```

**DON'T:**
- Assume free tier users can't call `/evaluate/social-snapshot`
- Try to upgrade tiers client-side (backend enforces)
- Show paid features to free users (check entitlements first)
- Send real card details to your frontend (Stripe handles this)

---

## 🚨 Common Mistakes That Will Break Things

### ❌ Mistake 1: Polling Too Fast
```javascript
// WRONG - Will hit rate limit
while (true) {
  const result = await fetch(`/job/${jobId}`);
  // No sleep = 60+ requests/second = instant 429 error
}

// RIGHT
while (true) {
  const result = await fetch(`/job/${jobId}`);
  await new Promise(r => setTimeout(r, 2000)); // 2 second delay
}
```

### ❌ Mistake 2: Not Handling Tier Restrictions
```javascript
// WRONG - Assumes all users can access all features
const report = await fetch(`/reports/${reportId}`);

// RIGHT
const entitlements = await fetch(`/entitlements`);
const { current_tier } = await entitlements.json();
if (current_tier === 'social_snapshot') {
  // Show upsell, don't show full report
  showUpsellButton();
} else {
  const report = await fetch(`/reports/${reportId}`);
  displayFullReport(report);
}
```

### ❌ Mistake 3: Ignoring Job Failures
```javascript
// WRONG - Assumes job will eventually complete
let job = null;
while (!job || job.status !== 'complete') {
  job = await fetch(`/job/${jobId}`).json();
  await sleep(2000);
}
// If job fails, this loops forever

// RIGHT
let job = null;
while (!job || (job.status !== 'complete' && job.status !== 'failed')) {
  job = await fetch(`/job/${jobId}`).json();
  if (job.status === 'failed') {
    showError(job.error);
    return;
  }
  await sleep(2000);
}
```

### ❌ Mistake 4: Bypassing Backend Validation
```javascript
// WRONG - Frontend tries to create entitlement
const newTier = 'growth_plan';
localStorage.setItem('userTier', newTier); // WRONG!
// Backend still sees free tier, user can't use features

// RIGHT
// POST /billing/subscribe - Backend creates entitlement
const result = await fetch('/billing/subscribe', {
  method: 'POST',
  body: JSON.stringify({ tier: 'growth_plan' })
});
// Frontend displays what backend returns
```

---

## 📋 API Response Shapes (What to Expect)

### Queue Response
```json
{
  "job_id": "job_...",
  "status": "queued"
}
```

### Job Status Response (While Running)
```json
{
  "status": "running",
  "stage": "Claude evaluation",
  "created_at": "2026-09-14T10:30:00Z",
  "updated_at": "2026-09-14T10:30:05Z"
}
```

### Job Status Response (Complete)
```json
{
  "status": "complete",
  "stage": "complete",
  "resultPayload": {
    "report_id": "rpt_...",
    "tier": "social_snapshot",
    "scores": {
      "overall": 47,
      "category_avg": 61,
      "dimensions": [...]
    },
    "growth_path": { "phases": [...] },
    "business": { "handle": "...", "platform": "..." },
    "upsell": { ... }
  }
}
```

### Job Failed Response
```json
{
  "status": "failed",
  "stage": "failed",
  "error": "Claude API key invalid or rate limited"
}
```

### Report Full Response
```json
{
  "report_id": "rpt_...",
  "tier": "social_snapshot",
  "scores": {
    "overall": 47,
    "category_avg": 61,
    "dimensions": [
      {
        "label": "Posting Consistency",
        "score": 35,
        "explanation": "You post 2-3x per week on average..."
      }
    ]
  },
  "growth_path": {
    "phases": [
      {
        "range": "1-30",
        "visible_action": "Shift toward short-form video...",
        "locked": {
          "count": 4,
          "teaser": "4 specific moves + weekly calendar"
        }
      }
    ]
  },
  "business": {
    "handle": "...",
    "platform": "instagram"
  },
  "upsell": {
    "cta_label": "Unlock your full Growth Plan",
    "target_tier": "growth_plan",
    "unlock_count": 12
  }
}
```

### Entitlements Response
```json
{
  "account_id": "...",
  "current_tier": "social_snapshot" | "growth_plan" | "business_evaluator" | "agency"
}
```

### Pricing Response
```json
{
  "tiers": [
    {
      "tier": "social_snapshot",
      "name": "Social Snapshot",
      "monthlyPrice": 0,
      "features": [...]
    },
    ...
  ],
  "discount": {
    "annual": "25% off",
    "note": "Annual billing includes 25% discount"
  }
}
```

---

## 🔐 Authentication

All endpoints require JWT token in `Authorization: Bearer <token>` header. The token is provided by the authentication system and is valid for 30 days.

If token expires, frontend gets 401 error. Redirect to login.

---

## 🚀 Safe Development Practices

1. **Test against real backend first** — don't assume happy path
2. **Test error cases** — rate limits, invalid tier, failed jobs
3. **Monitor network tab** — verify request/response shapes
4. **Check console for errors** — backend logs them server-side
5. **Use the provided template** (growth-engine.html) as reference implementation
6. **Never cache tier data** — always check `/entitlements` before showing paid features

---

## 📞 Escalation Path

If Haron's team encounters issues:

1. Check this guide first (most issues are in the list above)
2. Check backend test files for working examples:
   - `server/growth_engine_async.test.js` — polling patterns
   - `server/growth_engine_production.test.js` — full flow
3. Verify API keys are set (CLAUDE_API_KEY, GEMINI_API_KEY, STRIPE_API_KEY)
4. Check backend logs for actual errors
5. Review growth_engine.html template for correct implementation

---

**Backend Status:** ✅ Production-ready  
**Frontend Status:** 🟨 Awaiting Haron's team  
**Template Provided:** ✅ growth-engine.html (reference implementation)  
**API Documentation:** ✅ README.md + GROWTH_ENGINE_API.md  
**Test Examples:** ✅ growth_engine_async.test.js
