# Scalecraft — handoff to Joe (updated 2026-09-22)

## Where the code is

- **`main`** — everything through PR #4 (sample report, intake, check-ins, 60-day plan, cancel/reset, mailer, admin, promo codes). Render (`scalecraft.onrender.com`) runs this.
- **PR #5 `feat/baselines-import`** — small: baseline export/import, Instagram seed list, and the **Stripe placeholder guard** (a `sk_test_…_KEY` placeholder no longer switches billing to live mode and 500s). Render still has that placeholder, so unlock/subscribe 500 there until this lands or the var is unset.
- **PR #6 `feat/next-build`** — the whole build spec, Waves 1–5, stacked on #5 (77 commits, 82 files). Merge #5 first (or just merge #6 — it contains #5). Every feature was built and verified locally against the real backend plus the mock; the pg-mem test covers both DB modules; `scripts/smoke.js` and `scripts/shape_diff.js` are the regression checks.
- PR #3 (`redesign/field-guide`) is long since hand-merged — close it.

Feature-by-feature explanations: `docs/WHAT_WE_BUILT.md`.

Demo (mock data, no backend): `scalecraft-demo.vercel.app`, deployed with `scripts/deploy_demo.sh` — same `public/` as prod, mock switched on by hostname.

## What's on PR #6 (spec numbering)

**Wave 1 — go live and core.** 1.1 `?mock=1` dev switch + mock/real shape parity (`shape_diff.js`) · 1.2 cost tracking per report/feature + admin cost vs revenue · 1.3 30-post scrape with per-post fields · 1.4 evidence thumbnails on every claim, LLM explanations validated against the inputs · 1.5 free-limit loophole closed (per email + per IP) · 1.6 Resend mailer with prefs, CAN-SPAM footer, log · 1.7 card engine (score / then-vs-now) + public share page · 1.8 referral codes + attribution · 1.9 signup questions (business flag, niche) · 1.10 best time to post · 1.11 weekly rescore loop with history chart + niche percentile · 1.12 post writing (6 posts per paid report, regenerate one) · 1.13 funnel events + admin funnel · 1.14 price A/B variants · 1.15 move outcomes data.

**Wave 2.** 2.1 Roast (opt-in, three heats, blocklist + second-model review, rejections logged, under-18 skip, re-roast at 30 days) · 2.2 Levels · 2.3 Weekly streak with freezes · 2.4 Personal records · 2.5 Milestone cards · 2.6 Monday move email with signed one-tap "Mark done".

**Wave 3.** 3.1 48-hour post review (paid; profile re-read every 60h, review vs own average, rules fallback when the model is out) · 3.2 own trend first · 3.3 goal onboarding + progress bar (goal feeds the plan prompt) · 3.4 weekly niche brief from our own data (deterministic, gated, cached per week) + trending-audio proposal in `docs/`.

**Wave 4.** 4.1 pause 1–3 months · 4.2 maintenance tier ($5, `MAINTENANCE_PRICE_CENTS`) · 4.3 cancel screen (what they'd lose + exit reasons stored) · 4.4 win-back rescores at 30/60 days · 4.5 annual offer after the first rise · 4.6 badges and 4.7 quests behind `ENABLE_BADGES` / `ENABLE_QUESTS` (off).

**Wave 5.** 5.1 brand copy live ("Stop posting into the void.") · 5.2 methodology page from the scoring code · 5.3 State of Small Creators admin export + template (not published) · 5.4 public `/benchmarks/:niche` + UTM/`src` attribution — see `docs/MARKETING_SITE.md`.

New tables (both backends create them on boot): `growth_engine_events`, `_costs`, `_move_log`, `_move_outcomes`, `_shares`, `_referrals`, `_email_log`, `_roast_rejections`, `_niche_briefs`, `_cancel_reasons`, plus columns on `users` (email prefs, niche, is_business, price_variant, ref_code, goal, goal_target, utm) and `entitlements` (cancel_at, paused_until, pause_started_at, pause_ended_at, lapsed_at). No migrations to run by hand.

## Your part

1. **Merge #5 and #6** → Render redeploys → set the env below → `SMOKE_BASE=https://scalecraft.onrender.com node scripts/smoke.js` (expect 20/20 once the Stripe placeholder is gone).
2. **Stripe for real** — `growth_engine_billing.js` is mock unless `STRIPE_API_KEY` looks real. Stubs for you, each already receiving the right arguments:
   - `_createStripeSubscription` (monthly and annual; annual amount is precomputed).
   - `pauseSubscription` / `unpauseSubscription` already call `subscriptions.update({ pause_collection… })` when live — just needs the subscription id stored on the entitlement.
   - `switchTier` throws when live: swap the subscription item to the maintenance / growth_plan price ids.
   - Webhook `POST /billing/webhook` is a stub: payment failed → `setCancelAt(accountId, now)`.
3. **Resend** — `RESEND_API_KEY`, verified domain in `MAIL_FROM`, `APP_URL` for links, and the postal address in `EMAIL_POSTAL_ADDRESS` (Haron is sending it). Until then every send is a log line, including password reset and the one-tap Monday link emails.
4. **Thumbnail storage** — `THUMB_STORAGE=local` works on Render but the disk is ephemeral; `THUMB_STORAGE=s3` + `npm i @aws-sdk/client-s3` for anything durable. Your call.
5. **Meta OAuth "connect your account"** — still parked; nothing on the branch depends on it.

### Render env (beyond what's already there)

`SUPPORT_EMAIL=hello@futreeng.com` · `MAIL_FROM="Scalecraft <hello@futreeng.com>"` · `EMAIL_POSTAL_ADDRESS` · `APP_URL=https://scalecraft.onrender.com` (or the domain) · `ADMIN_EMAILS` (you + Haron) · `ADMIN_TOKEN` · `FOUNDERS_PROMO_CODE=FOUNDER50` (create it: `node scripts/promo.js create FOUNDER50 --kind free_months --value 1 --max 50`) · `SCRAPE_POSTS=30` · `BASELINE_MIN_N=10`. Everything else has a default; `server/.env.example` documents every knob by spec item.

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
