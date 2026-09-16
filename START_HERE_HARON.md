# 🎯 Haron — Start Here

Backend is ready. **IMPORTANT: Schedule a Discord call with me ASAP to set up your environment properly** so we can build in parallel.

---

## 🎯 IMMEDIATE: Discord Call

We need to sync up to:
1. ✅ Get your Groq API key added to your local `.env`
2. ✅ Verify the full evaluation flow works (queue → poll → retrieve → display)
3. ✅ Align on which UI components to build first
4. ✅ Set up parallel development workflow

**Without this call, you'll hit blockers.** This takes 15 mins and unblocks everything.

---

## ⚠️ Environment Setup (Do This Before/After Call)

**You need your own API keys for testing.** We don't have Claude/Gemini credits yet.

**Best option: Use Groq (FREE)**
```bash
1. Go to https://console.groq.com/keys and sign up (free, no credit card)
2. Copy your API key
3. cd server && cp .env.example .env
4. Add to .env: GROQ_API_KEY=gsk_xxxxxxxxxxxxx
5. npm start
6. Test: curl http://localhost:3005/api/growth-engine/v1/health
```

**Why?** When you test the evaluation flow (queue → poll → retrieve), the backend needs to call an LLM to generate the report. Without an API key, it'll hang on "running" forever.

---

## 📚 What You Need to Read

1. **[TEAM_GUIDE.md](TEAM_GUIDE.md)** — Full API reference
   - All endpoints you'll call from the UI
   - Error codes + how to handle them
   - Health check endpoint for debugging

2. **[CONTEXT_HANDOFF.md](CONTEXT_HANDOFF.md)** — Project state
   - What's built, what's left
   - Architecture overview
   - Backend priorities

---

## 🚀 Build Order

### Phase 1: Pages (No API needed)
- [ ] Landing page (describe product, pricing tiers)
- [ ] Signup page
- [ ] Login page
- [ ] Dashboard page layout
- [ ] Evaluation form

### Phase 2: Auth Flow (Uses real API)
- [ ] Signup: `POST /auth/signup` → store token in localStorage
- [ ] Login: `POST /auth/login` → store token
- [ ] Redirect to dashboard on success
- [ ] Handle errors (email exists, invalid format, etc.)

### Phase 3: Dashboard (Uses real API)
- [ ] Show user profile: `GET /account/profile` (requires token)
- [ ] Show tier status: `GET /account/subscription-status` (requires token)
- [ ] Show past reports: `GET /account/reports` (requires token)
- [ ] "Upgrade tier" button → `POST /billing/subscribe`

### Phase 4: Evaluation Flow (Uses real API + requires LLM key!)
- [ ] Submit form: `POST /evaluate/social-snapshot` (works without token for now)
- [ ] Poll loop: `GET /job/:jobId` every 2 seconds (watch for `status: "complete"`)
- [ ] When complete: `GET /reports/:reportId` → returns `{ reportId, reportBody: {...} }`
- [ ] **Display report**: Parse `reportBody` and render as markdown/HTML
  - Note: Backend returns structured report object, NOT plain markdown
  - See TEAM_GUIDE.md for exact response format

### Phase 5: Polish
- [ ] Error handling (show error messages from API)
- [ ] Loading states
- [ ] Empty states
- [ ] Mobile responsive

---

## 🔗 How to Call the API

**Every protected endpoint needs JWT token:**
```javascript
const token = localStorage.getItem('token');
const response = await fetch('/api/growth-engine/v1/account/profile', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
const data = await response.json();

if (!response.ok) {
  // Standardized error format: { error, code, status }
  console.error(data.code, data.error);
}
```

**Error codes you'll see:**
- `INVALID_EMAIL` — Bad email format (400)
- `INVALID_PASSWORD` — Too short (400)
- `EMAIL_EXISTS` — Already registered (409)
- `AUTH_FAILED` — Wrong email/password (401)
- `INVALID_TOKEN` — Token expired (401)
- `INVALID_PLATFORM` — Wrong platform name (400)
- And more... see [TEAM_GUIDE.md](TEAM_GUIDE.md) for full list

---

## ✅ Test the Backend First

Before building UI, make sure backend works:

```bash
# 1. Start backend
cd server
npm start

# 2. Test signup
curl -X POST http://localhost:3005/api/growth-engine/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","company_name":"Test Co"}'

# Should return: { token, user: { user_id, email, company_name } }

# 3. Use token to test protected endpoint
TOKEN="eyJhbGciOiJIUzI1NiIs..."
curl -X GET http://localhost:3005/api/growth-engine/v1/account/profile \
  -H "Authorization: Bearer $TOKEN"

# Should return: { user_id, email, company_name, created_at, updated_at }
```

---

## 🎨 UI Architecture Suggestion

```
App
├── Landing (/)
├── Auth
│   ├── Signup (/signup)
│   └── Login (/login)
└── Dashboard (private, requires token)
    ├── Profile (/dashboard)
    ├── Reports (/reports)
    ├── Evaluate (/evaluate)
    └── Upgrade (/upgrade)
```

Use React Router or similar to manage auth state (token in localStorage).

---

## 📞 Quick Help

| Problem | Solution |
|---------|----------|
| "Backend not running" | `cd server && npm start` on port 3005 |
| "No LLM key error" | Add Groq key to .env (see Critical section above) |
| "401 Unauthorized" | Make sure you're sending `Authorization: Bearer {token}` header |
| "Email already exists" | Use different email or login instead |
| "Evaluation stuck on running" | Check server logs, verify LLM key works, try `/health` endpoint |
| "CORS error" | Make sure backend is running on 3005 |

---

## 🔗 Key Files

- `server/routes/growth-engine.js` — All endpoints live here
- `server/middleware.js` — Validation + error handling
- `TEAM_GUIDE.md` — Complete API reference
- `.env.example` — Copy to .env and fill in keys

---

---

## ✅ Current Status

**Backend:** Evaluation flow works end-to-end! 🎉
- ✅ Form submission queues job
- ✅ Job processing works (Groq LLM generating reports)
- ✅ Reports saved to database
- ✅ `/reports/:reportId` returns complete report object

**Frontend:** Evaluation form + polling works, but report display needs work
- ✅ Form submits to backend
- ✅ Polling works
- ❌ Report parsing error: frontend looking for wrong field name
- **Next:** Update report display logic to handle actual response format

**Why the error?** The backend returns a structured report object, but your code was looking for an `overall` field that doesn't exist. Easy fix once you see the actual response format in the Network tab.

---

**Discord call first, then pick one page and build it. The API is stable and waiting. 🚀**

