# Funnel economics — the free Snapshot costs more than it looks

Noted 6 Oct 2026, while checking why a connected-account test hit
`Apify account out of credit`. Not urgent today; it is the biggest commercial
risk in the product and it should not be rediscovered by accident.

## The measured facts

**Apify (public scraping), read off the billing page 6 Oct:**

| | |
|---|---|
| Plan | Free, $5.00/month |
| Used | $3.82 (Actors $3.81, Storage $0.01) |
| Remaining | $1.18 |
| Period | 11 Sep → 10 Oct, resets monthly |

76% of a month's budget consumed in 26 days, essentially without launch
traffic. Apify also refused to start an actor run while $1.18 remained
(`[PostReview] @crone_and_crumb failed: Apify account out of credit`), so the
usable floor is higher than zero — it will not start a run it estimates cannot
finish.

**LLM:** `growth_engine_evaluator.js` runs `claude-opus-4-1` as primary, three
calls per report (Growth Scanner, Gap Auditor, Merge). Anthropic credit is
currently exhausted, so the chain is falling through to Gemini and reports are
being written by `gemini-2.5-flash`.

**Caps:** `FREE_RUNS_PER_DAY_GLOBAL` defaults to 500.
`FREE_SNAPSHOTS_PER_EMAIL` defaults to 1.

## The arithmetic

Using the rates in `growth_engine_costs.js` — these are estimates written into
config, not invoice figures (see "What is not measured" below):

| Per free Snapshot | |
|---|---|
| Apify: 1 profile + ~30 posts | ~$0.07 |
| Opus 4.1, 3 calls, ~30k in / 9k out | ~$1.10 |
| **Total** | **~$1.17** |
| Same report on Gemini instead | **~$0.10** |

Two things fall out of that:

1. **The LLM is ~15× the scrape.** Attention naturally goes to Apify because
   that is what ran out, but Opus is the expensive half by an order of
   magnitude.
2. **The daily cap is not funded.** 500 free runs/day at ~$1.17 is ~$585/day,
   ~$17.5k/month. The Apify plan behind it is $5/month, which funds roughly
   55–70 reports *per month* — about two a day. The cap is set ~250× above what
   the infrastructure can pay for.

The failure mode is quiet: the first real traffic spike drains Apify mid-month,
and from then until the reset every new visitor's free Snapshot fails. The free
Snapshot is the top of the funnel, so that is the whole acquisition path going
down without an alert.

## What is not measured

Cost tracking **is** wired — `costs.llm()` in the evaluator, `costs.scrape()` in
both Apify fetchers — so real per-report costs are already being recorded in the
database. Nobody can read them: every `/admin/*` route returns 404 because
neither `ADMIN_TOKEN` nor `ADMIN_EMAILS` is set on Render, so
`requireAdmin` takes its "nothing configured" branch.

**Set `ADMIN_TOKEN` on Render first.** It is one variable, and it turns the
estimates above into measurements from `/admin/overview`. Every number on this
page should be re-derived from that data before anyone spends money on it.

Also unmeasured: what actually consumed $3.81 of Actors in 26 days. Apify's
Historical usage tab breaks it down per actor. Worth looking before upgrading a
plan — if an actor costs more per run than config assumes, a bigger plan is
eaten at the same rate and just produces a bigger bill.

## Decisions this needs (not recommendations)

1. **Which model writes a free report?** Opus on a paid Growth Plan may be
   exactly right. Opus on a free Snapshot costs ~$1.10 to give away to someone
   who has not paid. Gemini is ~35× cheaper and is, as of today, what free users
   are actually getting anyway — because Claude ran out, not because anyone
   chose it.
2. **What should the real daily cap be?** 500 is a number the infrastructure
   cannot honour. A cap near what the Apify plan funds, failing with a waitlist
   rather than an error, would at least degrade honestly.
3. **Does Apify need a paid tier yet?** $5/month is ~2 free Snapshots a day. If
   the launch plan assumes more, this is a prerequisite, not an optimisation.
4. **Should the free tier alert before it dies?** Right now the first signal is
   a user seeing a failure. A threshold alert on remaining Apify credit, or on
   the cost rows already being written, would turn that into a warning.

## Not today

None of this blocks the app-review submission. The connected-account flows use
the official Instagram and TikTok APIs and never touch Apify, and report writing
falls through to Gemini. This is a post-submission conversation —
`/office-hours` is the right venue.
