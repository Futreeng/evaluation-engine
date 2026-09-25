/**
 * Assay tests — run with: node assay/assay.test.js
 *
 * The important cases are the ones where Assay must refuse to answer: thin
 * samples, and a real effect that only looks real because of who took it.
 */
const assert = require("assert");
const { rank, liftFor, assign } = require("./index");

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };

// A recommendation with a genuine effect is found.
t("a real effect is detected", () => {
  const obs = [];
  for (let i = 0; i < 40; i++) obs.push({ key: "post_cadence", taken: true, delta: 6 + (i % 5) - 2 });
  for (let i = 0; i < 40; i++) obs.push({ key: "post_cadence", taken: false, delta: 1 + (i % 5) - 2 });
  const [r] = rank(obs);
  assert.strictEqual(r.verdict, "helps");
  assert.ok(r.lift > 3 && r.lift < 7, "lift near 5, got " + r.lift);
  assert.ok(r.ci_low > 0, "confidence interval should exclude zero");
});

// Noise is not a finding.
t("no effect is reported as no effect", () => {
  const obs = [];
  for (let i = 0; i < 50; i++) obs.push({ key: "add_link", taken: i % 2 === 0, delta: (i % 7) - 3 });
  const [r] = rank(obs);
  assert.strictEqual(r.verdict, "no_effect");
});

// Refusing to answer is a feature.
t("a thin sample refuses to report", () => {
  const obs = [
    { key: "bio_rewrite", taken: true, delta: 20 },
    { key: "bio_rewrite", taken: true, delta: 22 },
    { key: "bio_rewrite", taken: false, delta: 0 },
  ];
  const [r] = rank(obs);
  assert.strictEqual(r.verdict, "insufficient_data");
  assert.strictEqual(r.lift, null, "must not publish a lift it cannot stand behind");
  assert.strictEqual(r.needed_per_arm, 15);
});

// A harmful recommendation is called harmful, not quietly dropped.
t("a harmful recommendation is reported as hurts", () => {
  const obs = [];
  for (let i = 0; i < 40; i++) obs.push({ key: "post_daily", taken: true, delta: -4 + (i % 5) - 2 });
  for (let i = 0; i < 40; i++) obs.push({ key: "post_daily", taken: false, delta: 2 + (i % 5) - 2 });
  const [r] = rank(obs);
  assert.strictEqual(r.verdict, "hurts");
  assert.ok(r.lift < 0);
});

// Ranking puts findings above gathering, so a thin row can never lead.
t("insufficient data never outranks a finding", () => {
  const obs = [];
  for (let i = 0; i < 40; i++) obs.push({ key: "real", taken: true, delta: 5 + (i % 3) - 1 });
  for (let i = 0; i < 40; i++) obs.push({ key: "real", taken: false, delta: 0 + (i % 3) - 1 });
  obs.push({ key: "thin", taken: true, delta: 90 });
  obs.push({ key: "thin", taken: false, delta: 0 });
  const out = rank(obs);
  assert.strictEqual(out[0].key, "real", "a 90-point thin result must not lead");
  assert.strictEqual(out[1].verdict, "insufficient_data");
});

// Strata keep the comparison honest.
t("strata narrow the comparison", () => {
  const obs = [];
  for (let i = 0; i < 40; i++) obs.push({ key: "k", strata: "food", taken: true, delta: 8 + (i % 3) - 1 });
  for (let i = 0; i < 40; i++) obs.push({ key: "k", strata: "food", taken: false, delta: 1 + (i % 3) - 1 });
  for (let i = 0; i < 40; i++) obs.push({ key: "k", strata: "gaming", taken: true, delta: 0 + (i % 3) - 1 });
  for (let i = 0; i < 40; i++) obs.push({ key: "k", strata: "gaming", taken: false, delta: 0 + (i % 3) - 1 });
  const food = rank(obs, { strata: "food" })[0];
  const gaming = rank(obs, { strata: "gaming" })[0];
  assert.strictEqual(food.verdict, "helps");
  assert.strictEqual(gaming.verdict, "no_effect");
});

// Assignment is stable per subject and actually withholds.
t("assignment is deterministic and holds out", () => {
  const cands = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const one = assign("subject-1", cands, { holdout: 0.5 });
  const again = assign("subject-1", cands, { holdout: 0.5 });
  assert.deepStrictEqual(one.shown, again.shown, "same subject must get the same experience");
  assert.strictEqual(one.shown.length + one.withheld.length, cands.length, "nothing may be lost");

  let withheldTotal = 0;
  for (let i = 0; i < 300; i++) withheldTotal += assign("s" + i, cands, { holdout: 0.5 }).withheld.length;
  const rate = withheldTotal / (300 * cands.length);
  assert.ok(rate > 0.4 && rate < 0.6, "holdout rate should be near 0.5, got " + rate.toFixed(2));
});

t("zero holdout withholds nothing", () => {
  const out = assign("s", ["a", "b", "c"], { holdout: 0 });
  assert.strictEqual(out.withheld.length, 0);
  assert.deepStrictEqual(out.shown, ["a", "b", "c"]);
});

// The failure this whole design exists to prevent.
t("selection bias is visible when decliners are excluded", () => {
  // Motivated subjects improve by about 10 whatever they do; unmotivated by
  // about 0. The recommendation itself does nothing at all. The spread is
  // real rather than flat, because identical deltas leave the t-test
  // undefined and Assay would refuse for the wrong reason.
  const honest = [], biased = [];
  const noise = (i) => (i % 5) - 2;
  for (let i = 0; i < 40; i++) {
    honest.push({ key: "x", taken: true, delta: 10 + noise(i) });
    honest.push({ key: "x", taken: false, delta: 10 + noise(i + 2) }); // motivated, ignored it
    biased.push({ key: "x", taken: true, delta: 10 + noise(i) });
    biased.push({ key: "x", taken: false, delta: 0 + noise(i + 2) });  // only the unmotivated counted
  }
  assert.strictEqual(rank(honest)[0].verdict, "no_effect", "with the true counterfactual, no effect");
  assert.strictEqual(rank(biased)[0].verdict, "helps", "without it, a non-existent effect looks real");
});

console.log(`\n${passed} passed — all good`);
