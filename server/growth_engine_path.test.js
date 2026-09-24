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
  assert.equal(q.topicOf({ title: "New Reel: Behind-the-camera recap", action: "Cut a 15s reel from the Rainier footage; caption ends with DM for collabs." }), "format"); // content, not a bio move
  assert.equal(q.topicOf({ title: "Add contact line in bio", action: "Edit your bio to include a brand partnership CTA and your email address." }), "bio_cta");
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

t("phase openers follow the plan's schedule", () => {
  const sch = { days: ["Thu", "Fri", "Sun"], times: { Thu: "6pm", Fri: "6pm", Sun: "6pm" } };
  assert.equal(q.applySchedule("Schedule three archive Reels on Mon, Wed, Fri at 7:15am.", sch), "Schedule three archive Reels on Thu, Fri and Sun at 6pm.");
  assert.equal(q.applySchedule("Post every Monday and Wednesday", sch), "Post every Thu, Fri and Sun");
  assert.equal(q.applySchedule("Reply within 2 hours", sch), "Reply within 2 hours");
  const b = { business: { handle: "x" }, calendar: { schedule: sch, weeks: [] }, growth_path: { phases: [{ label: "Kick-start Cadence", visible_action: "Post Mon, Wed, Fri at 8am", detail: "Three fixed days", opener: { how: ["Schedule for 7:15am on Mon, Wed, and Fri"], done_when: "A reel every Mon/Wed/Fri", example: null }, moves: [] }] } };
  q.finishPlan(b);
  assert.equal(b.growth_path.phases[0].visible_action, "Post Thu, Fri and Sun at 6pm");
  assert.equal(b.growth_path.phases[0].opener.done_when, "A reel every Thu, Fri and Sun");
});

t("invented links and emails become words; real ones stay", () => {
  const ctx = { links: new Set(["https://talon.co"]), contact: "me@talon.co", goal: "deals" };
  assert.equal(q.stripInvented("Add link: https://linktr.ee/talonwilson", ctx), "Add link: your link (the page brands should land on — a media kit, or a Linktree that points to it)");
  assert.equal(q.stripInvented("Paste https://talon.co/ and mail me@talon.co or fake@x.com", ctx), "Paste https://talon.co/ and mail me@talon.co or your email");
  const b = { business: { handle: "t" }, plan_context: { goal: "deals" }, growth_path: { phases: [{ label: "Profile", visible_action: "Add a link", opener: { how: ["Paste https://linktr.ee/t"], example: "https://linktr.ee/t", done_when: "" }, moves: [] }] }, calendar: { weeks: [] } };
  q.finishPlan(b);
  assert(!/linktr/.test(JSON.stringify(b.growth_path)));
  assert.equal(b.growth_path.phases[0].opener.example, "your link (the page brands should land on — a media kit, or a Linktree that points to it)");
});
t("consistency: 60% of target cadence is not Strong", () => {
  const scoring = require("./growth_engine_scoring");
  const t = scoring.targetFor("travel").target;
  const posts = []; const now = Date.now();
  for (let i = 0; i < 16; i++) posts.push({ id: String(i), timestamp: new Date(now - (i * 3.3 + 5) * DAY).toISOString(), like_count: 100, comments_count: 5, media_type: "VIDEO", is_reel: true, caption: "x", hashtags: [], video_view_count: 500 });
  const pf = { posts_per_week: 2.1, longest_gap_days: 6, days_since_last_post: 5, posts_analyzed: 16, date_range_days: 53 };
  const r = scoring.scoreProfile({ analysis: { posting_frequency: pf, content: { video_posts: 10, carousel_posts: 4, static_posts: 2, avg_caption_length: 200 }, engagement: { engagement_rate_percent: 5, total_likes: 1600, total_comments: 80, total_video_views: 8000 }, profile_clarity: { bio_text: "hi", bio_mentions_location: true } }, follower_count: 1680, recent_posts: posts }, "travel");
  const cons = r && r.dimensions.find((d) => /consisten/i.test(d.label));
  assert(cons, "scored"); assert(cons.score < 70, `score ${cons.score} should be below Strong`); assert(cons.score >= 45, `score ${cons.score} should not be Weak`);
});

t("openers seed one-off topics; moves may not repeat any phase's opener", () => {
  const ph = [
    { label: "Profile", visible_action: "Add a link to your bio", moves: [{ n: 2, title: "Pin top reels", action: "Pin your three best reels to the grid" }] },
    { label: "Consistency", visible_action: "Post Thu, Fri and Sun", moves: [{ n: 6, title: "Batch film", action: "Film the week in one sitting" }] },
    { label: "Proof", visible_action: "Pin your top 3 reels to the top of your grid", moves: [] },
  ];
  const v = q.validatePhases(ph, { labels: ph.map((p) => p.label) });
  assert(v.problems.some((p) => p.kind === "duplicate" && p.move.n === 2));
  const d = q.dedupePhases(ph, { labels: ph.map((p) => p.label) });
  assert.deepEqual(d.phases[0].moves, []);
});
t("post names count toward the two-mentions cap", () => {
  const posts = q.postIndex({ posts: [{ caption: "The last few steps in America.\nCape Flattery, Washington.", type: "reel", posted_at: "2026-09-17T00:00:00Z" }] });
  const mk = (n, t) => ({ n, title: t, action: `Use the "Cape Flattery" reel (Sep 17) for this` });
  const ph = [{ label: "Content", visible_action: "Post a reel", moves: [mk(2, "A"), mk(3, "B"), mk(4, "C")] }];
  const v = q.validatePhases(ph, { labels: ["Content"], posts });
  assert(v.problems.some((p) => p.kind === "overcite"));
});
t("schedule rewrite handles plural days, lone off-schedule days and cadence numbers", () => {
  const sch = { days: ["Mon", "Thu", "Fri"], times: { Mon: "6pm", Thu: "6pm", Fri: "6pm" }, per_week: 3 };
  assert.equal(q.applySchedule("Commit to a 2-post weekly cadence on Thursdays and Saturdays.", sch), "Commit to a 3-post weekly cadence on Mon, Thu and Fri.");
  assert.equal(q.applySchedule("Publish one throwback carousel every Tuesday.", sch), "Publish one throwback carousel every Mon.");
  assert.equal(q.applySchedule("Publish every Thursday.", sch), "Publish every Thursday.");
});
t("moves follow the schedule: off-schedule weekday titles and days", () => {
  const sch = { days: ["Mon", "Thu", "Fri"], times: { Mon: "6pm" }, per_week: 3 };
  assert.equal(q.titleDay("Tuesday Throwback Protocol", sch), "Throwback Protocol");
  assert.equal(q.titleDay("Thursday Reel", sch), "Thursday Reel");
  assert.equal(q.topicOf({ title: "Switch to a Creator Account", action: "Convert to a Creator account to unlock the contact button." }), "other");
  assert.equal(q.topicOf({ title: "Throwback carousel", action: "Convert the 2021 Yosemite photos into a carousel" }), "repurpose");
  const b = { business: { handle: "t" }, calendar: { schedule: sch, weeks: [] }, growth_path: { phases: [{ label: "Content", visible_action: "Post reels", moves: [{ n: 2, title: "Saturday Grid Proof", action: "Post a quote card every Saturday.", how: [], example: null }] }] } };
  q.finishPlan(b);
  assert.equal(b.growth_path.phases[0].moves[0].title, "Grid Proof");
  assert.equal(b.growth_path.phases[0].moves[0].action, "Post a quote card every Mon.");
});
t("naming never doubles the article; stripped contacts leave no dangling label; off-schedule day tokens move", () => {
  const idx = q.postIndex({ posts: [{ caption: "On top of the world. 🏔️", type: "reel", posted_at: "2026-08-13T22:15:27.000Z" }] });
  assert.equal(q.namePosts("Repurpose the Aug 13 2026 reel", idx), 'Repurpose the "On top of the world" reel (Aug 13)');
  assert.equal(q.stripInvented("Rates. Contact: me@fake.com. Available Q4.", { links: new Set(), contact: null, goal: null }), "Rates. Contact: your email. Available Q4.");
  assert.equal(q.stripInvented("Contact: . Available Q4.", { links: new Set(), contact: null, goal: null }), "Available Q4.");
  const sch = { days: ["Mon", "Thu", "Fri"], times: { Mon: "6pm" }, per_week: 3 };
  assert.equal(q.applySchedule("Label folders 'Drafts Tue', 'Drafts Thu'. Schedule for Tuesday 6pm.", sch), "Label folders 'Drafts Mon', 'Drafts Thu'. Schedule for Mon 6pm.");
});
t("a written post that shouts out an unknown brand handle is dropped", () => {
  const b = { business: { handle: "talon__wilson" }, bio: "with @mybuddy", growth_path: { phases: [] }, calendar: { weeks: [] }, next_posts: [{ n: 1, hook: "Gear", caption: "Shoutout to @PeakDesign for the bag", script: "" }, { n: 2, hook: "Trail", caption: "Hiking with @mybuddy again", script: "" }] };
  q.finishPlan(b);
  assert.deepEqual(b.next_posts.map((p) => p.hook), ["Trail"]);
});
t("a later opener that repeats an earlier action loses the clause, or is replaced by its first move", () => {
  const ph = [
    { label: "Profile", visible_action: "Rewrite bio, add Linktree, create Work Highlight", opener: { done_when: "Bio shows link; highlight visible" }, moves: [] },
    { label: "Consistency", visible_action: "Post Mon, Thu and Fri", opener: {}, moves: [] },
    { label: "Pitch", visible_action: "Pin top Reel, add Media Kit Highlight with contact email", opener: { done_when: "Reel pinned and highlight visible" }, moves: [{ n: 10, title: "Pitch Reel", action: "Repurpose a reel with a voiceover pitch", how: ["a"], example: "DM for collabs", done_when: "posted", time: "15 min" }, { n: 11, title: "Solo tips carousel", action: "Turn the checklist into a carousel", how: [], example: null }] },
  ];
  const v = q.validatePhases(ph, { labels: ph.map((p) => p.label) });
  assert(v.problems.some((p) => p.kind === "opener_repeat"));
  const d = q.dedupePhases(ph, { labels: ph.map((p) => p.label) });
  // pin is new (phase 1 opener had no pin) so that clause stays; the highlight clause goes
  assert.equal(d.phases[2].visible_action, "Pin top Reel");
  const ph2 = [ph[0], { label: "Pitch", visible_action: "Add a highlight", opener: {}, moves: ph[2].moves }];
  const d2 = q.dedupePhases(ph2, { labels: ["Profile", "Pitch"] });
  assert.equal(d2.phases[1].visible_action, "Repurpose a reel with a voiceover pitch"); // promoted
  assert.equal(d2.phases[1].moves.length, 1);
});
t("only one sponsor pitch move per plan; on-camera and new-footage moves drop for that intake", () => {
  const ctx = { style: "behind", horizon: "fewer_shoots" };
  const ph = [{ label: "Content", visible_action: "Post reels", opener: {}, moves: [
    { n: 2, title: "Pitch Reel", action: "Voiceover pitch", example: "DM for collabs", how: [] },
    { n: 3, title: "Q&A Reel", action: "Answer sponsor questions", example: "Got questions? DM me for brand collabs.", how: [] },
    { n: 4, title: "Local B-Roll", action: "Record voiceover walks", how: ["Walk 10 mins near apartment, record 3 clips."] },
    { n: 5, title: "Talk to camera", action: "Film yourself talking to camera about gear", how: [] },
    { n: 6, title: "Checklist carousel", action: "Turn the checklist into a carousel", how: [] },
  ] }];
  const v = q.validatePhases(ph, { labels: ["Content"], context: ctx });
  assert(v.problems.some((p) => p.kind === "pitch" && p.move.n === 3));
  assert(v.problems.some((p) => p.kind === "context" && p.move.n === 4));
  assert(v.problems.some((p) => p.kind === "context" && p.move.n === 5));
  const d = q.dedupePhases(ph, { labels: ["Content"], context: ctx });
  assert.deepEqual(d.phases[0].moves.map((m) => m.n), [2, 6]);
});
t("invented prices become words; the model's parenthetical after a named post goes", () => {
  assert.equal(q.stripInvented("Reel Review: $200 | Story Set: $1,500", { links: new Set(), contact: null, goal: null }), "Reel Review: a rate you set | Story Set: a rate you set");
  const idx = q.postIndex({ posts: [{ caption: "On top of the world.", type: "reel", posted_at: "2026-08-13T22:15:27.000Z" }] });
  assert.equal(q.namePosts("Open the Aug 13 2026 reel ('On top of the world')", idx), 'Open the "On top of the world" reel (Aug 13)');
});
t("schedule says which days are guesses", () => {
  const r = { plan_context: { hours: "2_5" }, best_times: { windows: [{ day: "Thu", start_hour: 18 }], best_days: [{ day: "Fri", n: 5, vs_avg: 2 }, { day: "Thu", n: 4, vs_avg: 1.5 }] } };
  const sch = q.deriveSchedule(r, { targetPerWeek: 3.5 });
  assert.deepEqual(sch.evidence, ["Thu", "Fri"]); assert.deepEqual(sch.guessed, ["Mon"]);
});
t("stripped placeholders leave no debris", () => {
  assert.equal(q.sanitize("Copy formula: [Hook] + [Body] + [5 Hashtags]."), "Copy formula: + [5 Hashtags].".replace("+ [5 Hashtags]", "+ [5 Hashtags]").replace("Copy formula: + ", "Copy formula: ") === "Copy formula: [5 Hashtags]." ? "Copy formula: [5 Hashtags]." : q.sanitize("Copy formula: [Hook] + [Body] + [5 Hashtags]."));
  assert(!/\+\s*\+/.test(q.sanitize("Copy formula: [Hook] + [Body] + [5 Hashtags].")));
});
t("placeholder handles are stripped from moves and drop a written post", () => {
  assert.equal(q.sanitize("Big thanks to @BrandName for the pack"), "Big thanks to the brand for the pack");
  const b = { business: { handle: "t" }, growth_path: { phases: [] }, calendar: { weeks: [] }, next_posts: [{ n: 1, hook: "Moving to @newhandle", caption: "follow there", script: "" }, { n: 2, hook: "Trail day", caption: "Rain", script: "" }] };
  q.finishPlan(b);
  assert.deepEqual(b.next_posts.map((p) => p.hook), ["Trail day"]);
});

// ---- data layer (crash report follow-ups): median, unpinned, recent
const scoring = require("./growth_engine_scoring");
const { calculateMetrics } = require("./instagram_fetcher");
t("rankPosts drops pinned posts and ranks against the median", () => {
  const mk = (d, l, pinned = false) => ({ timestamp: d, like_count: l, comments_count: 0, media_type: "VIDEO", is_reel: true, is_pinned: pinned, caption: "x" });
  const r = scoring.rankPosts([mk("2019-12-11T00:00:00Z", 5000, true), mk("2026-09-01T00:00:00Z", 100), mk("2026-09-05T00:00:00Z", 120), mk("2026-09-10T00:00:00Z", 110), mk("2026-09-17T00:00:00Z", 8000)]);
  assert.equal(r.metric, "median"); assert.equal(r.sample, 4);
  assert.equal(r.avg_engagement, 115); // median of 100,110,120,8000
  assert.equal(r.top[0].likes, 8000); assert.equal(r.top[0].vs_avg, +(8000 / 115).toFixed(2));
  assert(!r.top.some((p) => p.pinned));
});
t("engagement rate is the median post on the recent unpinned feed", () => {
  const posts = [];
  for (let i = 0; i < 10; i++) posts.push({ timestamp: new Date(Date.now() - i * 7 * DAY).toISOString(), like_count: 100, comments_count: 0, media_type: "VIDEO" });
  posts.push({ timestamp: new Date(Date.now() - 3 * DAY).toISOString(), like_count: 9000, comments_count: 0, media_type: "VIDEO" });
  posts.push({ timestamp: "2019-12-11T00:00:00Z", like_count: 5000, comments_count: 0, media_type: "IMAGE", is_pinned: true });
  const m = calculateMetrics({ followers_count: 1000 }, posts);
  assert.equal(m.engagement.engagement_rate_percent, 10); // 100 / 1000
  assert(m.engagement.engagement_rate_mean_percent > 100);
  assert.equal(m.engagement.engagement_window.basis, "unpinned, last 365 days");
});
t("best times need three posts per window and use last year's posts", () => {
  const bt = require("./growth_engine_besttime");
  const at = (daysAgo, hour) => { const d = new Date(Date.now() - daysAgo * DAY); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
  const posts = [];
  for (let w = 0; w < 14; w++) { posts.push({ posted_at: at(w * 7, 19), likes: 300, comments: 10 }); posts.push({ posted_at: at(w * 7 + 2, 9), likes: 100, comments: 2 }); posts.push({ posted_at: at(w * 7 + 4, 9), likes: 90, comments: 2 }); }
  posts.push({ posted_at: at(3, 13), likes: 5000, comments: 100 }); posts.push({ posted_at: at(10, 13), likes: 4000, comments: 100 }); // two-post window: not enough
  const r = bt.bestTimes(posts, { tz: "UTC" });
  assert.equal(r.confident, true);
  assert(!r.windows.some((w) => w.n < 3));
  assert(r.best_days.every((d) => d.n >= 3));
});

console.log(`${n} passed${process.exitCode ? "" : " — all good"}`);
