# Where Scalecraft stands — 27 Sep 2026

Written for Haron. Plain language on the backend parts; the sections marked **yours** are the
ones that need you specifically.

---

## The short version

Scalecraft generates reports and now emails them to users. That works end to end, confirmed on
production tonight with a real report and a real inbox.

It cannot take money. Not "the payment page needs polish" — no payment code was ever written.
That's the one thing standing between this and being a business.

---

## What works

**Reports.** A user submits a handle, the engine scores it and writes a 30-60-90 plan. Confirmed
working on production.

**Email.** Live as of tonight. Sending from `hello@send.futreeng.com` through Resend. Report-ready
emails deliver to real inboxes. Templates are built in the Field Guide identity and carry an
unsubscribe link, a postal address and a support address, which keeps us on the right side of
CAN-SPAM.

Thanks for doing the DNS — that was the piece blocking everything else.

**Analytics.** Funnel events are recorded. One bug fixed tonight: the Path screen was firing an
event the server rejected, so every Path view was being thrown away. Any Path numbers from before
today are missing, not zero.

---

## What doesn't work

### Payments — the big one

The subscribe flow was running in "mock mode" on production. Mock mode hands out a paid Growth
Plan and takes no money. Anyone who found the flow got the product free, and our analytics
recorded it as a real sale — so any conversion numbers you've seen are wrong.

That hole is closed now: the server refuses paid flows instead of giving the product away.

But closing it isn't the same as fixing it. The code that would actually charge a card is an
empty stub — it was never built. **Scalecraft cannot accept a payment today.** Building it is
backend work (Stripe, webhooks, making sure nobody gets double-charged or charged without
getting a report) and it sits with Joe.

**Yours:** the checkout and pricing UI. Right now the pricing page still offers a plan the server
will decline, so a visitor hits a dead end with an unhelpful error. That needs a real state —
either an honest "not open yet / join the waitlist," or a proper checkout once the backend
exists. Worth deciding which, because it changes what you build.

### The server falls asleep

We're on Render's free plan. The service sleeps after about 15 minutes with no traffic, and
because reports are generated inside that same process, **a report can die halfway through with
no error and no email.** The user waits for something that never arrives.

This is a paid upgrade and Joe's call. Flagging it because it looks exactly like a product bug
from the outside, and it's the kind of thing a tester would report as "it just hung."

---

## What we'd want before showing this to anyone paying

- Payments actually built
- The server on a plan that doesn't sleep
- A real state for the pricing page (**yours**)
- Someone outside the two of us using it and telling us it helped

---

## Needs you

1. **Pricing/checkout UI** — see above. The most useful thing you could pick up next.
2. **Email templates** — they're live and going to real inboxes. If the design isn't what you
   want, now is cheap; after they're in people's inboxes it isn't. They're in `server/emails/`,
   and Joe can send you a real one to look at.
3. **The from-address.** Mail shows as "Scalecraft" from `hello@send.futreeng.com`. Nobody reads
   replies there — replies bounce. Support goes to `hello@futreeng.com`. Say if you'd rather
   that was different; it's a one-line change now and a mess later.

---

## Things worth knowing

**Don't change `JWT_SECRET` in Render.** It signs the unsubscribe links. Changing it breaks the
unsubscribe button in every email already sent, which is a legal problem, not a broken link.

**Env var changes need a redeploy.** Saving a value in Render doesn't affect the running server
until it redeploys. This cost us an hour tonight.

**Deploys are manual.** Merging a PR doesn't ship it. Someone has to press Deploy.

**`main` had a failing test** before tonight's work. Worth someone looking at — a test suite
people ignore stops being a test suite.

---

## Where to look

| What | Where |
|---|---|
| Email setup, and what to do when it breaks | `docs/EMAIL_SETUP.md` |
| Email templates | `server/emails/` |
| What shipped tonight | PR #17 |
| Render dashboard | service is named `scalecraft` |
