# Scalecraft — handoff to Joe (2026-09-20)

Everything Haron's side built since PR #1 lives on two branches. Merge in this order:

1. **PR #2 `fix/railway-postgres` → `main`** — unbreaks Railway (Postgres wired through every module, app.js parse fix). Nothing works in prod until this lands.
2. **PR #3 `redesign/field-guide` → `main`** — the product as it stands now. Stacked on #2; GitHub retargets it to `main` once #2 merges.

After both: Railway redeploys from `main`, and `scalecraft-demo.vercel.app` (mock) can be repointed or retired.

## What's on `redesign/field-guide`

| Area | State |
|---|---|
| Frontend | Full "Field Guide" redesign in `public/` — landing, evaluating, free/paid report (phone-first, checkable moves, 12-week calendar, canvas share card), pricing, business lead form, history, how-it-scores, legal, auth. Vanilla hash router, no build step. |
| Platforms | **Instagram** (`instagram_apify_fetcher.js`, ~$0.003/pull) and **TikTok** (`tiktok_apify_fetcher.js`, 15 videos ≈ $0.06/pull) live. 8 others show "coming soon" + waitlist (`POST /waitlist`). |
| Scoring | Deterministic (`growth_engine_scoring.js`): four dimensions, per-niche targets, creator vs business checklists, TikTok branches. LLM only explains and writes moves — never sets numbers. |
| Pricing | Free Snapshot → **$12/mo Growth Plan** (90 days, weekly refresh) → **$15 one-time 60-day plan** (`POST /reports/:id/unlock`; phases 1–2, phase 3 locked). $29 Pro and business tiers exist but are hidden behind `ENABLE_GROWTH_PLAN_PRO` / `ENABLE_BUSINESS_CHECKOUT`. |
| Cost controls | Free limit is per handle+platform (402 returns the existing `report_id`); `PAID_RUNS_PER_DAY`, `COMPETITOR_PULLS_PER_DAY`, `FREE_RUNS_PER_DAY_GLOBAL`; 24h DB profile cache; in-process weekly refresh sweeper (`growth_engine_refresh.js`). |
| Evidence | `growth_engine_outcomes` — moves done → score/follower delta; `GET /outcomes`. |
| Emails | `server/mailer.js` — report ready, day-30/60 check-in, score changed (+nudge), plan ended (day 60, one-time), password reset. Sends via Resend when `RESEND_API_KEY` is set. |
| Plan fit | 4-question intake at unlock (`#/plan-setup`), saved per handle; check-ins at day 30/60; weekly refresh nudges when answers stop matching behaviour. |
| Tests | `node server/growth_engine_db_postgres.test.js` (pg-mem, no DB needed). **`node server/scripts/smoke.js`** walks the whole customer path against a running server (signup → free score → unlock → check-in → subscribe → cancel → resume → pause → reset → delete), 20 checks, ~3 min. Run it before merging anything. |
| Email pause | Signed one-click "Pause these emails" in every scheduled email; toggle on the plan card. Report-ready and reset still send. |
| Support | `SUPPORT_EMAIL` env → footer, legal, refund line, email footers. Hidden until set. |

`server/.env.example` lists every variable. Verified live locally against real Apify + Gemini/Groq: `@humansofny` IG 53 / TikTok 49, `@nike` TikTok 35, one-time unlock end-to-end.

## Your part (needs you or your accounts)

1. **Merge #2, then #3.** Railway env needs `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `APIFY_TOKEN`, ≥1 LLM key. Optional knobs are commented in `.env.example`.
2. **Stripe for real.** `growth_engine_billing.js` is mock unless `STRIPE_API_KEY` is set; `purchaseOneTime` uses a PaymentIntent, subscriptions use Subscriptions. The webhook handler (`POST /billing/webhook`) is a stub — payment-failed → downgrade isn't implemented. Stripe Tax is worth turning on (SaaS is taxable in several states). Annual pricing is shown but `subscribe` only takes monthly — wire it or drop the toggle.
3. ~~Cancel~~ — done: `POST /billing/cancel` (at period end) / `resume`, "Your plan" card on `#/reports`. Stripe path calls `subscriptions.update({cancel_at_period_end})` once real subscriptions exist.
4. ~~Email sender~~ — done: `server/mailer.js` (Resend REST). Needs `RESEND_API_KEY`, `MAIL_FROM` on a verified domain, `APP_URL`. Without the key it logs instead of sending.
5. ~~Password reset~~ — done: `POST /auth/forgot` + `/auth/reset`, `#/forgot`, `#/reset?token=`. Needs 4 to actually deliver.
6. ~~Admin auth~~ — done: `ADMIN_TOKEN` env, header `x-admin-token`; routes 404 when unset.
7. **Meta OAuth "connect your account."** Your Graph API fetcher only reads owner-connected accounts; the scorer doesn't consume that data yet (deliberately parked until the connect flow exists). Needs a Meta app + review.

## Cheap wins anyone can do

- Seed creator baselines: `server/scripts/seed_baselines.js --file seeds.json` — fetch + deterministic score, no LLM. Instagram ≈ $0.003/handle, TikTok ≈ $0.06. 16 niches × 20 on Instagram ≈ $1 and ~30 min. Until then "your niche average" is blank.
- Frontend analytics (Plausible/PostHog script tag) — we can't see funnel drop-off yet.
- Lower free cap for TikTok specifically (20× the per-pull cost of Instagram).
- Domain + lawyer pass on `#/legal/*` (drafted, marked for review). Name stays Scalecraft for now; "Uptrend" was liked and `uptrend.app` / `uptrend.io` / `getuptrend.com` were free on 2026-09-19.

## Rules we've been keeping

- Never push to `main` directly — branch + PR, even hotfixes. Railway deploys from `main`.
- Scores stay deterministic. If the LLM ever sets a number, that's a bug.
- API keys go in `server/.env` (gitignored), never in chat or commits.
