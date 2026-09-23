#!/usr/bin/env node
// Runs the deterministic parts of plan quality (docs/PATH_SPEC.md part 1)
// over the shipped sample report, so the public sample reads the way a fresh
// report would without spending LLM quota:
//   - repeated and off-phase moves dropped (the model isn't re-asked here)
//   - one posting schedule derived from the account's best days, applied to
//     the calendar slots and the written posts
//   - posts named by caption, verified how-to steps, banned phrases removed
//
//   node scripts/clean_sample.js            # rewrites public/sample-report.js
//   node scripts/clean_sample.js --dry      # prints what would change

const fs = require("fs");
const path = require("path");
const q = require("../server/growth_engine_plan_quality");
const scoring = require("../server/growth_engine_scoring");

const file = path.join(__dirname, "..", "public", "sample-report.js");
const src = fs.readFileSync(file, "utf8");
const m = src.match(/^([\s\S]*?=\s*)(\{[\s\S]*\})(;?\s*)$/);
if (!m) throw new Error("sample-report.js: could not find the object literal");
const r = JSON.parse(m[2]);
const dry = process.argv.includes("--dry");

const labels = r.growth_path.phases.map((p) => p.label);
const dd = q.dedupePhases(r.growth_path.phases, { labels });
r.growth_path.phases = dd.phases;
r.plan_dropped = dd.dropped.map((x) => ({ phase: x.phase + 1, title: x.move.title, reason: x.reason, topic: x.topic }));
console.log(`dropped ${dd.dropped.length} move(s): ${dd.dropped.map((x) => `"${x.move.title}" (${x.reason})`).join(", ")}`);

// One schedule. The calendar was written for Mon/Wed/Fri; remap each week's
// slots onto the derived days in order and stamp the posts with the same days.
const target = scoring.targetFor(r.business.category).target;
const schedule = q.deriveSchedule(r, { targetPerWeek: target?.posts_per_week });
console.log(`schedule: ${schedule.label} (${schedule.source})`);
const remap = (slots) => slots.map((s, i) => ({ ...s, day: schedule.days[i % schedule.days.length] }));
for (const w of r.calendar.weeks) w.slots = remap(w.slots);
for (const p of r.growth_path.phases) for (const w of p.calendar_weeks || []) w.slots = remap(w.slots);
r.calendar.posting_days = schedule.days;
r.calendar.posting_time = schedule.times[schedule.days[0]];
r.calendar.schedule = schedule;
r.next_posts = (r.next_posts || []).map((p, i) => { const d = schedule.days[i % schedule.days.length]; return { ...p, day: d, time: schedule.times[d] }; });
// The plan text that named other days/times follows the schedule too.
const dayRe = /\b(7:15\s?am|8:00\s?am|8am|7am)\b/gi;
const fixTimes = (s) => String(s || "").replace(dayRe, schedule.times[schedule.days[0]]).replace(/\bMon(day)?,? Wed(nesday)?,? (and )?Fri(day)?\b/gi, schedule.days.join(", ")).replace(/\bMon Wed Fri\b/g, schedule.days.join(" "));
for (const p of r.growth_path.phases) {
  p.visible_action = fixTimes(p.visible_action); p.detail = fixTimes(p.detail);
  if (p.opener) { p.opener.how = (p.opener.how || []).map(fixTimes); p.opener.done_when = fixTimes(p.opener.done_when); }
  for (const mv of p.moves) { mv.action = fixTimes(mv.action); mv.how = (mv.how || []).map(fixTimes); mv.done_when = fixTimes(mv.done_when); }
}
r.narrative = fixTimes(r.narrative);

// Timing now needs three posts per window/day; the shipped block predates that.
if (r.best_times) {
  r.best_times.windows = (r.best_times.windows || []).filter((w) => Number(w.n) >= 3);
  r.best_times.note = String(r.best_times.note || "").replace(/at least \d+ posts/, "at least 3 posts");
}
// The consistency scorer changed (cadence carries it): re-score that dimension from the
// same numbers the evidence line quotes, and the overall as the plain average.
{
  const cons = r.scores.dimensions.find((d) => /consisten/i.test(d.label));
  const m = cons && /(\d+) posts over (\d+) days \(([\d.]+)\/week.*longest gap (\d+) days; last post (\d+) day/.exec(cons.evidence || "");
  if (m) {
    const pf = { posts_analyzed: +m[1], date_range_days: +m[2], posts_per_week: +m[3], longest_gap_days: +m[4], days_since_last_post: +m[5] };
    const scored = scoring.scoreProfile({ analysis: { posting_frequency: pf, content: { video_posts: 19, carousel_posts: 10, static_posts: 1, avg_caption_length: 296 }, engagement: { engagement_rate_percent: 29.89, total_likes: 1, total_comments: 1, total_video_views: 1 }, profile_clarity: { bio_text: r.bio || "", bio_mentions_location: true } }, follower_count: r.business.followers, recent_posts: r.posts }, r.business.category);
    const nc = scored && scored.dimensions.find((d) => /consisten/i.test(d.label));
    if (nc) { cons.score = nc.score; cons.parts = nc.parts; r.scores.overall = Math.round(r.scores.dimensions.reduce((a, d) => a + d.score, 0) / r.scores.dimensions.length); console.log(`consistency re-scored: ${nc.score} (parts ${JSON.stringify(nc.parts)}), overall ${r.scores.overall}`); }
  }
}
// Best/worst posts: re-rank with the current rules (unpinned, against the median).
{
  const ranked = scoring.rankPosts((r.posts || []).map((p) => ({ ...p, timestamp: p.posted_at, media_type: String(p.type || "").toUpperCase(), is_reel: /reel/i.test(p.type || ""), like_count: p.likes, comments_count: p.comments, video_view_count: p.views })));
  if (ranked) r.post_insights = { ...ranked, note: r.post_insights?.note || null };
}
if (r.competitors?.you) r.competitors.you.overall = r.scores.overall;
r.narrative = String(r.narrative || "").replace(/overall rating is \d+/, `overall rating is ${r.scores.overall}`).replace(/Posting Consistency \(score \d+\)/, `Posting Consistency (score ${r.scores.dimensions.find((d) => /consisten/i.test(d.label)).score})`);
q.finishPlan(r);
r.growth_path.unlocked_steps = r.growth_path.phases.reduce((n, p) => n + 1 + p.moves.length, 0);
r.growth_path.total_steps = r.growth_path.unlocked_steps;
r.sample_cleaned_at = Date.now();

if (dry) { console.log(JSON.stringify({ phases: r.growth_path.phases.map((p) => ({ label: p.label, moves: p.moves.map((x) => `${x.n} ${x.title} [${x.topic}]`) })), calendar: r.calendar.weeks[0], posts: r.next_posts.map((p) => `${p.day} ${p.time} ${p.hook}`) }, null, 1)); process.exit(0); }
fs.writeFileSync(file, `${m[1]}${JSON.stringify(r, null, 1)}${m[3] || ";\n"}`);
console.log(`wrote ${file}`);
