/**
 * Weekly refresh — re-scores every paid report whose refresh_due_at has
 * passed, so a Growth Plan keeps earning its $12 in month two.
 *
 * Runs inside the server process on a timer (no external cron needed on
 * Railway). Each due report becomes a normal job for the same account with
 * `scheduled: true`, which the route does not meter. The job queue then
 * attaches history (score/follower deltas, moves done since) and records the
 * outcome row. Email hooks fire from the queue when a sender is configured.
 *
 *   REFRESH_INTERVAL_MIN   how often to look for due reports (default 30)
 *   REFRESH_BATCH          max refreshes per sweep (default 10) — keeps a
 *                          backlog from stampeding the LLM key
 *   REFRESH_DISABLED=true  turn off (e.g. locally)
 */

const geDb = require("./growth_engine_db_select");

let timer = null;
let running = false;

async function sweep(jobQueue) {
  if (running) return { skipped: "busy" };
  running = true;
  const started = Date.now();
  let queued = 0, skipped = 0;
  try {
    const due = await geDb.listReportsDueForRefresh(Date.now());
    const batch = due.filter((r) => r.tier && r.tier !== "social_snapshot").slice(0, Number(process.env.REFRESH_BATCH || 10));
    for (const r of batch) {
      const b = r.business || {};
      if (!r.accountId || r.accountId === "demo-account" || !b.handle || !b.platform) { skipped++; continue; }
      // Still entitled? Lapsed accounts stop refreshing rather than burning credit.
      let tier = "social_snapshot";
      try { const ent = await geDb.getOrCreateEntitlement(r.accountId); tier = ent?.currentTier || ent?.current_tier || tier; } catch { /* treat as lapsed */ }
      if (tier === "social_snapshot") { await geDb.updateReportRefreshDue(r.reportId, null); skipped++; continue; }
      const input = { handle: b.handle, platform: b.platform, category: b.category, email: r.reportBody?.email || null, scheduled: true, refresh_of: r.reportId };
      const { jobId } = await geDb.createJob(r.accountId, "growth_plan", input);
      // Push the due date forward now so a slow job doesn't get picked up twice.
      await geDb.updateReportRefreshDue(r.reportId, Date.now() + 7 * 24 * 60 * 60 * 1000);
      jobQueue.processJob(jobId, r.accountId, "growth_plan", input).catch((err) => console.error(`[Refresh] job ${jobId} failed:`, err.message));
      queued++;
    }
  } catch (err) {
    console.error("[Refresh] sweep failed:", err.message);
  } finally {
    running = false;
  }
  if (queued || skipped) console.log(`[Refresh] queued ${queued}, skipped ${skipped} in ${Date.now() - started}ms`);
  return { queued, skipped };
}

function start(jobQueue) {
  if (process.env.REFRESH_DISABLED === "true") { console.log("[Refresh] disabled"); return; }
  const every = Math.max(1, Number(process.env.REFRESH_INTERVAL_MIN || 30)) * 60 * 1000;
  timer = setInterval(() => sweep(jobQueue), every);
  timer.unref?.();
  setTimeout(() => sweep(jobQueue), 15000).unref?.(); // first look shortly after boot
  console.log(`[Refresh] weekly refresh sweeper every ${every / 60000} min`);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, sweep };
