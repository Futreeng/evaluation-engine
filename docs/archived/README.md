# Convergence — Dual-Model Collaboration Studio + Growth Engine

This repo contains:

1. **Convergence** — Dual-model collaboration studio (Claude + Gemini)
2. **Growth Engine** — Production-ready SaaS backend for social media auditing with subscription tiers

## Growth Engine — Quick Start for Frontend

**Status:** Backend complete, ready for frontend integration.

### For Haron's UI Team

The Growth Engine API is ready at `/api/growth-engine/v1`. Here's what you need to build:

#### 1. Start the Backend
```bash
cd server
npm install
cp .env.example .env
# Add real keys:
CLAUDE_API_KEY=sk-ant-...
GEMINI_API_KEY=...
STRIPE_API_KEY=sk_test_...

npm start
# Backend running on http://localhost:3000
```

#### 2. Frontend Workflow (Async Pattern)

```
User submits: @handle + platform + category
  ↓
Frontend: POST /api/growth-engine/v1/evaluate/social-snapshot
  ↓ Response: { job_id, status: "queued" }
  ↓
Frontend: Show "Evaluating..." spinner
  ↓
Poll: GET /api/growth-engine/v1/job/{job_id} every 2 seconds
  ↓ Response: { status: "running" } ... { status: "complete" }
  ↓
Fetch: GET /api/growth-engine/v1/reports/{report_id}
  ↓ Response: Full report with scores, growth path, upsell
  ↓
Display: Show report in UI
```

#### 3. API Endpoints for Frontend

```javascript
// Queue evaluation (free tier)
POST /api/growth-engine/v1/evaluate/social-snapshot
Body: { handle, platform, category, email }
Returns: { job_id, status: "queued" }

// Poll job status
GET /api/growth-engine/v1/job/{job_id}
Returns: { status, stage, created_at, updated_at, error }

// Retrieve completed report
GET /api/growth-engine/v1/reports/{report_id}
Returns: { report_id, tier, scores, growth_path, business, upsell }

// List user's reports
GET /api/growth-engine/v1/reports
Returns: { reports: [...] }

// Check subscription tier
GET /api/growth-engine/v1/entitlements
Returns: { account_id, current_tier }

// Get pricing tiers
GET /api/growth-engine/v1/billing/pricing
Returns: { tiers: [...], discount: "25% off annual" }

// Create subscription
POST /api/growth-engine/v1/billing/subscribe
Body: { tier, billingCycle }
Returns: { tier, amountFormatted, status }
```

#### 4. Example Frontend Code

```javascript
// Step 1: Queue evaluation
async function evaluateSocialProfile(handle, platform, category, email) {
  const response = await fetch('/api/growth-engine/v1/evaluate/social-snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, platform, category, email })
  });
  return response.json(); // { job_id, status: "queued" }
}

// Step 2: Poll for completion
async function pollJobStatus(jobId, onStatusChange) {
  while (true) {
    const response = await fetch(`/api/growth-engine/v1/job/${jobId}`);
    const job = await response.json();
    
    onStatusChange(job.status); // "running", "complete", "failed"
    
    if (job.status === "complete") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error);
    }
    
    await new Promise(r => setTimeout(r, 2000)); // Poll every 2 seconds
  }
}

// Step 3: Fetch report
async function getReport(reportId) {
  const response = await fetch(`/api/growth-engine/v1/reports/${reportId}`);
  return response.json(); // Full report
}

// Put it together
async function runEvaluation(handle, platform, category, email) {
  try {
    // Queue
    const queueResponse = await evaluateSocialProfile(handle, platform, category, email);
    const jobId = queueResponse.job_id;
    
    // Poll
    await pollJobStatus(jobId, status => {
      console.log(`Status: ${status}`);
      // Update UI: show spinner for "running", etc.
    });
    
    // Fetch report (job response contains report_id)
    const jobResponse = await fetch(`/api/growth-engine/v1/job/${jobId}`);
    const job = await jobResponse.json();
    const report = await getReport(job.resultPayload.report_id);
    
    // Display report
    console.log(report);
    // Render: scores, growth_path, upsell button
  } catch (error) {
    console.error('Evaluation failed:', error);
  }
}
```

#### 5. Subscription Flow

```javascript
// Get pricing
async function getPricing() {
  const response = await fetch('/api/growth-engine/v1/billing/pricing');
  return response.json();
}

// Subscribe to tier
async function subscribe(tier, billingCycle = 'monthly') {
  const response = await fetch('/api/growth-engine/v1/billing/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, billingCycle })
  });
  return response.json();
}
```

#### 6. Response Shapes (What Frontend Gets)

**Tier 0 Report:**
```json
{
  "report_id": "rpt_...",
  "tier": "social_snapshot",
  "scores": {
    "overall": 47,
    "category_avg": 61,
    "dimensions": [
      { "label": "Posting Consistency", "score": 35, "explanation": "..." }
    ]
  },
  "growth_path": {
    "phases": [
      {
        "range": "1-30",
        "visible_action": "Shift toward short-form video...",
        "locked": { "count": 4, "teaser": "4 specific moves + weekly calendar" }
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

---

## Convergence — Dual-Model Collaboration Studio

Claude and Gemini collaborate on a prompt — side-by-side, chained, or talking
directly to each other — with a small Node backend that now does the parts a
browser shouldn't be trusted with: it holds your API keys encrypted, makes the
actual calls to Anthropic and Google, and stores your conversations per
account. The browser never sees a raw API key, not even your own, after the
moment you type it in to save it.

## What changed from the single-file version

Previously this was one static HTML file that called Anthropic and Gemini
directly from the browser — which meant your API keys sat in page memory and
were visible in dev tools/network tab for the session. That's fine for a
quick local experiment, but not something to trust with a real key long-term
or share with anyone else.

Now:
- There's a real backend (`server/`) that owns your API keys. They're
  encrypted at rest (AES-256-GCM) and only ever decrypted in-memory, on the
  server, for the moment it takes to call Anthropic/Google. The browser gets
  back a masked hint (`••••ab12`), never the key itself.
- Accounts are real accounts (email + bcrypt-hashed password), so the app can
  be used by more than one person without everyone sharing one key.
- Conversations (turns, dialogue transcripts, settings) are stored server-side
  per account instead of the browser's localStorage, so they follow you
  between browsers/devices as long as you're signed in.
- All Claude/Gemini traffic is proxied through the backend over your own
  session — the frontend only ever talks to itself (same origin), never
  directly to `api.anthropic.com` or `generativelanguage.googleapis.com`.

## Project layout

```
convergence-app/
  server/            Node/Express backend
    server.js        entry point, security middleware, mounts routes
    db.js             file-backed datastore (users, keys, sessions)
    crypto.js          AES-256-GCM encrypt/decrypt for API keys at rest
    middleware/auth.js  verifies the session cookie (JWT)
    routes/
      auth.js          register / login / logout / me
      keys.js          save/check/delete API keys (write-only from client)
      sessions.js      CRUD for saved conversations
      proxy.js         streams requests to Claude/Gemini using the saved keys
    data/db.json       created on first run — your accounts/keys/sessions live here
    .env.example       copy to .env and fill in
  public/
    index.html         the frontend (React + Tailwind, no build step)
```

## Running it

Requires Node 18 or later (uses the built-in `fetch` and web-stream helpers).

```bash
cd server
npm install
cp .env.example .env
```

Generate two secrets and paste them into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run that twice — once for `JWT_SECRET`, once for `ENCRYPTION_KEY` — and put
each value in `.env`. These protect login sessions and your stored API keys
respectively; keep `.env` out of version control (it's already in
`.gitignore`) and never share these values.

```bash
npm start
```

Then open **http://localhost:3000** — the backend serves the frontend itself,
so there's only one thing to run and one origin involved (simpler and safer
than pointing a separately-hosted frontend at a different API host).

## First run

1. Create an account (email + password, 8+ characters minimum — this is
   local to your own server, there's no external identity provider).
2. Open the config panel, paste your Claude and Gemini API keys, and click
   **save keys**. They're encrypted and stored server-side immediately; the
   input fields clear and show a masked hint once saved.
3. Everything else — parallel/sequential/dialogue modes, critique & refine,
   token/cost tracking, sessions, JSON/Markdown export — works the same as
   before, just backed by the server instead of the browser.

## Free fallback for the left slot (no funded Claude account needed)

If you don't want to fund an Anthropic API account just to test whether this
app works for you, the config panel has a **left slot provider** selector:

- **Anthropic (Claude)** — the default, needs a funded API key.
- **Groq — free tier, no install** — hosted, fast, nothing to install
  locally. Get a key at **console.groq.com** (free signup) and paste it into
  the "Groq API key" field that appears when you pick this option. Free-tier
  terms can change, so check console.groq.com for what's currently offered.

Everything else — parallel/sequential/dialogue modes, critique & refine,
token tracking, sessions — works identically no matter which provider is in
the left slot; the app treats "left slot" as a role, not a specific company.
Switch back to Anthropic any time once you've funded that account — your
Gemini setup and saved conversations aren't affected by the switch.

## Model availability is checked before you can send anything

The app verifies your saved key and selected model actually work together
*before* letting you send a prompt — it calls each provider's models-list
endpoint (a free metadata call, no tokens spent) whenever you save a key or
change a model, and shows a live status under each model picker:

- "checking availability..." while it's verifying
- "✓ model available" once confirmed
- "✗ ..." with the specific problem if the model isn't accessible with that key

The Send button (and dialogue start/continue) stays disabled until both
sides show "✓ model available" — so a bad model ID or an unscoped key
surfaces in the config panel, not as a wasted attempt mid-conversation.

**If your Claude key needs a workspace ID:** some Anthropic API keys are
scoped to a specific workspace and return `"not scoped to a workspace"` on
every request until you provide one. There's a "Workspace ID" field under
the Claude API key field for exactly this — leave it blank unless you hit
that error, in which case add your workspace ID there and save again.

## Security notes, honestly

- **Encryption key management is the weak point of any self-hosted setup
  like this.** `ENCRYPTION_KEY` decrypts every saved API key. Treat it like a
  master password: store it in a secrets manager if you deploy this for real,
  not just in a `.env` file sitting on the same disk as the encrypted data.
  If someone gets both `data/db.json` and your `.env`, they get the keys.
- **This uses a JSON file as a datastore**, not a real database. That was a
  deliberate simplification to avoid native build dependencies and keep setup
  to `npm install && npm start`. It's fine for personal use or a small team on
  one machine, but it doesn't handle high write concurrency well and has no
  replication/backup story of its own — back up `server/data/db.json`
  yourself, and consider swapping in Postgres/SQLite-with-a-real-driver if
  you're putting this in front of more than a handful of people.
- **Sessions are stateless JWTs in an httpOnly cookie.** That means logging
  out just deletes the cookie — a stolen token remains valid until it expires
  (30 days) rather than being revocable server-side. For anything beyond
  personal/small-team use, add a token-revocation list or move to
  server-tracked sessions.
- **Run this behind HTTPS in production** (a reverse proxy like Caddy or
  nginx, or a platform that terminates TLS for you) and set `NODE_ENV=production`
  in `.env` so the session cookie gets the `Secure` flag. Over plain HTTP,
  the session cookie (and everything else) travels in the clear.
- **Rate limiting is in place** (`express-rate-limit`) on auth and API routes
  as a basic brute-force/abuse deterrent, but it's in-memory and per-process —
  fine for one instance, not a substitute for a real WAF if you're exposed to
  the open internet.
- The frontend still loads React/Tailwind/Babel from public CDNs
  (`unpkg.com`, `cdn.tailwindcss.com`, Google Fonts) — that's why
  `helmet`'s Content-Security-Policy is disabled in `server.js`. If you want a
  stricter CSP, vendor those scripts locally and re-enable it.

## Modes, features (unchanged from before)

- **Parallel** — same prompt to both models, compared side-by-side.
- **Sequential** — one model answers, the other builds on/refines it.
- **Dialogue** — Claude and Gemini talk directly to each other in a shared
  transcript; you set the topic, who speaks first, and how many exchanges,
  and can inject moderator messages, stop mid-stream, or regenerate the last
  message.
- **Phase 2 critique/refine** — either model critiques the other's answer,
  then the original author regenerates; you can promote the refined version
  as the final one.
- Token counts and cost estimates come from each API's real usage reporting.
  Pricing rates are editable placeholders in the config panel — verify them
  against current published pricing.
- **save json** / **export md** still work for taking a conversation out of
  the app; **import json** loads a previously exported file back in as a new
  session under your account.

## Known limitations

- Single-server, file-based storage — see security notes above before
  deploying this beyond personal/small-team use.
- No password reset flow (no email sending is wired up) — if you forget your
  password, you'd need to edit `server/data/db.json` by hand or add a reset
  flow yourself.
- Rerunning the *first* model in a sequential chain doesn't automatically
  re-run the second model with the new output.
