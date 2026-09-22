require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

if(!process.env.JWT_SECRET || !process.env.ENCRYPTION_KEY){
  console.error(
    "\nMissing required environment variables.\n" +
    "Copy .env.example to .env and set JWT_SECRET and ENCRYPTION_KEY " +
    "(long random strings — see README for how to generate them).\n"
  );
  process.exit(1);
}

const authRoutes = require("./routes/auth");
const keysRoutes = require("./routes/keys");
const sessionsRoutes = require("./routes/sessions");
const proxyRoutes = require("./routes/proxy");
const growthEngineRoutes = require("./routes/growth-engine");
const geDb = require("./growth_engine_db_select");

// NOTE: Growth Engine uses its own sql.js database (geDb)
// Convergence services below are commented out—Growth Engine doesn't need them
// const Database = require("./db/init");
// const JobQueue = require("./services/jobQueue");
// const AuditAnalyzer = require("./services/auditAnalyzer");

const app = express();
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false, // the frontend loads Tailwind/React/Babel from CDNs; see README before hardening this for production
}));

// Enable CORS for Growth Engine API (allow Vercel frontend to call localhost backend during development)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow Vercel frontend and localhost
  if (origin && (origin.includes('vercel.app') || origin.includes('localhost'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Conversations accumulate history (every prior turn is replayed to the model),
// so bodies grow well past a couple of megabytes in long sessions. 2mb was too
// tight and produced opaque 413 HTML error pages mid-conversation.
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// Body-parser failures (oversized payload, malformed JSON) otherwise return an
// HTML error page that the frontend can't parse, surfacing as a confusing
// generic error. Return JSON so the real reason reaches the user.
app.use((err, req, res, next) => {
  if(err && (err.type === "entity.too.large" || err.status === 413)){
    return res.status(413).json({ error: "That request was too large to send (over our own 50mb server limit). Try starting a new session or trimming the conversation history.", source: "local" });
  }
  if(err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)){
    return res.status(400).json({ error: "The request body wasn't valid JSON.", source: "local" });
  }
  return next(err);
});

// Generous but present rate limiting: auth endpoints get a tighter limit
// since they're the most sensitive to brute-forcing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

// Initialize Growth Engine database (legacy)
geDb.initDb().catch((err) => {
  console.error("Failed to initialize Growth Engine database:", err);
  process.exit(1);
});

// NOTE: Phase 2 services (Convergence app) disabled for Growth Engine
// Growth Engine uses its own sql.js-based database (geDb) initialized above
// Commented out to avoid sqlite3 dependency during Growth Engine mode
/*
let db = null;
let jobQueue = null;
(async () => {
  try {
    console.log("[Server] Initializing Phase 2 services...");
    db = new Database(process.env.DB_PATH || "./server/data/convergence.db");
    await db.init();
    console.log("[Server] Database initialized");
    jobQueue = new JobQueue(db);
    console.log("[Server] Job queue initialized");
    const auditAnalyzer = new AuditAnalyzer(db, null, null);
    jobQueue.setAuditAnalyzer(auditAnalyzer);
    growthEngineRoutes.initializeServices(db, jobQueue);
    console.log("[Server] Growth Engine routes initialized");
  } catch (err) {
    console.error("[Server] Failed to initialize Phase 2 services:", err);
    process.exit(1);
  }
})();
*/

const BUILD_VERSION = "2026-09-14-a";

app.get("/api/version", (req, res) => {
  res.json({ build: BUILD_VERSION, bodyLimit: "50mb" });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/keys", apiLimiter, keysRoutes);
app.use("/api/sessions", apiLimiter, sessionsRoutes);
app.use("/api/proxy", apiLimiter, proxyRoutes);
app.use("/api/growth-engine/v1", apiLimiter, growthEngineRoutes);

// Share cards (spec 1.7): the PNG, and a public page that shows only the
// card and a "Score my account" button — never the report.
app.get("/cards/:id.png", async (req, res) => {
  try {
    const share = await geDb.getShare(String(req.params.id).slice(0, 32));
    if (!share) return res.status(404).type("text").send("Not found");
    const size = req.query.size === "square" ? "square" : "story";
    const png = require("./growth_engine_cards").render(share.kind, share.data, size, share.shareId);
    res.set({ "content-type": "image/png", "cache-control": "public, max-age=86400" }).send(png);
  } catch (err) { console.error("[Cards] render failed:", err.message); res.status(500).type("text").send("Card unavailable"); }
});
app.get("/s/:id", async (req, res) => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  try {
    const share = await geDb.getShare(String(req.params.id).slice(0, 32));
    if (!share) return res.status(404).type("html").send("<!DOCTYPE html><meta charset=utf-8><title>Scalecraft</title><p style='font-family:sans-serif;padding:40px'>That card doesn't exist any more.</p>");
    geDb.bumpShareViews(share.shareId).catch(() => { });
    require("./growth_engine_events").track("share_page_visited", { anon: req.get("x-anon-id") || null, ref: share.ref || null, reportId: share.reportId, ip: req.ip, props: { share_id: share.shareId, kind: share.kind } });
    const base = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const d = share.data; const cta = `${base}/${share.ref ? `?ref=${encodeURIComponent(share.ref)}` : ""}`;
    const title = share.kind === "moment" ? `@${d.handle}: ${d.title} on Scalecraft` : `@${d.handle} scored ${d.overall}/100 on Scalecraft`;
    res.type("html").send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="Scalecraft scores a public social account 0–100 and writes the plan. Score yours free.">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Score yours at ${esc(base.replace(/^https?:\/\//, ""))} — free, about a minute."><meta property="og:image" content="${base}/cards/${share.shareId}.png?size=square"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1080"><meta property="og:url" content="${base}/s/${share.shareId}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${base}/cards/${share.shareId}.png?size=square">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&display=swap">
<style>body{margin:0;background:#FFF6E9;color:#2A2118;font-family:"Instrument Sans",system-ui,sans-serif}.wrap{max-width:520px;margin:0 auto;padding:28px 16px 48px;text-align:center}.brand{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:20px;text-align:left}.card{margin:22px auto 0;width:100%;max-width:420px;border-radius:24px;overflow:hidden;box-shadow:0 3px 0 #EADFCB;background:#D2603A}.card img{display:block;width:100%;height:auto}h1{font-family:"Bricolage Grotesque",sans-serif;font-size:26px;letter-spacing:-.02em;margin:26px 0 8px}p{color:#5B4C3B;line-height:1.5;margin:0 0 20px}.btn{display:inline-block;padding:16px 26px;border-radius:14px;background:#D2603A;color:#FFF6E9;font-weight:700;text-decoration:none;font-size:17px}.fine{font-size:12px;color:#7A6A57;margin-top:22px}</style></head>
<body><div class="wrap"><div class="brand">Scalecraft</div>
<div class="card"><img src="${base}/cards/${share.shareId}.png?size=square" width="1080" height="1080" alt="${esc(title)}"></div>
<h1>${esc(title)}</h1><p>Four dimensions, scored from public posts, with the first moves to change. Takes about a minute.</p>
<a class="btn" href="${cta}">Score my account — free</a>
<div class="fine">Scores read public data only. <a href="${base}/#/how" style="color:#7A6A57">How the score works</a></div></div></body></html>`);
  } catch (err) { res.status(500).type("text").send("Card unavailable"); }
});

app.use(express.static(path.join(__dirname, "..", "public")));
// Locally stored post thumbnails (THUMB_STORAGE=local)
app.use("/thumbs", express.static(require("./growth_engine_thumbs").localDir, { maxAge: "365d", immutable: true, fallthrough: true }));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Convergence server running on http://localhost:${PORT}`);
  console.log(`Build ${BUILD_VERSION} — JSON body limit 50mb`);
});