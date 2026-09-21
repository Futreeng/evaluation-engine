# Render Deployment — Quick Setup Checklist

You now have everything you need to deploy on Render. Here's what was created and what you need to do.

---

## ✅ What Was Created

| File | Purpose |
|------|---------|
| **Dockerfile** | Containerizes your Node.js backend (production-ready) |
| **render.yaml** | Render's infrastructure-as-code config (alternative to UI setup) |
| **RENDER_DEPLOYMENT.md** | Full step-by-step deployment guide |
| **API_KEYS_SETUP.md** (updated) | Now includes Render environment setup |

---

## 📋 Next Steps (in order)

### 1. Gather Your Secrets
Before deploying, collect these values:

- [ ] `JWT_SECRET` — Generate: `openssl rand -hex 32`
- [ ] `ENCRYPTION_KEY` — Generate: `openssl rand -hex 32`
- [ ] `DATABASE_URL` — From Railway: PostgreSQL → **Connect** → **Postgres Connection String**
- [ ] `APIFY_TOKEN` — From Apify: Settings → API tokens
- [ ] `CLAUDE_API_KEY` — From Anthropic console (optional but recommended)
- [ ] `GEMINI_API_KEY` — From Google AI Studio (optional)
- [ ] `STRIPE_API_KEY` — From Stripe dashboard (optional, for billing)

### 2. Connect GitHub to Render

1. Go to https://dashboard.render.com/
2. Click **"New +"** → **"Web Service"**
3. Click **"Connect account"** to authorize GitHub
4. Select `convergence-app` repository
5. Click **"Connect"**

### 3. Configure the Service

Fill in the form:

- **Name**: `convergence-api`
- **Runtime**: **"Docker"** (Dockerfile auto-detected ✓)
- **Branch**: `main`
- **Instance Type**: Start with **"Free"** tier

### 4. Set Environment Variables

In the Render form, add all values from Step 1:

```
NODE_ENV=production
PORT=3005
JWT_SECRET=<your secret from step 1>
ENCRYPTION_KEY=<your secret from step 1>
DATABASE_URL=<from Railway>
APIFY_TOKEN=<your token>
INSTAGRAM_ACCESS_TOKEN=<if you have it>
CLAUDE_API_KEY=<your key>
GEMINI_API_KEY=<your key>
... (other optional keys)
```

### 5. Deploy

Click **"Create Web Service"** and wait for the build to complete (~2-3 minutes).

### 6. Verify

Test the health endpoint:
```bash
curl https://convergence-api.onrender.com/api/growth-engine/v1/health
```

Should return:
```json
{"status":"ok"}
```

### 7. Update Frontend (if needed)

If your frontend is on Vercel, update the API URL:

**Option A: Vercel Environment Variables**
1. Go to Vercel project → **Settings** → **Environment Variables**
2. Update `VITE_API_URL` to `https://convergence-api.onrender.com`
3. Redeploy

**Option B: In Code**
```javascript
// Update frontend's API base URL
const API_URL = "https://convergence-api.onrender.com";
```

### 8. Test End-to-End

1. Go to https://scalecraft-demo.vercel.app/
2. Enter a real Instagram handle
3. Submit the form
4. Verify the report loads with real data (not mocks)

---

## 🆘 Troubleshooting Quick Links

| Issue | Solution |
|-------|----------|
| Build failed | → See RENDER_DEPLOYMENT.md → **Troubleshooting** → **Build Failed** |
| App won't start | → See RENDER_DEPLOYMENT.md → **Troubleshooting** → **Service Won't Start** |
| Database error | → See RENDER_DEPLOYMENT.md → **Troubleshooting** → **Database Connection Error** |
| API returns 500 | → Check Render **Logs** tab for error messages |
| Fake data still showing | → Verify `APIFY_TOKEN` and `INSTAGRAM_ACCESS_TOKEN` are set |

---

## 📚 Reference Files

- **RENDER_DEPLOYMENT.md** — Full guide (60+ lines of detail)
- **API_KEYS_SETUP.md** — How to get API keys (includes Render steps)
- **Dockerfile** — Container config (auto-used by Render)
- **render.yaml** — IaC alternative (if you prefer CLI/Git-based setup)

---

## 🎯 Key Points

✓ **Postgres stays on Railway** — No data migration needed  
✓ **No code changes** — Same backend code, just different host  
✓ **API keys centralized** — All set in Render environment  
✓ **Auto-redeploy on push** — Push to main → Render rebuilds automatically (if connected to GitHub)  

---

## Optional: Advanced Setup

### Use render.yaml Instead of UI

If you prefer infrastructure-as-code:

```bash
# Install Render CLI
npm install -g @render-com/cli

# Login
render login

# Deploy from render.yaml
render create --environment-vars APIFY_TOKEN=xxx,JWT_SECRET=yyy ...
```

### Automatic Deploys on Git Push

Already set up if you connected GitHub in Step 2. Every push to `main` triggers a rebuild.

To disable:
1. Go to Render service → **Settings** → **Git** → **Auto-deploy** → **Off**

---

## What's Next After Deployment?

- 📊 Monitor Render dashboard for uptime/performance
- 📝 Review API logs if users report issues
- 💰 Keep an eye on Apify costs (monitor at apify.com/billing)
- 🔄 Periodically refresh Instagram token (expires ~60 days)
- 📈 Upgrade Render instance if free tier hits resource limits

---

**Ready?** Start with **Step 1** above and work through the checklist!
