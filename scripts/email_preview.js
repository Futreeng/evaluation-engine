#!/usr/bin/env node
// Renders every email template with sample data to HTML files, footer included,
// without sending anything. For reviewing the design and for Joe's Resend tests.
//
//   node scripts/email_preview.js            # writes server/emails/preview/*.html
//   node scripts/email_preview.js /tmp/out   # elsewhere

const fs = require("fs");
const path = require("path");
process.env.EMAIL_PROVIDER = "log";
process.env.APP_URL = process.env.APP_URL || "https://scalecraft.onrender.com";
process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "hello@futreeng.com";
process.env.EMAIL_POSTAL_ADDRESS = process.env.EMAIL_POSTAL_ADDRESS || "FutureEng LLC, New York, NY";

const email = require("../server/growth_engine_email");
const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "server", "emails", "preview"));
fs.mkdirSync(out, { recursive: true });
const written = [];
// Capture instead of sending: same footer the real send injects.
email.send = async ({ subject, html, type, optOutUrl }) => {
  const full = html.replace("<!--footer-->", email.footer("usr_preview", type, optOutUrl));
  const name = `${String(written.length + 1).padStart(2, "0")}-${subject.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase()}.html`;
  fs.writeFileSync(path.join(out, name), full);
  written.push({ name, subject, type });
  return { id: "preview", status: "logged" };
};
const mailer = require("../server/mailer");

const handle = "talon__wilson", reportId = "rpt_7dfd1504fa2770d33b19f24f", to = "haron@example.com", userId = "usr_preview";
const dims = [{ label: "Posting Consistency", score: 58, delta: 6 }, { label: "Content Mix", score: 79, delta: 0 }, { label: "Engagement Quality", score: 66, delta: -2 }, { label: "Profile Clarity", score: 81, delta: 0 }];
const move = { phase: 1, n: 1, action: "Add a bio link and rewrite the first line so it says what you do and where.", why: "Your bio has no link and your Sep 16 reel sent 412 people to a profile with nowhere to go.", how: ["Open Instagram → your profile → Edit profile.", "Tap Links → Add external link, paste the URL, tap Done.", "Rewrite line one: who you are, where, what they get.", "Check it from a logged-out browser."], done_when: "Bio shows the niche, the link and a way to reach you.", time: "20 min, once" };

(async () => {
  await mailer.reportReady({ to, handle, platform: "Instagram", reportId, overall: 71, grade: "Fair", summary: "Posting Consistency is the biggest gap: 30 posts over 118 days with a 19-day hole in August. The content that works — nature reels with you in frame — is already there.", firstMove: move, paid: false, dimensions: dims.map(({ label, score }) => ({ label, score })), dataWindow: "Based on your last 30 posts, 21 May – 16 Sep. We can't see saves, reach or story views." });
  await mailer.mondayMove({ to, userId, handle, reportId, paid: true, kind: "move", move: { ...move, phase: 1, n: 3, action: "Film two nature reels in one session and schedule them for Tue and Sat.", why: "Your Sep 16 and Aug 2 reels are your two most-commented posts; both are you talking in frame outdoors.", how: ["Pick one location you already go to this week.", "Film both in one take each, 20–30 seconds, phone in hand.", "Schedule for Tue 7pm and Sat 11am — your two best windows.", "Post the second one even if the first one flops."], done_when: "Two reels published on the fixed days this week.", time: "1 hour this week" }, doneUrl: mailer.moveDoneUrl(reportId, "p1m3", "sig"), optOutUrl: mailer.optOutUrl(reportId, "sig"), quest: { title: "Post 2 reels this week" } });
  await mailer.scoreChanged({ to, userId, handle, reportId, oldScore: 71, newScore: 75, dimension: "Posting Consistency", delta: 6, movesDone: 2, dimensions: dims, nudge: null, brief: { ready: true, category: "Travel", lines: ["Reels with a person talking in the first two seconds are getting 1.8× the comments of scenery-only reels.", "Carousels that open with a map or a route are being saved at twice the category median.", "Posting three fixed days a week is beating five irregular days on consistency scores."] } });
  await mailer.checkin({ to, userId, handle, reportId, phase: 2, phaseLabel: "Content Engine", firstMove: { action: "Turn your best three reels into a 5-slide carousel each, one per week.", why: "Your top reels have 3× your median comments; carousels are your least-used format and the category's most-saved.", how: ["Pick the three reels with the most comments.", "Five slides: hook, three beats, one line to say or DM.", "Post on your Tuesday slot."] }, doneCount: 4, totalCount: 5 });
  await mailer.postReview({ to, userId, handle, reportId, review: { post_id: "p1", posted_at: "2026-09-24T19:00:00Z", type: "reel", caption: "Golden hour at the ridge. The trail nobody talks about — and why you should go in October.", permalink: "https://www.instagram.com/", metrics: { likes: 214, comments: 19, views: 3980, vs_avg: 2.4, vs_same_format: 1.4 }, review: { performance: "Strong: 2.4× your average engagement, and 1.4× your reel average.", likely_reason: "You in frame with a one-line opener, posted Tuesday 7pm — your best window.", next: "Repeat the format next Tuesday: one place, one reason to go, under 25 seconds, a question in the first line." } } });
  await mailer.moment({ to, userId, handle, reportId, moment: { kind: "record", key: "record_p1", title: "New personal record", line: "233 likes + comments · beat your previous best of 183", post: { caption: "Golden hour at the ridge" } } });
  await mailer.winback({ to, userId, handle, reportId, oldScore: 75, newScore: 69, since: "2026-08-20T00:00:00Z", milestone: 30 });
  await mailer.annualOffer({ to, userId, handle, reportId, offer: { monthly: 12, annual: 108, saves: 36 }, oldScore: 71, newScore: 75 });
  await mailer.planEnded({ to, userId, handle, reportId, overall: 71, price: 12 });
  await mailer.passwordReset({ to, resetUrl: `${process.env.APP_URL}/#/reset?token=preview` });
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Scalecraft email previews</title><body style="font-family:Helvetica,Arial,sans-serif;padding:24px;background:#FFF6E9"><h1>Scalecraft emails</h1><ol>${written.map((w) => `<li><a href="${w.name}">${w.subject}</a> <small>(${w.type})</small></li>`).join("")}</ol>`);
  console.log(`wrote ${written.length} previews to ${out}`);
  for (const w of written) console.log(`  ${w.name}  ${w.subject}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
