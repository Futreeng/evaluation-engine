// Win-back (spec 4.4): 30 and 60 days after a cancellation took effect,
// rescore the account once and email "your score went from X to Y since you
// left" with a resubscribe link — or congratulations if it went up. Only for
// accounts opted in to product emails; each milestone fires once, marked on
// the report the rescore produces (`winback`), so a lapsed account costs at
// most two snapshot runs.

const geDb = require("./growth_engine_db_select");
const email = require("./growth_engine_email");
const DAY = 86400000;
const ENABLED = String(process.env.WINBACK_ENABLED || "true") !== "false";
const MILESTONES = (process.env.WINBACK_DAYS || "30,60").split(",").map((n) => Number(n)).filter((n) => n > 0).sort((a, b) => a - b);

async function checkLapsed(jobQueue, { now = Date.now(), limit = Number(process.env.WINBACK_BATCH || 5) } = {}) {
  if (!ENABLED || !jobQueue) return 0;
  const oldest = MILESTONES[MILESTONES.length - 1] + 14;
  const lapsed = await geDb.listLapsedEntitlements(now - oldest * DAY, now - MILESTONES[0] * DAY);
  let queued = 0;
  for (const l of lapsed) {
    if (queued >= limit) break;
    const days = (now - l.lapsedAt) / DAY;
    const due = [...MILESTONES].reverse().find((m) => days >= m && days < m + 14);
    if (!due) continue;
    const key = `d${due}`;
    const reports = await geDb.listReportsByAccount(l.accountId);
    if (!reports.length) continue;
    if (reports.some((r) => r.reportBody?.winback === key)) continue;
    // A rescore takes minutes and sweeps are frequent: remember the queue on the base report so it isn't queued twice.
    if (reports.some((r) => r.reportBody?.winback_queued?.key === key && now - r.reportBody.winback_queued.at < DAY)) continue;
    // Still lapsed? (they may have come back on their own)
    try { const ent = await geDb.getEffectiveEntitlement(l.accountId); if (ent.currentTier !== "social_snapshot") continue; } catch { continue; }
    if (!(await email.allowed(l.accountId, "product_news"))) continue;
    const base = reports.find((r) => r.generatedAt <= l.lapsedAt && Number.isFinite(r.reportBody?.scores?.overall)) || reports.find((r) => Number.isFinite(r.reportBody?.scores?.overall));
    if (!base) continue;
    const b = base.reportBody;
    const to = b.email || (await geDb.getUserById(l.accountId).catch(() => null))?.email;
    if (!to) continue;
    const input = { handle: b.business?.handle, platform: b.business?.platform, category: b.business?.category, email: to, scheduled: true, winback: key, winback_base: { overall: b.scores.overall, report_id: base.reportId, generated_at: base.generatedAt }, tz: b.tz || null };
    if (!input.handle || !input.platform) continue;
    await geDb.patchReportBody(base.reportId, { winback_queued: { key, at: now } }).catch(() => { });
    const { jobId } = await geDb.createJob(l.accountId, "social_snapshot", input);
    jobQueue.processJob(jobId, l.accountId, "social_snapshot", input).catch((err) => console.error(`[Winback] job ${jobId} failed:`, err.message));
    queued++;
  }
  return queued;
}

module.exports = { checkLapsed, MILESTONES, ENABLED };
