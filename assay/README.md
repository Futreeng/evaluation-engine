# Assay

**Does the advice work?**

An assay is the test that determines what ore is actually worth, rather than what it looks
like it's worth. This does the same for recommendations.

Any product that tells people what to do — grow your account, close this deal, train this
way, study this next — eventually has to answer whether the advice does anything. Almost
none of them can, because they only record what people did, never what they were told and
ignored. Assay records both, so the question has an answer.

A FutureEng product. Scalecraft is the first thing it measures; nothing in the core knows
what Instagram is.

## The idea in one paragraph

People who follow advice are more motivated than people who don't. They improve more
whatever you tell them. So "users who completed 3+ actions improved by 12 points" measures
*motivation*, not your product — and it falls over the moment someone asks "compared to
whom?" The comparison that survives that question is against people who were **offered the
same thing and didn't take it**. That group is invisible unless you record the offer at the
moment you make it, and it cannot be reconstructed afterwards. Every unrecorded offer is a
permanently lost observation.

## Four calls

```js
const { Assay } = require("./assay");
const { MemoryStore } = require("./assay/store");

const assay = new Assay(new MemoryStore(), { domain: "scalecraft" });

// 1. What you put in front of them, when you generate it
await assay.offer({
  subjectId: accountId,
  sessionId: reportId,
  keys: ["post_cadence", "add_bio_link", "fix_highlights"],
  strata: "food_cooking",       // hold the comparison constant within this
  scoreAt: 39,
});

// 2. What they acted on
await assay.take({ subjectId: accountId, sessionId: reportId, key: "post_cadence" });

// 3. Where they ended up
await assay.observe({
  subjectId: accountId, sessionId: reportId,
  before: 39, after: 47, days: 30,
  meta: { followers_delta: 214 },
});

// 4. What actually works
await assay.report({ strata: "food_cooking" });
```

```json
{
  "status": "reporting",
  "subjects": 214, "observations": 641,
  "results": [
    { "key": "post_cadence", "verdict": "helps", "lift": 5.2,
      "ci_low": 2.8, "ci_high": 7.6, "p": 0.0011, "n_taken": 88, "n_declined": 126 },
    { "key": "add_bio_link", "verdict": "no_effect", "lift": 0.4, "p": 0.71 },
    { "key": "fix_highlights", "verdict": "insufficient_data", "needed_per_arm": 15 }
  ]
}
```

## What makes it defensible

**It refuses to answer.** Below `minPerArm` observations in either arm it returns
`insufficient_data` and `lift: null` rather than a number. A measurement system that always
has an answer is one that will eventually tell you something false, and a thin result can
never lead a ranking.

**It reports harm.** A recommendation that makes things worse comes back `hurts`. The point
is to find those.

**Nothing is modelled.** Welch's t-test and a correlation, over recorded observations. No
LLM sets a number. A figure you cannot recompute by hand is a figure you cannot defend.

**Randomised holdout.** `assign()` withholds a qualifying recommendation from a fraction of
subjects, deterministically seeded per subject so their experience is stable and any run
replays exactly. This is the difference between "people who did X improved" and "X causes
improvement". It is cheap now and impossible to add retroactively.

```js
const { assign } = require("./assay");
const { shown, withheld, arm } = assign(accountId, candidates, { holdout: 0.2 });
await assay.offer({ subjectId: accountId, sessionId: reportId, keys: shown, arm });
```

**Strata.** Compare within niche, starting band, or tier. A recommendation that helps a 30
may do nothing for a 70, and pooling them hides both.

## Calibration

The deepest question, and the one that validates the host product rather than any single
recommendation: does the score predict the thing the subject actually cares about?

```js
await assay.calibration({ externalKey: "followers_delta" });
// { correlation: 0.52, reading: "score tracks the outcome", n: 214 }
```

If a rising score doesn't track real-world results, the score is decoration. Better to know.

## Why it compounds

Every subject adds observations. Tighter intervals first, then finer cuts become possible —
per niche, then per starting band, then per tier. Better estimates rank the recommendations
better, which makes outcomes better, which sharpens the data.

That flywheel only turns on causal estimates. Built on selection bias it amplifies the bias
instead, and the product gets confidently worse. Hence the holdout.

## Porting it

Implement five methods (see `store.js`) and supply your own notion of a score. `SCHEMA` has
two tables with no foreign keys to the host, so Assay can be lifted into its own database
later without dragging the product's schema along.

| Domain | subject | recommendation | score | external |
|---|---|---|---|---|
| Scalecraft | social account | a plan move | account score /100 | follower delta |
| Sales | rep | a coaching action | pipeline health | closed revenue |
| Fitness | client | a programme change | adherence score | strength gain |
| Education | student | a study action | mastery score | assessment result |

## Tests

```
node assay/assay.test.js
```

Nine cases, covering real effects, null results, harm, thin samples, strata, deterministic
assignment, and the one the design exists to prevent: an effect that appears real only
because the decliners were excluded.

## Status

Core and tests complete. Not yet wired into Scalecraft — that needs an `offer()` call where
plan moves are generated, which is the only part that can't be backfilled.
