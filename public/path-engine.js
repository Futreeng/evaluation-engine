// The Path (docs/PATH_SPEC.md, part 2): turns a report body into an ordered
// list of steps with a status each, and picks what to show now. One file for
// the server (GET /reports/:id/path, verification at rescore), the app
// (#/path/:report, the sample) and the mock API, so the three never disagree.
//
//   ScalecraftPath.build(reportBody, { now, paid }) → { steps, now: [keys], next, phase, progress, caught_up, free, locked_count }
//
// Step keys reuse the move keys the rest of the product already stores
// (`p1m2` = phase 1, move 2; `p1m1` is the phase opener). Calendar slots are
// `c<week>-<day>`. State lives on the report body: moves_done (existing),
// moves_skipped, moves_later, moves_verified.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ScalecraftPath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY = 86400000;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIdx = (d) => DAYS.indexOf(String(d || "").slice(0, 3));
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const PHASE_DAYS = 30;

  function phaseStart(body, i) { return startOfDay(body.plan_started_at || body.generated_at || body.created_at || Date.now()) + i * PHASE_DAYS * DAY; }

  // Attach each written post to the calendar slot it was written for: same
  // day and format first, then same format, then in order.
  function pairPosts(slots, posts) {
    const free = [...(posts || [])];
    const take = (pred) => { const i = free.findIndex(pred); return i >= 0 ? free.splice(i, 1)[0] : null; };
    for (const s of slots) {
      s.post = take((p) => dayIdx(p.day) === dayIdx(s.day) && String(p.format).toLowerCase() === String(s.format).toLowerCase())
        || take((p) => String(p.format).toLowerCase() === String(s.format).toLowerCase())
        || null;
    }
    // Anything unpaired goes to the earliest slots still empty.
    for (const s of slots) if (!s.post && free.length) s.post = free.shift();
    return slots;
  }

  function build(body, { now = Date.now(), paid = null } = {}) {
    body = body || {};
    const isPaid = paid != null ? paid : !!(body.tier && body.tier !== "social_snapshot");
    const done = body.moves_done || {}, skipped = body.moves_skipped || {}, later = body.moves_later || {}, verified = body.moves_verified || {};
    const phases = (body.growth_path && body.growth_path.phases) || [];
    const weeks = (body.calendar && body.calendar.weeks) || [];
    const today = startOfDay(now);
    const statusOf = (key) => done[key] ? "done" : skipped[key] ? "skipped" : later[key] && later[key] > now ? "later" : "open";
    const steps = [];
    let lockedCount = 0;

    phases.forEach((p, i) => {
      const pk = "p" + (i + 1);
      const range = p.range || `${i * PHASE_DAYS + 1}-${(i + 1) * PHASE_DAYS}`;
      const opensAt = phaseStart(body, i);
      const base = { phase: i + 1, phase_label: p.label || `Phase ${i + 1}`, phase_range: range, opens_at: opensAt };
      const addMove = (key, m, n, opener) => {
        const st = statusOf(key);
        steps.push({ ...base, key, kind: "move", n, opener: !!opener, title: opener ? (p.label || "First move") : (m.title || ""), action: opener ? (p.visible_action || p.action || "") : (m.action || ""), why: opener ? (p.detail || "") : (m.why || ""),
          how: (opener ? (p.opener && p.opener.how) : m.how) || [], example: (opener ? (p.opener && p.opener.example) : m.example) || null, done_when: (opener ? (p.opener && p.opener.done_when) : m.done_when) || "", time: (opener ? (p.opener && p.opener.time) : m.time) || "",
          topic: (opener ? (p.opener && p.opener.topic) : m.topic) || null, due: null, status: st, done_at: done[key] || null, skipped: skipped[key] || null, verified: verified[key] || null, live: true });
      };
      if (p.not_included) { lockedCount += 1 + ((p.locked && p.locked.count) || 4); steps.push({ ...base, key: pk + "m1", kind: "move", n: 1, opener: true, title: p.label || "", action: p.visible_action || "", why: p.detail || "", how: [], example: null, done_when: "", time: "", due: null, status: "locked", live: false }); return; }
      if (!isPaid) {
        // Free report: the three openers are live, the rest is a greyed trail.
        addMove(pk + "m1", null, 1, true);
        const n = (p.locked && p.locked.count) || 4; lockedCount += n;
        const teasers = ((p.locked && p.locked.items) || []).map((it) => (it && (it.meta || it.title)) || "");
        for (let k = 0; k < n; k++) steps.push({ ...base, key: `${pk}m${k + 2}`, kind: "move", n: k + 2, title: teasers[k] ? teasers[k].replace(/^MOVE \d+\s*·?\s*/i, "").split(" · ")[0] : "Written from your posts when you unlock", action: "", why: "", how: [], example: null, done_when: "", time: "", due: null, status: "locked", live: false });
        return;
      }
      addMove(pk + "m1", null, 1, true);
      for (const m of p.moves || []) if (m && (m.action || m.title)) addMove(`${pk}m${m.n}`, m, m.n, false);
      // Calendar slots of this phase, dated from the plan start.
      const wk = weeks.filter((w) => Number(w.phase) === i + 1);
      const startDow = new Date(phaseStart(body, 0)).getDay();
      const slots = [];
      for (const w of wk) for (const sl of w.slots || []) {
        const di = dayIdx(sl.day); if (di < 0) continue;
        const due = phaseStart(body, 0) + (Number(w.week) - 1) * 7 * DAY + ((di - startDow + 7) % 7) * DAY;
        const key = `c${w.week}-${DAYS[di].toLowerCase()}`;
        slots.push({ ...base, key, kind: "slot", week: Number(w.week), day: DAYS[di], format: String(sl.format || "post"), source: sl.source || null, title: sl.angle || `${DAYS[di]} ${sl.format}`, action: sl.prompt || sl.angle || "", why: "", how: [], example: null, done_when: "The post is live.", time: sl.source === "no_camera" ? "20 min" : sl.source === "archive" ? "30 min" : "1 hour", due, status: statusOf(key), done_at: done[key] || null, skipped: skipped[key] || null, verified: verified[key] || null, live: true });
      }
      slots.sort((a, b) => a.due - b.due);
      steps.push(...slots);
    });
    // Written posts ride on the slots they were written for.
    pairPosts(steps.filter((s) => s.kind === "slot"), body.next_posts || []);

    // A phase is open once the previous one's moves are all done or skipped, or its
    // first day has arrived — whichever comes first.
    const openPhase = new Set([1]);
    for (let i = 1; i < phases.length; i++) {
      const prevMoves = steps.filter((s) => s.phase === i && s.kind === "move" && s.live);
      const cleared = prevMoves.length > 0 && prevMoves.every((s) => s.status === "done" || s.status === "skipped");
      if ((cleared && openPhase.has(i)) || now >= phaseStart(body, i)) openPhase.add(i + 1);
    }
    for (const s of steps) s.phase_open = openPhase.has(s.phase);

    // What to do now: the first open move in an open phase, plus every slot due today or overdue.
    const live = steps.filter((s) => s.live);
    const nowKeys = [];
    const firstMove = live.find((s) => s.kind === "move" && s.status === "open" && s.phase_open);
    if (firstMove) nowKeys.push(firstMove.key);
    for (const s of live) if (s.kind === "slot" && s.status === "open" && s.phase_open && startOfDay(s.due) <= today) nowKeys.push(s.key);
    // Up next: the earliest future slot, or the first move of the next phase.
    let next = null;
    const futureSlot = live.filter((s) => s.kind === "slot" && s.status === "open" && startOfDay(s.due) > today).sort((a, b) => a.due - b.due)[0];
    const nextPhaseMove = live.find((s) => s.kind === "move" && s.status === "open" && !s.phase_open);
    if (futureSlot && (!nextPhaseMove || futureSlot.due <= nextPhaseMove.opens_at)) next = { key: futureSlot.key, at: futureSlot.due, title: futureSlot.title, kind: "slot" };
    else if (nextPhaseMove) next = { key: nextPhaseMove.key, at: nextPhaseMove.opens_at, title: nextPhaseMove.title, kind: "move" };
    const total = live.length, doneN = live.filter((s) => s.status === "done").length, skippedN = live.filter((s) => s.status === "skipped").length;
    const curPhaseIdx = Math.max(...[...openPhase]);
    const curPhase = phases[curPhaseIdx - 1] || null;
    const phaseSteps = live.filter((s) => s.phase === curPhaseIdx);
    const laterSoon = live.filter((s) => s.status === "later").sort((a, b) => (later[a.key] || 0) - (later[b.key] || 0))[0] || null;
    return {
      steps, now: nowKeys, next, caught_up: !nowKeys.length, free: !isPaid, locked_count: lockedCount,
      phase: curPhase ? { index: curPhaseIdx, label: curPhase.label || `Phase ${curPhaseIdx}`, range: curPhase.range || "", done: phaseSteps.filter((s) => s.status === "done" || s.status === "skipped").length, total: phaseSteps.length } : null,
      progress: { done: doneN, skipped: skippedN, total, pct: total ? Math.round(((doneN + skippedN) / total) * 100) : 0 },
      later: laterSoon ? { key: laterSoon.key, at: later[laterSoon.key] } : null,
      plan_day: Math.max(1, Math.floor((now - phaseStart(body, 0)) / DAY) + 1),
    };
  }

  // Apply a status change and return the new state fields to persist.
  function apply(body, key, status, { now = Date.now(), reason = null } = {}) {
    const done = { ...(body.moves_done || {}) }, skipped = { ...(body.moves_skipped || {}) }, later = { ...(body.moves_later || {}) };
    delete done[key]; delete skipped[key]; delete later[key];
    if (status === "done") done[key] = now;
    else if (status === "skip") skipped[key] = { at: now, reason: reason || null };
    else if (status === "later") { const t = new Date(startOfDay(now) + DAY); t.setHours(6, 0, 0, 0); later[key] = +t; }
    return { moves_done: done, moves_skipped: skipped, moves_later: later };
  }

  // Rescore verification: what the profile shows now against a baseline taken at plan start.
  function verify(body, baseline, { now = Date.now() } = {}) {
    const prof = body.profile || {}; const base = baseline || {};
    const out = { ...(body.moves_verified || {}) };
    const posts = (body.posts || []).map((p) => +new Date(p.posted_at || p.timestamp)).filter(Number.isFinite);
    const path = build(body, { now, paid: true });
    for (const s of path.steps) {
      if (!s.live || s.status === "locked") continue;
      let ok = null, note = "";
      if (s.kind === "slot") { if (startOfDay(s.due) > startOfDay(now)) continue; ok = posts.some((t) => Math.abs(startOfDay(t) - startOfDay(s.due)) <= DAY); note = ok ? "We saw a post on this day." : "No post went up on this day."; }
      else if (s.topic === "bio_link") { ok = !!prof.external_url; note = ok ? "Your bio has a link now." : "We can't see a link in your bio yet."; }
      else if (s.topic === "bio_cta" || s.topic === "bio_rewrite") { if (base.bio == null) continue; ok = (prof.bio || "") !== (base.bio || ""); note = ok ? "Your bio has changed since the plan started." : "Your bio reads the same as when the plan started."; }
      else if (s.topic === "pin") { ok = Number(prof.pinned_posts) > Number(base.pinned_posts || 0); note = ok ? "There's a pinned post on your profile." : "We can't see a new pinned post yet."; }
      else if (s.topic === "highlight") { ok = Number(prof.highlight_count) > Number(base.highlight_count || 0); note = ok ? "A new highlight is on your profile." : "We can't see a new highlight yet."; }
      else continue;
      if (s.status === "done" || ok) out[s.key] = { at: now, ok: !!ok, note };
    }
    return out;
  }

  return { build, apply, verify, DAYS };
});
