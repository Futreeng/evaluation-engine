/**
 * Mailer — transactional email through Resend's REST API (no SDK).
 *
 *   RESEND_API_KEY   from resend.com; when unset every send is a no-op that
 *                    logs the subject, so local runs never email anyone
 *   MAIL_FROM        e.g. "Scalecraft <hello@scalecraft.app>" (verified domain)
 *   APP_URL          public origin for links, e.g. https://scalecraft.app
 *
 * Every email is built here in the Field Guide identity (600px, inline
 * styles). The HTML in server/emails/ is the design reference for these.
 */

const crypto = require("crypto");
const geDb = require("./growth_engine_db_select");
const email = require("./growth_engine_email");

const FROM = process.env.MAIL_FROM || "Scalecraft <onboarding@resend.dev>";
const APP = (process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "");
const SUPPORT = process.env.SUPPORT_EMAIL || "";

// One-click "pause these emails" link: no login (they're in their inbox),
// signed so it can't be forged for someone else.
const pauseSig = (userId) => crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(`pause:${userId}`).digest("hex").slice(0, 32);
const pauseLink = (userId) => `${APP.replace(/\/$/, "")}/api/growth-engine/v1/email/pause?u=${encodeURIComponent(userId)}&s=${pauseSig(userId)}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reportUrl = (id) => `${APP}/#/report/${encodeURIComponent(id)}`;

function layout(title, inner, { footerNote, userId } = {}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#FFF6E9;font-family:'Instrument Sans',Helvetica,Arial,sans-serif;color:#2A2118">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF6E9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#FFFDF8;border:1px solid #EADFCB;border-radius:24px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:1px solid #EADFCB;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.02em">Scalecraft</td></tr>
<tr><td style="padding:28px">${inner}</td></tr>
<tr><td style="padding:18px 28px 6px;font-size:12px;line-height:1.7;color:#7A6A57">${footerNote ? esc(footerNote) + " · " : ""}<a href="${APP}/#/reports" style="color:#7A6A57">Your reports</a></td></tr>
<!--footer-->
</table></td></tr></table></body></html>`;
}
const h2 = (t) => `<h2 style="margin:0;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.03em">${esc(t)}</h2>`;
const p = (t, extra = "") => `<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#5B4C3B;${extra}">${t}</p>`;
const button = (href, label, bg = "#D2603A") => `<a href="${href}" style="display:block;margin-top:22px;padding:16px;border-radius:14px;background:${bg};color:#FFF6E9;text-align:center;font-size:16px;font-weight:700;text-decoration:none">${esc(label)}</a>`;
const ghost = (href, label) => `<a href="${href}" style="display:block;margin-top:10px;padding:14px;border-radius:14px;border:1px solid #E0D2BA;color:#2A2118;text-align:center;font-size:15px;font-weight:600;text-decoration:none">${esc(label)}</a>`;
const moveCard = (eyebrow, action, why) => `<div style="margin-top:20px;padding:20px;background:#FFF6E9;border:1px solid #EADFCB;border-left:5px solid #D2603A;border-radius:18px">
  <div style="font-size:12px;letter-spacing:0.1em;color:#7A6A57">${esc(eyebrow)}</div>
  <p style="margin:8px 0 0;font-size:17px;line-height:1.45;font-weight:600">${esc(action)}</p>${why ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.55;color:#5B4C3B">Why: ${esc(why)}</p>` : ""}</div>`;
const scoreRow = (oldS, newS) => `<div style="margin-top:20px;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-size:44px;font-weight:700;letter-spacing:-0.03em">${esc(oldS)} <span style="color:#7A6A57">→</span> ${esc(newS)}</div>`;

// All sending goes through the email service (preferences, footer, log).
// `tag` is the template name; `type` the preference bucket.
const TYPE_OF = { report_ready: "transactional", password_reset: "transactional", checkin: "monday_move", monday_move: "monday_move", score_changed: "weekly_score", plan_ended: "weekly_score", moment: "milestones" };
async function send({ to, userId = null, subject, html, tag, devLink, optOutUrl = null }) {
  let uid = userId;
  if (!uid && to) { try { uid = (await geDb.getUserByEmail(String(to).toLowerCase()))?.userId || null; } catch { /* anonymous recipient */ } }
  return email.send({ to, userId: uid, type: TYPE_OF[tag] || "transactional", subject, html, devLink, optOutUrl });
}

// ---------------------------------------------------------------- emails

// Job complete → the score and the first move.
function reportReady({ to, handle, reportId, overall, grade, summary, firstMove, paid }) {
  const url = reportUrl(reportId);
  const inner = h2(`@${handle} scores ${overall}${grade ? ` · ${grade}` : ""}`) + p(esc(summary || ""))
    + (firstMove ? moveCard("MOVE 01 · THIS WEEK", firstMove.action, firstMove.why) : "")
    + button(url, paid ? "Open your Growth Plan" : "Open your report")
    + (paid ? "" : p("Every move beyond the first, and your 12-week calendar, unlock with the Growth Plan."));
  return send({ to, subject: `Your Scalecraft score: ${overall} for @${handle}`, html: layout("Your report is ready", inner), tag: "report_ready" });
}

// Day 28 / 58 → "Phase N starts Monday. Anything change?"
function checkin({ to, userId, handle, reportId, phase, phaseLabel, firstMove, doneCount, totalCount }) {
  const url = reportUrl(reportId);
  const inner = h2(`Phase ${phase} starts Monday. Anything change?`)
    + p(`You're ${esc(doneCount)} of ${esc(totalCount)} moves into @${esc(handle)}'s plan. The next 30 days — <b>${esc(phaseLabel || "")}</b> — were written when you started. If your time, your goal or your next few weeks have changed, tell us and the plan is rewritten tonight. If not, one tap and it carries on.`)
    + (firstMove ? moveCard(`PHASE ${phase} · MOVE 01`, firstMove.action, firstMove.why) : "")
    + button(`${url}?checkin=${phase}&changed=0`, "Nothing changed — carry on", "#2E7D5B")
    + ghost(`${url}?checkin=${phase}&changed=1`, "Something changed — update my plan");
  return send({ to, userId, subject: `Phase ${phase} starts Monday — anything change?`, html: layout("Check-in", inner, { userId }), tag: "checkin" });
}

// Weekly refresh where the score moved, optionally with a nudge.
function scoreChanged({ to, userId, handle, reportId, oldScore, newScore, dimension, delta, movesDone, nudge }) {
  const url = reportUrl(reportId);
  const up = newScore >= oldScore;
  const inner = h2(up ? `Your score went up.` : `Your score slipped.`) + scoreRow(oldScore, newScore)
    + p(`${esc(dimension)} moved ${delta > 0 ? "+" : ""}${esc(delta)}${movesDone ? ` after ${esc(movesDone)} move${movesDone === 1 ? "" : "s"} you marked done` : ""}. The moves and calendar for @${esc(handle)} have been rewritten against this week's posts.`)
    + (nudge ? `<div style="margin-top:20px;padding:16px 18px;background:#FBEED2;border-radius:14px;font-size:14px;line-height:1.55;color:#6B5310"><b>${esc(nudge.title)}</b><br>${esc(nudge.text)}</div>` + ghost(`${url}?nudge=${encodeURIComponent(nudge.key)}`, nudge.cta) : "")
    + button(url, "See what changed");
  return send({ to, userId, subject: `${handle}: ${oldScore} → ${newScore}`, html: layout("Score changed", inner, { userId }), tag: "score_changed" });
}

// Monday move (spec 2.6): one action under 15 minutes with a one-tap done link.
const moveDoneUrl = (reportId, key, s) => `${APP}/api/growth-engine/v1/email/move-done?r=${encodeURIComponent(reportId)}&k=${encodeURIComponent(key)}&s=${s}`;
const optOutUrl = (reportId, s) => `${APP}/api/growth-engine/v1/email/optout?r=${encodeURIComponent(reportId)}&s=${s}`;
function mondayMove({ to, userId, handle, reportId, paid, kind, move, doneUrl, optOutUrl: oo }) {
  const url = reportUrl(reportId);
  let inner, subject;
  if (kind === "upgrade") {
    subject = `Monday: the next move for @${handle} is on the plan`;
    inner = h2("Your free move was last Monday.") + p(`The Growth Plan writes @${esc(handle)}'s next 90 days — a move every Monday, under 15 minutes, with a rescore every week to show what it changed. This is the only time we'll mention it.`) + button(`${url}?upgrade=1`, "See the plan") + ghost(url, "Open my report");
  } else {
    subject = `Monday move for @${handle}: ${move.action.slice(0, 60)}${move.action.length > 60 ? "…" : ""}`;
    const steps = (move.how || []).slice(0, 4).map((h) => `<li style="margin:0 0 6px">${esc(h)}</li>`).join("");
    inner = h2("This week's move.") + p(`${move.time ? `About ${esc(move.time)}. ` : "Under 15 minutes. "}${paid ? "One of the moves from your plan — tick it off and it counts toward your rescore." : "The first move from your free report."}`)
      + moveCard(`PHASE ${move.phase} · MOVE ${String(move.n).padStart(2, "0")}`, move.action, move.why)
      + (steps ? `<ol style="margin:14px 0 0;padding-left:20px;font-size:14px;line-height:1.55;color:#5B4C3B">${steps}</ol>` : "")
      + button(doneUrl, "Mark done", "#2E7D5B") + ghost(url, "Open the plan");
  }
  return send({ to, userId, subject, html: layout("Monday move", inner, { userId }), tag: "monday_move", optOutUrl: oo });
}

// Rank-up or milestone after a rescore (spec 2.2, 2.5). Pref: milestones.
function moment({ to, userId, handle, reportId, moment: m }) {
  const url = reportUrl(reportId);
  const inner = h2(esc(m.title)) + p(esc(m.line))
    + p(m.kind === "rank_up" ? `That's the score band for @${esc(handle)} moving up. The card is ready if you want to post it.` : m.kind === "record" ? `A post from this week beat everything we'd seen from @${esc(handle)} before${m.post?.caption ? ` — “${esc(m.post.caption.slice(0, 80))}”` : ""}. The card is ready if you want to post it.` : `Milestone logged for @${esc(handle)}. Your plan keeps going — the next move is on the report.`)
    + button(`${url}?moment=${encodeURIComponent(m.key)}`, "See the card");
  return send({ to, userId, subject: `@${handle}: ${m.title}`, html: layout(m.title, inner, { userId }), tag: "moment" });
}

// Day 60 for one-time buyers: the plan they bought is over.
function planEnded({ to, userId, handle, reportId, overall, price }) {
  const url = reportUrl(reportId);
  const inner = h2(`Your 60 days are up.`)
    + p(`The plan you unlocked for @${esc(handle)} started at <b>${esc(overall)}</b>. Days 61–90 were written when you started — they're waiting in your report, locked.`)
    + p(`The Growth Plan re-scores you this week so you can see what the last 60 days changed, unlocks phase 3, and writes a fresh plan every 90 days. It's $${esc(price)} a month — less than the $15 you paid once.`)
    + button(`${url}`, "See phase 3 and what changed")
    + ghost(url, "Just open my report");
  return send({ to, userId, subject: `Your 60-day plan for @${handle} is done — what now?`, html: layout("Plan ended", inner, { userId }), tag: "plan_ended" });
}

// Password reset (route wiring is separate).
function passwordReset({ to, resetUrl }) {
  const inner = h2("Reset your password") + p("This link works once and expires in one hour. If you didn't ask for it, ignore this email.") + button(resetUrl, "Choose a new password");
  return send({ to, subject: "Reset your Scalecraft password", html: layout("Reset your password", inner), tag: "password_reset", devLink: resetUrl });
}

module.exports = { send, reportReady, checkin, scoreChanged, planEnded, passwordReset, moment, mondayMove, moveDoneUrl, optOutUrl, reportUrl, pauseSig, layout, configured: () => email.configured() };
