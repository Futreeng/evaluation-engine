# Growth Engine Storage Layer

## Architecture

The Growth Engine backend uses **sql.js** — a pure JavaScript SQL implementation running in Node.js — to provide transactional semantics without native compiled dependencies.

### Why sql.js?

- ✅ **ACID transactions**: Guarantees entitlements never double-charge or lose state
- ✅ **Concurrent-safe**: Multiple workers can safely read/write without race conditions
- ✅ **Queryable**: Proper indices and WHERE clauses for multi-tenant queries
- ✅ **No native deps**: Pure JavaScript, matches the project's no-compilation constraint
- ✅ **Persistent**: Atomic writes to disk using existing temp-file-then-rename pattern

### Compared to alternatives:

| Feature | Flat JSON | sql.js | SQLite (native) |
|---------|-----------|--------|-----------------|
| Transactions | ❌ | ✅ | ✅ |
| Concurrent reads | ❌ | ✅ | ✅ |
| Indexed queries | ❌ | ✅ | ✅ |
| No native deps | ✅ | ✅ | ❌ |

## Database Schema

### `growth_engine_jobs`
Tracks async evaluation jobs from intake to completion.

```sql
CREATE TABLE growth_engine_jobs (
  job_id TEXT PRIMARY KEY,           -- "job_<uuid>"
  account_id TEXT NOT NULL,          -- user id
  tier TEXT NOT NULL,                -- which tier's evaluation
  status TEXT DEFAULT 'queued',      -- queued|running|complete|failed
  stage TEXT,                        -- current evaluation phase
  input_params TEXT NOT NULL,        -- JSON: {handle, platform, category, ...}
  result_payload TEXT,               -- JSON: complete report body
  error TEXT,                        -- error message if status=failed
  created_at INTEGER NOT NULL,       -- timestamp
  updated_at INTEGER NOT NULL
)
```

### `growth_engine_reports`
Stores generated reports for retrieval and refresh management.

```sql
CREATE TABLE growth_engine_reports (
  report_id TEXT PRIMARY KEY,        -- "rpt_<uuid>"
  account_id TEXT NOT NULL,          -- user id
  tier TEXT NOT NULL,                -- tier that generated this
  business_handle TEXT,              -- @handle
  business_platform TEXT,            -- instagram|tiktok|x|etc
  business_category TEXT,            -- for benchmarking
  generated_at INTEGER NOT NULL,     -- when report was created
  refresh_due_at INTEGER,            -- NULL for tier 0; set for tiers 1+
  report_body TEXT NOT NULL,         -- JSON: full report from api-contract
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### `entitlements`
Tracks current subscription tier for each account.

```sql
CREATE TABLE entitlements (
  account_id TEXT PRIMARY KEY,
  current_tier TEXT DEFAULT 'social_snapshot',
  tier_start_date INTEGER,           -- when current tier began
  billing_period_start INTEGER,      -- for billing/churn tracking
  billing_period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### `tier_history`
Audit log of all tier changes (transactionally linked to entitlements updates).

```sql
CREATE TABLE tier_history (
  history_id TEXT PRIMARY KEY,       -- "hist_<uuid>"
  account_id TEXT NOT NULL,          -- user id
  from_tier TEXT,                    -- previous tier (NULL for initial)
  to_tier TEXT NOT NULL,             -- upgraded/downgraded to
  changed_at INTEGER NOT NULL
)
```

## API

All functions are async and return promises.

### Jobs

**Create a job**
```js
const job = await db.createJob(accountId, tier, inputParams);
// Returns: { jobId, status: 'queued', createdAt }
```

**Get job status**
```js
const job = await db.getJob(jobId);
// Returns: { jobId, accountId, tier, status, stage, inputParams, resultPayload, error, createdAt, updatedAt }
```

**Update job (with optional result)**
```js
const job = await db.updateJobStatus(jobId, 'complete', {
  resultPayload: { /* full report body */ },
  stage: 'merge_complete',
  error: null // or error message if status='failed'
});
```

### Reports

**Create report**
```js
const report = await db.createReport(accountId, tier, businessInfo, reportBody);
// businessInfo: { handle, platform, category }
// reportBody: full report from api-contract §2-4
```

**Get report**
```js
const report = await db.getReport(reportId);
```

**Update refresh due date**
```js
const report = await db.updateReportRefreshDue(reportId, refreshDueAtTimestamp);
```

**List reports by account**
```js
const reports = await db.listReportsByAccount(accountId);
// Returns: [{ reportId, tier, business, generatedAt, refreshDueAt, reportBody, ... }]
```

**List reports due for refresh (batch job helper)**
```js
const dueSoon = await db.listReportsDueForRefresh(beforeTimestamp);
// Used by background job to find reports that need weekly/bi-weekly refresh
```

### Entitlements

**Get or create entitlement**
```js
const ent = await db.getOrCreateEntitlement(accountId);
// Returns: { accountId, currentTier, tierStartDate, billingPeriodStart, billingPeriodEnd, ... }
// Defaults to tier='social_snapshot' if new
```

**Get entitlement**
```js
const ent = await db.getEntitlement(accountId);
```

**Upgrade tier (transactional)**
```js
const ent = await db.upgradeTier(accountId, 'growth_plan');
// Atomically:
//   1. Updates entitlements.current_tier
//   2. Inserts into tier_history
// Both succeed together or both fail (no partial state)
```

**Get tier history**
```js
const history = await db.getTierHistory(accountId);
// Returns: [{ historyId, accountId, fromTier, toTier, changedAt }, ...]
```

## Persistence

Database is saved to `server/data/growth_engine.db`. 

Writes use the same atomic pattern as the existing flat-file code:
1. Export database to binary buffer
2. Write to temp file (`growth_engine.db.tmp`)
3. Atomic rename (temp → real file)

This ensures no corruption if the server crashes mid-write.

## Testing

Run tests to verify the full lifecycle:
```bash
npm test  # runs growth_engine_db.test.js
```

Verify data persistence across restarts:
```bash
node growth_engine_db.verify.js
```

## Integration with Evaluation Engine

The storage layer handles only **data persistence**. Convergence's LLM calling and parallel persona evaluation (in `routes/convergence.js`, to be written) will:
1. Create a job via `db.createJob()`
2. Transition to `running` via `db.updateJobStatus(jobId, 'running')`
3. Call Claude+Gemini personas in parallel
4. Merge results
5. Transition to `complete` via `db.updateJobStatus(jobId, 'complete', { resultPayload })`
6. Create a report via `db.createReport()` for later retrieval

See `api-contract.md` for the exact request/response shapes.

## Next Steps

1. Wire this module into API endpoints (create `routes/growth_engine.js`)
2. Implement evaluation engine (use existing Convergence proxy patterns)
3. Add background job for report refreshes (query `listReportsDueForRefresh`)
4. Integrate with billing/Stripe for entitlement enforcement
