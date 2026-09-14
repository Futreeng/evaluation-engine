# Frontend Template — Reference Only

This directory contains a **reference implementation** of the Futreeng Growth Engine frontend.

## ⚠️ Important

**Haron's design work is NOT constrained by this template.** 

- This is just a working example showing one way to implement the async evaluation flow
- You are free to (and should) build your own design that matches Futreeng's brand
- This template will never overwrite your actual frontend — it lives in `frontend-template/`, not in `public/`
- Use this ONLY for reference when implementing the API integration patterns

## What This Contains

**`growth-engine-reference.html`** — A complete, single-file example showing:
- Form for queuing an evaluation
- Polling logic to check job status
- Report display with scores and growth path
- Pricing table and subscription flow
- All async patterns implemented correctly

## How to Use It

1. **For implementation reference:**
   - Open in browser: `file:///path/to/growth-engine-reference.html`
   - Inspect the JavaScript code for polling patterns
   - Check response shape handling

2. **For styling inspiration:**
   - Uses Tailwind CSS (from CDN)
   - Professional blue/green color scheme
   - Responsive grid layout
   - Card-based design

3. **Do NOT:**
   - Deploy this file directly
   - Use this as your actual frontend (build your own)
   - Assume this is the final design

## Building Your Own Frontend

Start with the backend contract (see `FRONTEND_INTEGRATION_GUIDE.md` at project root):

1. **Queue evaluation** → `POST /evaluate/social-snapshot`
2. **Poll status** → `GET /job/{job_id}` (every 2 seconds)
3. **Fetch report** → `GET /reports/{report_id}`
4. **Handle pricing** → `GET /billing/pricing` + `POST /billing/subscribe`

The template shows how—now build it with YOUR design.

## Reference API Calls

All the key patterns from this template:

```javascript
// Queue evaluation
const queueResponse = await fetch(`${API_BASE}/evaluate/social-snapshot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ handle, platform, category, email })
});

// Poll for completion
const statusResponse = await fetch(`${API_BASE}/job/${jobId}`);
const statusData = await statusResponse.json();

// Fetch report
const reportResponse = await fetch(`${API_BASE}/reports/{report_id}`);
const report = await reportResponse.json();
```

See the implementation in `growth-engine-reference.html` for the complete flow.

---

**Template Purpose:** Reference implementation for backend API integration  
**Your Responsibility:** Design and build the actual frontend UI  
**Backend Status:** Production-ready and will never interfere with your work  
**Questions?** See FRONTEND_INTEGRATION_GUIDE.md or check the backend tests for patterns
