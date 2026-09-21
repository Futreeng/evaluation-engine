/**
 * Cost tracking (spec 1.2). Every scrape and every LLM call records what it
 * cost, attributed to the job/report/account that caused it.
 *
 * Attribution rides on AsyncLocalStorage: the job queue (and the competitor
 * route) run their work inside costs.run({...}), and the fetchers / LLM
 * callers deep in the stack call costs.add() without threading ids around.
 *
 * Rates are estimates in config, overridable by env (COST_RATES_JSON) —
 * update them when a provider changes price. Amounts are stored in cents
 * with 4 decimals so a $0.003 profile pull isn't rounded away.
 */
const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage();

// $ per 1M tokens (in, out) for LLMs; $ per unit for scrapes.
const DEFAULT_RATES = {
  llm: {
    "claude-opus-4-1": { in: 15, out: 75 },
    "claude-sonnet": { in: 3, out: 15 },
    "gemini-2.5-flash": { in: 0.30, out: 2.50 },
    "gemini-3.5-flash": { in: 0.30, out: 2.50 },
    "gemini-3.6-flash": { in: 0.30, out: 2.50 },
    "gemini-3.5-flash-lite": { in: 0.10, out: 0.40 },
    "groq/compound": { in: 0.15, out: 0.60 },
    "groq/compound-mini": { in: 0.10, out: 0.40 },
    "openai/gpt-oss-20b": { in: 0.10, out: 0.50 },
    "gpt-4o-mini": { in: 0.15, out: 0.60 },
    _default: { in: 0.50, out: 1.50 },
  },
  scrape: { "apify:instagram-profile": 0.003, "apify:instagram-post": 0.0023, "apify:tiktok-video": 0.004, _default: 0.003 },
};
let RATES = DEFAULT_RATES;
try { if (process.env.COST_RATES_JSON) { const o = JSON.parse(process.env.COST_RATES_JSON); RATES = { llm: { ...DEFAULT_RATES.llm, ...(o.llm || {}) }, scrape: { ...DEFAULT_RATES.scrape, ...(o.scrape || {}) } }; } } catch { console.warn("[Costs] COST_RATES_JSON did not parse; using defaults"); }

let geDb = null;
const db = () => (geDb ||= require("./growth_engine_db_select"));

// Run fn with this attribution; nested runs inherit unless overridden.
function run(ctx, fn) { return als.run({ ...(als.getStore() || {}), ...ctx }, fn); }
const current = () => als.getStore() || {};

function llmRate(model) { const m = String(model || ""); const key = Object.keys(RATES.llm).find((k) => k !== "_default" && m.startsWith(k)); return RATES.llm[key] || RATES.llm._default; }

// Record an LLM call. usage: { in, out } tokens.
function llm({ provider, model, label, usage }) {
  const r = llmRate(model);
  const tin = Number(usage?.in) || 0, tout = Number(usage?.out) || 0;
  const cents = (tin * r.in + tout * r.out) / 1e6 * 100;
  write({ kind: "llm", provider, model: String(model || "").slice(0, 60), label: String(label || "").slice(0, 60), quantity: tin + tout, detail: { in: tin, out: tout }, cents });
}
// Record a scrape. unit: "apify:instagram-profile" | "apify:tiktok-video"; quantity: profiles or videos.
function scrape({ unit, quantity = 1, handle, platform }) {
  const cents = (RATES.scrape[unit] ?? RATES.scrape._default) * quantity * 100;
  write({ kind: "scrape", provider: "apify", model: unit, label: handle ? `@${handle}` : "", quantity, detail: { platform }, cents });
}
function write(row) {
  const c = current();
  db().insertCost({ ...row, accountId: c.accountId || null, jobId: c.jobId || null, reportId: c.reportId || null, feature: c.feature || "other" })
    .catch((e) => console.warn("[Costs] write failed:", e.message));
}
// Let the job queue set the report id once it exists.
function setReport(reportId) { const s = als.getStore(); if (s) s.reportId = reportId; }

module.exports = { run, current, llm, scrape, setReport, RATES };
