# Email setup (Resend)

Scalecraft Social sends through `server/growth_engine_email.js`. With no `RESEND_API_KEY` it logs
instead of sending, so nothing leaves a dev box.

Live as of 27 Sep 2026: sending from `hello@send.futreeng.com`, verified, confirmed
delivering to external inboxes.

## 1. Domain verification — one time, already done

We verified the **subdomain** `send.futreeng.com`, not the root domain. That was deliberate:
`futreeng.com` already carries an SPF record for our regular business mail, and a domain can
only have one. Verifying a subdomain keeps Resend's records entirely separate, so nothing we
do here can break normal email.

If you ever need to redo this:

1. Resend → **Domains** → **Add Domain** → `send.futreeng.com`.
2. Resend shows three records. As of Sep 2026 that's one `TXT` (DKIM, `resend._domainkey.send`)
   and two `CNAME`s (`rsend.send`, `send.send`). Resend has changed this set before — use what
   the dashboard shows, not this list.
3. The Name fields already include the `.send` suffix. In GoDaddy, paste them **exactly as
   shown** — GoDaddy appends `futreeng.com` itself. Adding it yourself produces
   `rsend.send.futreeng.com.futreeng.com`.
4. Easiest path: the **Go to GoDaddy** / Auto configure button writes the records for you.
   Requires the GoDaddy login, which Haron holds.
5. Wait for **Verified**. Sending from an unverified domain is rejected.

Leave **Enable Receiving** off. We only send. Nothing monitors `hello@send.futreeng.com`, which
is why `SUPPORT_EMAIL` exists as the real contact point in footers.

## 2. Environment (Render → scalecraft → Environment)

```
RESEND_API_KEY=re_…                        # Resend → API Keys → "Sending access" only
MAIL_FROM=Scalecraft Social <hello@send.futreeng.com>   # must be on the verified domain
EMAIL_POSTAL_ADDRESS=FutreEng LLC, <street>, <city, state zip>   # CAN-SPAM footer
SUPPORT_EMAIL=hello@futreeng.com
APP_URL=https://scalecraft.onrender.com    # links in emails
```

Notes that have bitten us:

- **Paste values raw, without quotes.** The quotes in `.env.example` are dotenv syntax. Render
  takes the field literally, so quotes end up inside the From header.
- **Don't set `EMAIL_PROVIDER`.** The provider auto-selects Resend whenever `RESEND_API_KEY` is
  present (`growth_engine_email.js:47`). Setting it by hand only creates a way to get it wrong.
- **`APP_URL` must serve both the frontend and the API.** Emails contain both `/#/report/<id>`
  (frontend) and `/api/growth-engine/v1/email/unsubscribe` (backend). Our Express server serves
  `public/`, so one origin covers both. Update this the day a custom domain is pointed at the
  service, or every link in already-sent mail keeps pointing at onrender.com.
- **Never rotate `JWT_SECRET` once mail is out.** It HMACs the unsubscribe and pause links
  (`growth_engine_email.js:55`). Changing it dead-links the unsubscribe button in every email
  already delivered — a CAN-SPAM problem, not just a broken link.
- **Env changes need a redeploy to take effect.** A running instance keeps the old values. This
  cost us a debugging cycle on 27 Sep: `MAIL_FROM` had been updated but the instance serving the
  job still had `onboarding@resend.dev`.

## 3. Check

- Admin → `GET /api/growth-engine/v1/admin/emails` returns `{ provider, emails: [...] }`. The
  `provider` field must read `"resend"`; `"log"` means the key didn't load and every send is
  being silently swallowed. Needs `ADMIN_EMAILS` or an `x-admin-token` matching `ADMIN_TOKEN`,
  otherwise the route 404s by design.
- Render logs, search `Mail`. `[Mail] sent` is success; `[Mail] failed` carries the reason.
- Resend → **Logs** is the authoritative record. Your inbox can mislead you (spam, delays).

## Troubleshooting — things that actually happened

**`You can only send testing emails to your own email address`** — `MAIL_FROM` is still
`onboarding@resend.dev`. Resend's shared test sender only delivers to the Resend account
owner's address. Set `MAIL_FROM` to the verified domain and redeploy.

**403 on every `/emails` POST in Resend's logs** — sending from a domain that isn't verified.

**Report completes, no email, nothing in any log** — the recipient was null. As of 27 Sep this
warns and writes a `skipped` row rather than vanishing, but if you see `[Mail] no recipient`,
the bug is upstream: `inputParams.email` never got populated. The recipient resolves as
`req.body.email || req.user?.email` (`routes/growth-engine.js:550`).

**Nothing in the logs at all, job never finished** — on Render's free plan the instance sleeps
after ~15 minutes of inactivity, and the job queue runs in-process. An in-flight report dies
with it: no error, no retry, no email. `render.yaml` specifies `standard` for this reason.

## What every email carries

- Physical address footer (`EMAIL_POSTAL_ADDRESS`), support address, privacy link.
- Two signed one-click links on every non-transactional email: unsubscribe from that type, and
  pause all but receipts. No login needed.
- Preference buckets: `weekly_score`, `monday_move`, `milestones`, `post_reviews`,
  `product_news`. `transactional` (report ready, password reset, receipts) always sends.
  `mailer.js:52` maps each template to its bucket — a new template needs an entry there or it
  defaults to transactional and bypasses preferences.

## Swapping the provider later

Add an object to `providers` in `growth_engine_email.js` with `send({ to, subject, html, text,
type })` returning `{ id, status }`, and set `EMAIL_PROVIDER` to its name. Templates,
preferences, footer and logging don't change.
