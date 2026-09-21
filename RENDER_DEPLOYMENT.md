# Render Backend Deployment Guide

This guide walks through deploying the Convergence API backend on **Render** while keeping PostgreSQL on **Railway**.

---

## Why Render Instead of Railway?

- **Better Node.js support**: Render has more reliable Node.js runtime detection vs Railway's Nixpacks issues
- **Simpler config**: Docker-native deployment (Dockerfile provided)
- **Same Postgres**: Keep your existing Railway Postgres database
- **Cost**: Similar pricing, simpler to debug

---

## Prerequisites

1. **Render account**: https://dashboard.render.com/ (free tier available)
2. **Railway Postgres running**: Your existing database connection string
3. **GitHub repo connected** (recommended for automatic deploys)

---

## Step 1: Connect GitHub to Render

1. Go to https://dashboard.render.com/
2. Click **"New +"** → **"Web Service"**
3. Select **"Build and deploy from a Git repository"**
4. Click **"Connect account"** to authorize GitHub
5. Select your `convergence-app` repository
6. Click **"Connect"**

---

## Step 2: Configure the Web Service

After connecting your repo, you'll see the deployment form:

### Basic Settings
- **Name**: `convergence-api`
- **Runtime**: Select **"Docker"** (Dockerfile will be auto-detected)
- **Branch**: `main`
- **Build Command**: `(leave empty — Dockerfile handles this)`
- **Start Command**: `(leave empty — Dockerfile handles this)`
- **Instance Type**: Start with **"Free"** tier (0.5 GB RAM) for testing

### Environment Variables
Click **"Advanced"** → **"Add Environment Variable"** and set:

```
NODE_ENV=production
PORT=3005
JWT_SECRET=<your 32+ byte random secret>
ENCRYPTION_KEY=<your 32+ byte random secret>
DATABASE_URL=<your Railway Postgres connection string>
APIFY_TOKEN=<your Apify token>
INSTAGRAM_ACCESS_TOKEN=<your Instagram Graph API token>
INSTAGRAM_BUSINESS_ACCOUNT_ID=<optional>
CLAUDE_API_KEY=<your Claude API key>
GEMINI_API_KEY=<your Gemini API key>
GROQ_API_KEY=<your Groq API key>
OPENAI_API_KEY=<optional>
STRIPE_API_KEY=<optional for billing>
FREE_SNAPSHOTS_PER_EMAIL=1
```

**Generate secure secrets locally** (if needed):
```bash
openssl rand -hex 32
```

### Health Check
- **Health Check Path**: `/api/growth-engine/v1/health`
- **Health Check Timeout**: `120` seconds

---

## Step 3: Deploy

1. Click **"Create Web Service"** (or **"Deploy"**)
2. Render will:
   - Clone your repo
   - Build the Docker image
   - Deploy the service
   - Print a live URL like `https://convergence-api.onrender.com`

3. **Monitor the build** in the **Logs** tab:
   - Look for `"Build Successful"` message
   - Service will be `"Live"` when ready (~2-3 minutes first time)

---

## Step 4: Verify Deployment

### Check Health Endpoint
```bash
curl https://convergence-api.onrender.com/api/growth-engine/v1/health
```

Expected response:
```json
{"status":"ok"}
```

### Check Backend Logs
1. Go to your Render service dashboard
2. Click **"Logs"** tab
3. Should see: `listening on port 3005` and no errors

### Test the Full Flow
1. Go to your frontend: https://scalecraft-demo.vercel.app/
2. Enter a real Instagram handle
3. Submit the form
4. Should see the report load and display real data (not mocks)

---

## Step 5: Update Frontend (if needed)

If your frontend is on Vercel and pointing to Railway, update it to use Render:

1. Go to **Vercel project** → **Settings** → **Environment Variables**
2. Update `VITE_API_URL` or `REACT_APP_API_URL`:
   ```
   https://convergence-api.onrender.com
   ```
3. Redeploy Vercel

Or update in frontend code if hardcoded:
```javascript
// Before
const API = "https://my-railway-api.up.railway.app";

// After
const API = "https://convergence-api.onrender.com";
```

---

## Ongoing Management

### Redeploy Manually
If you need to redeploy without pushing code:
1. Go to your Render service
2. Click **"Manual Deploy"** → **"Deploy latest commit"**

### View Logs
- **Render Logs**: Dashboard → **Logs** tab
- Shows all stdout/stderr from your app

### Update Environment Variables
1. Click **"Environment"** tab
2. Edit the variable
3. Click **"Save"** (auto-redeploys)

### Monitor Performance
- **CPU/Memory**: Check in the **"Metrics"** tab
- If hitting limits, upgrade to **"Standard"** tier ($7/month)

---

## Troubleshooting

### Build Failed
**Check**: Logs for missing dependencies
- Ensure `server/package.json` has all required packages
- Run `npm install` locally to verify

### "Cannot find module"
**Check**: Dockerfile working directory
- Ensure paths are relative to `/app`
- Current Dockerfile: `WORKDIR /app`, `COPY server/ ./server/`

### Database Connection Error
**Check**: `DATABASE_URL` is set correctly
```
DATABASE_URL should be: postgres://user:pass@host:port/dbname
```
- Copy this from Railway dashboard: **PostgreSQL** → **Connect** → **Postgres Connection String**

### API Returns 500 Errors
**Check**: Render logs for specific error messages
- Look for lines starting with `Error:` or `TypeError`
- Common issues:
  - Missing environment variables
  - Database connection timeout
  - Invalid API keys (Claude, Apify, etc.)

### Service Won't Start
**Check**: Render logs at boot time
- Ensure `server/server.js` is the correct entry point
- Verify `PORT=3005` is used in server code

---

## Keeping Postgres on Railway

Your PostgreSQL database remains on **Railway**. No migration needed:

1. Railway Postgres stays running as-is
2. Render API connects via `DATABASE_URL` env var (Postgres connection string)
3. Render and Railway communicate over the public internet (encrypted)

**If you want to move Postgres to Render later:**
- Render offers managed PostgreSQL too
- Just update `DATABASE_URL` to the new Render Postgres connection string
- No code changes needed

---

## Undoing (Back to Railway)

If you want to revert to Railway backend:

1. Pause or delete the Render service
2. Update frontend `VITE_API_URL` back to Railway URL
3. Redeploy frontend

---

## Next Steps

- ✅ Backend running on Render
- ✅ Postgres on Railway
- 🔄 Update frontend API endpoint (if not already done)
- 🔄 Test full flow end-to-end
- 📊 Monitor Render logs and metrics as you test

---

Questions? Check Render logs first — they print the exact error you're hitting.
