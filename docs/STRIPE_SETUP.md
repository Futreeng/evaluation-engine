# Stripe setup

Payments run through Stripe Checkout, Stripe's hosted page. The app never sees
a card. Code: `server/growth_engine_billing.js` (`_createStripeSubscription`
builds the session, `handleWebhook` grants and revokes, `stripeLineItem` and
`stripeCustomerFor` pick the price and the customer, `portalUrl`), routes in
`server/routes/growth-engine.js` (`/billing/subscribe`, `/billing/webhook`,
`/billing/portal`), `scripts/stripe_products.js` for the catalogue.

## How a payment flows

1. Customer clicks Start on pricing. `POST /billing/subscribe` quotes the price
   (locked price for a current subscriber, founders price while spots last,
   otherwise list) and returns `checkoutUrl`. The browser goes to Stripe.
2. Stripe takes the card and sends the browser back to `#/plan-setup?checkout=success`,
   which only shows "Payment received" — the redirect proves nothing.
3. Stripe posts `checkout.session.completed` to the webhook. The signature is
   verified against `STRIPE_WEBHOOK_SECRET`, the event id is claimed once in
   `growth_engine_webhook_events`, and the tier is granted. That is the only
   place a plan turns on.
4. `invoice.payment_succeeded` renews (and is the safety net if the session
   event was missed), `customer.subscription.deleted` drops the account to free,
   `invoice.payment_failed` is logged while Stripe retries.

The 60-day one-time plan is not sold through Stripe yet; it stays on the waitlist.
"Card & receipts" on the account page opens Stripe's customer portal.

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
- Verified against the sandbox on 28 Sept: checkout sessions at the founders
  $12 and $108 using the catalogue prices, a real $12 subscription, the signed
  webhook granting the plan, a bad signature refused, a customer portal session,
  and cancel from the app recorded on the Stripe subscription.

## What is on Render right now (28 Sept, sandbox)

Set through Render's API from `server/.env`, no values typed by hand:
`STRIPE_API_KEY` (Haron's sandbox key), `STRIPE_WEBHOOK_SECRET` (from the
endpoint below), `STRIPE_PRODUCTS_JSON`, `STRIPE_PRICES_JSON`. `APP_URL` is
`https://scalecraftsocial.com`. Deploy `dep-datefsg93c1s73a9s3cg` went live and
`/billing/pricing` reports `checkout: "stripe"`, `billing_available: true`.

The webhook endpoint was created with the Stripe API in the sandbox
(`we_1UKmtRRmNl7Nhf9n2rvK4d5s`): `https://scalecraftsocial.com/api/growth-engine/v1/billing/webhook`,
events `checkout.session.completed`, `invoice.payment_succeeded`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed`. Its secret is the one on Render. Going live means
repeating exactly this in the main account: run `scripts/stripe_products.js`
with the live key, create the endpoint, replace the four values.

Not yet done: a human click-through on the live site with card 4242 4242 4242 4242
(Stripe's hosted page blocks automated card entry).

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
4. **Settings → Business**: legal name FutureEng LLC, support email
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
any CVC. You land back on the app with "Payment received"; the plan turns on
when the forwarded webhook lands. Check `#/reports`: the plan card shows the
founders price and "Card & receipts".

Then in the dashboard: cancel the subscription → the app shows the plan ending
at period end. Delete it → the plan reads as free. `stripe trigger
invoice.payment_failed` → a `payment_failed` event appears in `#/admin`.

## Promo codes

Codes in `#/admin` still work. A code with a `stripe_coupon_id` is passed to
Checkout as the coupon; a free-months code becomes a trial of that length; an
amount code changes the amount on the line. A $0 code still grants without
Checkout, as before. Stripe's own promotion-code box is shown when no app code
is applied.
