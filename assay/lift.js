/**
 * Assay — lift estimation.
 *
 * The one question: for a given recommendation, did the subjects who took it
 * improve more than comparable subjects who were offered it and did not?
 *
 * Everything here is deterministic arithmetic over observations. No model
 * decides a number. That is the same rule the Scalecraft scorer keeps, and it
 * matters more here: a measurement layer that can be argued with is worthless.
 */

// Welch's t-test denominator. Unequal variances, unequal n — the usual case,
// because takers and decliners are never the same size.
function welch(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const varr = (xs, m) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  const ma = mean(a), mb = mean(b);
  const va = varr(a, ma), vb = varr(b, mb);
  const se = Math.sqrt(va / na + vb / nb);
  if (!Number.isFinite(se) || se === 0) return null;
  const t = (ma - mb) / se;
  // Welch–Satterthwaite degrees of freedom.
  const df = (va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  return { t, df, se, meanA: ma, meanB: mb, nA: na, nB: nb };
}

// Two-sided p-value from Student's t, via the regularised incomplete beta.
// Abramowitz & Stegun 26.5.8 continued fraction — accurate enough well past
// the precision anyone should act on.
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function lnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function pValue(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return null;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/**
 * Lift for one recommendation.
 *
 * `taken` and `declined` are arrays of deltas (outcome_after - outcome_before)
 * for subjects who did and did not act on it. `declined` must include subjects
 * who were offered the recommendation and ignored it, not only those who
 * actively dismissed it — a deliberate dismissal is its own kind of engaged
 * behaviour, and comparing doers to dismissers flatters the result.
 *
 * `minPerArm` is honest refusal, not a formality: below it the estimate is
 * noise, and reporting noise as a finding is how measurement systems start
 * lying.
 */
function liftFor({ key, taken, declined, minPerArm = 15 }) {
  const w = welch(taken, declined);
  if (!w || w.nA < minPerArm || w.nB < minPerArm) {
    return {
      key,
      verdict: "insufficient_data",
      n_taken: taken.length,
      n_declined: declined.length,
      needed_per_arm: minPerArm,
      lift: null,
    };
  }
  const p = pValue(w.t, w.df);
  const lift = w.meanA - w.meanB;
  const ci = 1.96 * w.se; // normal approximation; df is large whenever we report
  return {
    key,
    verdict: p != null && p < 0.05 ? (lift > 0 ? "helps" : "hurts") : "no_effect",
    lift: +lift.toFixed(2),
    ci_low: +(lift - ci).toFixed(2),
    ci_high: +(lift + ci).toFixed(2),
    p: p == null ? null : +p.toFixed(4),
    n_taken: w.nA,
    n_declined: w.nB,
    mean_taken: +w.meanA.toFixed(2),
    mean_declined: +w.meanB.toFixed(2),
  };
}

/**
 * Rank every recommendation in a set of observations.
 *
 * An observation is { key, taken: bool, delta: number, strata?: string }.
 * `strata` narrows the comparison — niche, starting score band, follower tier.
 * Comparing within a stratum is what stops "this move helps" really meaning
 * "this move is shown to people who were already improving".
 */
function rank(observations, { minPerArm = 15, strata = null } = {}) {
  const rows = strata ? observations.filter((o) => o.strata === strata) : observations;
  const byKey = new Map();
  for (const o of rows) {
    if (!Number.isFinite(o.delta)) continue;
    if (!byKey.has(o.key)) byKey.set(o.key, { taken: [], declined: [] });
    byKey.get(o.key)[o.taken ? "taken" : "declined"].push(o.delta);
  }
  const out = [];
  for (const [key, arms] of byKey) out.push(liftFor({ key, ...arms, minPerArm }));
  // Reportable findings first, biggest effect at the top; everything still
  // gathering data goes below, so a thin result can never lead the list.
  const order = { helps: 0, hurts: 1, no_effect: 2, insufficient_data: 3 };
  return out.sort((a, b) =>
    order[a.verdict] - order[b.verdict] || (b.lift ?? -Infinity) - (a.lift ?? -Infinity));
}

module.exports = { liftFor, rank, welch, pValue };
