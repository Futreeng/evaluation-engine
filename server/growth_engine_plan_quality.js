// Plan quality (docs/PATH_SPEC.md, part 1). Everything here is deterministic:
// the model writes the moves, this file decides what they may repeat, which
// steps come from a verified library, what the posting schedule is and how
// posts are named. Runs on every paid report; the same functions clean the
// shipped sample offline (scripts/clean_sample.js).

const DAY = 86400000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_IDX = Object.fromEntries(DAYS.map((d, i) => [d, i]));

// ------------------------------------------------------------------ topics
// A move's topic decides whether it may repeat (one-off topics) and which
// dimension it serves. Order matters: first match wins.
const TOPICS = [
  { key: "bio_link", dim: "profile", once: true, re: /\b(linktree|link in bio|external link|add (a |the |your )?link|bio link|website link|link to (a |your |the )?(media kit|booking|newsletter|shop|site))\b/i },
  // A CTA is a bio move only when the bio is what changes; "DM for collabs" in a reel caption is content.
  { key: "bio_cta", dim: "profile", once: true, re: /\bbio\b.{0,60}\b(cta|dm|contact|email|call[- ]?to[- ]?action)\b|\b(cta|dm line|contact line|email line|call[- ]?to[- ]?action)\b.{0,60}\bbio\b|📩.{0,40}\bbio\b|\bbio\b.{0,40}📩|\bcontact line\b/i },
  { key: "bio_rewrite", dim: "profile", once: true, re: /\b(rewrite|revise|update|edit|rework|tighten|new)\b.{0,20}\bbio\b|\bbio\b.{0,30}\b(rewrite|revise|niche statement|tagline|first line)\b/i },
  { key: "highlight", dim: "profile", once: true, re: /\bhighlights?\b/i },
  { key: "pin", dim: "profile", once: true, re: /\bpin(ned|ning)?\b/i },
  { key: "media_kit", dim: "profile", once: true, re: /\bmedia kit\b/i },
  { key: "schedule", dim: "consistency", once: false, re: /\b(schedule|fixed (posting )?days|posting days|cadence|calendar|batch|draft(s)? for|same days? each week|every (mon|tue|wed|thu|fri|sat|sun)|per week|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[ ,/&and]{1,6}\b(mon|tue|wed|thu|fri|sat|sun))\b/i },
  { key: "repurpose", dim: "content_mix", once: false, re: /\b(re-?cut|re-?post|re-?mix|throwback|repurpos|archive|trim)\b|\bconvert\b.{0,30}\b(reel|carousel|video|post|clip|photo)s?\b/i },
  { key: "format", dim: "content_mix", once: false, re: /\b(carousel|static|photo|reel|video|format|mix)\b/i },

  { key: "engage", dim: "engagement", once: false, re: /\b(comment|repl(y|ies)|question|hook|caption opener|first line|dm your|conversation|poll|sticker)\b/i },
];
const DIM_OF_LABEL = [
  ["profile", /profile|bio|clarity/i], ["consistency", /consisten|cadence|posting|schedule|frequen/i],
  ["content_mix", /content|mix|format|strategy/i], ["engagement", /engage|comment|conversation|reach/i],
];
// A move that is really a sponsor pitch posted to the audience ("DM for collabs" reels).
const PITCH_RE = /\b(dm (me )?for (brand )?(collabs?|deals?|partnerships?)|partnership potential|let'?s team up|brand collaborations welcome|sponsor(ed)? (q&a|pitch)|pitch reel)\b/i;
const isPitch = (m) => PITCH_RE.test(`${m?.title || ""} ${m?.action || ""} ${m?.example || ""} ${(m?.how || []).join(" ")}`);
// What the creator told us they won't do. "behind" = never on camera; "fewer_shoots" = no new footage.
const ON_CAMERA_RE = /\b(talk(ing)?[- ]to[- ]camera|on[- ]camera|face[- ]to[- ]camera|selfie video|record yourself|film yourself|show your face|piece to camera)\b/i;
const NEW_FOOTAGE_RE = /\b(record \d+ (new )?clips?|film (new|a|the|\d+)|shoot (new|a|the|\d+)|new footage|new shoot|go (out|to) [^.]{0,40}(record|film|shoot)|walk [^.]{0,40}record)\b/i;
function violatesContext(move, ctx) {
  if (!ctx) return null;
  const blob = `${move?.title || ""} ${move?.action || ""} ${(move?.how || []).join(" ")}`;
  if (ctx.style === "behind" && ON_CAMERA_RE.test(blob)) return "needs the creator on camera, and they said they stay behind it";
  if (ctx.horizon === "fewer_shoots" && NEW_FOOTAGE_RE.test(blob)) return "needs new footage, and they said no new shoots this quarter";
  return null;
}
function topicOf(move) {
  const text = `${move?.title || ""} ${move?.action || ""}`;
  for (const t of TOPICS) if (t.re.test(text)) return t.key;
  return "other";
}
function openerTopics(ph) {
  const segs = String(`${ph.visible_action || ""}`).split(/\s*(?:,|;|\band\b|\+|·)\s*/).filter(Boolean);
  const out = new Set(); for (const seg of segs) { const t = topicOf({ title: "", action: seg }); if (t !== "other") out.add(t); }
  const whole = topicOf({ title: ph.label, action: ph.visible_action }); if (whole !== "other") out.add(whole);
  return [...out];
}
const topicDef = (key) => TOPICS.find((t) => t.key === key) || { key, dim: null, once: false };
function dimOfLabel(label) { for (const [k, re] of DIM_OF_LABEL) if (re.test(String(label || ""))) return k; return null; }

// ------------------------------------------------------------------ dates in text
// Models cite posts by ISO date (with ASCII, non-breaking or en-dash hyphens).
const DATE_RE = /\b(20\d\d)[-‑–‐](\d\d)[-‑–‐](\d\d)\b/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_RE = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:,?\\s+(20\\d\\d))?\\b`, "g");
function datesIn(text) {
  const out = new Set(); const s = String(text || "");
  for (const m of s.matchAll(DATE_RE)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of s.matchAll(MON_RE)) { const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase()); if (mi >= 0 && m[3]) out.add(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`); }
  return [...out];
}

// ------------------------------------------------------------------ post names
// "the Cape Flattery reel (Sep 17)". Built from the caption's first real words.
function postName(post) {
  if (!post) return null;
  const raw = String(post.caption || post.caption_preview || "").replace(/[#@]\S+/g, " ").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ");
  const lines = raw.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => /\p{L}/u.test(l));
  let title = "";
  // A place or a title: a run of two or more capitalised words that isn't just the start of a sentence.
  for (const line of lines) {
    const words = line.split(" ");
    for (let i = 0; i < words.length; i++) {
      const run = [];
      for (let j = i; j < words.length && run.length < 3; j++) { const w = words[j].replace(/[^\p{L}\p{N}'’-]/gu, ""); if (!w || !/^\p{Lu}/u.test(w) || w === "I") break; run.push(w); if (/[,.!?;:]$/.test(words[j])) break; }
      if (run.length >= 2 && !(i === 0 && run.length === words.length)) { title = run.join(" "); break; }
    }
    if (title) break;
  }
  if (!title) {
    // Else the first line, cut to six words.
    const first = (lines[0] || "").replace(/[.!?…]+$/, "");
    const words = first.split(" ").filter(Boolean);
    title = words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
  }
  const type = /reel|video/i.test(post.type || post.format || post.media_type || "") ? "reel" : /carousel|sidecar/i.test(post.type || post.format || post.media_type || "") ? "carousel" : "post";
  const d = new Date(post.posted_at || post.date || post.timestamp);
  const when = Number.isFinite(+d) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : "";
  return title ? `the "${title}" ${type}${when ? ` (${when})` : ""}` : `the ${type}${when ? ` from ${when}` : ""}`;
}
// Index every post the report knows about by ISO date.
function postIndex(reportBody) {
  const idx = new Map();
  const add = (p, key) => { const d = new Date(key); if (!Number.isFinite(+d)) return; const k = d.toISOString().slice(0, 10); if (!idx.has(k)) idx.set(k, p); };
  for (const p of reportBody.posts || []) add(p, p.posted_at || p.timestamp);
  for (const list of [reportBody.post_insights?.top, reportBody.post_insights?.bottom]) for (const p of list || []) add({ caption: p.caption, type: p.format, posted_at: p.date }, p.date);
  for (const d of reportBody.scores?.dimensions || []) for (const p of d.evidence_posts || []) add(p, p.posted_at);
  return idx;
}
// Replace "2026-09-17" / "Sep 17 2026" with the post's name wherever the post is known.
function namePosts(text, idx) {
  let s = String(text || "");
  if (!s) return s;
  s = s.replace(DATE_RE, (m, y, mo, d) => { const p = idx.get(`${y}-${mo}-${d}`); return p ? postName(p) : m; });
  s = s.replace(MON_RE, (m, mon, d, y) => { if (!y) return m; const mi = MONTHS.findIndex((x) => x.toLowerCase() === mon.slice(0, 3).toLowerCase()); const p = idx.get(`${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`); return p ? postName(p) : m; });
  // "post the "Cape Flattery" reel (Sep 17) reel" → drop the doubled noun; "reel the ..." → tidy.
  s = s.replace(/(\))\s+(reel|post|carousel)\b/gi, "$1").replace(/\b(reel|post|carousel|video)\s+the "/gi, 'the "');
  // "the "On top of the world" reel (Aug 13) ('On top of the world')" — the model's own parenthetical after our name.
  s = s.replace(/("[^"]+" (?:reel|carousel|post) \([^)]+\))\s*\('[^']*'\)/g, "$1");
  return s.replace(/\b(the|The)\s+the\s+"/g, '$1 "');
}

// ------------------------------------------------------------------ text hygiene
const BANNED = [
  [/\bswipe[- ]up( (in|to) (the|my) (bio|link))?\b/gi, "tap the link in my bio"],
  [/\bthank you for the opportunity\.?/gi, ""],
  [/@(?:brand|your|new|their|company|partner)[a-z]*(?:name|handle)\b/gi, "the brand"], [/\bready to amplify your brand\??/gi, ""],
  [/\b(dear|hi|hello) (brands?|sponsors?)\b[^.\n]*[.\n]?/gi, ""],
];
function sanitize(text, { name = null } = {}) {
  let s = String(text || "");
  // Placeholders: the model doesn't know their name; use the handle or drop the phrase.
  s = s.replace(/\[\s*(your )?name\s*\]/gi, name ? `@${name}` : "").replace(/\[\s*(your |insert )?[a-z ]{2,30}\]/gi, "").replace(/\b(I['’]m|I am|it['’]s|this is)\s+([–—-]\s+)/gi, "$1 ").replace(/\b(I['’]m|I am|it['’]s|this is)\s*[.,]/gi, "$1 me,");
  for (const [re, rep] of BANNED) s = s.replace(re, rep);
  s = s.replace(/(\s*\+\s*){2,}/g, " + ").replace(/:\s*\+\s*/g, ": ").replace(/\(\s*\)/g, "").replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
  return s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\s*[-–]\s*$/gm, "").replace(/[\s•·\-–—|]+$/g, "").trim();
}

// ------------------------------------------------------------------ verified mechanics
// Real steps for the actions the model keeps inventing. Keyed by platform then topic.
const HOWTO = {
  instagram: {
    bio_link: ["Open Instagram → your profile → Edit profile.", "Tap Links → Add external link.", "Paste the URL, give it a short title, tap Done.", "Check it from a logged-out browser."],
    bio_cta: ["Open your profile → Edit profile → Bio.", "Add the line as the last line of your bio.", "Tap Done, then check it on your public profile."],
    bio_rewrite: ["Open your profile → Edit profile → Bio.", "Replace the text with the new version (150 characters max).", "Tap Done, then read it once on your public profile."],
    highlight: ["Post the story first (or open an old one from Profile → the clock icon → Stories archive).", "On the story, tap Highlight → New → name it → Add.", "On your profile, press and hold the highlight → Edit highlight → set the cover."],
    pin: ["Open the post from your profile grid.", "Tap the three dots (top right) → Pin to your profile.", "Up to three posts can be pinned; unpin the weakest if it's full."],
    schedule: ["Film or edit the posts for the week in one sitting and save them as drafts.", "When you open a draft to post, tap Advanced settings → Schedule this post and set the day and time.", "Check the Scheduled content list under your profile menu."],
    media_kit: ["Make a one-page media kit (Canva has a free template): audience size, your best three posts with their numbers, what you offer.", "Host it at a link you control and add that link to your bio.", "Reply to every brand DM with the link, not screenshots."],
    repurpose: ["Find the original clip in your camera roll (or open the reel → three dots → Save to keep a copy).", "Create → Reel → pick the clip, trim to the moment that worked, add the new voiceover or text on screen.", "Write the caption fresh — say what's different this time — and post at your scheduled slot."],
  },
  tiktok: {
    bio_link: ["Open your profile → Edit profile → Website (needs a Business account, or 1k followers).", "Paste the URL and tap Save.", "Check it from a logged-out browser."],
    bio_cta: ["Open your profile → Edit profile → Bio.", "Add the line as the last line (80 characters max).", "Tap Save, then check it on your public profile."],
    bio_rewrite: ["Open your profile → Edit profile → Bio.", "Replace the text with the new version (80 characters max).", "Tap Save, then read it once on your public profile."],
    highlight: ["TikTok has no highlights; use a pinned video instead.", "Open the video → three dots → Pin to profile."],
    pin: ["Open the video from your profile.", "Tap the three dots → Pin to profile.", "Up to three videos can be pinned."],
    schedule: ["Edit the week's videos in one sitting and save them as drafts.", "On the post screen, turn on Schedule video and set the day and time (desktop or Business account).", "Check them under your profile → Drafts / Scheduled."],
    media_kit: ["Make a one-page media kit: audience size, your best three videos with their numbers, what you offer.", "Host it at a link you control and add that link to your bio.", "Reply to every brand DM with the link, not screenshots."],
    repurpose: ["Find the original clip in your camera roll (or open the video → three dots → Save video).", "Tap + → upload the clip, trim to the moment that worked, add the new voiceover or text.", "Write the caption fresh and post at your scheduled slot."],
  },
};
function howFor(platform, topic) { const p = HOWTO[String(platform || "instagram").toLowerCase()] || HOWTO.instagram; return p[topic] || null; }

// ------------------------------------------------------------------ schedule
// One posting schedule for the whole plan, derived from the account's own
// best days and windows plus the hours they said they have.
const hourLabel = (h) => { h = Number(h); if (!Number.isFinite(h)) return null; const ap = h >= 12 ? "pm" : "am"; const x = h % 12 || 12; return `${x}${ap}`; };
function cadenceFor(planContext, targetPerWeek) {
  const hours = planContext?.hours;
  if (hours === "lt2") return 2;
  if (hours === "2_5") return 3;
  const t = Number(targetPerWeek);
  return Math.max(2, Math.min(4, Number.isFinite(t) ? Math.round(t) : 3));
}
function deriveSchedule(reportBody, { targetPerWeek = null } = {}) {
  const bt = reportBody.best_times || {};
  const n = cadenceFor(reportBody.plan_context, targetPerWeek ?? reportBody.scores?.targets?.posts_per_week);
  const ranked = [...(bt.best_days || [])].filter((d) => Number(d.n) >= 2 && DAY_IDX[d.day] != null).sort((a, b) => b.vs_avg - a.vs_avg).map((d) => d.day);
  for (const w of bt.windows || []) if (DAY_IDX[w.day] != null && !ranked.includes(w.day)) ranked.push(w.day);
  for (const d of ["Mon", "Wed", "Fri", "Sat", "Tue", "Thu", "Sun"]) if (!ranked.includes(d)) ranked.push(d);
  const mondayFirst = (d) => (DAY_IDX[d] + 6) % 7;
  const days = ranked.slice(0, n).sort((a, b) => mondayFirst(a) - mondayFirst(b));
  const best = (bt.windows || [])[0];
  const times = {};
  for (const d of days) { const w = (bt.windows || []).find((x) => x.day === d) || best; times[d] = w ? hourLabel(w.start_hour) : "7pm"; }
  const source = (bt.best_days || []).some((d) => Number(d.n) >= 2) ? "your best days" : "starting points until we have more of your posts";
  const evidence = days.filter((d) => (bt.best_days || []).some((x) => x.day === d && Number(x.n) >= 2) || (bt.windows || []).some((w) => w.day === d));
  return { days, times, per_week: n, label: days.map((d) => `${d} ${times[d]}`).join(", "), source, evidence, guessed: days.filter((d) => !evidence.includes(d)) };
}

// ------------------------------------------------------------------ validation and dedupe
// Problems are strings the retry prompt can quote back to the model.
function validatePhases(phases, { labels = [], posts = null, context = null } = {}) {
  // Known posts by name ("Cape Flattery") so mentions count whether the model wrote a date or a name.
  const postNames = posts ? [...posts.entries()].map(([date, p]) => { const n = postName(p) || ""; const q = /"([^"]+)"/.exec(n); return q ? { key: q[1], date } : null; }).filter(Boolean) : [];
  const problems = [];
  const seenOnce = new Map(); // topic → "phase i move n"
  const postCites = new Map(); // date → [moves]
  // Openers come from the free snapshot and can't be rewritten, so every opener's one-off
  // topic is taken before any move is checked — a move may not repeat any phase's opener.
  phases.forEach((ph, i) => { for (const t of openerTopics(ph)) { if (!topicDef(t).once) continue; if (seenOnce.has(t) && !seenOnce.get(t).startsWith(`phase ${i + 1} `)) problems.push({ kind: "opener_repeat", phase: i, topic: t, text: `phase ${i + 1} first move repeats ${seenOnce.get(t)} (both are about ${t.replace("_", " ")}).` }); else if (!seenOnce.has(t)) seenOnce.set(t, `phase ${i + 1} first move`); } });
  let pitches = 0;
  phases.forEach((ph, i) => {
    const dim = dimOfLabel(labels[i] || ph.label);
    const all = [...(ph.opener ? [{ ...ph.opener, title: ph.first_move_title || ph.label, action: ph.visible_action || "", _opener: true }] : []), ...(ph.moves || [])];
    for (const m of all) {
      const t = topicOf(m); const def = topicDef(t);
      const id = m._opener ? `phase ${i + 1} first move` : `move ${m.n} "${m.title}"`;
      if (m._opener) { /* seeded above */ } else if (def.once) { if (seenOnce.has(t)) problems.push({ kind: "duplicate", phase: i, move: m, topic: t, text: `${id} repeats ${seenOnce.get(t)} (both are about ${t.replace("_", " ")}).` }); else seenOnce.set(t, id); }
      if (!m._opener && isPitch(m)) { pitches++; if (pitches > 1) problems.push({ kind: "pitch", phase: i, move: m, text: `${id} is another sponsor pitch post; only one move in the plan may pitch brands to the audience — the rest serve the audience.` }); }
      const cv = !m._opener && violatesContext(m, context); if (cv) problems.push({ kind: "context", phase: i, move: m, text: `${id} ${cv}.` });
      if (dim && def.dim && def.dim !== dim && !m._opener) problems.push({ kind: "off_phase", phase: i, move: m, topic: t, text: `${id} is about ${def.dim.replace("_", " ")}, but phase ${i + 1} is "${labels[i] || ph.label}".` });
      const blob = `${m.title} ${m.action} ${m.why} ${(m.how || []).join(" ")} ${m.example || ""}`;
      const cited = new Set(datesIn(blob));
      for (const nm of postNames) if (blob.includes(nm.key)) cited.add(nm.date);
      for (const d of cited) { const l = postCites.get(d) || []; l.push(id); postCites.set(d, l); }
    }
  });
  for (const [d, l] of postCites) if (l.length > 2) problems.push({ kind: "overcite", date: d, text: `The post from ${d} is used by ${l.length} moves (${l.join(", ")}); use it at most twice.` });
  return { ok: problems.length === 0, problems };
}
// Drop what the retry didn't fix: later duplicates of one-off topics and
// off-phase moves that a same-topic move elsewhere already covers.
function dedupePhases(phases, { labels = [], context = null } = {}) {
  const seen = new Set(); const dropped = []; let pitches = 0;
  // Openers first, in order. A later opener that repeats an earlier phase's one-off action
  // loses that clause; if nothing is left, its first move becomes the opener.
  const cutClauses = (text, takenTopics) => {
    const parts = String(text || "").split(/(\s*(?:,|;|\band\b)\s*)/);
    const keep = []; for (let k = 0; k < parts.length; k += 2) { const seg = parts[k]; const t = topicOf({ title: "", action: seg }); if (!(topicDef(t).once && takenTopics.has(t))) keep.push(seg.trim()); }
    return keep.filter(Boolean).join(", ").replace(/^(\w)/, (c) => c.toUpperCase());
  };
  phases = phases.map((ph, i) => {
    const mine = openerTopics(ph).filter((t) => topicDef(t).once);
    const repeated = mine.filter((t) => seen.has(t));
    let o = { ...ph };
    if (repeated.length) {
      const taken = new Set(repeated);
      const va = cutClauses(ph.visible_action, taken);
      if (va && va.length >= 8) { o.visible_action = va; o.detail = ph.detail; if (o.opener) o.opener = { ...o.opener, done_when: cutClauses(o.opener.done_when, taken) || o.opener.done_when }; }
      else if ((ph.moves || []).length) {
        // Whole opener already done earlier: the first surviving move takes its place.
        const first = ph.moves.find((m) => !(topicDef(topicOf(m)).once && seen.has(topicOf(m)))) || ph.moves[0];
        o.visible_action = first.action || first.title; o.detail = first.why || ""; o.opener = { how: first.how || [], example: first.example ?? null, done_when: first.done_when || "", time: first.time || "" }; o.moves = ph.moves.filter((m) => m !== first); o.promoted_move = first.n;
        dropped.push({ phase: i, move: { title: ph.visible_action }, reason: "opener_repeat_promoted", topic: repeated.join("+") });
        if (isPitch(first)) pitches++;
      }
    }
    for (const t of openerTopics(o)) if (topicDef(t).once) seen.add(t);
    // This phase's moves happen before the next phase's opener, so they count as taken too.
    for (const m of o.moves || []) { const t = topicOf(m); if (topicDef(t).once) seen.add(t); }
    return o;
  });
  seen.clear(); for (const ph of phases) for (const t of openerTopics(ph)) if (topicDef(t).once) seen.add(t);
  const out = phases.map((ph, i) => {
    const dim = dimOfLabel(labels[i] || ph.label);
    const moves = [];
    for (const m of ph.moves || []) {
      const t = topicOf(m); const def = topicDef(t);
      if (def.once && seen.has(t)) { dropped.push({ phase: i, move: m, reason: "duplicate", topic: t }); continue; }
      const cv = violatesContext(m, context); if (cv) { dropped.push({ phase: i, move: m, reason: "context", topic: t }); continue; }
      if (isPitch(m)) { pitches++; if (pitches > 1) { dropped.push({ phase: i, move: m, reason: "pitch", topic: t }); continue; } }
      if (dim && def.dim && def.dim !== dim && def.once && i > 0) { dropped.push({ phase: i, move: m, reason: "off_phase", topic: t }); seen.add(t); continue; }
      if (def.once) seen.add(t);
      moves.push(m);
    }
    return { ...ph, moves };
  });
  return { phases: out, dropped };
}

// The phase openers are written in the free snapshot, before the schedule exists, so
// they can name other days or times. Rewrite day lists and clock times in them to the
// plan's one schedule. Moves are left alone: they were written with the schedule in hand.
const DAY_WORD = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?s?";
const LONE_DAY_RE = /\b(every|each|on)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?s?)\b/gi;
const CADENCE_RE = /\b(\d)[- ](?:post|posts)[- ](?:a|per|weekly|every)\s*(?:week|cadence)?\b|\b(\d)\s*(?:posts?|reels?|videos?)\s+(?:a|per)\s+week\b/gi;
const DAY_LIST_RE = new RegExp(`\\b${DAY_WORD}(?:\\s*(?:,|/|&|and|\\+)\\s*${DAY_WORD}){1,5}\\b`, "g");
const CLOCK_RE = /\b\d{1,2}(?::\d\d)?\s?(?:am|pm)\b/gi;
function applySchedule(text, schedule) {
  if (!text || !schedule?.days?.length) return text;
  const days = schedule.days.join(", ").replace(/, ([^,]+)$/, " and $1");
  const time = schedule.times?.[schedule.days[0]] || null;
  let out = String(text).replace(DAY_LIST_RE, days);
  // "every Tuesday" when Tuesday isn't a posting day → the first posting day.
  const short = (d) => String(d).slice(0, 3).toLowerCase();
  out = out.replace(LONE_DAY_RE, (m, w, d) => (schedule.days.some((x) => short(x) === short(d)) ? m : `${w} ${schedule.days[0]}`));
  if (schedule.per_week) out = out.replace(CADENCE_RE, (m) => m.replace(/\d/, String(schedule.per_week)));
  // Any other weekday that isn't a posting day ("Drafts Tue", "for Tuesday 6pm") → the first posting day.
  out = out.replace(/\b((?:Mon|Tues?|Wed|Thurs?|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?s?)\b/g, (m) => (schedule.days.some((x) => short(x) === short(m)) ? m : schedule.days[0]));
  if (time) out = out.replace(CLOCK_RE, time);
  return out;
}

// Models invent plausible links ("https://linktr.ee/<handle>") and emails when none was
// given. Only the account's real link and what the creator typed in may appear; anything
// else becomes plain words, so nobody pastes a URL that goes nowhere.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)<>"'”’]+|\b(?:linktr\.ee|beacons\.ai|bio\.site|stan\.store|linkin\.bio)\/[^\s)<>"'”’]+/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
function allowedLinks(reportBody) {
  const out = new Set();
  const add = (u) => { if (u) out.add(String(u).trim().replace(/\/$/, "").toLowerCase()); };
  add(reportBody.plan_context?.link); add(reportBody.profile?.external_url);
  for (const m of String(reportBody.bio || reportBody.profile?.bio || "").matchAll(URL_RE)) add(m[0]);
  return out;
}
function stripInvented(text, { links, contact, goal }) {
  if (!text) return text;
  const linkWords = goal === "deals" ? "your link (the page brands should land on — a media kit, or a Linktree that points to it)" : goal === "sell" ? "your link (the page where they buy)" : goal === "bookings" ? "your link (your booking page)" : "your link";
  let out = String(text).replace(URL_RE, (u) => { const k = u.trim().replace(/\/$/, "").toLowerCase(); return [...links].some((l) => k === l || k.endsWith(l) || l.endsWith(k)) ? u : linkWords; });
  out = out.replace(EMAIL_RE, (e) => (contact && e.toLowerCase() === String(contact).toLowerCase() ? e : "your email"));
  // Dollar amounts the model made up ("Reel: $200") — the account gives us no pricing data.
  out = out.replace(/\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?\b/g, "a rate you set");
  out = out.replace(/\b(your link)\s*\(([^)]*)\)([^.]*)\1\s*\([^)]*\)/g, "$1 ($2)$3$1"); // don't explain twice in one sentence
  // Lines left as a bare label, a lone emoji, or just "your email" after the stripping go too.
  const bare = (line) => { const t = line.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim(); if (t === "") return /\p{Extended_Pictographic}/u.test(line); return /^[A-Za-z&' ]{2,40}:\s*(your email|your link.*)?$/i.test(t) || /^(your email|your link.*)$/i.test(t); };
  if (out.includes("\n")) out = out.split("\n").filter((l) => !bare(l)).join("\n"); // multi-line examples (a bio) only; a one-line "Add link: your link" stays
  return out.replace(/\b(contact|email|link|website|work with me)\s*:\s*(?=[.,;•]|$)[.,;]?\s*/gi, "").replace(/\s+([.,;])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

// "Tuesday Throwback Protocol" when Tuesday isn't a posting day → "Throwback Protocol".
function titleDay(title, schedule) {
  if (!title || !schedule?.days?.length) return title;
  const short = (d) => String(d).slice(0, 3).toLowerCase();
  return String(title).replace(/^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?s?)\s+/i, (m, d) => (schedule.days.some((x) => short(x) === short(d)) ? m : ""));
}

// ------------------------------------------------------------------ why check + buttons
const evidence = require("./growth_engine_evidence");
// Every number the account's data can vouch for: scores, follower count, every post's
// likes/comments/views, best-time lifts, the evidence lines, targets.
function numbersInReport(r) {
  const posts = (r.posts || []).map((p) => ({ l: p.likes, c: p.comments, v: p.views, d: p.posted_at ? new Date(p.posted_at).getDate() : null }));
  return evidence.allowedNumbers({
    scores: { overall: r.scores?.overall, dims: (r.scores?.dimensions || []).map((d) => ({ s: d.score, e: d.evidence, p: d.parts, avg: d.category_avg })), pct: r.scores?.category_percentile },
    followers: r.business?.followers, sampled: r.posts_sampled, window: r.data_window,
    posts, insights: r.post_insights, best: r.best_times, schedule: r.calendar?.schedule, plan_days: r.plan_days,
    year: new Date().getFullYear(),
  });
}
// A move's "why" may only quote the account's own numbers. Sentences that quote anything
// else are dropped; the move stays. Returns how many sentences went.
function checkWhy(text, allowed) {
  if (!text) return { text, stripped: 0 };
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const keep = sentences.filter((sn) => evidence.validateExplanation(sn, allowed).ok);
  return { text: keep.join(" ").trim(), stripped: sentences.length - keep.length };
}
// The button on a move, decided from the move itself — never model output.
//   see_example: the move cites one of the account's posts → open that post
//   write_post:  a posting move with a written post to show → open it
//   mark_done:   everything else (the Path and the report already have the checkbox)
function ctaFor(move, r, idx, postNames, { free = false } = {}) {
  const blob = `${move.title || ""} ${move.action || ""} ${move.why || ""} ${(move.how || []).join(" ")} ${move.example || ""}`;
  const byDate = new Map(); for (const p of r.posts || []) { const d = new Date(p.posted_at || p.timestamp); if (Number.isFinite(+d)) byDate.set(d.toISOString().slice(0, 10), p); }
  let hit = null;
  for (const nm of postNames) if (blob.includes(nm.key)) { hit = byDate.get(nm.date) || idx.get(nm.date); if (hit) break; }
  if (!hit) for (const d of datesIn(blob)) { hit = byDate.get(d); if (hit) break; }
  if (hit && (hit.permalink || hit.url)) return { type: "see_example", label: "See the post", url: hit.permalink || hit.url, post_id: hit.id || hit.post_id || null };
  const topic = move.topic || topicOf(move);
  // A free report has no written posts yet: the button is the paywall ("Get this post written").
  if (free && ["format", "repurpose", "schedule"].includes(topic)) return { type: "write_post", label: "Get this post written", post_index: 0 };
  if (["format", "repurpose", "schedule"].includes(topic) && (r.next_posts || []).length) {
    const fmt = /carousel/i.test(blob) ? "carousel" : /reel|video/i.test(blob) ? "reel" : /static|photo|image/i.test(blob) ? "static" : null;
    const sameFmt = (p) => !fmt || String(p.format).toLowerCase() === fmt || (fmt === "static" && /photo|image/i.test(p.format));
    // Prefer the written post on the day the move names ("Monday Memory Reel" → the Monday reel).
    const dayM = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.exec(blob); const day = dayM ? dayM[1].slice(0, 3).toLowerCase() : null;
    let i = day ? r.next_posts.findIndex((p) => String(p.day).slice(0, 3).toLowerCase() === day && sameFmt(p)) : -1;
    if (i < 0) i = r.next_posts.findIndex(sameFmt);
    return { type: "write_post", label: "Open the written post", post_index: i >= 0 ? i : 0 };
  }
  return { type: "mark_done", label: "Mark done" };
}

// Free snapshot: only the phase openers exist; give each its button (paywall for posting moves).
function stampFreeCtas(reportBody) {
  const idx = postIndex(reportBody);
  const postNames = [...idx.entries()].map(([date, p]) => { const n = postName(p) || ""; const q = /"([^"]+)"/.exec(n); return q ? { key: q[1], date } : null; }).filter(Boolean);
  for (const ph of reportBody.growth_path?.phases || []) { const om = { title: ph.label, action: ph.visible_action, why: ph.detail, how: [], example: null }; ph.opener = { ...(ph.opener || {}), cta: ctaFor(om, reportBody, idx, postNames, { free: true }), target: targetFor(om, reportBody) }; }
  return reportBody;
}

// ------------------------------------------------------------------ targets + confidence
// "How we'll measure it": every move names the number it is trying to move and where to,
// from the scorer's own figures. Deterministic — the rescore can say whether it happened.
const DIM_LABEL = { profile: "Profile Clarity", consistency: "Posting Consistency", content_mix: "Content Mix", engagement: "Engagement Quality" };
const nextBand = (score) => (score < 50 ? 60 : score < 70 ? 80 : Math.min(100, score + 10));
function targetFor(move, r) {
  const topic = move.topic || topicOf(move);
  const dimKey = topicDef(topic).dim || (/bio|link|highlight|pin|profile/i.test(`${move.title} ${move.action}`) ? "profile" : null);
  if (!dimKey) return null;
  const dim = (r.scores?.dimensions || []).find((d) => d.label === DIM_LABEL[dimKey]);
  if (!dim || !Number.isFinite(Number(dim.score))) return null;
  const score = Number(dim.score);
  if (dimKey === "consistency") {
    const m = /([\d.]+)\/week vs ([\d.]+)\/week/.exec(dim.evidence || "");
    const per = r.calendar?.schedule?.per_week;
    if (m) return { dimension: dim.label, metric: "posts a week", from: Number(m[1]), to: per || Number(m[2]), unit: "/week" };
  }
  // Content and engagement moves are measured on what a typical post earns, not a band score.
  if ((dimKey === "engagement" || dimKey === "content_mix") && Number.isFinite(Number(r.post_insights?.avg_engagement))) {
    const med = Number(r.post_insights.avg_engagement);
    const eng = (r.scores?.dimensions || []).find((d) => /engagement/i.test(d.label));
    return { dimension: eng ? eng.label : dim.label, metric: "likes + comments on a typical post", from: med, to: Math.round(med * 1.4), unit: "" };
  }
  if (score >= 100) return null;
  return { dimension: dim.label, metric: "score", from: score, to: nextBand(score), unit: "" };
}
// How much to trust a number, from its sample size. Shown next to the number.
function confidence(n, { high = 12, some = 4 } = {}) {
  n = Number(n) || 0;
  return n >= high ? { level: "high", label: "High confidence", n } : n >= some ? { level: "some", label: "Some evidence", n } : { level: "low", label: "Needs more data", n };
}

// ------------------------------------------------------------------ finish
// Names, hygiene and verified steps across the whole report. Idempotent.
function finishPlan(reportBody, { platform = reportBody.business?.platform || "instagram" } = {}) {
  const idx = postIndex(reportBody);
  const name = reportBody.business?.handle || null;
  const linkCtx = { links: allowedLinks(reportBody), contact: reportBody.plan_context?.contact || null, goal: reportBody.plan_context?.goal || null };
  const fix = (s) => stripInvented(sanitize(namePosts(s, idx), { name }), linkCtx);
  // The library replaces the model's steps only where the mechanic IS the move (profile
  // edits) or where the model's own steps invent a flow that doesn't exist.
  const LIBRARY_ALWAYS = new Set(["bio_link", "bio_cta", "bio_rewrite", "highlight", "pin", "media_kit"]);
  const BOGUS_HOW = /throwback sticker|add to reel|swipe[- ]up|save to highlight|reels archive|remix button|archive(d)?:|archive the|hide (the|your) (lowest|worst)|delete (the|your) (lowest|worst)/i;
  const fixMove = (m, asOpener = null) => {
    if (!m) return m;
    const topic = m.topic || topicOf(asOpener || m);
    const lib = howFor(platform, topic);
    const ownHow = (m.how || []).map(fix);
    const useLib = !!lib && (LIBRARY_ALWAYS.has(topic) || !ownHow.length || ownHow.some((x) => BOGUS_HOW.test(x)));
    const o = { ...m };
    for (const k of ["title", "action", "why", "example", "done_when"]) if (o[k]) o[k] = fix(o[k]);
    o.how = useLib ? [...lib] : ownHow;
    // A scheduling move's "starting point" is a day/time, never a caption pasted in by mistake.
    if (topic === "schedule" && o.example && !/\b(mon|tue|wed|thu|fri|sat|sun|am|pm|\d{1,2}:\d\d)\b/i.test(o.example)) o.example = null;
    if (useLib && ownHow.length) { const own = ownHow.find((x) => /\b(caption|write|name it|title|text|say|record|voiceover)\b/i.test(x) && !/edit profile|three dots|tap/i.test(x)); if (own && !o.how.includes(own)) o.how.push(own); }
    o.topic = topic;
    return o;
  };
  const schedule = reportBody.calendar?.schedule || null;
  for (const ph of reportBody.growth_path?.phases || []) {
    if (schedule) { for (const k of ["visible_action", "detail"]) if (ph[k]) ph[k] = applySchedule(ph[k], schedule);
      ph.moves = (ph.moves || []).map((m) => ({ ...m, topic: m.topic || topicOf(m), title: titleDay(m.title, schedule), action: applySchedule(m.action, schedule), why: applySchedule(m.why, schedule), done_when: applySchedule(m.done_when, schedule), how: (m.how || []).map((x) => applySchedule(x, schedule)), example: m.example ? applySchedule(m.example, schedule) : m.example })); if (ph.opener) { ph.opener = { ...ph.opener, how: (ph.opener.how || []).map((x) => applySchedule(x, schedule)), done_when: applySchedule(ph.opener.done_when, schedule), example: ph.opener.example ? applySchedule(ph.opener.example, schedule) : ph.opener.example }; } }
    if (ph.opener) ph.opener = fixMove(ph.opener, { title: ph.label, action: ph.visible_action });
    if (ph.visible_action) ph.visible_action = fix(ph.visible_action);
    if (ph.detail) ph.detail = fix(ph.detail);
    ph.moves = (ph.moves || []).map((m) => fixMove(m));
    for (const w of ph.calendar_weeks || []) for (const s of w.slots || []) { s.angle = fix(s.angle); s.prompt = fix(s.prompt); }
  }
  for (const w of reportBody.calendar?.weeks || []) for (const s of w.slots || []) { s.angle = fix(s.angle); s.prompt = fix(s.prompt); }
  // Why-lines only quote the account's numbers; every move gets its button.
  { const allowed = numbersInReport(reportBody); let stripped = 0;
    const postNames = [...idx.entries()].map(([date, p]) => { const n = postName(p) || ""; const q = /"([^"]+)"/.exec(n); return q ? { key: q[1], date } : null; }).filter(Boolean);
    for (const ph of reportBody.growth_path?.phases || []) {
      if (ph.detail) { const c = checkWhy(ph.detail, allowed); ph.detail = c.text; stripped += c.stripped; }
      if (ph.opener) { const om = { title: ph.label, action: ph.visible_action, why: ph.detail, how: ph.opener.how, example: ph.opener.example, topic: ph.opener.topic }; ph.opener = { ...ph.opener, cta: ctaFor(om, reportBody, idx, postNames), target: targetFor(om, reportBody) }; }
      ph.moves = (ph.moves || []).map((m) => { const c = checkWhy(m.why, allowed); stripped += c.stripped; const o = { ...m, why: c.text }; return { ...o, cta: ctaFor(o, reportBody, idx, postNames), target: targetFor(o, reportBody) }; });
    }
    reportBody.why_stripped = stripped; }
  if (Array.isArray(reportBody.next_posts)) {
    let pitched = 0;
    const PLACEHOLDER_HANDLE = /@(?:brand|your|new|their|company|partner)[a-z]*(?:name|handle)\b/i;
    // Only handles we know: the creator's own, competitors they picked, anyone in their bio. A shout-out to any other @handle is an invented endorsement.
    const known = new Set([reportBody.business?.handle, ...((reportBody.competitors?.competitors || []).map((c) => c.handle)), ...((String(reportBody.bio || "").match(/@[a-z0-9_.]+/gi) || []).map((h) => h.slice(1)))].filter(Boolean).map((h) => String(h).toLowerCase()));
    const unknownMention = (t) => (String(t).match(/@[a-z0-9_.]{2,}/gi) || []).some((h) => !known.has(h.slice(1).toLowerCase()));
    reportBody.next_posts = reportBody.next_posts.filter((p) => { const t = `${p.hook} ${p.caption} ${p.script}`; return !PLACEHOLDER_HANDLE.test(t) && !unknownMention(t); });
    reportBody.next_posts = reportBody.next_posts.map((p) => {
      const o = { ...p };
      for (const k of ["hook", "caption", "script", "why"]) if (o[k]) o[k] = fix(o[k]);
      if (/media kit|brand (deal|partnership|collab)/i.test(`${o.hook} ${o.caption} ${o.script}`)) { pitched++; if (pitched > 1) o.pitch = true; }
      return o;
    });
    // More than one sponsor pitch in a set: keep the first, the rest go to the back so the path leads with audience posts.
    reportBody.next_posts = [...reportBody.next_posts.filter((p) => !p.pitch), ...reportBody.next_posts.filter((p) => p.pitch).map((p) => { const o = { ...p }; delete o.pitch; return o; })].map((p, i) => ({ ...p, n: i + 1 }));
  }
  return reportBody;
}

// Benchmark text from the scorer's own numbers, so the model's explanation
// and the evidence line quote the same target.
// Stamp confidence on the timing block (per window and overall) and on the niche marker.
function stampConfidence(reportBody) {
  const bt = reportBody.best_times;
  if (bt) { bt.confidence = confidence(bt.sample, { high: 20, some: 12 }); for (const w of bt.windows || []) w.confidence = confidence(w.n, { high: 6, some: 3 }); }
  const n = reportBody.scores?.category_sample_size;
  if (reportBody.scores && n != null) reportBody.scores.category_confidence = confidence(n, { high: 100, some: 25 });
  return reportBody;
}
function benchmarkText(t) {
  if (!t) return null;
  return {
    posting_consistency: `${t.posts_per_week} posts/week; gaps over ${t.max_gap_days} days are unusual`,
    content_mix: `${Math.round(t.video_share * 100)}% video`,
    engagement_quality: `${t.engagement_rate}% engagement rate; comments ${Math.round((t.comment_share || 0.04) * 100)}% of interactions`,
    profile_clarity: "bio says what the account is about and where; a link that goes somewhere; a next step; story highlights",
  };
}

module.exports = { targetFor, confidence, stampConfidence, stampFreeCtas, numbersInReport, checkWhy, ctaFor, isPitch, violatesContext, openerTopics, titleDay, stripInvented, allowedLinks, applySchedule, TOPICS, topicOf, topicDef, dimOfLabel, datesIn, postName, postIndex, namePosts, sanitize, HOWTO, howFor, deriveSchedule, cadenceFor, validatePhases, dedupePhases, finishPlan, benchmarkText };
