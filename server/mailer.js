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
<tr><td style="padding:18px 28px 24px;border-top:1px solid #EADFCB;font-size:12px;line-height:1.7;color:#7A6A57">${footerNote ? esc(footerNote) + " · " : ""}Scalecraft · <a href="${APP}/#/reports" style="color:#7A6A57">Your reports</a>${SUPPORT ? ` · <a href="mailto:${esc(SUPPORT)}" style="color:#7A6A57">Reply or write to ${esc(SUPPORT)}</a>` : ""} · <a href="${APP}/#/legal/privacy" style="color:#7A6A57">Privacy</a>${userId ? ` · <a href="${pauseLink(userId)}" style="color:#7A6A57">Pause these emails</a>` : ""}</td></tr>
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

async function send({ to, subject, html, tag, devLink, pausable }) {
  if (!to) return { skipped: "no recipient" };
  if (pausable) { try { if (await geDb.isEmailPaused(to)) { console.log(`[Mail] paused — not sending "${subject}" to ${to}`); return { skipped: "paused" }; } } catch { /* send anyway */ } }
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(`[Mail] (no RESEND_API_KEY) would send "${subject}" to ${to}${devLink ? ` — ${devLink}` : ""}`); return { skipped: "no key", subject }; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, tags: tag ? [{ name: "type", value: tag }] : undefined }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`[Mail] ${res.status} sending "${subject}":`, body?.message || body); return { error: body?.message || `status ${res.status}` }; }
  console.log(`[Mail] sent "${subject}" to ${to} (${body.id})`);
  return { id: body.id };
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
  return send({ to, subject: `Phase ${phase} starts Monday — anything change?`, html: layout("Check-in", inner, { userId }), tag: "checkin", pausable: true });
}

// Weekly refresh where the score moved, optionally with a nudge.
function scoreChanged({ to, userId, handle, reportId, oldScore, newScore, dimension, delta, movesDone, nudge }) {
  const url = reportUrl(reportId);
  const up = newScore >= oldScore;
  const inner = h2(up ? `Your score went up.` : `Your score slipped.`) + scoreRow(oldScore, newScore)
    + p(`${esc(dimension)} moved ${delta > 0 ? "+" : ""}${esc(delta)}${movesDone ? ` after ${esc(movesDone)} move${movesDone === 1 ? "" : "s"} you marked done` : ""}. The moves and calendar for @${esc(handle)} have been rewritten against this week's posts.`)
    + (nudge ? `<div style="margin-top:20px;padding:16px 18px;background:#FBEED2;border-radius:14px;font-size:14px;line-height:1.55;color:#6B5310"><b>${esc(nudge.title)}</b><br>${esc(nudge.text)}</div>` + ghost(`${url}?nudge=${encodeURIComponent(nudge.key)}`, nudge.cta) : "")
    + button(url, "See what changed");
  return send({ to, subject: `${handle}: ${oldScore} → ${newScore}`, html: layout("Score changed", inner, { userId }), tag: "score_changed", pausable: true });
}

// Day 60 for one-time buyers: the plan they bought is over.
function planEnded({ to, userId, handle, reportId, overall, price }) {
  const url = reportUrl(reportId);
  const inner = h2(`Your 60 days are up.`)
    + p(`The plan you unlocked for @${esc(handle)} started at <b>${esc(overall)}</b>. Days 61–90 were written when you started — they're waiting in your report, locked.`)
    + p(`The Growth Plan re-scores you this week so you can see what the last 60 days changed, unlocks phase 3, and writes a fresh plan every 90 days. It's $${esc(price)} a month — less than the $15 you paid once.`)
    + button(`${url}`, "See phase 3 and what changed")
    + ghost(url, "Just open my report");
  return send({ to, subject: `Your 60-day plan for @${handle} is done — what now?`, html: layout("Plan ended", inner, { userId }), tag: "plan_ended", pausable: true });
}

// Password reset (route wiring is separate).
function passwordReset({ to, resetUrl }) {
  const inner = h2("Reset your password") + p("This link works once and expires in one hour. If you didn't ask for it, ignore this email.") + button(resetUrl, "Choose a new password");
  return send({ to, subject: "Reset your Scalecraft password", html: layout("Reset your password", inner), tag: "password_reset", devLink: resetUrl });
}

module.exports = { send, reportReady, checkin, scoreChanged, planEnded, passwordReset, reportUrl, pauseSig, configured: () => !!process.env.RESEND_API_KEY };
