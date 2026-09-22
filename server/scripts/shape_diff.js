#!/usr/bin/env node
/**
 * Mock vs real API shape diff (spec 1.1).
 *
 * Loads public/mock-api.js in a tiny browser shim and calls the same routes
 * against a RUNNING real server, then prints every key that exists on one
 * side and not the other (arrays compared by their first element). Reads
 * only — never queues an evaluation, so it costs nothing.
 *
 *   node scripts/shape_diff.js                          # http://localhost:3005
 *   SHAPE_BASE=https://… SHAPE_TOKEN=<jwt> SHAPE_REPORT=rpt_… SHAPE_JOB=job_… node scripts/shape_diff.js
 *
 * SHAPE_TOKEN should belong to a paid account with at least one report so the
 * paid-only routes (plan context, referrals, reports list) have real bodies.
 * Without SHAPE_REPORT/SHAPE_JOB the newest report on that account is used.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BASE = (process.env.SHAPE_BASE || "http://localhost:3005").replace(/\/$/, "") + "/api/growth-engine/v1";
const TOKEN = process.env.SHAPE_TOKEN || "";
// Server-side fields app.js never reads (raw scrape rows, persona drafts,
// scorer internals). Listed so the diff only shows what the SPA would notice;
// SHAPE_IGNORE= adds to it, SHAPE_STRICT=1 shows everything.
const SERVER_ONLY = /\.(posts|posts\[\]|posts_sampled|posts_last_14d|bio|thumb_prefix|raw_personas|explanation_rejections|plan_context\.[a-z_]+)(\.|\[|$)|dimensions\[\]\.(evidence|parts|explanation_source)|post_insights\.patterns\.(format_avg|day_avg)|business\.is_business_account|apis\./;
const IGNORE = new Set((process.env.SHAPE_IGNORE || "").split(",").filter(Boolean));
const ignored = k => IGNORE.has(k) || (!process.env.SHAPE_STRICT && SERVER_ONLY.test("." + k));

// ---- mock side ------------------------------------------------------------
const mockSrc = fs.readFileSync(path.join(__dirname, "..", "..", "public", "mock-api.js"), "utf8");
const win = { SCALECRAFT_CONFIG: { apiBase: "/api/growth-engine/v1", mock: { queuedMs: 0, stageMs: 0 } } };
const ctx = vm.createContext({ window: win, location: { origin: "http://mock" }, btoa, atob, encodeURIComponent, decodeURIComponent, setTimeout, Date, Math, JSON, Array, Object, String, Number, Boolean, Map, Set, Promise, console });
vm.runInContext(mockSrc, ctx);
const mockFetch = win.scalecraftMockFetch;

// ---- real side ------------------------------------------------------------
async function realCall(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* html */ }
  return { status: res.status, json };
}
async function mockCall(method, p, body, token) {
  const r = await mockFetch("/api/growth-engine/v1" + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}

// ---- shape walk -----------------------------------------------------------
function shape(v, prefix, out) {
  if (Array.isArray(v)) { out.set(prefix, "array"); if (v.length) shape(v[0], prefix + "[]", out); return; }
  if (v && typeof v === "object") { out.set(prefix, "object"); for (const k of Object.keys(v)) shape(v[k], prefix ? prefix + "." + k : k, out); return; }
  out.set(prefix, v === null ? "null" : typeof v);
}
function diff(a, b) {
  const A = new Map(), B = new Map(); shape(a, "", A); shape(b, "", B);
  const onlyMock = [], onlyReal = [], typeMismatch = [];
  for (const [k, t] of A) { if (!k || ignored(k)) continue; if (!B.has(k)) onlyMock.push(k); else if (B.get(k) !== t && B.get(k) !== "null" && t !== "null") typeMismatch.push(`${k} (mock ${t} / real ${B.get(k)})`); }
  for (const k of B.keys()) { if (!k || ignored(k)) continue; if (!A.has(k)) onlyReal.push(k); }
  return { onlyMock, onlyReal, typeMismatch };
}

async function main() {
  const email = `shape-${Date.now()}@example.test`, password = "shape-pass-123";
  // Sign up on both sides so authed routes have a token each.
  const su = { real: await realCall("POST", "/auth/signup", { email, password }), mock: await mockCall("POST", "/auth/signup", { email, password }) };
  const mockTok = su.mock.json?.token || "mock";
  const paidTok = TOKEN || su.real.json?.token;
  // Newest report on the paid account, for the report/job routes.
  let reportId = process.env.SHAPE_REPORT, jobId = process.env.SHAPE_JOB;
  if (paidTok && !reportId) { const l = await realCall("GET", "/account/reports", null, paidTok); reportId = l.json?.reports?.[0]?.reportId; }
  if (!jobId) console.log("(set SHAPE_JOB=job_… to compare GET /job/:id — skipped)");
  // Mock report: drive one evaluation through the (zero-delay) mock queue.
  await mockCall("POST", "/billing/subscribe", { tier: "growth_plan", cycle: "monthly" }, mockTok);
  const ev = await mockCall("POST", "/evaluate/social-snapshot", { handle: "shape", platform: "instagram", category: "travel", email }, mockTok);
  const mockJob = ev.json?.job_id; let mockRep = null;
  for (let i = 0; i < 40 && !mockRep; i++) { const j = await mockCall("GET", "/job/" + mockJob, null, mockTok); if (j.json?.status === "complete") mockRep = j.json.resultPayload?.report_id; else await new Promise(r => setTimeout(r, 50)); }

  // The real paid report already carries a competitor set; give the mock one too.
  if (mockRep) await mockCall("POST", "/reports/" + mockRep + "/competitors", { handles: ["rival_one", "rival_two"] }, mockTok);

  const cases = [
    ["GET /health", "GET", "/health"],
    ["GET /billing/pricing", "GET", "/billing/pricing"],
    ["POST /auth/signup", null, null, null, su],
    ["POST /auth/login", "POST", "/auth/login", { email, password }],
    ["GET /auth/me", "GET", "/auth/me", null, null, true],
    ["GET /account/subscription-status", "GET", "/account/subscription-status", null, null, true],
    ["GET /account/reports", "GET", "/account/reports", null, null, true],
    ["GET /account/plan-context", "GET", "/account/plan-context?handle=" + (process.env.SHAPE_HANDLE || "talon__wilson") + "&platform=instagram", null, null, true],
    ["GET /account/email-prefs", "GET", "/account/email-prefs", null, null, true],
    ["GET /account/referrals", "GET", "/account/referrals", null, null, true],
    ["POST /billing/promo/check", "POST", "/billing/promo/check", { code: "NOPE", product: "growth_plan", cycle: "monthly" }, null, true],
    ["POST /waitlist", "POST", "/waitlist", { email, platform: "youtube", handle: "shape" }],
    ...(jobId ? [["GET /job/:id", "GET", null, null, null, true, { real: "/job/" + jobId, mock: "/job/" + mockJob }]] : []),
    ["GET /reports/:id", "GET", null, null, null, true, { real: "/reports/" + reportId, mock: "/reports/" + mockRep }],
    ["POST /reports/:id/share", "POST", null, {}, null, true, { real: "/reports/" + reportId + "/share", mock: "/reports/" + mockRep + "/share" }],
  ];
  let issues = 0;
  for (const [name, method, p, body, pre, authed, paths] of cases) {
    let real, mock;
    if (pre) ({ real, mock } = pre);
    else {
      real = await realCall(method, paths ? paths.real : p, body, authed ? paidTok : null);
      mock = await mockCall(method, paths ? paths.mock : p, body, authed ? mockTok : null);
    }
    const d = diff(mock.json, real.json);
    const statusNote = mock.status === real.status ? "" : `  status mock ${mock.status} / real ${real.status}`;
    const n = d.onlyMock.length + d.onlyReal.length + d.typeMismatch.length + (statusNote ? 1 : 0);
    issues += n;
    console.log(`${n ? "△" : "✔"} ${name}${statusNote}`);
    if (d.onlyMock.length) console.log("    only in mock : " + d.onlyMock.join(", "));
    if (d.onlyReal.length) console.log("    only in real : " + d.onlyReal.join(", "));
    if (d.typeMismatch.length) console.log("    type mismatch: " + d.typeMismatch.join(", "));
  }
  console.log(`\n${issues ? issues + " differences" : "shapes match"}`);
}
main().catch(e => { console.error(e); process.exit(1); });
