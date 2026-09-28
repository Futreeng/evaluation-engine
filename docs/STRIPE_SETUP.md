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
5. **Products** (optional). Checkout carries the amount itself, so nothing
   needs to exist in the catalogue. If you'd rather see named products in
   reports, create them and put the ids in `STRIPE_PRODUCTS_JSON`; to bill from
   dashboard Prices instead, put the ids in `STRIPE_PRICES_JSON` (a price is
   used only when its amount matches the app's quote, so founders $12/$108 and
   Growth $19/$190 each need their own). Formats in `server/.env.example`.
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
