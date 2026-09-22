// Quests (spec 4.7) — behind ENABLE_QUESTS, off by default. Not a separate
// system: the Monday move grows into one short, trackable quest with a clear
// finish ("Post 3 reels this week"), set at each rescore from the calendar
// week the plan is in, and checked at the next rescore from the posts we
// already read. No extra scrape, no LLM.

const ENABLED = process.env.ENABLE_QUESTS === "true";
const DAY = 86400000;
const LABEL = { reel: "reel", video: "video", carousel: "carousel", image: "photo post" };

// Which calendar week the plan is in right now.
function currentWeek(body, now) {
  const started = body.plan_started_at || body.generated_at || now;
  const w = 1 + Math.floor((now - started) / DAY / 7);
  const weeks = body.calendar?.weeks || [];
  return weeks.find((x) => x.week === w) || weeks[Math.min(weeks.length - 1, Math.max(0, w - 1))] || null;
}

// The next quest: the dominant format in this week's calendar slots, else planned days.
function nextQuest(body, now = Date.now()) {
  const wk = currentWeek(body, now);
  const slots = wk?.slots || [];
  const byType = {}; for (const s of slots) { const t = String(s.format || "").toLowerCase(); if (t) byType[t] = (byType[t] || 0) + 1; }
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  const planned = (body.calendar?.posting_days || []).length || 3;
  const ends_at = now + 7 * DAY;
  if (top && top[1] >= 2) return { key: `q_${top[0]}_${top[1]}_${Math.floor(now / DAY)}`, title: `Post ${top[1]} ${LABEL[top[0]] || top[0]}s this week`, target: { kind: "posts_of_type", type: top[0], n: top[1] }, started_at: now, ends_at, progress: 0, done: false, week: wk?.week || null };
  return { key: `q_days_${planned}_${Math.floor(now / DAY)}`, title: `Post on ${planned} different days this week`, target: { kind: "days", n: planned }, started_at: now, ends_at, progress: 0, done: false, week: wk?.week || null };
}

// Progress from the posts we hold, counted inside the quest window.
function evaluateQuest(quest, posts, now = Date.now()) {
  if (!quest) return null;
  const inWin = (posts || []).filter((p) => { const t = Date.parse(p.posted_at || 0); return t >= quest.started_at && t <= Math.min(quest.ends_at, now) && !p.is_pinned; });
  let progress = 0;
  if (quest.target.kind === "posts_of_type") progress = inWin.filter((p) => String(p.type || "").toLowerCase() === quest.target.type).length;
  else progress = new Set(inWin.map((p) => String(p.posted_at).slice(0, 10))).size;
  return { ...quest, progress, done: progress >= quest.target.n, checked_at: now, closed: now >= quest.ends_at };
}

// Called at every rescore of a plan: close the old quest, open the next.
function rollQuests(body, prevBody, now = Date.now()) {
  if (!ENABLED) return;
  const history = [...(prevBody?.quest_history || [])];
  if (prevBody?.quest) { const done = evaluateQuest(prevBody.quest, body.posts, now); history.push({ key: done.key, title: done.title, progress: done.progress, n: done.target.n, done: done.done, ended_at: Math.min(done.ends_at, now) }); }
  body.quest_history = history.slice(-8);
  body.quest = nextQuest(body, now);
}

module.exports = { ENABLED, nextQuest, evaluateQuest, rollQuests, currentWeek };
