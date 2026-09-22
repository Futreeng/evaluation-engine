// Plan quality + path engine (docs/PATH_SPEC.md). Run: node server/growth_engine_path.test.js
const assert = require("assert");
const q = require("./growth_engine_plan_quality");
const P = require("../public/path-engine.js");

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error("✗", name, "\n ", e.message); process.exitCode = 1; } };

// ---- topics and validation
t("topics", () => {
  assert.equal(q.topicOf({ title: "Add DM CTA", action: "Insert a DM line at the end of your bio." }), "bio_cta");
  assert.equal(q.topicOf({ title: "Add Linktree to bio", action: "Rewrite bio to include CTA and Linktree" }), "bio_link");
  assert.equal(q.topicOf({ title: "Create Media Kit Highlight", action: "Add a highlight with top 3 reels." }), "highlight");
  assert.equal(q.topicOf({ title: "Pin Top Post", action: "Pin the reel to profile." }), "pin");
  assert.equal(q.topicOf({ title: "Boost Posting Consistency", action: "Post Reel Mon Wed Fri" }), "schedule");
  assert.equal(q.topicOf({ title: "Gear Spotlight Carousel", action: "Create a 5-slide carousel" }), "format");
  assert.equal(q.topicOf({ title: "Reply to every comment", action: "Answer comments within an hour" }), "engage");
});
const phases = [
  { label: "Improve Profile Clarity", visible_action: "Add a link to your bio", opener: {}, moves: [{ n: 2, title: "Add DM CTA", action: "Insert a DM line in your bio" }, { n: 3, title: "Make a highlight", action: "Add a highlight" }] },
  { label: "Boost Posting Consistency", visible_action: "Post Thu, Fri, Sun", opener: {}, moves: [{ n: 6, title: "Add contact line in bio", action: "Edit your bio to add an email" }, { n: 7, title: "Batch film Sunday", action: "Film the week's three reels in one sitting on Sunday", why: "cites 2026-09-17" }] },
  { label: "Optimize Content Strategy", visible_action: "Post a throwback reel", opener: {}, moves: [{ n: 10, title: "Collab highlight", action: "Add a highlight for brands" }, { n: 11, title: "Gear carousel", action: "Make a carousel from the 2026-09-17 reel", how: ["Use 2026-09-17 again"] }] },
];
t("validate finds repeats, off-phase moves and over-cited posts", () => {
  const v = q.validatePhases(phases, { labels: phases.map((p) => p.label) });
  assert.equal(v.ok, false);
  const kinds = v.problems.map((p) => p.kind);
  assert(kinds.includes("duplicate")); assert(kinds.includes("off_phase"));
  assert(v.problems.some((p) => p.kind === "duplicate" && p.move.n === 6));
  assert(v.problems.some((p) => p.kind === "duplicate" && p.move.n === 10));
  assert(v.problems.some((p) => p.kind === "off_phase" && p.move.n === 6));
});
t("dedupe keeps the first of each one-off topic", () => {
  const d = q.dedupePhases(phases, { labels: phases.map((p) => p.label) });
  assert.deepEqual(d.phases.map((p) => p.moves.map((m) => m.n)), [[2, 3], [7], [11]]);
  assert.equal(d.dropped.length, 2);
});
t("clean plan passes", () => {
  const clean = [{ label: "Improve Profile Clarity", visible_action: "Add a link to your bio", moves: [{ n: 2, title: "Add DM CTA", action: "Insert a DM line in your bio" }] }, { label: "Boost Posting Consistency", visible_action: "Post Thu, Fri, Sun", moves: [{ n: 6, title: "Batch film Sunday", action: "Film the week's reels in one sitting" }] }];
  assert.equal(q.validatePhases(clean, { labels: clean.map((p) => p.label) }).ok, true);
});

// ---- names, hygiene, how-to
const body = { business: { handle: "talon__wilson", platform: "instagram" }, posts: [{ caption: "The last few steps in America.\n\nCape Flattery, Washington.", type: "reel", posted_at: "2026-09-17T00:11:54.000Z" }, { caption: "I used to think you had to do something extraordinary to inspire somebody.", type: "reel", posted_at: "2026-09-12T00:01:53.000Z" }] };
t("post names", () => {
  const idx = q.postIndex(body);
  assert.equal(q.postName(idx.get("2026-09-17")), 'the "Cape Flattery" reel (Sep 17)');
  assert.equal(q.postName(idx.get("2026-09-12")), 'the "I used to think you had…" reel (Sep 12)');
  assert.equal(q.namePosts("Pin 2026‑09‑17 reel to profile.", idx), 'Pin the "Cape Flattery" reel (Sep 17) to profile.');
  assert.equal(q.namePosts("Use Sep 17 2026 footage", idx), 'Use the "Cape Flattery" reel (Sep 17) footage');
  assert.equal(q.namePosts("no dates here", idx), "no dates here");
});
t("hygiene", () => {
  assert.equal(q.sanitize("Swipe up in the bio to view it."), "tap the link in my bio to view it.");
  assert.equal(q.sanitize("Hey, I'm [Name] – a traveler.", { name: "talon" }), "Hey, I'm @talon – a traveler.");
  assert.equal(q.sanitize("Thanks!\nThank you for the opportunity."), "Thanks!");
});
t("finishPlan swaps in verified steps and names posts", () => {
  const b = { ...body, growth_path: { phases: [{ label: "Improve Profile Clarity", visible_action: "Add a link to your bio", opener: { how: ["made up"], example: "x", done_when: "y", time: "5 min" }, moves: [{ n: 2, title: "Pin Top Post", action: "Pin 2026-09-17 reel to profile.", why: "", how: ["Go to 2026‑09‑17 reel → Pin to Profile"], example: null, done_when: "Pinned post appears below bio.", time: "5 min" }] }] }, calendar: { weeks: [] }, next_posts: [{ n: 1, hook: "Swipe up", caption: "Media kit in bio, DM for collabs", script: "I'm [Name]", why: "" }, { n: 2, hook: "Trail day", caption: "Rain", script: "", why: "" }, { n: 3, hook: "Brand partnership", caption: "media kit", script: "", why: "" }] };
  q.finishPlan(b);
  const m = b.growth_path.phases[0].moves[0];
  assert.equal(m.topic, "pin");
  assert.deepEqual(m.how, q.HOWTO.instagram.pin);
  assert.equal(m.action, 'Pin the "Cape Flattery" reel (Sep 17) to profile.');
  assert.equal(b.growth_path.phases[0].opener.topic, "bio_link");
  assert.deepEqual(b.growth_path.phases[0].opener.how, q.HOWTO.instagram.bio_link);
  assert.equal(b.next_posts[0].hook, "tap the link in my bio");
  assert.equal(b.next_posts[0].script, "I'm @talon__wilson");
  // the second sponsor pitch moves to the back
  assert.deepEqual(b.next_posts.map((p) => p.n), [1, 2, 3]);
  assert.equal(b.next_posts[2].hook, "Brand partnership");
});

// ---- schedule
t("schedule from best days and hours", () => {
  const r = { plan_context: { hours: "2_5" }, best_times: { windows: [{ day: "Thu", start_hour: 18, end_hour: 21 }, { day: "Fri", start_hour: 18 }], best_days: [{ day: "Fri", n: 5, vs_avg: 2.04 }, { day: "Thu", n: 5, vs_avg: 1.99 }, { day: "Sun", n: 2, vs_avg: 1.3 }, { day: "Mon", n: 1, vs_avg: 3 }] } };
  const s = q.deriveSchedule(r, { targetPerWeek: 3.5 });
  assert.deepEqual(s.days, ["Thu", "Fri", "Sun"]);
  assert.equal(s.times.Thu, "6pm"); assert.equal(s.times.Sun, "6pm");
  assert.equal(s.per_week, 3);
  assert.equal(q.deriveSchedule({ plan_context: { hours: "lt2" }, best_times: null }, { targetPerWeek: 4.5 }).per_week, 2);
  assert.equal(q.deriveSchedule({ plan_context: { hours: "10plus" }, best_times: null }, { targetPerWeek: 4.5 }).per_week, 4);
  assert.deepEqual(q.deriveSchedule({}, {}).days.length, 3);
});
t("benchmark text mirrors the scorer's targets", () => {
  const b = q.benchmarkText({ posts_per_week: 3.5, max_gap_days: 7, video_share: 0.6, engagement_rate: 2.8, comment_share: 0.04 });
  assert(b.posting_consistency.startsWith("3.5 posts/week"));
  assert(b.engagement_quality.startsWith("2.8% engagement rate"));
});

// ---- path engine
const DAY = 86400000;
const start = new Date("2026-09-21T12:00:00Z").setHours(0, 0, 0, 0); // a Monday
const plan = {
  tier: "growth_plan", plan_started_at: start,
  growth_path: { phases: [
    { range: "1-30", label: "Improve Profile Clarity", visible_action: "Add a link", opener: { how: ["a"], topic: "bio_link" }, moves: [{ n: 2, title: "Add DM CTA", action: "DM line", topic: "bio_cta" }, { n: 3, title: "Pin", action: "Pin it", topic: "pin" }] },
    { range: "31-60", label: "Boost Posting Consistency", visible_action: "Post Thu Fri Sun", opener: { topic: "schedule" }, moves: [{ n: 6, title: "Batch", action: "Batch film", topic: "schedule" }] },
  ] },
  calendar: { weeks: [{ week: 1, phase: 1, slots: [{ day: "Thu", format: "reel", angle: "A", source: "archive" }, { day: "Sun", format: "carousel", angle: "B" }] }, { week: 5, phase: 2, slots: [{ day: "Thu", format: "reel", angle: "C" }] }] },
  next_posts: [{ n: 1, day: "Sun", format: "carousel", hook: "H1" }, { n: 2, day: "Thu", format: "reel", hook: "H2" }],
};
t("path order and now", () => {
  const p = P.build(plan, { now: start + 2 * DAY }); // Wednesday of week 1
  assert.deepEqual(p.steps.map((s) => s.key), ["p1m1", "p1m2", "p1m3", "c1-thu", "c1-sun", "p2m1", "p2m6", "c5-thu"]);
  assert.deepEqual(p.now, ["p1m1"]);
  assert.equal(p.steps.find((s) => s.key === "c1-thu").post.hook, "H2");
  assert.equal(p.steps.find((s) => s.key === "c1-sun").post.hook, "H1");
  assert.equal(p.next.key, "c1-thu");
  assert.equal(p.progress.total, 8);
  assert.equal(p.plan_day, 3);
});
t("slot due today joins now; phase 2 opens when phase 1 moves are cleared", () => {
  const b = { ...plan, moves_done: { p1m1: 1, p1m2: 1 }, moves_skipped: { p1m3: { at: 1, reason: "cant" } } };
  const p = P.build(b, { now: start + 3 * DAY + 3600000 }); // Thursday
  assert.deepEqual(p.now, ["p2m1", "c1-thu"]);
  assert.equal(p.phase.index, 2);
  const s = p.steps.find((x) => x.key === "p2m6"); assert.equal(s.phase_open, true);
});
t("phase 2 opens on day 31 regardless", () => {
  const p = P.build(plan, { now: start + 31 * DAY });
  assert.equal(p.steps.find((x) => x.key === "p2m1").phase_open, true);
  assert.equal(p.now[0], "p1m1"); // still the first open move
});
t("caught up", () => {
  const b = { ...plan, moves_done: { p1m1: 1, p1m2: 1, p1m3: 1 }, moves_skipped: {}, };
  const p = P.build(b, { now: start + 1 * DAY }); // Tuesday: moves done, next slot Thursday, phase 2 open (cleared) → p2m1 is now
  assert.deepEqual(p.now, ["p2m1"]);
  const b2 = { ...b, moves_done: { ...b.moves_done, p2m1: 1, p2m6: 1 } };
  const p2 = P.build(b2, { now: start + 1 * DAY });
  assert.equal(p2.caught_up, true); assert.equal(p2.next.key, "c1-thu");
});
t("apply and later", () => {
  const st = P.apply(plan, "p1m2", "later", { now: start + 2 * DAY });
  assert(st.moves_later.p1m2 > start + 2 * DAY);
  const p = P.build({ ...plan, ...st }, { now: start + 2 * DAY });
  assert.equal(p.steps.find((s) => s.key === "p1m2").status, "later");
  const p2 = P.build({ ...plan, ...st }, { now: start + 3 * DAY + 8 * 3600000 });
  assert.equal(p2.steps.find((s) => s.key === "p1m2").status, "open");
  const done = P.apply(plan, "p1m2", "done", { now: 5 });
  assert.equal(done.moves_done.p1m2, 5);
  const undo = P.apply({ ...plan, ...done }, "p1m2", "open");
  assert.equal(undo.moves_done.p1m2, undefined);
});
t("free report: openers live, the rest locked", () => {
  const free = { tier: "social_snapshot", growth_path: { phases: [{ range: "1-30", label: "A", visible_action: "do a", locked: { count: 4, items: [{ meta: "MOVE 02 · Pin the reel · why" }] } }, { range: "31-60", label: "B", visible_action: "do b", locked: { count: 4 } }] } };
  const p = P.build(free, {});
  assert.equal(p.free, true); assert.equal(p.locked_count, 8);
  assert.deepEqual(p.steps.filter((s) => s.live).map((s) => s.key), ["p1m1", "p2m1"]);
  assert.equal(p.steps.find((s) => s.key === "p1m2").title, "Pin the reel");
});
t("verify against a baseline", () => {
  const b = { ...plan, profile: { external_url: "https://x", highlight_count: 0, pinned_posts: 1, bio: "new bio" }, posts: [{ posted_at: new Date(start + 3 * DAY).toISOString() }], moves_done: { p1m1: 1, p1m2: 1, p1m3: 1 } };
  const v = P.verify(b, { bio: "old bio", highlight_count: 0, pinned_posts: 0 }, { now: start + 5 * DAY });
  assert.equal(v.p1m1.ok, true); assert.equal(v.p1m2.ok, true); assert.equal(v.p1m3.ok, true);
  assert.equal(v["c1-thu"].ok, true); assert.equal(v["c1-sun"], undefined); // Sunday hasn't come
  const v2 = P.verify({ ...b, profile: { ...b.profile, external_url: null } }, { bio: "new bio" }, { now: start + 5 * DAY });
  assert.equal(v2.p1m1.ok, false); assert.equal(v2.p1m2.ok, false); // marked done, but the bio reads the same → recorded as not seen
});

console.log(`${n} passed${process.exitCode ? "" : " — all good"}`);
