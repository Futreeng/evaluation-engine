# Stripe setup

Payments run through Stripe Checkout, Stripe's hosted page. The app never sees
a card. Code: `server/growth_engine_stripe.js` (sessions, webhook, portal),
`server/growth_engine_billing.js` (which price an account pays), routes in
`server/routes/growth-engine.js` (`/billing/subscribe`, `/reports/:id/unlock`,
`/billing/checkout/confirm`, `/billing/portal`, `/billing/webhook`), and the
`#/checkout/done` view in `public/app.js`.

## How a payment flows

1. Customer clicks Start on pricing (or Get the 60-day plan on a report).
2. `POST /billing/subscribe` quotes the price the same way the mock did
   (locked price for a current subscriber, founders price while spots last,
   otherwise list) and returns a Checkout URL. The browser goes to Stripe.
3. Stripe takes the card, then sends the browser to `#/checkout/done?session_id=…`
   and posts `checkout.session.completed` to the webhook.
4. Both paths call `applySession`. The first one grants the tier (or starts the
   60-day job); the second sees it's done. The confirm page then runs the plan
   for the handle that was scored, exactly as before.
5. Later events keep the entitlement honest: `customer.subscription.updated`
   (period dates, cancel-at-period-end, pause), `customer.subscription.deleted`
   (plan ends), `invoice.payment_failed` (logged; Stripe retries on its own).

Cancel, pause and resume in the app call Stripe directly using the stored
subscription id. "Card & receipts" on the account page opens Stripe's portal.

## What the account looks like (28 Sept)

- The dashboard uses **Sandboxes** instead of a test-mode toggle. Sandbox keys
  and webhooks only work inside that sandbox; live keys come from the main
  account when you go live.
- **Managed Payments is on by default.** Stripe (through Link) is the merchant of
  record: it collects and remits sales tax itself, and the checkout page says
  "Sold through Link". Two consequences the code already handles: every product
  carries a tax code (`STRIPE_TAX_CODE`, default SaaS personal use), and
  `automatic_tax` is never sent unless `STRIPE_AUTOMATIC_TAX=true`. It also needs
  the Stripe SDK at v22+ (API 2025-03-31 or later); `server/package.json` has it.
  To turn Managed Payments off instead: Settings → Managed Payments in the
  dashboard, then nothing else changes.
- Products and prices were created by `node scripts/stripe_products.js`; the ids
  are in `server/.env` as `STRIPE_PRODUCTS_JSON` / `STRIPE_PRICES_JSON`. Re-run the
  script in the live account when the time comes and copy its two lines to Render.
- Verified against the sandbox on 28 Sept: checkout session at the founders $12,
  a real $12 subscription applied through the signed webhook (plan on, founders
  flag, period end stored), bad signature refused, customer portal session
  created, cancel from the app recorded on the Stripe subscription.

## Dashboard (test mode first)

1. **Developers → API keys**: copy the secret key. Local: `STRIPE_API_KEY` in
   `server/.env`. Production: Render env.
2. **Developers → Webhooks → Add endpoint**:
   `https://scalecraft.onrender.com/api/growth-engine/v1/billing/webhook`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
   Without it every webhook is refused (500) and only the browser's return grants.
3. **Settings → Billing → Customer portal**: turn on; allow cancel, update
   payment method, invoice history. Return URL is set by the app.
4. **Settings → Business**: legal name FutreEng LLC, support email
   hello@futreeng.com, statement descriptor `SCALECRAFT`.
5. **Products**: `node scripts/stripe_products.js` creates or finds the
   catalogue with tax codes and prints the two env lines. Checkout falls back to
   carrying the amount itself if a price id doesn't match the app's quote.
6. **Stripe Tax** (optional): enable in the dashboard, then `STRIPE_AUTOMATIC_TAX=true`.
7. Live mode: repeat 1–3 with live keys. Never edit or delete a price a
   subscriber is on; create a new one.

## Local test

```
stripe login
stripe listen --forward-to localhost:3005/api/growth-engine/v1/billing/webhook
# paste the whsec_… it prints into server/.env as STRIPE_WEBHOOK_SECRET
NODE_ENV=production node server/server.js     # or leave NODE_ENV unset: a real test key is enough
```

Sign in, pricing, Start Growth. Card `4242 4242 4242 4242`, any future date,
any CVC. You land on "Confirming your payment…", then the plan runs. Check
`#/reports`: the plan card shows the founders price and "Card & receipts".

Then in the dashboard: cancel the subscription → the app shows the plan ending
at period end. Delete it → the plan reads as free. `stripe trigger
invoice.payment_failed` → a `payment_failed` event appears in `#/admin`.

Unit test without Stripe: `node server/growth_engine_stripe.test.js` (part of `npm test`).

## Promo codes

Codes in `#/admin` still work. A code with a `stripe_coupon_id` is passed to
Checkout as the coupon; a free-months code becomes a trial of that length; an
amount code changes the amount on the line. A $0 code still grants without
Checkout, as before. Stripe's own promotion-code box is shown when no app code
is applied.
