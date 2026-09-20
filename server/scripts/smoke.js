#!/usr/bin/env node
/**
 * Smoke test — walks the customer path against a RUNNING server.
 *
 *   node scripts/smoke.js                       # http://localhost:3005
 *   SMOKE_BASE=https://…railway.app node scripts/smoke.js
 *   SMOKE_HANDLE=someaccount SMOKE_PLATFORM=instagram SMOKE_NICHE=travel node scripts/smoke.js
 *
 * Costs one profile pull the first time (cached 24h after) plus the LLM
 * calls for one free score and one plan. Takes 3–6 minutes. Run it before
 * merging anything that touches routes, billing, the queue or the DB modules.
 * Uses mock billing unless the server has STRIPE_API_KEY — don't point it at
 * production with real Stripe on.
 *
 * The free score is one per handle, ever — so either start the server with
 * FREE_SNAPSHOTS_PER_EMAIL=unlimited (and set SMOKE_FREE_UNLIMITED=1 here so
 * the 402 step is skipped), or pass a handle that has never been scored.
 */
const FREE_UNLIMITED = process.env.SMOKE_FREE_UNLIMITED === "1";
const BASE = (process.env.SMOKE_BASE || "http://localhost:3005").replace(/\/$/, "") + "/api/growth-engine/v1";
const HANDLE = process.env.SMOKE_HANDLE || "talon__wilson";
const PLATFORM = process.env.SMOKE_PLATFORM || "instagram";
const NICHE = process.env.SMOKE_NICHE || "travel";
const EMAIL = `smoke-${Date.now()}@example.test`;
const PASSWORD = "smoke-pass-123";

let token = null;
const results = [];
async function call(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token && !opts.anon ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* html or empty */ }
  return { status: res.status, json };
}
async function step(name, fn) {
  const t = Date.now();
  try { const out = await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`✔ ${name}${out ? " — " + out : ""} (${Date.now() - t}ms)`); }
  catch (err) { results.push({ name, ok: false, ms: Date.now() - t, err: err.message }); console.log(`✘ ${name} — ${err.message}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function waitJob(jobId, maxMs = 6 * 60 * 1000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const { json } = await call("GET", `/job/${jobId}`);
    if (json?.status === "complete") return json.resultPayload;
    if (json?.status === "failed") throw new Error(`job failed: ${json.error}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("job timed out");
}

(async () => {
  console.log(`Smoke: ${BASE} as ${EMAIL} on @${HANDLE} (${PLATFORM}/${NICHE})\n`);
  let freeReport = null, unlockedReport = null;

  await step("health", async () => { const { status, json } = await call("GET", "/health"); expect(status === 200 && json?.status === "ok", `status ${status}`); return `db ${json.db}`; });
  await step("pricing", async () => { const { json } = await call("GET", "/billing/pricing"); expect(json?.tiers?.some((t) => t.tier === "growth_plan"), "no growth_plan tier"); expect(json.one_time?.[0]?.days === 60, "one-time should be a 60-day plan"); return `$${json.tiers.find((t) => t.tier === "growth_plan").monthlyPrice}/mo, $${json.one_time[0].price} once`; });
  await step("signup", async () => { const { status, json } = await call("POST", "/auth/signup", { email: EMAIL, password: PASSWORD }); expect(status === 200 && json?.token, `status ${status}`); token = json.token; });
  await step("login wrong password → 401", async () => { const { status } = await call("POST", "/auth/login", { email: EMAIL, password: "nope-nope" }, { anon: true }); expect(status === 401, `status ${status}`); });
  await step("free score (with horizon answer)", async () => {
    const { status, json } = await call("POST", "/evaluate/social-snapshot", { handle: HANDLE, platform: PLATFORM, category: NICHE, email: EMAIL, plan_context: { horizon: "fewer_shoots" } });
    if (status === 402 && json?.code === "FREE_LIMIT_REACHED") throw new Error(`@${HANDLE} was already scored for free by another account — pass SMOKE_HANDLE=<unscored handle>, or run the server with FREE_SNAPSHOTS_PER_EMAIL=unlimited and SMOKE_FREE_UNLIMITED=1`);
    expect(status === 200 && json?.job_id, `status ${status}: ${JSON.stringify(json)}`);
    freeReport = await waitJob(json.job_id);
    expect(Number.isFinite(freeReport?.scores?.overall), "no score");
    expect(freeReport.growth_path?.phases?.length === 3, "expected 3 phases");
    expect(freeReport.plan_context?.horizon === "fewer_shoots", "horizon not carried");
    return `score ${freeReport.scores.overall}`;
  });
  await step("second free score for same handle → 402 with report_id", async () => {
    if (FREE_UNLIMITED) return "skipped (unlimited mode)";
    const { status, json } = await call("POST", "/evaluate/social-snapshot", { handle: HANDLE, platform: PLATFORM, category: NICHE, email: EMAIL });
    if (status === 200) { await waitJob(json.job_id).catch(() => {}); throw new Error("free limit not enforced (FREE_SNAPSHOTS_PER_EMAIL=unlimited?)"); }
    expect(status === 402 && json?.report_id, `status ${status}`);
  });
  await step("report is readable by owner", async () => { const { status, json } = await call("GET", `/reports/${freeReport.report_id}`); expect(status === 200 && (json.reportBody || json).scores, `status ${status}`); });
  await step("plan context save + read", async () => {
    const ctx = { horizon: "fewer_shoots", hours: "2_5", goal: "deals", style: "behind", notes: "smoke" };
    const put = await call("PUT", "/account/plan-context", { handle: HANDLE, platform: PLATFORM, plan_context: ctx }); expect(put.status === 200, `put ${put.status}`);
    const get = await call("GET", `/account/plan-context?handle=${HANDLE}&platform=${PLATFORM}`); expect(get.json?.plan_context?.goal === "deals", "context not saved");
  });
  await step("one-time unlock → 60-day plan", async () => {
    const { status, json } = await call("POST", `/reports/${freeReport.report_id}/unlock`, { plan_context: { horizon: "fewer_shoots", hours: "lt2", goal: "followers", style: "photos" } });
    expect(status === 200 && json?.job_id, `status ${status}: ${JSON.stringify(json)}`);
    unlockedReport = await waitJob(json.job_id);
    expect(unlockedReport.plan_days === 60, `plan_days ${unlockedReport.plan_days}`);
    expect(unlockedReport.growth_path.phases[2]?.not_included === true, "phase 3 should be locked");
    expect(unlockedReport.calendar?.weeks?.length === 8, `weeks ${unlockedReport.calendar?.weeks?.length}`);
    expect(unlockedReport.refresh_due_at == null, "one-time must not schedule a refresh");
    const moves = unlockedReport.growth_path.phases.slice(0, 2).flatMap((p) => p.moves);
    expect(moves.length >= 6 && moves.every((m) => m.how && m.how.length), "moves missing how");
    return `${moves.length} moves, ${unlockedReport.calendar.weeks.length} weeks`;
  });
  await step("check-in refused for one-time report → 402", async () => { const { status } = await call("POST", `/reports/${unlockedReport.report_id}/checkin`, { phase: 2, changed: false }); expect(status === 402, `status ${status}`); });
  await step("subscribe (mock) → growth_plan", async () => { const { status, json } = await call("POST", "/billing/subscribe", { tier: "growth_plan", billingCycle: "monthly" }); expect(status === 200 && json?.tier === "growth_plan", `status ${status}`); });
  await step("subscription status active", async () => { const { json } = await call("GET", "/account/subscription-status"); expect(json?.status === "active" && json.current_tier === "growth_plan", JSON.stringify(json)); });
  await step("cancel → pending, tier kept", async () => { const c = await call("POST", "/billing/cancel", { reason: "smoke" }); expect(c.json?.status === "cancel_pending", JSON.stringify(c.json)); const s = await call("GET", "/account/subscription-status"); expect(s.json.status === "cancel_pending" && s.json.current_tier === "growth_plan", JSON.stringify(s.json)); return `ends ${new Date(c.json.endsAt).toISOString().slice(0, 10)}`; });
  await step("resume → active", async () => { const r = await call("POST", "/billing/resume"); expect(r.json?.status === "active", JSON.stringify(r.json)); });
  await step("email pause on/off", async () => { const on = await call("POST", "/account/email/pause", { paused: true }); expect(on.json?.email_paused === true, "pause failed"); const off = await call("POST", "/account/email/pause", { paused: false }); expect(off.json?.email_paused === false, "resume failed"); });
  await step("forgot password (same reply for unknown email)", async () => { const a = await call("POST", "/auth/forgot", { email: EMAIL }, { anon: true }); const b = await call("POST", "/auth/forgot", { email: "nobody@example.test" }, { anon: true }); expect(a.status === 200 && b.status === 200 && a.json?.message === b.json?.message, "replies differ"); });
  await step("reset with bad token → 400", async () => { const { status } = await call("POST", "/auth/reset", { token: "0".repeat(64), password: "another-pass-1" }, { anon: true }); expect(status === 400, `status ${status}`); });
  await step("history lists both runs", async () => { const { json } = await call("GET", `/account/history?handle=${HANDLE}&platform=${PLATFORM}`); expect((json?.history || []).length >= 2, `history ${json?.history?.length}`); });
  await step("admin route needs token", async () => { const { status } = await call("GET", "/admin/queue-stats", null, { anon: true }); expect(status === 401 || status === 404, `status ${status}`); });
  await step("delete account", async () => { const { status } = await call("DELETE", "/account"); expect(status === 200, `status ${status}`); const me = await call("GET", "/auth/me"); expect(me.status === 401, "token still valid after delete"); });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(", ")}` : ""));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
