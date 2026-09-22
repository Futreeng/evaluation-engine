// Moments — levels, milestones and (later) records and streaks (spec 2.2–2.5).
//
// Gamification rule from the spec: nothing gamey appears until the user has
// done something to earn it. So a level is always attached to a score (it's
// just a name for the band), but a *moment* — rank-up, milestone — only
// exists when a rescore shows the change. Each moment is keyed so it fires
// once per account+handle; `moments_seen` rides along on the report body the
// way check-ins and nudges do.
//
// Everything numeric lives in env, defaults below.

// SCORE_LEVELS="Rookie:0,Rising:40,Consistent:55,Established:70,Elite:85"
const LEVELS = (() => {
  const raw = process.env.SCORE_LEVELS || "Rookie:0,Rising:40,Consistent:55,Established:70,Elite:85";
  const rows = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [name, min] = s.split(":"); return { name: name.trim(), min: Number(min) }; })
    .filter((l) => l.name && Number.isFinite(l.min)).sort((a, b) => a.min - b.min);
  return rows.map((l, i) => ({ ...l, max: i + 1 < rows.length ? rows[i + 1].min - 1 : 100, rank: i + 1 }));
})();

const MILESTONES = {
  followers: Number(process.env.MILESTONE_FOLLOWERS || 1000),
  score: Number(process.env.MILESTONE_SCORE || 70),
  streak_weeks: Number(process.env.MILESTONE_STREAK_WEEKS || 4),
};

function levelFor(score) {
  if (!Number.isFinite(score)) return null;
  let cur = LEVELS[0];
  for (const l of LEVELS) if (score >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > cur.min) || null;
  return { name: cur.name, rank: cur.rank, of: LEVELS.length, min: cur.min, max: cur.max, next: next ? { name: next.name, min: next.min, points_away: next.min - score } : null };
}

// What changed between the previous report and this one. Returns the moments
// that haven't fired before for this account+handle.
function detectMoments(reportBody, prevBody) {
  const out = [];
  const seen = new Set((reportBody.moments_seen || []).map((m) => m.key));
  const score = reportBody.scores?.overall;
  const prevScore = prevBody?.scores?.overall;
  const now = Date.now();
  const push = (m) => { if (!seen.has(m.key)) out.push({ ...m, at: now }); };

  // 2.2 rank-up: level rose since the last report (never on a first run — no "before").
  if (Number.isFinite(score) && Number.isFinite(prevScore)) {
    const lv = levelFor(score), pv = levelFor(prevScore);
    if (lv && pv && lv.rank > pv.rank) push({ kind: "rank_up", key: `rank_${lv.name.toLowerCase()}`, title: `You're ${lv.name} now`, line: `${pv.name} → ${lv.name} · ${prevScore} → ${score}`, from: pv.name, to: lv.name, score });
  }
  // 2.5 milestones (thresholds in config): first time over the line.
  const followers = reportBody.business?.followers;
  const prevFollowers = prevBody?.business?.followers;
  if (Number.isFinite(followers) && followers >= MILESTONES.followers && (!Number.isFinite(prevFollowers) || prevFollowers < MILESTONES.followers) && prevBody) {
    push({ kind: "milestone", key: `followers_${MILESTONES.followers}`, title: `${fmtK(MILESTONES.followers)} followers`, line: `@${reportBody.business?.handle} just passed ${fmtK(MILESTONES.followers)}`, score });
  }
  if (Number.isFinite(score) && score >= MILESTONES.score && Number.isFinite(prevScore) && prevScore < MILESTONES.score) {
    push({ kind: "milestone", key: `score_${MILESTONES.score}`, title: `Score over ${MILESTONES.score}`, line: `${prevScore} → ${score} · into the ${levelFor(score)?.name || ""} band`, score });
  }
  const streak = reportBody.streak?.weeks;
  const prevStreak = prevBody?.streak?.weeks;
  if (Number.isFinite(streak) && streak >= MILESTONES.streak_weeks && (!Number.isFinite(prevStreak) || prevStreak < MILESTONES.streak_weeks)) {
    push({ kind: "milestone", key: `streak_${MILESTONES.streak_weeks}`, title: `${MILESTONES.streak_weeks}-week streak`, line: `${streak} on-plan weeks in a row`, score });
  }
  return out;
}

function fmtK(n) { return n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace(".0k", "k") : String(n); }

module.exports = { LEVELS, MILESTONES, levelFor, detectMoments };
