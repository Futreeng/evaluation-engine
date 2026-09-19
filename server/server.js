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
const geDb = require(process.env.DATABASE_URL ? "./growth_engine_db_postgres" : "./growth_engine_db");

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

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Convergence server running on http://localhost:${PORT}`);
  console.log(`Build ${BUILD_VERSION} — JSON body limit 50mb`);
});