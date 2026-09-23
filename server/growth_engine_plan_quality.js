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
  { key: "bio_cta", dim: "profile", once: true, re: /\bbio\b.{0,60}\b(cta|dm|contact|email|call[- ]?to[- ]?action)\b|\b(cta|dm line|contact line|email line|call[- ]?to[- ]?action)\b.{0,60}\bbio\b|📩.{0,40}\bbio\b|\bbio\b.{0,40}📩|\bcontact (line|button)\b/i },
  { key: "bio_rewrite", dim: "profile", once: true, re: /\b(rewrite|revise|update|edit|rework|tighten|new)\b.{0,20}\bbio\b|\bbio\b.{0,30}\b(rewrite|revise|niche statement|tagline|first line)\b/i },
  { key: "highlight", dim: "profile", once: true, re: /\bhighlights?\b/i },
  { key: "pin", dim: "profile", once: true, re: /\bpin(ned|ning)?\b/i },
  { key: "media_kit", dim: "profile", once: true, re: /\bmedia kit\b/i },
  { key: "schedule", dim: "consistency", once: false, re: /\b(schedule|fixed (posting )?days|posting days|cadence|calendar|batch|draft(s)? for|same days? each week|every (mon|tue|wed|thu|fri|sat|sun)|per week|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[ ,/&and]{1,6}\b(mon|tue|wed|thu|fri|sat|sun))\b/i },
  { key: "format", dim: "content_mix", once: false, re: /\b(carousel|static|photo|reel|video|format|mix)\b/i },

  { key: "engage", dim: "engagement", once: false, re: /\b(comment|repl(y|ies)|question|hook|caption opener|first line|dm your|conversation|poll|sticker)\b/i },
  { key: "repurpose", dim: "content_mix", once: false, re: /\b(re-?cut|re-?post|throwback|repurpos|archive|convert|trim)\b/i },
];
const DIM_OF_LABEL = [
  ["profile", /profile|bio|clarity/i], ["consistency", /consisten|cadence|posting|schedule|frequen/i],
  ["content_mix", /content|mix|format|strategy/i], ["engagement", /engage|comment|conversation|reach/i],
];
function topicOf(move) {
  const text = `${move?.title || ""} ${move?.action || ""}`;
  for (const t of TOPICS) if (t.re.test(text)) return t.key;
  return "other";
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
  return s;
}

// ------------------------------------------------------------------ text hygiene
const BANNED = [
  [/\bswipe[- ]up( (in|to) (the|my) (bio|link))?\b/gi, "tap the link in my bio"],
  [/\bthank you for the opportunity\.?/gi, ""], [/\bready to amplify your brand\??/gi, ""],
  [/\b(dear|hi|hello) (brands?|sponsors?)\b[^.\n]*[.\n]?/gi, ""],
];
function sanitize(text, { name = null } = {}) {
  let s = String(text || "");
  // Placeholders: the model doesn't know their name; use the handle or drop the phrase.
  s = s.replace(/\[\s*(your )?name\s*\]/gi, name ? `@${name}` : "").replace(/\[\s*(your |insert )?[a-z ]{2,30}\]/gi, "").replace(/\b(I['’]m|I am|it['’]s|this is)\s+([–—-]\s+)/gi, "$1 ").replace(/\b(I['’]m|I am|it['’]s|this is)\s*[.,]/gi, "$1 me,");
  for (const [re, rep] of BANNED) s = s.replace(re, rep);
  return s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\s*[-–]\s*$/gm, "").trim();
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
  },
  tiktok: {
    bio_link: ["Open your profile → Edit profile → Website (needs a Business account, or 1k followers).", "Paste the URL and tap Save.", "Check it from a logged-out browser."],
    bio_cta: ["Open your profile → Edit profile → Bio.", "Add the line as the last line (80 characters max).", "Tap Save, then check it on your public profile."],
    bio_rewrite: ["Open your profile → Edit profile → Bio.", "Replace the text with the new version (80 characters max).", "Tap Save, then read it once on your public profile."],
    highlight: ["TikTok has no highlights; use a pinned video instead.", "Open the video → three dots → Pin to profile."],
    pin: ["Open the video from your profile.", "Tap the three dots → Pin to profile.", "Up to three videos can be pinned."],
    schedule: ["Edit the week's videos in one sitting and save them as drafts.", "On the post screen, turn on Schedule video and set the day and time (desktop or Business account).", "Check them under your profile → Drafts / Scheduled."],
    media_kit: ["Make a one-page media kit: audience size, your best three videos with their numbers, what you offer.", "Host it at a link you control and add that link to your bio.", "Reply to every brand DM with the link, not screenshots."],
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
  return { days, times, per_week: n, label: days.map((d) => `${d} ${times[d]}`).join(", "), source };
}

// ------------------------------------------------------------------ validation and dedupe
// Problems are strings the retry prompt can quote back to the model.
function validatePhases(phases, { labels = [] } = {}) {
  const problems = [];
  const seenOnce = new Map(); // topic → "phase i move n"
  const postCites = new Map(); // date → [moves]
  phases.forEach((ph, i) => {
    const dim = dimOfLabel(labels[i] || ph.label);
    const all = [...(ph.opener ? [{ ...ph.opener, title: ph.first_move_title || ph.label, action: ph.visible_action || "", _opener: true }] : []), ...(ph.moves || [])];
    for (const m of all) {
      const t = topicOf(m); const def = topicDef(t);
      const id = m._opener ? `phase ${i + 1} first move` : `move ${m.n} "${m.title}"`;
      if (def.once) { if (seenOnce.has(t)) problems.push({ kind: "duplicate", phase: i, move: m, topic: t, text: `${id} repeats ${seenOnce.get(t)} (both are about ${t.replace("_", " ")}).` }); else seenOnce.set(t, id); }
      if (dim && def.dim && def.dim !== dim && !m._opener) problems.push({ kind: "off_phase", phase: i, move: m, topic: t, text: `${id} is about ${def.dim.replace("_", " ")}, but phase ${i + 1} is "${labels[i] || ph.label}".` });
      for (const d of datesIn(`${m.title} ${m.action} ${m.why} ${(m.how || []).join(" ")} ${m.example || ""}`)) { const l = postCites.get(d) || []; l.push(id); postCites.set(d, l); }
    }
  });
  for (const [d, l] of postCites) if (l.length > 2) problems.push({ kind: "overcite", date: d, text: `The post from ${d} is used by ${l.length} moves (${l.join(", ")}); use it at most twice.` });
  return { ok: problems.length === 0, problems };
}
// Drop what the retry didn't fix: later duplicates of one-off topics and
// off-phase moves that a same-topic move elsewhere already covers.
function dedupePhases(phases, { labels = [] } = {}) {
  const seen = new Set(); const dropped = [];
  const out = phases.map((ph, i) => {
    const dim = dimOfLabel(labels[i] || ph.label);
    if (ph.opener) { const t = topicOf({ title: ph.label, action: ph.visible_action }); if (topicDef(t).once) seen.add(t); }
    const moves = [];
    for (const m of ph.moves || []) {
      const t = topicOf(m); const def = topicDef(t);
      if (def.once && seen.has(t)) { dropped.push({ phase: i, move: m, reason: "duplicate", topic: t }); continue; }
      if (dim && def.dim && def.dim !== dim && def.once && i > 0) { dropped.push({ phase: i, move: m, reason: "off_phase", topic: t }); seen.add(t); continue; }
      if (def.once) seen.add(t);
      moves.push(m);
    }
    return { ...ph, moves };
  });
  return { phases: out, dropped };
}

// ------------------------------------------------------------------ finish
// Names, hygiene and verified steps across the whole report. Idempotent.
function finishPlan(reportBody, { platform = reportBody.business?.platform || "instagram" } = {}) {
  const idx = postIndex(reportBody);
  const name = reportBody.business?.handle || null;
  const fix = (s) => sanitize(namePosts(s, idx), { name });
  const fixMove = (m, asOpener = null) => {
    if (!m) return m;
    const topic = topicOf(asOpener || m);
    const lib = howFor(platform, topic);
    const o = { ...m };
    for (const k of ["title", "action", "why", "example", "done_when"]) if (o[k]) o[k] = fix(o[k]);
    o.how = lib ? [...lib] : (o.how || []).map(fix);
    if (lib && m.how && m.how.length) { const own = m.how.map(fix).find((x) => /\b(caption|write|name it|title|text|say|record|voiceover)\b/i.test(x) && !/edit profile|three dots|tap/i.test(x)); if (own && !o.how.includes(own)) o.how.push(own); }
    o.topic = topic;
    return o;
  };
  for (const ph of reportBody.growth_path?.phases || []) {
    if (ph.opener) ph.opener = fixMove(ph.opener, { title: ph.label, action: ph.visible_action });
    if (ph.visible_action) ph.visible_action = fix(ph.visible_action);
    if (ph.detail) ph.detail = fix(ph.detail);
    ph.moves = (ph.moves || []).map((m) => fixMove(m));
    for (const w of ph.calendar_weeks || []) for (const s of w.slots || []) { s.angle = fix(s.angle); s.prompt = fix(s.prompt); }
  }
  for (const w of reportBody.calendar?.weeks || []) for (const s of w.slots || []) { s.angle = fix(s.angle); s.prompt = fix(s.prompt); }
  if (Array.isArray(reportBody.next_posts)) {
    let pitched = 0;
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
function benchmarkText(t) {
  if (!t) return null;
  return {
    posting_consistency: `${t.posts_per_week} posts/week; gaps over ${t.max_gap_days} days are unusual`,
    content_mix: `${Math.round(t.video_share * 100)}% video`,
    engagement_quality: `${t.engagement_rate}% engagement rate; comments ${Math.round((t.comment_share || 0.04) * 100)}% of interactions`,
    profile_clarity: "bio says what the account is about and where; a link that goes somewhere; a next step; story highlights",
  };
}

module.exports = { TOPICS, topicOf, topicDef, dimOfLabel, datesIn, postName, postIndex, namePosts, sanitize, HOWTO, howFor, deriveSchedule, cadenceFor, validatePhases, dedupePhases, finishPlan, benchmarkText };
