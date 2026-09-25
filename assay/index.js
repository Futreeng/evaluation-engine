/**
 * Assay — does the advice work?
 *
 * A domain-agnostic measurement core. It knows nothing about social media,
 * fitness, sales or schooling. It knows four things:
 *
 *   offer(...)    these recommendations were put in front of this subject
 *   take(...)     this one was acted on
 *   observe(...)  the subject's score moved from X to Y over N days
 *   report(...)   which recommendations actually caused the movement
 *
 * The host product supplies a store (see store.js for the contract) and its
 * own notion of a score. Everything else is here.
 *
 * Why offer() exists, and why it is the part you cannot skip: measuring only
 * what people did tells you about people, not about advice. Subjects who act
 * are more motivated than subjects who don't, and they would have improved
 * anyway. The counterfactual — offered, ignored — is the entire basis of a
 * causal claim, it is invisible unless recorded at the moment of offering,
 * and it cannot be reconstructed later. Every offer that goes unrecorded is a
 * permanently lost observation.
 */

const { rank, liftFor } = require("./lift");

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Randomised assignment.
 *
 * `holdout` is the fraction of subjects for whom a recommendation is withheld
 * even though it qualified. That withholding is what turns the whole system
 * from "people who did X improved" into "X causes improvement" — without it,
 * every number is correlational and arguable, however large the sample.
 *
 * Assignment is deterministic in `subjectId` so a subject sees a stable
 * experience across sessions, and so a run can be replayed exactly.
 */
function assign(subjectId, candidates, { holdout = 0, shuffle = false, salt = "" } = {}) {
  const h = hash(String(subjectId) + salt);
  const rnd = mulberry(h);
  let list = candidates.slice();
  if (shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const withheld = [];
  if (holdout > 0) {
    list = list.filter((c) => {
      if (rnd() < holdout) { withheld.push(c); return false; }
      return true;
    });
  }
  return { shown: list, withheld, arm: withheld.length ? "holdout" : "control", seed: h };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Assay {
  /**
   * @param store   persistence, see store.js
   * @param domain  namespace, so one store can hold several products
   */
  constructor(store, { domain = "default", minPerArm = 15 } = {}) {
    this.store = store;
    this.domain = domain;
    this.minPerArm = minPerArm;
  }

  /**
   * Record what was put in front of a subject. Call this when the
   * recommendations are generated, not when they are acted on.
   *
   * `strata` is anything the comparison should be held constant within —
   * niche, starting band, plan length. It is stored per offer because the
   * subject's circumstances at the moment of offering are what matter, not
   * their circumstances now.
   */
  async offer({ subjectId, sessionId, keys, strata = null, scoreAt = null, meta = null, arm = "control" }) {
    const at = Date.now();
    const batch = "of_" + uid();
    await this.store.putOffers(keys.map((key, i) => ({
      id: "o_" + uid(),
      domain: this.domain,
      batch_id: batch,
      subject_id: String(subjectId),
      session_id: sessionId ? String(sessionId) : null,
      key: String(key),
      position: i,
      arm,
      strata: strata == null ? null : String(strata),
      score_at: scoreAt,
      taken_at: null,
      meta: meta ? JSON.stringify(meta) : null,
      created_at: at,
    })));
    return { batchId: batch, n: keys.length };
  }

  /** Record that a subject acted on one recommendation. */
  async take({ subjectId, sessionId, key, at = Date.now() }) {
    return this.store.markTaken({
      domain: this.domain,
      subject_id: String(subjectId),
      session_id: sessionId ? String(sessionId) : null,
      key: String(key),
      taken_at: at,
    });
  }

  /**
   * Record where the subject ended up. `before`/`after` are on whatever scale
   * the host product scores in; Assay only ever subtracts them.
   */
  async observe({ subjectId, sessionId, before, after, days = null, meta = null }) {
    return this.store.putOutcome({
      id: "r_" + uid(),
      domain: this.domain,
      subject_id: String(subjectId),
      session_id: sessionId ? String(sessionId) : null,
      before, after,
      delta: Number(after) - Number(before),
      days,
      meta: meta ? JSON.stringify(meta) : null,
      created_at: Date.now(),
    });
  }

  /**
   * What actually works, ranked.
   *
   * Joins offers to outcomes by subject+session, so each observation is one
   * recommendation shown to one subject with the movement that followed.
   */
  async report({ strata = null, minPerArm = this.minPerArm } = {}) {
    const observations = await this.store.observations({ domain: this.domain, strata });
    const ranked = rank(observations, { minPerArm, strata });
    const reportable = ranked.filter((r) => r.verdict !== "insufficient_data");
    return {
      domain: this.domain,
      strata,
      subjects: new Set(observations.map((o) => o.subject_id)).size,
      observations: observations.length,
      recommendations: ranked.length,
      reportable: reportable.length,
      // Said plainly so a thin result is never mistaken for a finding.
      status: reportable.length ? "reporting" : "gathering",
      results: ranked,
    };
  }

  /**
   * Does the score predict the thing the subject actually cares about?
   *
   * The deepest question the system can answer, and the one that validates the
   * host product rather than any single recommendation: if a rising score does
   * not track the real-world outcome, the score is decoration.
   */
  async calibration({ externalKey }) {
    const rows = await this.store.outcomesWithExternal({ domain: this.domain, externalKey });
    const pairs = rows.filter((r) => Number.isFinite(r.delta) && Number.isFinite(r.external));
    if (pairs.length < 20) return { status: "gathering", n: pairs.length, needed: 20 };
    const xs = pairs.map((p) => p.delta), ys = pairs.map((p) => p.external);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2;
    }
    const r = dx && dy ? num / Math.sqrt(dx * dy) : null;
    return {
      status: "reporting", n: pairs.length, external: externalKey,
      correlation: r == null ? null : +r.toFixed(3),
      reading: r == null ? "undefined" : r > 0.4 ? "score tracks the outcome"
        : r > 0.15 ? "weak relationship" : "score does not predict the outcome",
    };
  }
}

module.exports = { Assay, assign, rank, liftFor };
