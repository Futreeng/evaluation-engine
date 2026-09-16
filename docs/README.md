# futureEng Growth Engine — Documentation

This folder contains documentation for the Growth Engine SaaS platform.

---

## 📄 Current Documentation (Start Here)

**At the root level:**

1. **[CONTEXT_HANDOFF.md](../CONTEXT_HANDOFF.md)** ⭐ **START HERE**
   - Complete project state, architecture, and next steps
   - For: Backend dev picking up work
   - Updated: 2026-09-16 (today)

2. **[TEAM_GUIDE.md](../TEAM_GUIDE.md)** 
   - API reference, endpoints, auth flow, JWT tokens
   - For: Haron (frontend dev) building UI
   - Updated: 2026-09-16 (today)

3. **[BUSINESS_OPS.md](../BUSINESS_OPS.md)**
   - Business checklist, startup operations, compliance notes
   - For: Founder/business owner (you)
   - Status: Reference for ongoing operations

---

## 📦 What's Built

### Backend (Production Ready)
- ✅ Multi-platform evaluation (Twitter + Instagram; extensible for TikTok/LinkedIn)
- ✅ User authentication (signup, login, JWT tokens)
- ✅ Subscription tier management (free, $39, $99, $249/mo)
- ✅ Mock payment processing (Stripe integration ready)
- ✅ Async job queue (non-blocking evaluations)
- ✅ Narrative report generation (LLM-powered, 4-way fallback)
- ✅ Database (sql.js, no external DB needed)

### Frontend (Ready for UI)
- 🚀 All backend endpoints ready for integration
- 🚀 Auth endpoints live: signup, login, profile
- 🚀 Evaluation flow: queue → poll → retrieve
- 🚀 Billing flow: check tier, upgrade, pricing

---

## 🚀 Quick Links

**For Frontend Developer (Haron):**
1. Read: [TEAM_GUIDE.md](../TEAM_GUIDE.md) for API reference
2. Test: `curl -X POST http://localhost:3005/api/growth-engine/v1/auth/signup ...`
3. Build: Landing page → signup/login → dashboard → evaluation form

**For Backend Developer (You):**
1. Read: [CONTEXT_HANDOFF.md](../CONTEXT_HANDOFF.md) for project state
2. Next: Add tier enforcement, real Stripe integration, TikTok fetcher
3. Run: `cd server && npm start` (runs on port 3005)

**For Business/Operations:**
1. Read: [BUSINESS_OPS.md](../BUSINESS_OPS.md) for startup checklist
2. Get Stripe credentials from Haron
3. Schedule Discord call to pass keys securely

---

## 📋 Archive

Older documentation (outdated, kept for reference):
- `archived/README.md` — Old port numbers (was 3000, now 3005)
- `archived/START_HERE_HARON.md` — No auth endpoints (now added)
- `archived/FRONTEND_INTEGRATION_GUIDE.md` — Superseded by TEAM_GUIDE.md
- `archived/PHASE_*.md` — Status from earlier development stages
- `archived/FINAL_BACKEND_SUMMARY.md` — Old backend summary

If you need historical context, check the archive. Otherwise, ignore these.

---

## 🔗 File Structure

```
convergence-app/
├── CONTEXT_HANDOFF.md          ← Project state & handoff
├── TEAM_GUIDE.md               ← API reference for Haron
├── BUSINESS_OPS.md             ← Business checklist
├── docs/
│   ├── README.md               ← You are here
│   └── archived/               ← Old documentation (ignore)
├── server/                     ← Backend code
├── public/                     ← Frontend (built by Haron)
├── reports/                    ← Generated reports
└── package.json
```

---

## ✅ Status

- **Auth/Accounts:** ✅ Complete & tested
- **Instagram Fetcher:** ✅ Ready (needs API credentials)
- **Mock Stripe:** ✅ Ready (real Stripe pending)
- **Frontend:** 🚀 Ready to build (awaiting Haron)
- **Tier Enforcement:** 🔄 Pending
- **Real Stripe Integration:** 🔄 Pending

---

**Last Updated:** 2026-09-16
