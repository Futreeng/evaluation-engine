# Status — 24 Sept (Joe's side)

Answers "what changed since the 23 Sept handoff". `main` is `9447c5b`; PRs #7 and #8 are
merged and deployed to `scalecraft.onrender.com`. **A full report now generates end to end
on production.** Two items in `HANDOFF_JOE.md` are out of date — see *Corrections*.

## Done

**The database was never persisting.** Render had no `DATABASE_URL` at all, so
`growth_engine_db_select` fell through to the sql.js file inside the container and every
restart wiped it — reports, accounts, entitlements, baselines. It looked healthy the whole
time because `/health` reports `"db":"ok"` for both backends. Now on Railway Postgres
(public URL; Render can't reach Railway's private network). All 24 tables created on boot,
verified from both ends: rows written directly to Railway are visible to the live API.

**`hasPlan` (#7, Haron's fix) confirmed working.** A real report completed — smoke test
scored `@sallysbakeblog` 74 in 60s. Jobs table had three failures before the deploy, none
after.

**The Groq rung of the ladder had never run.** `callGroqNonStreaming` tried
`["groq/compound", "openai/gpt-oss-20b", "groq/compound-mini"]`. Neither compound model is
on our key — `GET /openai/v1/models` doesn't list them and both return `404
model_not_found`. Only the middle entry could ever execute, so the four-provider net was
three paid providers and one working model by accident. Now
`["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]`, all three verified
against the live API.

**Baselines seeded and re-seeded for the new scorer.**

| niche | platform | n | avg | top quartile |
|---|---|---|---|---|
| food_cooking | instagram | 26 | 58 | 68 |
| food_cooking | tiktok | 10 | 49 | 57 |

Instagram was re-scored after the cadence weighting change; the average moved 61 → 58, the
downward shift you predicted. 15 niches still unseeded.

**Frontend fixes (#8).**

- `viewReport` read `sessionStorage` and never revalidated, so a report deleted server-side
  still rendered from cache — the page looked fine until a button hit the API and 404'd.
  This is what produced "Report not found" on a page visibly showing a report. Cached copy
  still paints immediately; a background check clears it on 404/403.
- `viewLanding` read `sc_sample`, one key overwritten by every completed run, so the hero
  showed whichever account was scored last regardless of which report was open. Now always
  the shipped sample.
- `DEV_UNLOCK_ALL=true` runs the full pipeline without auth, entitlements or metering, for
  local testing. Off by default, warns on boot.

## Corrections to HANDOFF_JOE.md

**"A real primary model" (item 1b) is not blocking.** The doc reads the failed runs as
quota. They were the 404s above. With the list corrected a complete report generated for
**~1.3¢** on free tiers:

```
groq   | openai/gpt-oss-120b | 2 calls | 0.78¢
gemini | gemini-3.5-flash    | 1 call  | 0.55¢
```

Claude is still 401 on Render and worth fixing, but a paid key isn't needed to ship.

**The demo deploy is broken on purpose.** `mockHosts` is now empty, so
`scalecraft-demo.vercel.app` no longer mocks by hostname and `scripts/deploy_demo.sh` won't
produce a mock deploy. It served invented scores for real handles with only a corner badge,
and was mistaken for the real product repeatedly during the crash investigation —
`#/report/sample` covers that case with real data now. `?mock=1` still works on localhost
and `*.vercel.app`. Say if you want it back and we'll find a louder way to signal it.

## Real costs (measured, from `growth_engine_costs`)

| item | cost |
|---|---|
| Instagram profile pull | $0.003 |
| Instagram 30-post scrape | **$0.069** |
| TikTok pull | $0.06 |
| LLM per full report | ~$0.013 |
| **Full Instagram report** | **~$0.077** |

The deeper scrape is 23× the profile pull and dominates. `SCRAPE_POSTS=12` takes a report
to ~$0.011 since the first ~12 posts come free with the profile — worth considering for
seeding, where only the deterministic score is used.

`FREE_RUNS_PER_DAY_GLOBAL` still defaults to 500. At $0.077 that's a **$38/day** ceiling if
a link gets shared. Recommend 25 until launch.

## Running full evals

No env change needed. `STRIPE_API_KEY` isn't live, so mock billing grants a real
entitlement:

1. Sign up with any email
2. Pricing → subscribe to Growth or Pro (free, immediate)
3. Run an evaluation — full Growth Plan pipeline

Free Snapshot is one per handle ever, so use unscored handles. Paid runs cap at 5/day
(`PAID_RUNS_PER_DAY`). Only `food_cooking` has baselines; other niches read "pending",
which is correct. First request may take ~50s on a cold start.

Do **not** set `DEV_UNLOCK_ALL` on Render — it would give every anonymous visitor the full
pipeline unmetered.

## Still open

**Email doesn't send.** Key is set and Resend is selected, but all six attempts failed:

```
You can only send testing emails to your own email address (generalemail@futreeng.com)
```

`futreeng.com` isn't verified in Resend. Until it is, nothing reaches customers — including
password resets. Also unset on Render: `MAIL_FROM`, `APP_URL`, `SUPPORT_EMAIL`,
`EMAIL_POSTAL_ADDRESS`. Without `APP_URL` every reset link reads `localhost:3005`.

**`#/admin` is unreachable** — `ADMIN_EMAILS` and `ADMIN_TOKEN` unset, so spend-vs-revenue
and the funnel can't be seen from the UI. The data is all recording.

**Railway credit reads 26 days** (was 98 before public networking egress). If it empties the
database stops. Decide whether Postgres stays on Railway or moves to Render.

**`THUMB_STORAGE=local`** is on Render's ephemeral disk — the same silent-loss failure we
just fixed for the database, still live for thumbnails.

**Stripe is still mock.** No payment can actually be taken.

Unchanged from your list: retention sweep, DPAs, official API access, lawyer pass on
`#/legal/*`, password minimum, Sentry, backups, domain.

## Test state

- `npm test` — 22 path tests pass, postgres module assertions pass
- `node --check` across `server/`, `server/routes/`, `public/` — clean
- `npm run smoke` against Render — **16/20**

All four smoke failures are the same stale assertion: the test expects a 60-day one-time
plan, and `ENABLE_ONE_TIME_UNLOCK` is deliberately off per P.8. The server says so itself
(`{"code":"NOT_SOLD"}`). Worth updating so CI is trustworthy. `npm run check` is a bash
loop, so it fails on Windows — fine in CI.

`tests/e2e.test.js` fails on `node --test`: it requires `node-fetch` (not a dependency) and
targets port 3001. Looks like a leftover from the old Convergence product.
