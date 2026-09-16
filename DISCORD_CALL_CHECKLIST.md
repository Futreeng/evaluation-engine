# Discord Call Checklist — Getting Ready to Launch

**Duration:** ~30 mins  
**Goal:** Set up Haron's environment + align on parallel development  
**When:** When Haron is home

---

## ✅ Part 1: Environment Setup (5 mins)

### Check Haron's Setup
- [ ] Does Haron have a free Groq API key? (https://console.groq.com/keys)
- [ ] Has he run `cp .env.example .env` in the server folder?
- [ ] Has he added `GROQ_API_KEY=gsk_...` to his `.env`?
- [ ] Can he run `npm start` in server folder without errors?

### Verify Health Check
```bash
curl http://localhost:3005/api/growth-engine/v1/health
```
Should show:
- `"status": "ok"`
- `"groq": "configured"` (at minimum)

---

## ✅ Part 2: Walk Through Evaluation Flow (10 mins)

### Live Test (Use Postman, curl, or browser):

**1. Queue evaluation:**
```bash
curl -X POST http://localhost:3005/api/growth-engine/v1/evaluate/social-snapshot \
  -H "Content-Type: application/json" \
  -d '{"handle":"twitter","platform":"x","category":"tech","email":"test@test.com"}'
```
Response: `{ "job_id": "job_...", "status": "queued" }`

**2. Poll job status (wait 30-60 sec, then poll):**
```bash
curl http://localhost:3005/api/growth-engine/v1/job/{job_id}
```
Response progression:
- First: `{ "status": "running" }`
- Later: `{ "status": "complete", "resultPayload": {...} }`

**3. Fetch report:**
```bash
curl http://localhost:3005/api/growth-engine/v1/reports/{report_id}
```
Response: `{ "reportId": "...", "reportBody": {...} }`

### Checkpoints:
- [ ] Job queues successfully
- [ ] Status progresses: queued → running → complete
- [ ] Report fetches without errors
- [ ] Report body has structure (not undefined)

---

## ✅ Part 3: Clarify Frontend Integration (10 mins)

### What Haron Needs to Build

**Phase 1 (This Week):**
- [ ] Evaluation form submission → calls `/evaluate/social-snapshot`
- [ ] Poll loop → calls `/job/:jobId` every 2 seconds
- [ ] Report display → calls `/reports/:reportId` and renders `reportBody`

**Phase 2 (Next Week):**
- [ ] Signup/login pages (no rush, can build in parallel)
- [ ] Dashboard (show reports, tier status)

### Key Integration Points
1. **Response format:** Report returns `{ reportId, reportBody: {...}, ...}`
   - NOT `{ overall: ... }` (this was the error)
   - `reportBody` is a JSON object with narrative content

2. **Error handling:** All errors are standardized
   - `{ error: "...", code: "ERROR_CODE", status: 400 }`
   - Haron should handle by error code, not by message

3. **No auth required (for now)** on `/evaluate/social-snapshot`
   - Will add auth back once he builds login UI

### Deliverable: Report Display
When report completes, Haron needs to:
1. Parse `reportBody` object
2. Display narrative as readable text/markdown
3. Show strengths, opportunities, action plan

---

## ✅ Part 4: Agree on Parallel Development (5 mins)

### Split the Work

**Haron's Track (Frontend):**
- Build evaluation form (input validation on frontend side)
- Implement queue → poll → retrieve flow
- Display report results
- Build landing page + pricing info
- Once evaluated: auth flow (signup/login/dashboard)

**Your Track (Backend):**
- Add Stripe integration (real payment, not mock)
- Add tier enforcement (free = 1 eval/month, paid = unlimited)
- Add Instagram API handling (if credentials available)
- Database cleanup/optimization

### Communication:
- [ ] Agree on daily standup time (Slack/Discord)
- [ ] Haron uses `/health` endpoint to debug API issues
- [ ] You use TEAM_GUIDE.md error codes to help Haron debug
- [ ] Next sync: When Haron finishes eval form + report display

---

## 📋 Things to Send Haron After Call

- [ ] Updated START_HERE_HARON.md (explains current state)
- [ ] TEAM_GUIDE.md section on report response format
- [ ] Link to GitHub repo
- [ ] Your Discord handle for quick questions

---

## 🚀 Success Criteria

After this call, Haron should:
- ✅ Have working backend running locally with Groq key
- ✅ Understand exactly how evaluation flow works (queue → poll → retrieve)
- ✅ Know report response structure (to fix the 'overall' error)
- ✅ Have clear next steps (build eval form + report display)
- ✅ Feel confident to build in parallel

---

## 📞 Call Agenda (Print This)

```
1. (5 min) Quick environment check
   - Does Groq key work?
   - Does health check pass?

2. (10 min) Walk through evaluation API live
   - Queue job
   - Poll status
   - Fetch report
   - Confirm he sees the data

3. (10 min) Explain what he builds next
   - Form → queue job
   - Poll loop → track status
   - Display report → parse reportBody

4. (5 min) Align on split work + communication

Total: ~30 minutes
```

---

**Notes:**
- Record this for reference if needed
- Save the curl commands for testing
- Once this works, Haron has green light to build UI

