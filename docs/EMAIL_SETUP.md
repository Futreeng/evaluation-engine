# Email setup (Resend)

Scalecraft sends through `server/growth_engine_email.js`. With no `RESEND_API_KEY` it logs instead of sending, so nothing leaves a dev box.

## 1. Domain verification (SPF + DKIM) — one time

1. In Resend → **Domains** → **Add domain** → `futreeng.com` (or the sending domain you pick). Choose the region closest to Render.
2. Resend shows three DNS records. Add them at the DNS host for the domain:
   - **DKIM**: a `TXT` record at `resend._domainkey.futreeng.com` with the long `p=…` value.
   - **SPF**: a `TXT` record at `send.futreeng.com` (Resend uses a subdomain for the return path) with `v=spf1 include:amazonses.com ~all`, plus the `MX` record it lists for the same subdomain.
   - If the root domain already has an SPF record, leave it; Resend's SPF lives on its own subdomain.
3. Wait for Resend to show **Verified** (minutes to an hour). Sending from an unverified domain is rejected.
4. Optional but recommended: a `DMARC` `TXT` at `_dmarc.futreeng.com`: `v=DMARC1; p=none; rua=mailto:hello@futreeng.com` — start with `p=none`, tighten to `quarantine` after a week of clean reports.

## 2. Environment (Render → Environment)

```
RESEND_API_KEY=re_…                        # Resend → API Keys → "sending" permission is enough
MAIL_FROM="Scalecraft <hello@futreeng.com>" # must be on the verified domain
EMAIL_PROVIDER=resend                      # optional; defaults to resend when the key is set
EMAIL_POSTAL_ADDRESS="FutreEng LLC, <street>, <city, state zip>"   # CAN-SPAM footer — required before any weekly/marketing send
SUPPORT_EMAIL=hello@futreeng.com
APP_URL=https://scalecraft.onrender.com     # links in emails
```

## 3. Check

- Sign in as an admin → `GET /api/growth-engine/v1/admin/emails` lists every send with type, user, status and Resend message id.
- Reset a password on a test account: the reset email should arrive within seconds; `status: sent` in the log.
- In Resend → **Emails** you'll see the same message ids.

## What every email carries

- Physical address footer (`EMAIL_POSTAL_ADDRESS`), support address, privacy link.
- Two signed one-click links on every non-transactional email: unsubscribe from that type, and pause all but receipts. No login needed.
- Preference buckets: `weekly_score`, `monday_move`, `milestones`, `product_news`; `transactional` (report ready, password reset, receipts) always sends. Users toggle them under Email on their reports page.

## Swapping the provider later

Add an object to `providers` in `growth_engine_email.js` with `send({ to, subject, html, text, type })` returning `{ id, status }`, and set `EMAIL_PROVIDER` to its name. Templates, preferences, footer and logging don't change.
