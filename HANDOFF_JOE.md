# Scalecraft — handoff to Joe (updated 2026-09-20, evening)

## Where the code is

- **`main`** — has PR #1, PR #2 and the whole `redesign/field-guide` branch (you hand-merged it; PR #3 is still open, just close it). Plus your own tidy-ups (Twitter/X removed, `API_KEYS_SETUP.md`, root `package.json`).
- **`feat/sample-report`** — 12 commits on top of `main`, pushed, **no PR yet**. Everything in the "Built since" list below is here. Branch from `main` → review → merge. Nothing on it conflicts with `main`.

Railway is still 502. `main` boots clean locally and the Postgres module passes its test, so it's env: the server exits at boot if `JWT_SECRET` or `ENCRYPTION_KEY` is missing (first lines of the deploy log will say). Needs `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `APIFY_TOKEN`, and `GEMINI_API_KEY` or `GROQ_API_KEY`.

## Built since the last handoff (all on `feat/sample-report`)

**Product**
1. **Public sample report** — `#/report/sample`, a real Growth Plan for `@talon__wilson` (Haron's account, so no consent issue), competitor `@blackmenhikela` (also ours). Data ships in `public/sample-report.js`; regenerate with `node server/scripts/export_sample_report.js <report_id>`. Landing score card and pricing link to it.
2. **Moves carry the how** — every move (and each phase's Move 01) has 3–5 platform-specific steps, a paste-ready example in the creator's own voice, a "done when" check and a time cost. Plan Writer is now three parallel per-phase LLM calls instead of one (a flaky call loses a phase, not the plan; can't truncate). Rows expand on tap.
3. **Intake** — four taps + optional line at `#/plan-setup`, asked between "start the plan" and payment: next 90 days · hours/week · goal · how they make content, plus link (sell/bookings) or brand contact (deals). Saved per account+handle in `growth_engine_plan_context`; turned into hard rules for the snapshot openers and the Plan Writer. Every calendar slot is tagged `new` / `archive` / `no_camera`. Free form asks just the first question (optional); free report explains the paid plan asks four more.
4. **Check-ins** — day 30 and 60: card on the report + email. "Nothing changed" is one tap; "Something changed" opens the prefilled intake and rewrites the plan (`POST /reports/:id/checkin`). Weekly refresh **nudges** when answers stop matching behaviour (said fewer shoots, posting 6+/fortnight; said 5–10 hrs, silent two weeks), once per phase, one tap to accept.
5. **One-time unlock = 60-day plan** ($15): phases 1–2, 8 weeks; phase 3 visible with locked rows; "Not in your 60-day plan" strip; day-60 email. Copy says "60-day plan" before the money. One-time buyers get no check-ins/refresh by design.
6. **Cancel at period end** — `POST /billing/cancel` / `resume`; `cancel_at` on entitlements, `geDb.getEffectiveEntitlement()` applies the downgrade lazily so every reader agrees. "Your plan" card on `#/reports`, one confirm, optional reason (logged only). When you wire real Stripe subscriptions, the same path calls `subscriptions.update({cancel_at_period_end})`.
7. **Password reset** — `POST /auth/forgot` (same reply whether the email exists, 5/email/hour) → emailed 32-byte token (sha256 stored, 1h, single use) → `POST /auth/reset` sets password and signs in. `#/forgot`, `#/reset?token=`.

**Infrastructure**
8. **Mailer** — `server/mailer.js`, Resend via REST, no SDK. Emails: report ready, check-in, score changed (+nudge), plan ended, password reset. Without `RESEND_API_KEY` every send is a log line (and the reset link is printed for local testing). Scheduled sends (day 28/58/60) run from the refresh sweeper.
9. **Email pause** — signed one-click "Pause these emails" link in every scheduled email (no login), toggle on the plan card. Report-ready and reset still send. `email_paused` on users.
10. **Auth rate limit** — your `authLimiter` existed but was never mounted. Now on login/signup/forgot/reset: 20 per IP per 15 min.
11. **Admin token** — `ADMIN_TOKEN` env, header `x-admin-token`; `/admin/*` 404s when unset.
12. **Support address** — `SUPPORT_EMAIL` env → footer Contact, refund line, legal page, email footers. Hidden until set.
13. **JWT fix** — a token kept working after account deletion; `authMiddleware` now checks the account exists.
14. **Smoke test** — `node server/scripts/smoke.js` against a running server: 20 checks (signup → free score → unlock → check-in → subscribe → cancel → resume → pause → reset → delete), ~3 min, 20/20 green. Free score is one per handle, so run the server with `FREE_SNAPSHOTS_PER_EMAIL=unlimited` and the script with `SMOKE_FREE_UNLIMITED=1`. **Run it before merging anything that touches routes, billing, the queue or the DB modules.**
15. **Seed script** — `server/scripts/seed_baselines.js --file seeds.json [--dry]` fetches + scores without the LLM. Instagram ≈ $0.003/handle, TikTok ≈ $0.06. Not run yet (Haron's call on spend).

New DB tables/columns (both backends create them on boot): `growth_engine_plan_context`, `growth_engine_password_resets`, `entitlements.cancel_at`, `users.email_paused`. `server/.env.example` has every variable with a comment.

## Your part

1. **Railway env** (above) → deploy `main` → then merge `feat/sample-report` and deploy again. Run the smoke test against Railway with a throwaway handle.
2. **Stripe for real** — `growth_engine_billing.js` is mock unless `STRIPE_API_KEY` is set. `_createStripeSubscription` throws "not implemented"; `purchaseOneTime` already uses a PaymentIntent. The webhook (`POST /billing/webhook`) is a stub — payment failed → `setCancelAt(accountId, now)` is all it needs to downgrade. Stripe Tax is worth turning on. Annual is shown on the pricing page but `subscribe` only takes monthly — wire it or hide the toggle.
3. **Resend** — key + a verified sending domain (`MAIL_FROM`), `APP_URL` for links. Until then no email leaves the box, including password reset.
4. **Meta OAuth "connect your account"** — your Graph API fetcher only reads owner-connected accounts; the scorer doesn't consume that data yet, parked until the connect flow exists.
5. `SUPPORT_EMAIL` and `ADMIN_TOKEN` values.

## Cheap wins, anyone

- Seed baselines (script ready; ~$1 for all 16 Instagram niches).
- Analytics script tag (Plausible/PostHog) — no funnel visibility yet.
- Error monitoring (Sentry), Postgres backups on Railway.
- Lower free cap for TikTok (20× Instagram's per-pull cost).
- Password minimum 6 → 8. Lawyer pass on `#/legal/*`. Domain.

## Rules we've been keeping

- Never push to `main` directly — branch + PR, even hotfixes. Railway deploys from `main`.
- Scores stay deterministic. If the LLM ever sets a number, that's a bug.
- API keys go in `server/.env` (gitignored), never in chat or commits.
- The sample report is a real person's account, used with permission. Don't swap it for a big-name account.
