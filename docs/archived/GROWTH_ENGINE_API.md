# Growth Engine API Documentation

**Base URL:** `/api/growth-engine/v1`  
**Authentication:** Requires JWT (Bearer token in Authorization header)  
**Rate Limit:** 120 requests per minute per authenticated user

---

## Endpoints

### 1. Evaluate Social Snapshot (Tier 0 — Free)

**POST** `/evaluate/social-snapshot`

Free tier evaluation that returns the report immediately (no polling required).

#### Request

```json
{
  "handle": "@boutique_fitness_co",
  "platform": "instagram",
  "category": "boutique_fitness",
  "email": "owner@business.com"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `handle` | string | ✅ | Social media handle (e.g., `@username`) |
| `platform` | string | ✅ | `instagram` \| `tiktok` \| `x` \| `facebook` \| `linkedin` |
| `category` | string | ✅ | For benchmarking (`boutique_fitness`, `fitness`, `food_beverage`, etc.) |
| `email` | string | ✅ | Lead capture; gated behind this field to prevent spam |

#### Response (200 OK)

```json
{
  "report_id": "rpt_579cb228847d33321785844e",
  "tier": "social_snapshot",
  "business": {
    "handle": "@boutique_fitness_co",
    "platform": "instagram",
    "category": "boutique_fitness",
    "business_name": null
  },
  "generated_at": 1726329383705,
  "refresh_due_at": null,
  "data_confidence": "full",
  "scores": {
    "overall": 47,
    "category_avg": 61,
    "dimensions": [
      {
        "key": "posting_consistency",
        "label": "Posting Consistency",
        "score": 35,
        "explanation": "1.8 posts/week vs 4-5/week for growing accounts your size"
      },
      {
        "key": "content_mix",
        "label": "Content Mix",
        "score": 58,
        "explanation": "80% static image / 20% video; video-first accounts see 2-3x reach"
      },
      {
        "key": "engagement_rate",
        "label": "Engagement Rate",
        "score": 52,
        "explanation": "1.1% avg vs 2.4% category benchmark"
      },
      {
        "key": "discovery_signal",
        "label": "Discovery Signal",
        "score": 40,
        "explanation": "reach is mostly existing followers, low algorithmic pickup"
      }
    ]
  },
  "growth_path": {
    "phases": [
      {
        "range": "1-30",
        "label": "Fix the consistency gap",
        "visible_action": "Shift toward short-form video around your top-performing theme.",
        "locked": {
          "count": 4,
          "teaser": "4 more specific moves + your exact weekly posting calendar"
        }
      },
      {
        "range": "31-60",
        "label": "Close the discovery gap",
        "visible_action": "Adopt trending formats to break out of the existing-follower bubble.",
        "locked": {
          "count": 6,
          "teaser": "The 6 specific hook/format types performing best in your niche"
        }
      },
      {
        "range": "61-90",
        "label": "Compound what's working",
        "visible_action": "Double down on the format that validates in the first 60 days.",
        "locked": {
          "count": 3,
          "teaser": "Content calendar, ready-to-use post prompts, competitor benchmarks"
        }
      }
    ]
  },
  "upsell": {
    "cta_label": "Unlock your full Growth Plan",
    "target_tier": "growth_plan",
    "unlock_count": 12
  }
}
```

#### Error Responses

**422 Unprocessable Entity** — Missing email
```json
{ "error": "email_required" }
```

**400 Bad Request** — Missing required fields
```json
{ "error": "handle, platform, and category are required" }
```

**502 Bad Gateway** — Evaluation failed
```json
{
  "error": "Evaluation failed",
  "details": "Claude API error 401: Invalid API key",
  "jobId": "job_..."
}
```

---

### 2. Poll Job Status

**GET** `/job/:jobId`

Check the status of an evaluation job. Used by UI to show "Generating report..." state and poll for completion.

#### Response (200 OK)

```json
{
  "job_id": "job_98ae5cea6160a14fdba920b2",
  "tier": "social_snapshot",
  "status": "complete",
  "stage": "social_analysis",
  "created_at": 1726329383000,
  "updated_at": 1726329385000,
  "error": null
}
```

| Status | Meaning |
|--------|---------|
| `queued` | Waiting to run |
| `running` | Currently evaluating |
| `complete` | Done; report ready (fetch via `GET /reports/{report_id}`) |
| `failed` | Error occurred; see `error` field |

#### Error Responses

**404 Not Found**
```json
{ "error": "Job not found" }
```

**403 Forbidden** — User doesn't own this job
```json
{ "error": "Unauthorized" }
```

---

### 3. Get Report

**GET** `/reports/:reportId`

Retrieve a stored report by ID.

#### Response (200 OK)

Same structure as `POST /evaluate/social-snapshot` response (see above).

#### Error Responses

**404 Not Found**
```json
{ "error": "Report not found" }
```

**403 Forbidden**
```json
{ "error": "Unauthorized" }
```

---

### 4. List Reports

**GET** `/reports`

List all reports for the authenticated user.

#### Response (200 OK)

```json
{
  "reports": [
    {
      "report_id": "rpt_579cb228847d33321785844e",
      "tier": "social_snapshot",
      "business": {
        "handle": "@boutique_fitness_co",
        "platform": "instagram",
        "category": "boutique_fitness"
      },
      "generated_at": 1726329383705,
      "refresh_due_at": null
    }
  ]
}
```

---

### 5. Get Entitlements

**GET** `/entitlements`

Get the user's current subscription tier and billing state.

#### Response (200 OK)

```json
{
  "account_id": "user_123",
  "current_tier": "social_snapshot",
  "tier_start_date": 1726329383705,
  "billing_period_start": null,
  "billing_period_end": null
}
```

| Tier | Features |
|------|----------|
| `social_snapshot` | Free; limited diagnostic with teased recommendations |
| `growth_plan` | $39/mo; full 90-day calendar + LLM prompts |
| `business_evaluator` | $99/mo; + margin/inventory cross-check |
| `agency` | $249+/mo; multi-client, white-label, API access |

---

### 6. Upgrade Tier (Admin/Billing)

**POST** `/admin/upgrade-tier`

**⚠️ PLACEHOLDER** — In production, this will integrate with Stripe and billing system.

#### Request

```json
{
  "tier": "growth_plan"
}
```

#### Response (200 OK)

```json
{
  "account_id": "user_123",
  "current_tier": "growth_plan",
  "tier_start_date": 1726329383705
}
```

---

## Authentication

All endpoints require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

Obtain a token by authenticating at `/api/auth/login` (see main Convergence API docs).

---

## Error Handling

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "details": "Optional technical details",
  "source": "Optional: 'upstream' (Claude/Gemini API), 'local' (server), etc."
}
```

**Status codes:**
- `200` — Success
- `400` — Bad request (validation error)
- `402` — Payment required (tier mismatch)
- `403` — Forbidden (user doesn't own this resource)
- `404` — Not found
- `422` — Unprocessable entity (missing required fields)
- `429` — Too many requests (rate limit exceeded)
- `500` — Server error
- `502` — Upstream API error (Claude/Gemini)

---

## Usage Examples

### Example 1: Get Social Snapshot

```bash
curl -X POST http://localhost:3000/api/growth-engine/v1/evaluate/social-snapshot \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "@boutique_fitness_co",
    "platform": "instagram",
    "category": "boutique_fitness",
    "email": "owner@business.com"
  }'
```

### Example 2: Check Entitlement

```bash
curl http://localhost:3000/api/growth-engine/v1/entitlements \
  -H "Authorization: Bearer <jwt_token>"
```

### Example 3: List My Reports

```bash
curl http://localhost:3000/api/growth-engine/v1/reports \
  -H "Authorization: Bearer <jwt_token>"
```

---

## Rate Limiting

Rate limits are per-authenticated-user:
- **120 requests per minute** for most endpoints
- **20 requests per 15 minutes** for auth endpoints (separate limiter)

When rate limited, you'll receive:

```
HTTP 429 Too Many Requests
Retry-After: 60
```

---

## Data Model

### Report Structure

All reports (tiers 0-3) follow this base structure:

```
{
  report_id: string,
  tier: "social_snapshot" | "growth_plan" | "business_evaluator" | "agency",
  business: {
    handle: string,
    platform: string,
    category: string,
    business_name: string | null
  },
  generated_at: number (timestamp),
  refresh_due_at: number | null,
  data_confidence: "full" | "partial" | "insufficient",
  scores: {
    overall: 0-100,
    category_avg: 0-100,
    dimensions: [
      {
        key: string,
        label: string,
        score: 0-100,
        explanation: string
      }
    ]
  },
  growth_path: {
    phases: [
      {
        range: "1-30" | "31-60" | "61-90",
        label: string,
        visible_action: string,
        // For tier 0 (free):
        locked: { count: number, teaser: string },
        // For tiers 1-2 (paid):
        content: string
      }
    ]
  },
  // Tier 0 only:
  upsell: {
    cta_label: string,
    target_tier: string,
    unlock_count: number
  }
}
```

---

## Data Retention

- **Tier 0 (free)**: Reports kept for 30 days; re-run gated to 1x per day
- **Tier 1+**: Reports kept indefinitely; refresh scheduled (weekly for Tier 1, bi-weekly for Tier 2)
- **Jobs**: Retained for audit trail; older than 90 days archived

---

## Next Steps (Tiers 1-3)

This implementation covers **Tier 0 only** (free Social Snapshot). Tier 1-3 follow the same pattern with additional persona evaluations and output fields:

- **Tier 1 (Growth Plan)**: Adds `content_calendar` (13 weeks) and `competitor_comparison`
- **Tier 2 (Business Evaluator)**: Adds `action_plan` (checklist) and `business_reconciliation`
- **Tier 3 (Agency)**: Adds multi-client dashboard and API bulk export

See `futreeng-growth-engine-api-contract.md` for full tier schemas.
