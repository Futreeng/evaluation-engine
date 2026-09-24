# What we built — Scalecraft, Waves 1–5

Plain-language record of every feature on `feat/next-build` (PR #6): what it does for the user, why it exists, how it works, and where the code lives. Spec numbers match `SCALECRAFT_BUILD_SPEC.md`.

Two rules run through all of it: **scores are deterministic** (fixed rules set every number; the language model only writes words, and every number it cites is checked against the data it was given), and **every knob is config** (`server/.env.example` documents them by spec item).

---

## Wave 1 — Go live and the core product

### 1.1 Go-live check
**What:** Mock mode is off by default; `?mock=1` turns it on for a tab (localhost and the Vercel demo only), and the demo site is mock-by-hostname instead of a hand-patched build. `scripts/shape_diff.js` runs the mock API inside node against a live server and prints every field that differs, route by route.
**Why:** The front end was developed against a mock; the spec asked for the real backend to be the default and for the two to agree. The diff turned up seven real mismatches (missing routes, a legacy field, a date field the app read that real reports never had) — all fixed.
**Where:** `public/config.js`, `server/scripts/shape_diff.js`, `scripts/deploy_demo.sh`.

### 1.2 Cost tracking
**What:** Every scrape and every LLM call is logged with its provider, tokens, unit cost and the feature that triggered it (free report, paid report, rescore, roast, post review, competitors…). `#/admin` shows spend per user next to revenue per user.
**Why:** We pay per profile pull and per token; without this no one could say what a report costs or which feature is burning money.
**Where:** `server/growth_engine_costs.js` (AsyncLocalStorage carries the account/report/feature context so every call underneath is attributed), rate table at the top of that file.

### 1.3 Deeper scrape
**What:** 30 recent posts per account (configurable `SCRAPE_POSTS`, 12–50) instead of ~12; each stored with date/time, format, caption, likes, comments, views, saves/shares where available, permalink.
**Why:** Cadence, best time to post, records and reviews all need enough posts to be meaningful. The profile scraper gives ~12; the rest come from the post scraper at $0.0023 each.
**Where:** `server/instagram_apify_fetcher.js` (`fetchPostsFromApify` top-up), `growth_engine_evaluator.js` (`posts[]` on the report).

### 1.4 Evidence on every claim
**What:** Each dimension carries the specific posts that cost the points — thumbnail, date, format, the metric — shown as tiles under the explanation. Thumbnails are our own resized copies (the platforms' URLs expire and block hotlinking), stored locally or in S3, cleaned up for free reports after 90 days. A validator rejects any explanation that cites a number not present in the data the model was shown.
**Why:** "Trust the score" only works if every sentence points at something real.
**Where:** `growth_engine_evidence.js` (`pickEvidence`, `allowedNumbers`, `validateExplanation`), `growth_engine_thumbs.js`, `public/app.js` (`evidenceHTML`).

### 1.5 Free-limit loophole
**What:** One free score per handle *and* per email, plus a per-IP hourly cap.
**Why:** Before this a new email address bought a new free score for the same account.
**Where:** `routes/growth-engine.js` (`evaluateLimiter`, `latestFreeSnapshotForEmail`).

### 1.6 Email foundation
**What:** A mailer with two providers (Resend, or a log line when there's no key), per-user preferences by type (weekly score, Monday move, milestones, post reviews, product news), a master pause, CAN-SPAM footer with postal address + unsubscribe, and a log of every send.
**Why:** Every later feature emails something; they all go through one door with the same rules.
**Where:** `growth_engine_email.js` (service), `mailer.js` (templates).

### 1.7 Card engine and score card
**What:** Server-rendered 1080×1920 and 1080×1080 PNG cards (score, then-vs-now, moments, roast) and a public share page with OG tags and a CTA carrying the sharer's referral code.
**Why:** The share moment is the growth loop; the card has to look the same on every device and the link has to attribute.
**Where:** `growth_engine_cards.js` (`@napi-rs/canvas`, fonts in `server/assets/fonts`), `server.js` (`/cards/:id.png`, `/s/:id`).

### 1.8 Referral tracking
**What:** Every account gets a code; share cards and links carry it; signups and payments from that code are attributed and shown on the reports page.
**Where:** `routes/growth-engine.js` (`ensureRefCode`, signup/payment attribution), `growth_engine_db*.js` referral tables.

### 1.9 Signup questions
**What:** "Is this a business account?" and a confirmed niche at signup/intake, stored on the account for phase 2 and the admin business list.
**Where:** `users.is_business`, `users.niche`, `/admin/business-accounts`.

### 1.10 Best time to post
**What:** From the account's own posts: the day/time windows that beat its average (with the sample size and a confidence flag), in the report and fed into the plan and post writing.
**Where:** `growth_engine_besttime.js`.

### 1.11 Weekly rescore loop
**What:** Paid accounts are rescored weekly; the report shows the score history as a chart, what changed per dimension, which moves were done in between, and a percentile within the niche ("scores higher than X% of travel accounts") once the niche has enough data.
**Why:** The product's promise is "do the moves, watch the number move" — this is where the number moves.
**Where:** `growth_engine_refresh.js` (sweeper), `growth_engine_job_queue.js` (history block), `nichePercentile` in both DB modules.

### 1.12 Post writing
**What:** Every paid report ships six posts written for the account's next slots — hook, caption, script, why — each regenerable one at a time (metered).
**Where:** `growth_engine_evaluator.js` (`writeNextPosts`, `rewriteOnePost`), `POST /reports/:id/posts/regenerate`.

### 1.13 Funnel analytics
**What:** A fixed allowlist of events (evaluate started/completed, report viewed, share clicked, signup, pricing viewed, subscribe, unlock, cancel…) tracked with anonymous id, referral and marketing source; an admin funnel table with step-to-step conversion.
**Where:** `growth_engine_events.js`, `/admin/funnel`.

### 1.14 Pricing control
**What:** Price variants from one env JSON; a visitor keeps their variant, it's copied onto the account at signup, and the funnel can be split by variant.
**Where:** `growth_engine_pricing.js`, `PRICE_VARIANTS_JSON`.

### 1.15 Outcomes data
**What:** Every move marked done is logged with the score before and after, so "creators who did move X gained N points" can be computed later.
**Where:** `growth_engine_move_log`, `growth_engine_move_outcomes`, `/admin/move-outcomes`.

---

## Wave 2 — Roast and launch gamification

### 2.1 Roast my account
**What:** Opt-in on every report, free. Pick a heat (Mild / Medium / Extra Crispy), get six jokes revealed one at a time, each built on a real fact from the report, ending with "Okay, here's how we fix it" and the first move. Share card. Re-roast after 30 days compares then and now.
**Guardrails:** roast the content never the person; a deterministic screen for appearance/identity words, then a second model reviews the lines; fail → regenerate once → normal report; every rejection logged for review; a bio that reads as under 18 gets no roast; only your own report can be roasted.
**Where:** `growth_engine_roast.js`, `growth_engine_roast_rejections` table, `#/admin` → Rejected roasts.

### 2.2 Levels
**What:** Score bands (Rookie / Rising / Consistent / Established / Elite, from `SCORE_LEVELS`) next to the score with points-to-next; a rank-up moment, card and email when a rescore crosses a band.
**Where:** `growth_engine_moments.js` (`levelFor`, `detectMoments`), `GET /levels`.

### 2.3 Weekly streak with freezes
**What:** Paid only. An on-plan week = posted on at least the planned number of days; checked at each rescore. Hidden until the first on-plan week. One freeze to start, one more every four on-plan weeks (max two); a freeze covers a missed week automatically; frozen during a pause; no punishing language.
**Where:** `computeStreak` in `growth_engine_moments.js`.

### 2.4 Personal records
**What:** When a new post beats the previous best on the main metric (likes+comments, or views), a "New personal record" moment, card and milestone email.
**Where:** `detectMoments` (kind `record`), `RECORD_METRIC`.

### 2.5 Milestone cards
**What:** First 1k followers, score over 70, 4-week streak — thresholds in config — through the card engine.
**Where:** `MILESTONE_*` env, `detectMoments`.

### 2.6 Monday move
**What:** Every Monday morning in the user's own time zone, one move under 15 minutes from the current phase with a signed one-tap "Mark done" link (no login) that updates the plan, the move log and outcomes. Free reports get their one free move, then a single upgrade prompt, then nothing.
**Where:** `growth_engine_monday.js`, `GET /email/move-done`, report-scoped opt-out for anonymous free reports.

---

## Wave 3 — Weekly loop

### 3.1 48-hour post review (paid)
**What:** Every ~60 hours we re-read each paid account's profile (one cheap pull), spot posts that weren't in the scored report, and once a post is ~48h old write a review: how it did against the account's own average (deterministic multiplier), the likely reason (hook, format, timing — model, numbers validated), and what to repeat or change. In the app under "Your posts, 48 hours in", and by email.
**Why:** The fastest feedback loop in the product — you posted Tuesday, you know by Thursday.
**Where:** `growth_engine_post_reviews.js`, `post_reviews` email preference.

### 3.2 Personal trend first
**What:** The score box leads with your own line ("Up 12 points since 12 Aug · +340 followers"); the niche comparison comes second.
**Where:** report score box in `public/app.js`.

### 3.3 Goal onboarding
**What:** Right after the first report, one question: follower target / brand deals / sell something / bookings / just grow consistently. Stored on the report (so anonymous free reports keep it) and the account; changeable on the reports page; a progress bar toward it on the report and the dashboard. The goal feeds the plan prompt, Monday moves and post writing.
**Where:** `PUT /account/goal`, `POST /reports/:id/goal`, `goalProgress` in `public/app.js`.

### 3.4 Weekly trend brief
**What:** "What's working in {niche} this week" from our own data: the formats, opener styles, days/time slots, cadence and caption length of posts that beat their own account's median, across every account scored in the niche. Aggregated and anonymised; deterministic (no model, no cost); published only once the niche has `BASELINE_MIN_N` accounts; cached per week so the app and the weekly email agree.
**Where:** `growth_engine_briefs.js`, `GET /briefs/:niche`, `docs/TRENDING_AUDIO_PROPOSAL.md` (external audio source: proposal only).

---

## Wave 4 — Retention

### 4.1 Pause instead of cancel
**What:** Before cancelling, a 1–3 month pause: nothing charged, nothing runs, history and streak kept (streak frozen), auto-resumes or "Resume now". Stripe `pause_collection` when live.
### 4.2 Maintenance tier
**What:** $5/month (`MAINTENANCE_PRICE_CENTS`): weekly rescore and score history only — no plan, moves, posts or streak. Offered on the cancel flow; switch both ways.
### 4.3 Cancel screen
**What:** What they'd lose (runs of history, streak, written posts, competitor set, moves done), then one optional exit question (fixed reasons + other + a line) stored for review.
**Where (4.1–4.3):** `growth_engine_billing.js` (`pauseSubscription`, `switchTier`), `GET /billing/cancel-preview`, `growth_engine_cancel_reasons`, cancel flow in `public/app.js`.

### 4.4 Win-back emails
**What:** 30 and 60 days after a cancellation takes effect, one snapshot rescore and an email: "your score went from X to Y since you left" with a resubscribe link — or congratulations if it went up. Product-news opt-in only; each milestone once.
**Where:** `growth_engine_winback.js`, `entitlements.lapsed_at`.

### 4.5 Annual plan offer
**What:** After a monthly subscriber's first score increase, once: a card on the report and an email offering the year at the pricing page's annual price.
**Where:** job queue (`offers.annual`), `mailer.annualOffer`.

### 4.6 Badges · 4.7 Quests (flags, off by default)
**What:** Badges for real milestones (first 1k, a post at 3× your average, 12-week streak, a dimension at 90+) with cards. Quests grow the Monday move into one weekly, checkable goal from the calendar ("Post 3 reels this week"), progress read at the next rescore from posts we already hold.
**Where:** `detectBadges` in `growth_engine_moments.js`, `growth_engine_quests.js`, `ENABLE_BADGES`, `ENABLE_QUESTS`.

---

## Wave 5 — Brand, methodology, data

### 5.1 Brand stance
**What:** Landing and meta copy around "Stop posting into the void. Growth is a system, not luck." — approved by Haron before shipping. No reach/follower/income claims anywhere.
### 5.2 Methodology page
**What:** `#/how` rewritten from what `growth_engine_scoring.js` actually does: the four dimensions with their real sub-weights (Instagram and TikTok), what we read and can't see, niche targets vs the measured niche average, the minimum-sample rule (read from config), what the score is not.
### 5.3 State of Small Creators (template)
**What:** Admin export of aggregated, anonymised niche stats — score distribution and bands, dimension averages, posting frequency, format mix, engagement rate, follower quartiles — only for niches at the gate; a markdown report template filled by a script. Not published.
**Where:** `growth_engine_stats.js`, `GET /admin/state-of-creators`, `scripts/state_of_creators.js`, `docs/STATE_OF_SMALL_CREATORS_TEMPLATE.md`.
### 5.4 Support for Joe's marketing site
**What:** Public read-only `GET /benchmarks/:niche` (aggregates only, gated, CORS, cached), and marketing attribution: `utm_*` and `?src=` captured on first visit, carried on every event, stamped on the account at signup, summarised at `/admin/sources`.
**Where:** `docs/MARKETING_SITE.md` documents both for Joe.

---

## Pricing add-on (P.1–P.7)

**What:** Free / Growth $19 ($190 a year) / Pro $39 ($390) / Maintenance $5 (cancel flow only); founders pricing — the first 400 Growth subscribers lock $12/$108 for as long as they stay, with a live "X of 400 spots left" counter that is never faked; existing subscribers keep their price; weekly fair-use limits (rewrites 10/25, post reviews 7/20, written posts 6/12, competitors 5/10) with friendly reset-date messages and an upgrade path, every hit logged; one central entitlement function every paid feature asks; downgrades take effect at period end and Pro data is kept, hidden; Pro rescores every 3 days. The one-time $15 unlock is off (`ENABLE_ONE_TIME_UNLOCK`) since P.8 earmarks a one-time product.
**Why:** The tiers had to reflect Waves 2–4, protect margin on the expensive features (post writing, reviews, competitor pulls), and reward early adopters. The earlier "founders band" free-month code is retired as a founders mechanism (promo codes stay for comps and campaigns); the landing form now collects launch-note emails.
**Where:** `growth_engine_plans.js` (every price, limit and feature list; `PLAN_PRICES_JSON` / `PLAN_LIMITS_JSON` overrides), `growth_engine_entitlements.js` (`effective`, `has`, `checkLimit`, `gate`), `GET /billing/pricing` (with `founders` and `limits`), `/admin/limits`, `/admin/price-test` (P.7: conversion, revenue per visitor, month-two retention by variant; founders excluded).
**Not built:** Pro's single *combined* multi-platform plan — Pro can score every platform under one subscription, each with its own plan; merging them into one plan is evaluator work.

## The Path (branch `feat/path`, after the sample audit)

Spec: `docs/PATH_SPEC.md`. The sample report read well at the top and fell apart as a
to-do list: the same bio move four times, one reel cited ten times, four different
answers on when to post, Instagram steps that don't exist. Two parts:

### Plan quality (`server/growth_engine_plan_quality.js`)
- Phases are written in order; each prompt carries the moves already in the plan and a
  fixed posting schedule. A validator rejects repeats, off-phase moves and over-cited
  posts; the phase is rewritten once with the problems quoted back, then what still
  repeats is dropped (`report.plan_dropped` says what).
- One schedule for the plan: cadence from the hours answer, days from the account's best
  days, time from its best window. Moves, calendar and written posts all use it.
- A library of real Instagram/TikTok steps (link, bio, pin, highlight, schedule) replaces
  the model's "how" whenever a move matches.
- Posts are named by caption ("the Cape Flattery reel, Sep 17"), never by ISO date.
  "Swipe up", `[Name]` placeholders and sponsor-facing lines are removed; at most one
  written post per set pitches brand work.
- Benchmark text for creator niches is generated from the scorer's numeric targets, so
  the explanation and the evidence line quote the same number.
- A dimension the summary names as a loss is labelled "Biggest gap", never "Strong".
- `scripts/clean_sample.js` runs the deterministic parts over the shipped sample.

### The Path (`public/path-engine.js`, `#/path/:report`)
- One shared engine for the server route, the app and the mock: every move, calendar
  slot (with its written post attached) and phase becomes a step with a status.
- One card at a time: Done, Skip (with a reason), Not today. "2 today" when a move and a
  post day coincide. Caught-up state names the next step and offers "work ahead".
- Soft order: phase 2 opens when phase 1's moves are done or day 31 arrives.
- Verification at rescore: link in bio, bio changed, pinned post, new highlight, a post on
  the slot's day. A second tick, or "we couldn't see this yet" on moves marked done.
- Free reports: the three openers are live, the rest is a greyed trail with the unlock.
- Signed-in users with a plan land on the Path; the report is one tap away. The report's
  "This week" card is now "Start here →". Monday emails open the Path.
- Routes: `GET /reports/:id/path`, `POST /reports/:id/path/:key`. Events: `path_viewed`,
  `path_done`, `path_skipped`, `path_later`, `move_skipped`.
- Tests: `node server/growth_engine_path.test.js`.

### Data layer (crash-report follow-ups, 23 Sept)
- Engagement rate is the median post's likes+comments over followers, on the unpinned
  feed from the last year (the mean is kept as `engagement_rate_mean_percent`). One viral
  reel or a pinned post from 2019 no longer sets the number.
- Best/worst posts exclude pinned posts and rank against the median (`post_insights.metric`).
- Best times need three posts per window (was two) and only look at the last year.
- The evaluating screen's failures are classified; see the handoff note.

### Unsatisfied-customer pass (23 Sept)
- Posting Consistency: cadence carries the dimension (full at target, nothing at a third
  of it), so 60% of target reads Fair, not Strong. The sample re-scored 76 → 61, overall 75 → 71.
- The weakest dimension shows a checklist of what's there and what's missing, parsed from
  the scorer's evidence line, instead of one paragraph.
- No invented links or emails: anything the creator didn't give us becomes words ("your
  link — the page brands should land on"). The Path asks for the link on that step and
  writes it in (`POST /reports/:id/context`).
- Best and worst posts open by default with the best multiple in the heading; pinned posts
  out; against the median.
- Calendar heading says how many weeks are written when the set is short; the sample's
  competitor section is labelled as one example account; "16 accounts scored so far";
  "10 points to Elite".
- Score box carries the four dimensions, the niche marker and three facts.

### Sample regenerated (24 Sept)
- After Joe fixed the Groq model list (#8), full paid runs complete. The public sample is
  now report `rpt_7dfd1504fa2770d33b19f24f` (the third clean run, chosen after the refund-pass rules and the growth playbook went into every prompt), exported with `server/scripts/export_sample_report.js`
  and finished with `scripts/clean_sample.js`: three phases, 12 weeks, five posts, one schedule,
  explanations that quote the scorer's targets.
- Fixed on the way: the merge output budget (6144 → 8192) was truncating the third phase;
  openers now seed the one-off topics so moves can't repeat them; post names count toward
  the two-mentions cap; plural and lone weekdays follow the schedule; placeholder or unknown
  @handles drop the written post; the how-to library only replaces steps where the mechanic
  is the move or the model's steps are bogus.

### Refund pass (24 Sept)
- Later phase openers can't repeat an earlier phase's one-off action: the repeated clause is
  cut, or the phase's first move is promoted to opener.
- One sponsor-pitch move per plan; intake constraints enforced (behind the camera → no
  on-camera moves; no new shoots → no new-footage moves); invented dollar amounts become
  "a rate you set"; bare label and lone-emoji lines left by stripped emails go.
- A growth playbook (hooks, saves and shares over likes, one idea and one CTA per post,
  consistency over volume, reply in the first hour, repurpose at most twice, never invent)
  is in the snapshot merge, the plan-phase prompt and the post prompt.
- Guessed posting days are labelled on the calendar; collapsed calendar weeks show their
  subjects.

## Also fixed along the way

- Stored report bodies carried a provisional `report_id` (share sheet broke).
- Goal / level / streak stamps ran after the report was written and were never persisted.
- A legacy `overall` string mirrored into the report wrapper; Postgres report rows lacked `createdAt/updatedAt` that sql.js rows had.
- Calendars came back with 3 weeks when the model truncated — a top-up call fills the rest.
- The explanation validator rejected legitimate forms ("19 of 30", "55%") — allowed set now built from the actual prompt input.

## What's not built, on purpose

The "Earmarked — do not build" list in the spec (pre-post check, growth sprints, live audit stream, leagues, XP, predict-your-post, squads, transit level names, founder story, accuracy study, content series, affiliate payouts), and the external trending-audio source (proposal only).
