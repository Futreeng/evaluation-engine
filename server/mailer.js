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
const pathUrl = (id) => `${APP}/#/path/${encodeURIComponent(id)}`;

// Field Guide identity, email edition. Single column, 600px, inline styles,
// tables only (Gmail and Outlook drop flex and external CSS). The one colour
// that moves is the account's dimension colour, passed as `tint`.
const F = { ground: "#FFF6E9", card: "#FFFDF8", line: "#EADFCB", line2: "#E0D2BA", ink: "#2A2118", body: "#5B4C3B", muted: "#7A6A57", act: "#B84E2A", green: "#2E7D5B", gold: "#FBEED2", goldT: "#6B5310", dark: "#2A2118", onDark: "#FFF6E9", onDarkMuted: "#D8C9B4" };
const DISPLAY = "'Bricolage Grotesque',Helvetica,Arial,sans-serif";
const SANS = "'Instrument Sans',Helvetica,Arial,sans-serif";
const DIM_COLOURS = { "Posting Consistency": "#D2603A", "Content Mix": "#2E7D5B", "Engagement Quality": "#3F6CB0", "Profile Clarity": "#B0614A" };
const dimColour = (label) => DIM_COLOURS[label] || F.act;

// eyebrow: small caps line in the masthead (what this email is). preheader: the
// inbox preview text, hidden in the body. handle/platform: the account line.
function layout(title, inner, { footerNote, userId, eyebrow, preheader, handle, platform, tint } = {}) {
  const mark = `<td width="14" style="width:14px;height:14px;border-radius:4px;background:${tint || F.act};font-size:0;line-height:0">&nbsp;</td>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${F.ground};font-family:${SANS};color:${F.ink};-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${F.ground}">${esc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${F.ground}"><tr><td align="center" style="padding:28px 12px 36px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:${F.card};border:1px solid ${F.line};border-radius:24px">
<tr><td style="padding:20px 28px 18px;border-bottom:1px solid ${F.line}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    ${mark}<td style="padding-left:10px;font-family:${DISPLAY};font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${F.ink}">Scalecraft</td>
    <td align="right" style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${F.muted};white-space:nowrap">${esc(eyebrow || title)}</td>
  </tr></table>
</td></tr>
${handle ? `<tr><td style="padding:16px 28px 0;font-size:13px;color:${F.muted}">@${esc(handle)}${platform ? ` · ${esc(platform)}` : ""}</td></tr>` : ""}
<tr><td style="padding:${handle ? "10px" : "28px"} 28px 28px">${inner}</td></tr>
<tr><td style="padding:16px 28px 6px;border-top:1px solid ${F.line};font-size:12px;line-height:1.7;color:${F.muted}">${footerNote ? esc(footerNote) + "<br>" : ""}Reply to this email and a person answers. <a href="${APP}/#/reports" style="color:${F.muted}">Your reports</a></td></tr>
<!--footer-->
</table></td></tr></table></body></html>`;
}
const h2 = (t) => `<h2 style="margin:0;font-family:${DISPLAY};font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.03em;color:${F.ink}">${esc(t)}</h2>`;
const p = (t, extra = "") => `<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:${F.body};${extra}">${t}</p>`;
const eyebrowText = (t, colour = F.muted) => `<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${colour}">${esc(t)}</div>`;
const button = (href, label, bg = F.act) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px"><tr><td align="center" style="border-radius:14px;background:${bg}"><a href="${href}" style="display:block;padding:16px;border-radius:14px;color:${F.onDark};text-align:center;font-size:16px;font-weight:700;text-decoration:none">${esc(label)}</a></td></tr></table>`;
const ghost = (href, label) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:10px"><tr><td align="center" style="border:1px solid ${F.line2};border-radius:14px"><a href="${href}" style="display:block;padding:13px;color:${F.ink};text-align:center;font-size:15px;font-weight:600;text-decoration:none">${esc(label)}</a></td></tr></table>`;
// One move: eyebrow, the action, why, optional how-steps. The left rule is the accent.
const moveCard = (eyebrow, action, why, { how = [], colour = F.act, doneWhen = null, time = null } = {}) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>
  <td width="5" style="width:5px;background:${colour};border-radius:18px 0 0 18px;font-size:0">&nbsp;</td>
  <td style="padding:18px 20px;background:${F.ground};border:1px solid ${F.line};border-left:0;border-radius:0 18px 18px 0">
    ${eyebrowText(eyebrow)}${time ? `<div style="font-size:12px;color:${F.muted};margin-top:2px">${esc(time)}</div>` : ""}
    <p style="margin:8px 0 0;font-size:17px;line-height:1.45;font-weight:600;color:${F.ink}">${esc(action)}</p>
    ${why ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.55;color:${F.body}"><b style="color:${F.ink}">Why:</b> ${esc(why)}</p>` : ""}
    ${how.length ? `<ol style="margin:12px 0 0;padding-left:20px;font-size:14px;line-height:1.55;color:${F.body}">${how.slice(0, 4).map((x) => `<li style="margin:0 0 5px">${esc(x)}</li>`).join("")}</ol>` : ""}
    ${doneWhen ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${F.muted}"><b>Done when:</b> ${esc(doneWhen)}</p>` : ""}
  </td></tr></table>`;
// The score, big, with the grade beside it. Grade band colours follow the app.
const gradeColours = (grade) => /strong|great|excellent/i.test(grade || "") ? ["#E4F0E9", "#226B4C"] : /weak|poor|needs/i.test(grade || "") ? ["#F8E3DB", "#8E3A1E"] : [F.gold, F.goldT];
const bigScore = (score, grade) => { const [bg, fg] = gradeColours(grade); return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:6px"><tr>
  <td style="font-family:${DISPLAY};font-size:84px;line-height:0.9;font-weight:700;letter-spacing:-0.05em;color:${F.ink}">${esc(score)}</td>
  <td style="padding-left:16px;vertical-align:middle">${grade ? `<span style="display:inline-block;padding:6px 13px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:700;letter-spacing:0.04em">${esc(String(grade).toUpperCase())}</span>` : ""}<div style="margin-top:8px;font-size:12px;color:${F.muted}">out of 100</div></td>
</tr></table>`; };
// Four dimension rows as bars. Tables, not divs with flex, so every client draws them.
const dimRows = (dims) => !dims?.length ? "" : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px">${dims.map((d) => { const c = dimColour(d.label); const w = Math.max(2, Math.min(100, Math.round(Number(d.score) || 0))); return `<tr><td style="padding:0 0 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:14px;color:${c};font-weight:600">${esc(d.label)}</td><td align="right" style="font-size:14px;font-weight:700;color:${F.ink}">${esc(d.score)}${d.delta ? `<span style="font-weight:600;color:${d.delta > 0 ? F.green : F.act}"> ${d.delta > 0 ? "+" : ""}${esc(d.delta)}</span>` : ""}</td></tr></table>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:5px;background:#F1E2CB;border-radius:999px"><tr><td width="${w}%" style="width:${w}%;height:8px;background:${c};border-radius:999px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table>
</td></tr>`; }).join("")}</table>`;
const scoreRow = (oldS, newS) => { const up = Number(newS) >= Number(oldS); return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:18px"><tr>
  <td style="font-family:${DISPLAY};font-size:56px;line-height:1;font-weight:700;letter-spacing:-0.04em;color:${F.muted}">${esc(oldS)}</td>
  <td style="padding:0 14px;font-family:${DISPLAY};font-size:32px;color:${F.muted}">&rarr;</td>
  <td style="font-family:${DISPLAY};font-size:56px;line-height:1;font-weight:700;letter-spacing:-0.04em;color:${F.ink}">${esc(newS)}</td>
  <td style="padding-left:14px;vertical-align:middle"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${up ? "#E4F0E9" : "#F8E3DB"};color:${up ? "#226B4C" : "#8E3A1E"};font-size:13px;font-weight:700">${up ? "+" : ""}${esc(Number(newS) - Number(oldS))}</span></td>
</tr></table>`; };
// A quiet note box (data window, quests, nudges).
const note = (html, bg = F.ground, colour = F.body) => `<div style="margin-top:18px;padding:14px 16px;background:${bg};border-radius:14px;font-size:14px;line-height:1.55;color:${colour}">${html}</div>`;

// All sending goes through the email service (preferences, footer, log).
// `tag` is the template name; `type` the preference bucket.
const TYPE_OF = { report_ready: "transactional", password_reset: "transactional", checkin: "monday_move", monday_move: "monday_move", score_changed: "weekly_score", plan_ended: "weekly_score", moment: "milestones", post_review: "post_reviews", winback: "product_news", annual_offer: "product_news" };
async function send({ to, userId = null, subject, html, tag, devLink, optOutUrl = null }) {
  let uid = userId;
  if (!uid && to) { try { uid = (await geDb.getUserByEmail(String(to).toLowerCase()))?.userId || null; } catch { /* anonymous recipient */ } }
  return email.send({ to, userId: uid, type: TYPE_OF[tag] || "transactional", subject, html, devLink, optOutUrl });
}

// ---------------------------------------------------------------- emails

// Job complete → the score, the four dimensions, and the first move.
function reportReady({ to, handle, platform, reportId, overall, grade, summary, firstMove, paid, dimensions = [], dataWindow = null }) {
  const url = reportUrl(reportId);
  const lead = dimensions.length ? [...dimensions].sort((x, y) => x.score - y.score)[0] : null;
  const inner = eyebrowText("Your score") + bigScore(overall, grade) + p(esc(summary || ""), "font-size:16px;color:#2A2118")
    + dimRows(dimensions)
    + (firstMove ? moveCard("MOVE 01 · THIS WEEK", firstMove.action, firstMove.why, { how: firstMove.how || [], colour: lead ? dimColour(lead.label) : F.act, time: firstMove.time || null }) : "")
    + button(url, paid ? "Open your Growth Plan" : "Open your report")
    + (paid ? "" : p("Every move beyond the first, and your 12-week calendar, unlock with the Growth Plan.", "font-size:13px;color:#7A6A57"))
    + (dataWindow ? note(esc(dataWindow), F.card, F.muted) : "");
  const preheader = `${overall} out of 100${lead ? ` — ${lead.label} is the biggest gap` : ""}. First move inside.`;
  return send({ to, subject: `Your Scalecraft score: ${overall} for @${handle}`, html: layout("Your report is ready", inner, { eyebrow: "Report ready", preheader, handle, platform, tint: lead ? dimColour(lead.label) : null }), tag: "report_ready" });
}

// Day 28 / 58 → "Phase N starts Monday. Anything change?"
function checkin({ to, userId, handle, reportId, phase, phaseLabel, firstMove, doneCount, totalCount }) {
  const url = reportUrl(reportId);
  const inner = h2(`Phase ${phase} starts Monday. Anything change?`)
    + p(`You're ${esc(doneCount)} of ${esc(totalCount)} moves into @${esc(handle)}'s plan. The next 30 days — <b>${esc(phaseLabel || "")}</b> — were written when you started. If your time, your goal or your next few weeks have changed, tell us and the plan is rewritten before Monday.`)
    + (firstMove ? moveCard(`PHASE ${phase} · MOVE 01`, firstMove.action, firstMove.why, { how: firstMove.how || [] }) : "")
    + button(`${url}?checkin=${phase}&changed=0`, "Nothing changed — carry on", F.green)
    + ghost(`${url}?checkin=${phase}&changed=1`, "Something changed — update my plan");
  return send({ to, userId, subject: `Phase ${phase} starts Monday — anything change?`, html: layout("Check-in", inner, { userId, eyebrow: `Day ${phase === 2 ? 28 : 58} check-in`, preheader: `${doneCount} of ${totalCount} moves done. Phase ${phase} is written — does it still fit?`, handle }), tag: "checkin" });
}

// Weekly refresh where the score moved, optionally with a nudge.
function scoreChanged({ to, userId, handle, reportId, oldScore, newScore, dimension, delta, movesDone, nudge, brief = null, dimensions = [] }) {
  const url = reportUrl(reportId);
  const up = newScore >= oldScore;
  const inner = h2(up ? `Your score went up.` : `Your score slipped.`) + scoreRow(oldScore, newScore)
    + p(`${esc(dimension)} moved ${delta > 0 ? "+" : ""}${esc(delta)}${movesDone ? ` after ${esc(movesDone)} move${movesDone === 1 ? "" : "s"} you marked done` : ""}. The moves and calendar for @${esc(handle)} have been rewritten against this week's posts.`)
    + dimRows(dimensions)
    + (nudge ? note(`<b>${esc(nudge.title)}</b><br>${esc(nudge.text)}`, F.gold, F.goldT) + ghost(`${url}?nudge=${encodeURIComponent(nudge.key)}`, nudge.cta || "Show me") : "")
    + (brief && brief.ready && brief.lines?.length ? `<div style="margin-top:22px;padding-top:16px;border-top:1px solid ${F.line}">${eyebrowText(`What's working in ${brief.category || "your category"} this week`, F.act)}<ul style="margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.55;color:${F.body}">${brief.lines.slice(0, 3).map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join("")}</ul></div>` : "")
    + button(url, "See what changed");
  return send({ to, userId, subject: `${handle}: ${oldScore} → ${newScore}`, html: layout("Score changed", inner, { userId, eyebrow: "Weekly rescore", preheader: `${oldScore} → ${newScore}. ${dimension} moved ${delta > 0 ? "+" : ""}${delta}.`, handle, tint: up ? F.green : F.act }), tag: "score_changed" });
}

// Monday move (spec 2.6): one action under 15 minutes with a one-tap done link.
const moveDoneUrl = (reportId, key, s) => `${APP}/api/growth-engine/v1/email/move-done?r=${encodeURIComponent(reportId)}&k=${encodeURIComponent(key)}&s=${s}`;
const optOutUrl = (reportId, s) => `${APP}/api/growth-engine/v1/email/optout?r=${encodeURIComponent(reportId)}&s=${s}`;
function mondayMove({ to, userId, handle, reportId, paid, kind, move, doneUrl, optOutUrl: oo, quest = null }) {
  const url = reportUrl(reportId);
  let inner, subject, preheader;
  if (kind === "upgrade") {
    subject = `Monday: the next move for @${handle} is on the plan`;
    preheader = "One move every Monday, under 15 minutes, rescored weekly. This is the only time we'll mention it.";
    inner = h2("Your free move was last Monday.") + p(`The Growth Plan writes @${esc(handle)}'s next 90 days — a move every Monday, under 15 minutes, with a rescore every week to show what it changed. This is the only time we'll mention it.`) + button(`${url}?upgrade=1`, "See the plan") + ghost(url, "Open my report");
  } else {
    subject = `Monday move for @${handle}: ${move.action.slice(0, 60)}${move.action.length > 60 ? "…" : ""}`;
    preheader = `${move.time ? `About ${move.time}.` : "Under 15 minutes."} ${move.action}`;
    inner = h2("This week's move.") + p(`${move.time ? `About ${esc(move.time)}. ` : "Under 15 minutes. "}${paid ? "One of the moves from your plan — tick it off and it counts toward your rescore." : "The first move from your free report."}`)
      + moveCard(`PHASE ${move.phase} · MOVE ${String(move.n).padStart(2, "0")}`, move.action, move.why, { how: move.how || [], doneWhen: move.done_when || null })
      + (quest ? note(`<b>This week's quest:</b> ${esc(quest.title)}. <span style="color:${F.muted}">Checked at your next rescore.</span>`) : "")
      + button(doneUrl, "Mark done", F.green) + ghost(paid ? pathUrl(reportId) : url, paid ? "Open my path" : "Open the plan");
  }
  return send({ to, userId, subject, html: layout("Monday move", inner, { userId, eyebrow: "Monday move", preheader, handle }), tag: "monday_move", optOutUrl: oo });
}

// 48-hour post review (spec 3.1). Pref: post_reviews.
function postReview({ to, userId, handle, reportId, review: r }) {
  const url = reportUrl(reportId);
  const m = r.metrics || {}; const v = r.review || {};
  const good = m.vs_avg != null && Number(m.vs_avg) >= 1;
  const row = (label, text) => `<tr><td style="padding:12px 0;border-top:1px solid ${F.line};font-size:14px;line-height:1.6;color:${F.ink}"><b>${label}.</b> ${text}</td></tr>`;
  const inner = h2(`Your ${esc(r.type || "post")} from ${esc(new Date(r.posted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}, 48 hours in.`)
    + (r.caption ? note(`“${esc(r.caption.slice(0, 120))}${r.caption.length > 120 ? "…" : ""}”`) : "")
    + (m.vs_avg != null ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:18px"><tr><td style="font-family:${DISPLAY};font-size:44px;line-height:1;font-weight:700;letter-spacing:-0.04em;color:${good ? F.green : F.act}">${esc(m.vs_avg)}&times;</td><td style="padding-left:12px;font-size:13px;line-height:1.5;color:${F.muted}">your average<br>${esc(m.likes)} likes · ${esc(m.comments)} comments</td></tr></table>` : "")
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px">${row("How it did", esc(v.performance))}${row("Likely why", esc(v.likely_reason))}${row("Next post", esc(v.next))}</table>`
    + button(`${url}?review=${encodeURIComponent(r.post_id)}`, "See all reviews") + (r.permalink ? ghost(r.permalink, "Open the post") : "");
  return send({ to, userId, subject: `@${handle}: your ${r.type || "post"} at 48 hours — ${m.vs_avg != null ? `${m.vs_avg}× your average` : "reviewed"}`, html: layout("Post review", inner, { userId, eyebrow: "48-hour review", preheader: v.performance || "", handle, tint: good ? F.green : F.act }), tag: "post_review" });
}

// Win-back (spec 4.4): a one-off rescore 30/60 days after leaving. Pref: product_news.
function winback({ to, userId, handle, reportId, oldScore, newScore, since, milestone }) {
  const url = reportUrl(reportId);
  const up = Number.isFinite(oldScore) && newScore > oldScore;
  const inner = (up ? h2(`Your score went up since you left.`) + scoreRow(oldScore, newScore) + p(`@${esc(handle)} is doing better on its own — genuinely, well done. We rescored it once so you'd know. If you ever want the weekly rescore and the plan back, it's one tap; if not, this is the last of these.`)
    : h2(`Your score went from ${esc(oldScore)} to ${esc(newScore)} since you left.`) + scoreRow(oldScore, newScore) + p(`We rescored @${esc(handle)} once${since ? ` against ${esc(new Date(since).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}` : ""} so you can see what changed. The report shows which dimension slipped and the move that would have held it. This is the last of these unless you come back.`))
    + button(`${url}?resubscribe=1`, up ? "See the report" : "See what changed") + ghost(`${APP}/#/pricing`, "Start the plan again");
  return send({ to, userId, subject: up ? `@${handle}: ${oldScore} → ${newScore} since you left — nice` : `@${handle}: ${oldScore} → ${newScore} since you left`, html: layout("Since you left", inner, { userId, eyebrow: `${milestone || 30} days on`, preheader: `${oldScore} → ${newScore}. One rescore, no strings.`, handle, tint: up ? F.green : F.act }), tag: "winback" });
}

// Annual offer (spec 4.5): once, after the first score increase on a monthly plan. Pref: product_news.
function annualOffer({ to, userId, handle, reportId, offer, oldScore, newScore }) {
  const url = reportUrl(reportId);
  const inner = h2(`First rise: ${esc(oldScore)} → ${esc(newScore)}.`) + p(`That's the plan working for @${esc(handle)}. If you're staying, a year is $${esc(offer.annual)} instead of $${esc(offer.monthly * 12)} — ${esc(offer.saves)} off, same plan, no change to what runs weekly.`)
    + button(`${url}?annual=1`, `Lock in a year — $${offer.annual}`) + ghost(url, "Not now");
  return send({ to, userId, subject: `@${handle}: ${oldScore} → ${newScore}. A year for $${offer.annual}?`, html: layout("Annual plan", inner, { userId, eyebrow: "One-time offer", preheader: `$${offer.annual} for the year instead of $${offer.monthly * 12}. Same plan.`, handle, tint: F.green }), tag: "annual_offer" });
}

// Rank-up or milestone after a rescore (spec 2.2, 2.5). Pref: milestones.
function moment({ to, userId, handle, reportId, moment: m }) {
  const url = reportUrl(reportId);
  const inner = h2(esc(m.title)) + p(esc(m.line))
    + p(m.kind === "rank_up" ? `That's the score band for @${esc(handle)} moving up. The card is ready if you want to post it.` : m.kind === "record" ? `A post from this week beat everything we'd seen from @${esc(handle)} before${m.post?.caption ? ` — “${esc(m.post.caption.slice(0, 80))}”` : ""}. The card is ready if you want to post it.` : `The card is ready if you want to post it.`)
    + button(`${url}?moment=${encodeURIComponent(m.key)}`, "See the card");
  return send({ to, userId, subject: `@${handle}: ${m.title}`, html: layout(m.title, inner, { userId, eyebrow: m.kind === "record" ? "Personal record" : "Milestone", preheader: m.line || m.title, handle, tint: F.green }), tag: "moment" });
}

// Day 60 for one-time buyers: the plan they bought is over.
function planEnded({ to, userId, handle, reportId, overall, price }) {
  const url = reportUrl(reportId);
  const inner = h2(`Your 60 days are up.`)
    + p(`The plan you unlocked for @${esc(handle)} started at <b>${esc(overall)}</b>. Days 61–90 were written when you started — they're waiting in your report, locked.`)
    + p(`The Growth Plan re-scores you this week so you can see what the last 60 days changed, unlocks phase 3, and writes a fresh plan every 90 days. It's $${esc(price)} a month — less than the $15 you paid once.`)
    + button(`${url}`, "See phase 3 and what changed")
    + ghost(url, "Just open my report");
  return send({ to, userId, subject: `Your 60-day plan for @${handle} is done — what now?`, html: layout("Plan ended", inner, { userId, eyebrow: "Day 60", preheader: "Phase 3 is written and waiting. Here's what the last 60 days changed.", handle }), tag: "plan_ended" });
}

// Password reset (route wiring is separate).
function passwordReset({ to, resetUrl }) {
  const inner = h2("Reset your password") + p("This link works once and expires in one hour. If you didn't ask for it, ignore this email.") + button(resetUrl, "Choose a new password");
  return send({ to, subject: "Reset your Scalecraft password", html: layout("Reset your password", inner, { eyebrow: "Account", preheader: "One link, one hour." }), tag: "password_reset", devLink: resetUrl });
}

module.exports = { send, reportReady, F, dimColour, checkin, scoreChanged, planEnded, passwordReset, moment, mondayMove, postReview, winback, annualOffer, moveDoneUrl, optOutUrl, reportUrl, pauseSig, layout, configured: () => email.configured() };
