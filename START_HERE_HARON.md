# 🎯 HARON — YOUR DOMAIN

Backend is done. Here's what's ready for you to build with.

**You own the frontend.** Build it your way. These docs are just reference material—use what's helpful, ignore what's not. The backend will work with whatever you build as long as you hit the endpoints.

---

## ✅ What's Live Right Now

**Demo Frontend:** https://convergence-app-xi.vercel.app

This shows a **working example** of how to:
- Queue social media evaluations
- Poll for job completion
- Display reports with scores
- Show subscription tiers
- Handle errors properly

**This is NOT your final design.** It's a reference showing the correct API patterns.

---

## 📖 What You Need to Read (In Order)

### 1. **THIS FILE** (you're reading it)
   - Gives you the big picture

### 2. **HARON_DEPLOYMENT_INFO.md** (5 min read)
   - Deployment details
   - How the reference works
   - Development checklist
   - Common mistakes to avoid

### 3. **FRONTEND_INTEGRATION_GUIDE.md** (10 min read)
   - Complete API contract
   - Response shapes for all endpoints
   - Error handling patterns
   - Rate limiting rules
   - Tier enforcement logic

### 4. **Reference Implementation**
   - Location: `frontend-template/growth-engine-reference.html`
   - Also live at: https://convergence-app-xi.vercel.app
   - Use this to understand polling, error handling, response parsing

---

## 🚀 Your Mission (TL;DR)

1. ✅ **Understand the API** → Read FRONTEND_INTEGRATION_GUIDE.md
2. ✅ **Study the reference** → Open https://convergence-app-xi.vercel.app in browser, inspect code
3. ✅ **Design your UI** → Use your own design (not constrained by template)
4. ✅ **Implement the flow** → Queue → Poll → Retrieve → Display
5. ✅ **Test locally** → Backend on localhost:3000, frontend on your dev server
6. ✅ **Deploy** → Push to your repo, deploy to Vercel or your host

---

## 📋 Key API Endpoints You'll Use

```javascript
// 1. Queue an evaluation (returns job_id)
POST /api/growth-engine/v1/evaluate/social-snapshot
Body: { handle, platform, category, email }

// 2. Poll for completion (every 2 seconds)
GET /api/growth-engine/v1/job/{job_id}

// 3. Fetch completed report
GET /api/growth-engine/v1/reports/{report_id}

// 4. Show pricing & subscribe
GET /api/growth-engine/v1/billing/pricing
POST /api/growth-engine/v1/billing/subscribe

// 5. Check user's tier
GET /api/growth-engine/v1/entitlements
```

Full documentation: See FRONTEND_INTEGRATION_GUIDE.md

---

## ⚠️ Three Things Not to Do

❌ **DON'T** poll faster than 1 second per request  
❌ **DON'T** show paid features to free tier users  
❌ **DON'T** assume jobs complete instantly (takes 5-15 seconds)  

See FRONTEND_INTEGRATION_GUIDE.md for the full list of common mistakes.

---

## 🔧 Local Development Setup

```bash
# 1. Start backend
cd server
npm install
npm start
# Backend running on http://localhost:3000

# 2. In another terminal, start your frontend
cd ..
npm start  # or your frontend dev command
# Frontend on http://localhost:3000 or http://localhost:3001

# 3. Test the full flow:
# - Submit evaluation form
# - See "Evaluating..." spinner
# - Polling updates status
# - Report displays when done
```

---

## 📚 All Files You Need

| File | Purpose | Read Time |
|------|---------|-----------|
| **HARON_DEPLOYMENT_INFO.md** | Deployment setup & checklist | 5 min |
| **FRONTEND_INTEGRATION_GUIDE.md** | Complete API reference | 10 min |
| **frontend-template/growth-engine-reference.html** | Reference implementation | Study as needed |
| **GROWTH_ENGINE_API.md** | Detailed endpoint docs | Reference |
| **README.md** | Project overview | 5 min |

---

## 🎨 Design Freedom

✅ Use your own color scheme  
✅ Use your own layout  
✅ Use your own components & framework  
✅ Use your own animations  

Just follow the API contract and you're golden.

---

## ✔️ Implementation Checklist

- [ ] Read HARON_DEPLOYMENT_INFO.md
- [ ] Read FRONTEND_INTEGRATION_GUIDE.md
- [ ] Review reference at https://convergence-app-xi.vercel.app
- [ ] Set up local backend (cd server && npm start)
- [ ] Build your UI
- [ ] Test queue → poll → retrieve flow locally
- [ ] Test error cases (bad inputs, network failures)
- [ ] Test subscription tier restrictions
- [ ] Deploy to Vercel / your host
- [ ] Verify against live backend

---

## 🆘 If You Get Stuck

**Q: "My polls are hitting rate limits (429 errors)"**  
A: Slow down to 1 request every 2 seconds. See FRONTEND_INTEGRATION_GUIDE.md → "Implement Polling Correctly"

**Q: "What should the report look like?"**  
A: See FRONTEND_INTEGRATION_GUIDE.md → "API Response Shapes" → "Report Full Response"

**Q: "How do I restrict features by subscription tier?"**  
A: See FRONTEND_INTEGRATION_GUIDE.md → "Handle All Job States" section

**Q: "The backend keeps returning 402 Payment Required"**  
A: User doesn't have access to that tier. Check their entitlements first: `GET /entitlements`

**More questions?** See FRONTEND_INTEGRATION_GUIDE.md — it has a full FAQ.

---

## 🚀 You're Ready

- ✅ Backend is production-ready
- ✅ API is documented & tested
- ✅ Reference implementation is live
- ✅ All guides are written
- ✅ Your design is yours to make

**Start with:** HARON_DEPLOYMENT_INFO.md (next file)

---

**Questions?** → See FRONTEND_INTEGRATION_GUIDE.md  
**Need API docs?** → See GROWTH_ENGINE_API.md  
**Want to see it working?** → https://convergence-app-xi.vercel.app  
**Want to study the code?** → frontend-template/growth-engine-reference.html  

---

**Status:** Backend ✅ | Reference Frontend ✅ | Your Turn 🚀

Good luck! 🎉
