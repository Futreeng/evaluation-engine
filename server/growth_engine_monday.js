// Monday move (spec 2.6) — every Monday morning in the user's time zone, one
// action from their plan that takes under 15 minutes, with a one-tap "Mark
// done" link. Paid plans get their next undone move; a free report gets its
// one free move, then a single upgrade prompt, then nothing more.
//
// Runs inside the refresh sweep (every REFRESH_INTERVAL_MIN), so "Monday
// morning" is a window: local Monday, MONDAY_MOVE_HOUR ≤ hour < +4. Each
// report remembers the ISO weeks it was mailed for, so the window can be hit
// several times without a second email. Marking done goes through the same
// move log + outcomes row as the button on the report (1.15).
//
// Config: MONDAY_MOVE_ENABLED, MONDAY_MOVE_HOUR, MONDAY_MOVE_MAX_MIN, MONDAY_MOVE_LOOKBACK_DAYS.

const crypto = require("crypto");
const geDb = require("./growth_engine_db_select");
const mailer = require("./mailer");
const events = require("./growth_engine_events");

const ENABLED = String(process.env.MONDAY_MOVE_ENABLED || "true") !== "false";
const HOUR = Number(process.env.MONDAY_MOVE_HOUR || 8);
const MAX_MIN = Number(process.env.MONDAY_MOVE_MAX_MIN || 15);
const LOOKBACK_DAYS = Number(process.env.MONDAY_MOVE_LOOKBACK_DAYS || 100);
const DAY = 86400000;

// Signed one-tap links: no login needed from an inbox, can't be forged.
const sig = (s) => crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(s).digest("hex").slice(0, 32);
const doneSig = (reportId, key) => sig(`done:${reportId}:${key}`);
const verifyDone = (reportId, key, s) => !!reportId && !!key && s === doneSig(reportId, key);

// Local weekday/hour in a zone; falls back to UTC on a bad zone name.
function localParts(now, tz) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: false });
    const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    return { weekday: p.weekday, hour: Number(p.hour) % 24 };
  } catch { return localParts(now, "UTC"); }
}
function isMondayMorning(now, tz) { const l = localParts(now, tz); return l.weekday === "Mon" && l.hour >= HOUR && l.hour < HOUR + 4; }
// ISO week key, so one email per report per week regardless of sweep cadence.
function weekKey(now) { const d = new Date(now); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4)); const w = 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7); return `${y}-W${String(w).padStart(2, "0")}`; }

const minutesOf = (t) => { const m = String(t || "").match(/(\d+)\s*(min|minute)/i); return m ? Number(m[1]) : null; };

// Next undone move under MAX_MIN; else the next undone move of any length.
function pickMove(body, paid) {
  const done = body.moves_done || {};
  const phases = body.growth_path?.phases || [];
  const all = [];
  phases.forEach((p, i) => {
    if (p.not_included) return;
    const pk = `p${i + 1}`;
    all.push({ key: `${pk}m1`, title: p.label || `Phase ${i + 1}`, action: p.visible_action || p.action || "", why: p.detail || "", how: p.opener?.how || [], time: p.opener?.time || null, phase: i + 1, n: 1 });
    for (const m of p.moves || []) all.push({ key: `${pk}m${m.n}`, title: m.title || "", action: m.action || "", why: m.why || "", how: m.how || [], time: m.time || null, phase: i + 1, n: m.n });
  });
  const undone = all.filter((m) => !done[m.key] && m.action);
  if (!undone.length) return null;
  if (!paid) return undone.find((m) => m.key === "p1m1") || null; // the one free move
  // Stay inside the phase the plan is currently in, so Monday doesn't jump ahead.
  const started = body.plan_started_at || body.generated_at || Date.now();
  const curPhase = Math.min(phases.length, 1 + Math.floor((Date.now() - started) / DAY / 30));
  const inPhase = undone.filter((m) => m.phase <= curPhase);
  const pool = inPhase.length ? inPhase : undone;
  return pool.find((m) => { const mins = minutesOf(m.time); return mins != null && mins <= MAX_MIN; }) || pool[0];
}

// One sweep. `now` and `force` exist for tests; force skips the Monday-morning check.
async function sendMondayMoves({ now = Date.now(), force = false } = {}) {
  if (!ENABLED) return 0;
  const rows = await geDb.listReportsWithEmailSince(now - LOOKBACK_DAYS * DAY);
  const latest = new Map();
  for (const r of rows) {
    const k = `${String(r.reportBody?.email || "").toLowerCase()}|${r.business?.platform}|${String(r.business?.handle || "").toLowerCase()}`;
    if (!latest.has(k) || latest.get(k).generatedAt < r.generatedAt) latest.set(k, r);
  }
  const wk = weekKey(now);
  let sent = 0;
  for (const r of latest.values()) {
    const body = r.reportBody || {};
    const to = body.email; if (!to || body.email_optout) continue;
    if (r.accountId === "demo-account") continue;
    if (!force && !isMondayMorning(now, body.tz)) continue;
    const sentWeeks = body.monday_moves_sent || [];
    if (sentWeeks.includes(wk)) continue;
    const paid = !!r.tier && r.tier !== "social_snapshot";
    if (paid) {
      // Lapsed subscribers stop getting Mondays; one-time buyers stop at day 60.
      if (body.one_time_unlock && (now - (body.plan_started_at || r.generatedAt)) / DAY > (body.plan_days || 60)) continue;
      if (!body.one_time_unlock && r.accountId) { try { const ent = await (geDb.getEffectiveEntitlement || geDb.getOrCreateEntitlement)(r.accountId); const tier = ent?.currentTier || ent?.current_tier; if (!tier || tier === "social_snapshot" || tier === "maintenance") continue; if (ent.pausedUntil && ent.pausedUntil > now) continue; } catch { continue; } }
    }
    const move = pickMove(body, paid);
    let kind;
    if (paid) { if (!move) continue; kind = "move"; }
    else if (move && !sentWeeks.length) kind = "move";
    else if (!body.monday_upgrade_sent) kind = "upgrade";
    else continue;
    const r2 = await mailer.mondayMove({
      to, userId: r.accountId || null, handle: r.business?.handle, reportId: r.reportId, paid, kind, move,
      quest: paid && process.env.ENABLE_QUESTS === "true" && body.quest && body.quest.ends_at > now ? body.quest : null,
      doneUrl: move ? mailer.moveDoneUrl(r.reportId, move.key, doneSig(r.reportId, move.key)) : null,
      optOutUrl: r.accountId ? null : mailer.optOutUrl(r.reportId, sig(`optout:${r.reportId}`)),
    });
    if (r2 && (r2.skipped || r2.error)) continue;
    const patch = { monday_moves_sent: [...sentWeeks, wk].slice(-60) };
    if (kind === "upgrade") patch.monday_upgrade_sent = now;
    await geDb.patchReportBody(r.reportId, patch);
    events.track("monday_move_sent", { accountId: r.accountId || null, reportId: r.reportId, props: { kind, key: move?.key || null, paid } });
    sent++;
  }
  return sent;
}

const verifyOptOut = (reportId, s) => !!reportId && s === sig(`optout:${reportId}`);

module.exports = { sendMondayMoves, pickMove, isMondayMorning, weekKey, doneSig, verifyDone, verifyOptOut, ENABLED, _test: { localParts, minutesOf } };
