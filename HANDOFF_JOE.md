# Scalecraft — handoff to Joe (updated 2026-09-23)

## Where the code is

- **`main`** — PRs #3, #5 and #6 merged 22 Sept. Everything through the build spec Waves 1–5
  and the pricing add-on. Render (`scalecraft.onrender.com`) runs this. **Known bug on
  main:** every paid run dies after scoring with `hasPlan is not defined` (fixed on #7).
- **PR #7 `feat/path`** — the Path, plan-quality validator, both crash-report fixes, failure
  classification, retry from cache, median engagement, CI workflow, the customer pass on
  the report. Merge this next; it's the fix for the crash on main.
- Demo (mock data, no backend): `scalecraft-demo.vercel.app`, deployed with
  `scripts/deploy_demo.sh` — same `public/` as prod, mock switched on by hostname.

Feature-by-feature explanations: `docs/WHAT_WE_BUILT.md`. Path spec: `docs/PATH_SPEC.md`.

## What's on main (spec numbering)

**Wave 1 — go live and core.** 1.1 `?mock=1` dev switch + mock/real shape parity (`shape_diff.js`) · 1.2 cost tracking per report/feature + admin cost vs revenue · 1.3 30-post scrape with per-post fields · 1.4 evidence thumbnails on every claim, LLM explanations validated against the inputs · 1.5 free-limit loophole closed (per email + per IP) · 1.6 Resend mailer with prefs, CAN-SPAM footer, log · 1.7 card engine (score / then-vs-now) + public share page · 1.8 referral codes + attribution · 1.9 signup questions (business flag, niche) · 1.10 best time to post · 1.11 weekly rescore loop with history chart + niche percentile · 1.12 post writing (6 posts per paid report, regenerate one) · 1.13 funnel events + admin funnel · 1.14 price A/B variants · 1.15 move outcomes data.

**Wave 2.** 2.1 Roast (opt-in, three heats, blocklist + second-model review, rejections logged, under-18 skip, re-roast at 30 days) · 2.2 Levels · 2.3 Weekly streak with freezes · 2.4 Personal records · 2.5 Milestone cards · 2.6 Monday move email with signed one-tap "Mark done".

**Wave 3.** 3.1 48-hour post review (paid; profile re-read every 60h, review vs own average, rules fallback when the model is out) · 3.2 own trend first · 3.3 goal onboarding + progress bar (goal feeds the plan prompt) · 3.4 weekly niche brief from our own data (deterministic, gated, cached per week) + trending-audio proposal in `docs/`.

**Wave 4.** 4.1 pause 1–3 months · 4.2 maintenance tier ($5, `MAINTENANCE_PRICE_CENTS`) · 4.3 cancel screen (what they'd lose + exit reasons stored) · 4.4 win-back rescores at 30/60 days · 4.5 annual offer after the first rise · 4.6 badges and 4.7 quests behind `ENABLE_BADGES` / `ENABLE_QUESTS` (off).

**Wave 5.** 5.1 brand copy live ("Stop posting into the void.") · 5.2 methodology page from the scoring code · 5.3 State of Small Creators admin export + template (not published) · 5.4 public `/benchmarks/:niche` + UTM/`src` attribution — see `docs/MARKETING_SITE.md`.

**Pricing add-on (P.1–P.8).** Growth $19/$190, Pro $39/$390, Maintenance $5, founders $12/$108 for the first 400 (live counter, price locked while active), pre-update subscribers keep their price, weekly fair-use limits, central entitlements, downgrades at period end, one-time plan earmarked (`ENABLE_ONE_TIME_UNLOCK` off).

Tables (both backends create them on boot): `growth_engine_events`, `_costs`, `_move_log`, `_move_outcomes`, `_shares`, `_referrals`, `_email_log`, `_roast_rejections`, `_niche_briefs`, `_cancel_reasons`, plus columns on `users` and `entitlements`. No migrations to run by hand.

## What's on PR #7 (`feat/path`)

- **Plan quality**: phases written in order with the earlier moves in context; a validator
  rejects repeats, off-phase moves and over-cited posts, rewrites once, then drops what still
  repeats; one posting schedule derived from the account's best days; verified Instagram /
  TikTok how-to steps; posts named by caption; no invented links or emails; captions and
  scripts labelled as suggestions.
- **The Path** (`#/path/:report`): one step at a time — Done / Skip with a reason / Not
  today; calendar slots carry their written post; phase 2 opens when phase 1 is cleared or
  day 31 arrives; verification at each rescore (link, bio change, pin, highlight, post on
  the day); free reports see the three openers; signed-in users with a plan land here.
  Routes `GET/POST /reports/:id/path[/:key]`, `POST /reports/:id/context`.
- **Scoring**: engagement rate is the median post on the recent unpinned feed; best/worst
  exclude pinned and rank against the median; timing windows need three posts; Posting
  Consistency is carried by cadence (see below).
- **Report**: score box shows the four dimensions, niche marker and three facts; the weakest
  dimension shows a what's-missing checklist; honest calendar/competitor/niche-count copy.
- Nothing new for Render env. The shipped sample was cleaned by the deterministic rules;
  regenerate it from a complete paid run when model quota allows (five runs on 23 Sept
  failed on Gemini 503 / Groq quota) with `server/scripts/export_sample_report.js`.

## Crash report of 23 Sept (both fixed on `feat/path`)

- `hasPlan is not defined`: declared in the wrapper, read in the worker function. Every run
  that got past scoring died there. Fixed.
- False "couldn't find it": an empty scraper result was mapped to not-found. Failures are now
  classified (`PROFILE_NOT_FOUND`, `PROFILE_PRIVATE`, `NO_POSTS`, `UPSTREAM`, `WRITER`,
  `OUR_SIDE`) and `GET /job/:id` returns `error_code`; the app shows a different screen for
  each and never shows raw error text (the log has it next to the job id).
- Retry reuses the cached scrape (24h) instead of asking Instagram again; cache write
  failures are logged instead of swallowed — watch Render logs for
  "profile cache write failed" (would mean Postgres cache rows aren't landing).
- `npm test` (unit), `npm run check` (syntax), `npm run smoke` (end to end against a running
  server). `.github/workflows/ci.yml` runs the first two on every push; the smoke job runs
  on manual dispatch with a base URL. Not done: retry resuming mid-pipeline (it restarts, but
  from cache), and the smoke job on a schedule (needs a server started with
  `FREE_SNAPSHOTS_PER_EMAIL=unlimited`).

Scorer change to know about: Posting Consistency weights are now cadence 65 / gaps 20 /
recency 15 with the cadence ramp bottoming at a third of target. Existing reports keep their
stored scores; the next rescore will move accounts that post well under target down a band,
and the score-change email will say so. Baselines (`scripts/baselines_sync.js`) should be
re-run once so niche averages match.

## Data retention and DPAs (yours, per Haron 23 Sept)

The privacy page promises "reports kept while your account exists; anonymous free snapshots
kept 90 days". The code only half does that (thumbnails for free reports go at 90 days via
`THUMB_FREE_TTL_DAYS`; the report rows, cached profiles, email log, events, outcomes and cost
ledger never expire). Competitor data is stored for accounts that never used us.

1. **Retention sweep** in `growth_engine_refresh.js` (it already runs on the refresh
   interval): anonymous reports and cached profiles after 90 days; email log, events and
   cost rows after 12 months; competitor snapshots deleted with the report that asked for
   them. Make the numbers env knobs and list them in `.env.example`.
2. **Privacy page**: replace the retention sentence with a table of data types and windows
   (the `viewLegal` copy in `public/app.js`), and add a named subprocessor list: Apify,
   Google (Gemini), Groq, Stripe, Resend, Render. Check each provider's terms before keeping
   the line "your data is not used to train their models".
3. **Accept each provider's DPA** (Apify, Google Cloud/AI Studio, Groq, Stripe, Resend,
   Render) and keep the confirmations in the shared drive so we can answer a customer's DPA
   with our own list.
4. Remove the "[Counsel to confirm disclosures.]" placeholder from the live privacy page once
   a lawyer has read it.

## Official Instagram and TikTok access (yours, per Haron 23 Sept)

Goal: creators connect their own account so the report can see saves, reach, story views and
audience demographics, competitors come through Business Discovery instead of a scrape, and
the product no longer depends on scraping for paid users. The scrape stays for the free
Snapshot. "App" here means a registered integration with a client id, not a phone app.

1. **Meta app**: developers.facebook.com → Business app → add the Instagram product, using
   "Instagram API with Instagram Login" (no Facebook Page needed). Request only
   `instagram_business_basic` and `instagram_business_manage_insights`.
2. **Data deletion callback**: a URL that receives Meta's signed request and returns a
   confirmation code; wire it to `DELETE /account`. Required before review.
3. **Privacy page** must match: replace "public data only, through a third-party data
   provider" with the connected-account wording, plus the retention table above.
4. **Business Verification** (legal entity docs, domain, business email on the domain) for
   Advanced Access so people outside the test users can connect.
5. **App Review**: screencast of signup → connect → approve → report showing reach/saves from
   the API. Expect one round of "clearer screencast please". Two to four weeks.
6. **TikTok**: Login Kit + Display API (`user.info.basic`, `user.info.stats`, `video.list`).
   Faster review. No competitor lookups; keep the scrape for those.
7. Add test users (yours, Haron's, the sample account's owner with permission) so the
   connect flow can be built before review finishes.

Product side (Haron/Claude): connect screen, token storage and 60-day refresh, Business
Discovery for competitors, new signals folded into the existing dimensions.

## Your part

1. **Merge #7** → Render redeploys → set the env below → `SMOKE_BASE=https://scalecraft.onrender.com node server/scripts/smoke.js` (or dispatch the `smoke` job in `.github/workflows/ci.yml`). Then re-run `scripts/baselines_sync.js` once for the scorer change.
1b. **A real primary model.** Claude is unconfigured on Render (401) and the Gemini/Groq free tiers refused five runs in a row. Put a paid key on one of them before any customer runs a paid report; the pipeline degrades to a partial plan without one.
2. **Stripe for real** — `growth_engine_billing.js` is mock unless `STRIPE_API_KEY` looks real. **Pricing add-on (P.1–P.7) is in:** Growth $19/$190, Pro $39/$390, Maintenance $5, founders $12/$108 for the first 400 (live counter), pre-update subscribers keep their price, weekly fair-use limits, downgrades at period end. All of it in `growth_engine_plans.js` (env overrides `PLAN_PRICES_JSON` / `PLAN_LIMITS_JSON`). In Stripe create **new** Price objects for 1900/19000/3900/39000/500 and founders 1200/10800 — never edit or delete the existing $12 prices. Stubs for you, each already receiving the right arguments (`priceCents`, `cycle`, `founder` are on the entitlement after every subscribe):
   - `_createStripeSubscription` (monthly and annual; annual amount is precomputed).
   - `pauseSubscription` / `unpauseSubscription` already call `subscriptions.update({ pause_collection… })` when live — just needs the subscription id stored on the entitlement.
   - `switchTier` throws when live: swap the subscription item to the maintenance / growth_plan price ids.
   - Webhook `POST /billing/webhook` is a stub: payment failed → `setCancelAt(accountId, now)`.
3. **Resend** — `RESEND_API_KEY`, verified domain in `MAIL_FROM`, `APP_URL` for links, and the postal address in `EMAIL_POSTAL_ADDRESS` (Haron is sending it). Until then every send is a log line, including password reset and the one-tap Monday link emails.
4. **Thumbnail storage** — `THUMB_STORAGE=local` works on Render but the disk is ephemeral; `THUMB_STORAGE=s3` + `npm i @aws-sdk/client-s3` for anything durable. Your call.
5. **Official API access** — see the section above; the connect flow is built once the Meta app and test users exist.

### Render env (beyond what's already there)

`SUPPORT_EMAIL=hello@futreeng.com` · `MAIL_FROM="Scalecraft <hello@futreeng.com>"` · `EMAIL_POSTAL_ADDRESS` · `APP_URL=https://scalecraft.onrender.com` (or the domain) · `ADMIN_EMAILS` (you + Haron) · `ADMIN_TOKEN` · promo codes only for comps/campaigns (`node scripts/promo.js create …`) — founders pricing is automatic, no code · `SCRAPE_POSTS=30` · `BASELINE_MIN_N=10`. Everything else has a default; `server/.env.example` documents every knob by spec item.

Cost guardrails already on: `PAID_RUNS_PER_DAY`, `COMPETITOR_PULLS_PER_DAY`, `FREE_RUNS_PER_DAY_GLOBAL`, `EVALS_PER_IP_PER_HOUR`, `ROASTS_PER_IP_PER_HOUR`, `POST_REVIEW_*`, `WINBACK_BATCH`. Every scrape and LLM call lands in `growth_engine_costs`; `#/admin` shows spend vs revenue.

## Cheap wins, anyone

- Seed baselines (`scripts/seed_baselines.js`; ~$1 for all 16 Instagram niches) — until niches reach 10 accounts the niche average, brief, percentile and benchmarks all read "pending".
- Regenerate the public sample (`scripts/export_sample_report.js`) once the LLM free tier resets — the committed one has a 3-week calendar; the top-up code is in.
- Error monitoring (Sentry), Postgres backups on Render, analytics tag.
- Lower free cap for TikTok (20× Instagram's per-pull cost). Password minimum 6 → 8. Lawyer pass on `#/legal/*`. Domain.

## Rules we've been keeping

- Never push to `main` directly — branch + PR, even hotfixes. Render deploys from `main`.
- Scores stay deterministic. If the LLM ever sets a number, that's a bug. (Roast, post reviews and explanations all validate cited numbers against their inputs.)
- API keys go in `server/.env` (gitignored), never in chat or commits.
- The sample report is a real person's account, used with permission. Don't swap it for a big-name account.
- Nothing per account ever leaves the aggregate endpoints (`/briefs`, `/benchmarks`, `/admin/state-of-creators`).
