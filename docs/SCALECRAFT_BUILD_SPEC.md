# Scalecraft — Complete Build Spec

Creators first; businesses are phase 2.

## Context

Scalecraft is our social account evaluator. The front end is app.js, mock-api.js, config.js and styles.css. The backend is server/routes/growth-engine.js (Growth Engine API, hosted on Railway, with a Vercel copy calling it). mock-api.js mirrors the real routes so app.js needs no branches. Keep it that way: every new route gets a matching mock.

## Working rules

- Read the backend and front end first and give me a plan before writing code.
- Build in wave order, one item at a time, on a feature branch, never main.
- After each item, summarize what changed, how to test it, and anything I need to decide.
- Don't invent data. Every claim, roast line, card and email must be backed by real account data.
- Put all names, thresholds, prices and copy that might change in config, not hardcoded.
- Every feature logs its scraping and LLM costs (item 1.2) and its funnel events (item 1.13).

## Decisions already made

- Level names are neutral for now and live in config so they can be renamed later.
- Scrape the last 30–50 posts per account.
- Email goes through Resend, behind a provider interface so it can be swapped later. No push notifications yet.
- The pre-post check is NOT in this build.
- Joe is building a separate Next.js marketing site with the free tools and benchmark pages. We only build the data endpoint and attribution his site needs (item 5.4).

---

## Wave 1 — Go live and core product

### 1.1 Go live on real data

Set useMock to false by default in production. Keep mock mode available in dev with a ?mock=1 query param. Run the full flow end to end against the Railway backend: evaluate, poll, report, signup, pricing, subscribe. List every place where the real API response shape differs from the mock, then fix both sides to match.

### 1.2 Cost tracking

Log the scraping cost and LLM token usage per report, per rescore, per post-writing run, and per every later feature that calls either. Add an admin dashboard showing cost per user alongside revenue per user.

### 1.3 Deeper scrape

Scrape the last 30–50 posts, configurable. Store per post: posted date and time, type (image, carousel, video), caption, likes, comments, saves and views where available.

### 1.4 Evidence on every claim, with thumbnails

- For each dimension, the backend returns an evidence array of post IDs, and for each one the stored thumbnail URL, permalink, post type, posted date, and the metric that supports the claim.
- The LLM prompt that writes explanations may only reference posts and numbers passed to it. Add a validation step that rejects or rewrites any explanation citing a stat that isn't in the input data.
- Only posts the explanation actually refers to go in its evidence array.

Thumbnail storage:

- Instagram and TikTok thumbnail URLs from the scraper are signed and expire, and often block hotlinking. Never store or render those URLs directly.
- At scrape time, download the thumbnail for each scraped post, resize to 320px wide, convert to WebP at about 75 quality, and upload to our own storage (Vercel Blob, S3 or R2; use what's already in the stack, or propose one).
- Download in parallel with a timeout per image. If a download fails, save the post without a thumbnail. Never fail the report because of an image.

Thumbnail UI:

- A row of 1 to 3 square thumbnails under each explanation, about 72px on mobile, with rounded corners.
- A small label on each with the supporting metric ("41 saves", "2.1k views") and a video icon for videos.
- Tapping opens the permalink in a new tab.
- If a thumbnail is missing, show a neutral tile with the post type icon and date, still linking to the post.
- Lazy load, set width and height to avoid layout shift, and use the first caption words as alt text.
- Add matching evidence data with placeholder tiles to mock-api.js.

Thumbnail privacy and cleanup:

- Thumbnails appear only in the report view, never on share pages or cards.
- Delete a user's stored thumbnails when their account is deleted.
- A cleanup job removes thumbnails for free reports older than 90 days.

### 1.5 Close the free-limit loophole

Enforce one free Snapshot per handle AND per email on the backend, plus a basic per-IP rate limit. Return the existing FREE_LIMIT_REACHED 402 shape so the front end keeps working.

### 1.6 Email foundation (Resend)

- Build an email service module with one interface (send, templates, logging) so the provider can be changed later without touching features. Resend is the first implementation, using the RESEND_API_KEY env var.
- Document the domain verification steps (SPF, DKIM) I need to complete.
- Every email gets an unsubscribe link and a physical address footer, to comply with CAN-SPAM.
- Add email preferences to the account page: weekly score, Monday move, milestones, product news, each toggleable.
- Log every send with type, user, status and Resend message ID.

### 1.7 Card engine and score card

- One server-side system that renders every shareable card as PNG at 1080x1920 (Stories/TikTok) and 1080x1080 (feed). Later waves use it for roast cards, rank-ups, personal records, milestones and badges.
- The first card is the score card: handle, overall score, niche average, the four dimension scores, and "Score yours at [url]".
- Add a Share button on the report with download and native share on mobile.
- Each card gets a public share page at /s/:shareId with Open Graph image tags, showing only the card and a "Score my account" button. Never show the full report or post thumbnails publicly.

### 1.8 Referral tracking

Every share link and card URL carries a ref code tied to the user. Store the ref on first visit, and attribute it on signup and on paid subscription. Add a simple "your referrals" count to the account page. Build the data model to support affiliate payouts later, but don't build payouts.

### 1.9 Signup questions for phase 2

At signup and on the evaluate form, ask "Is this a business account?" (yes/no) and confirm the niche. Store both. Add an admin-only export of business-flagged accounts for the phase 2 waitlist.

### 1.10 Best time to post

From the user's own posts, find which days and hours perform best, per platform, relative to their own average. Show the 2–3 recommended posting windows in the report with a plain explanation ("Your Wednesday 7am posts average 2x your usual saves"). If there isn't enough data for a confident answer, say so and show a sensible default, clearly labeled as a starting point.

### 1.11 Weekly rescore loop

- A scheduled job rescores every paid account weekly, and score history is stored.
- The user gets an email through the email service when their score changes, with the change and the top reason.
- In the app, show a score history chart and the user's percentile rank within their niche, only once the niche has enough accounts (reuse the existing min_n logic).

### 1.12 Post writing (paid plan)

Paid users get a "Your next posts" section with the next 6 posts, generated from their own best-performing posts and their current plan phase. Each post includes a hook, caption, a short video script or shot idea, and a suggested posting day and time taken from item 1.10. Add a regenerate button per post and copy buttons for each field. Scripts are plain wrapped text, no code formatting.

### 1.13 Funnel analytics

Track these events with account and ref attribution:

- evaluate started
- evaluate completed
- report viewed
- share clicked
- card downloaded
- share page visited
- signup
- pricing viewed
- subscribe
- cancel

Every later feature adds its own events. Add an admin dashboard showing conversion between each step and month-two retention for paid users.

### 1.14 Pricing control

Move all tier prices and features to backend config (the front end already reads /billing/pricing). Add support for price A/B tests: assign a variant per visitor, persist it, and report conversion by variant.

### 1.15 Outcomes data

Every time a move is marked done, log it with a timestamp. Store score changes after each rescore alongside it, so we can later measure which moves raise scores in which niche. No UI yet, just clean, queryable tables.

---

## Wave 2 — Roast and launch gamification

Gamification rule: nothing gamey appears until the user has done something to earn it. Day one is just the score and the plan.

### 2.1 Roast my account

- An opt-in mode on the report. The normal report stays the default.
- Same data and evidence as the report, written in a funny, brutally honest voice. Every joke must be tied to a real fact from the account's data.
- Heat levels: Mild, Medium, Extra Crispy, picked by the user before the reveal.
- Every roast ends with "Okay, here's how we fix it" and the first move from their plan.
- Roast card through the card engine with the top two lines, the score and "Get roasted at [url]". Keep the reveal easy to screen-record.
- Free for everyone, as a top-of-funnel feature.
- Re-roast offered after 30 days, comparing then and now.

Roast guardrails (required):

- Roast the content, never the person. No jokes about appearance, body, weight, race, ethnicity, gender, sexuality, age, religion or disability, even if the user asks.
- Only the user's own scored account can be roasted. No roasting other handles.
- If the bio or profile suggests the account holder is under 18, skip roast mode and show the normal report only.
- Run every roast through a second check that rejects identity or appearance jokes. If it fails, regenerate once, then fall back to the normal report.
- Log every rejected roast for review.

### 2.2 Levels

Map the score to ranks in config: Rookie 0–39, Rising 40–54, Consistent 55–69, Established 70–84, Elite 85–100. Show the rank next to the score. On a rank-up after a rescore, show a rank-up moment and card, and send an email if the user has milestone emails on.

### 2.3 Weekly streak with freezes

Paid users only, since it needs weekly data. An on-plan week means the user posted on at least their planned number of days, measured at the rescore. The streak stays hidden until the first on-plan week. Users start with one freeze, which covers one missed week automatically, and earn another every 4-week streak, holding a maximum of 2. No punishing language when a streak ends.

### 2.4 Personal records

When a new post beats the user's best-performing post on their main metric, show a "New personal record" moment and card and send the milestone email. Hidden until it first happens.

### 2.5 Milestone cards

Through the card engine: first 1k followers, score over 70, 4-week streak. Thresholds live in config.

### 2.6 Monday move

Every Monday morning in the user's time zone, email one action from their plan that takes under 15 minutes, with a one-tap "Mark done" link. Paid users get their next plan move. Free users get their one free move, then an upgrade prompt. Completing it updates move completion and logs to the outcomes data (1.15).

---

## Wave 3 — Weekly loop

### 3.1 48-hour post review (paid only)

Detect new posts during scheduled checks every 2–3 days (configurable) for paid accounts. About 48 hours after a post goes live, compare it to the user's own average and write a short review: how it performed, the likely reason (hook, format, timing), and what to repeat or change. Deliver it in the app, and by email if enabled.

### 3.2 Personal trend first

Across the report and dashboard, lead with the user's own trend ("Up 12 points since March") and show the niche comparison second.

### 3.3 Goal onboarding

Right after the user sees their first report, not before, ask for their goal: grow to a follower target, land brand deals, sell a product or service, or just grow consistently. Store it. The plan, Monday moves and post writing are tuned to the goal, and a progress bar toward it appears on the dashboard. The goal can be changed anytime in settings.

### 3.4 Weekly trend brief

A weekly "What's working in [niche]" section in the app and in the weekly email. Source it first from our own data: the formats, hook styles and posting patterns of top-performing posts across scored accounts in that niche, aggregated and anonymized, never naming or showing other users' accounts. Only publish it for a niche once it has enough accounts, reusing the min_n logic. Propose, but don't build, an external source for trending audio, with its cost.

---

## Wave 4 — Retention and flagged features

### 4.1 Pause instead of cancel

When a user starts to cancel, offer a 1–3 month pause first, using Stripe's pause collection. Their history and streak are kept, and the streak is frozen during the pause.

### 4.2 Maintenance tier

A $5/month tier (price in config): weekly rescore and score history only, no post writing or full plan. Offer it on the cancel flow.

### 4.3 Cancel screen

Before confirming a cancellation, show what they'd lose: score history, current streak, and their written next posts. Ask one optional exit question with fixed reasons plus "other", and store the answer.

### 4.4 Win-back emails

At 30 and 60 days after cancellation, rescore the account once and email the result: "Your score went from X to Y since you left. Here's what changed," with a resubscribe link. If the score went up, congratulate them instead. Only if they're opted in to product emails.

### 4.5 Annual plan offer

After a paid user's first score increase, show and email an annual plan offer. Pricing comes from /billing/pricing.

### 4.6 Badges (behind a feature flag, off by default)

Badges for real milestones: first 1k, first post at 3x their average, 12-week streak, a dimension scored 90+. They use the card engine. The badge list lives in config.

### 4.7 Quests (behind a feature flag, off by default)

Extend the Monday move into short, trackable quests with a clear finish, like "Post 3 coach-on-camera videos this week." Progress is checked from rescore data. Not a separate system.

---

## Wave 5 — Brand, methodology, data

### 5.1 Brand stance

Update the landing page and meta copy around "Stop posting into the void. Growth is a system, not luck." Draft the copy and show it to me before it ships.

### 5.2 Methodology page

A plain-language page explaining how the score works, written from what growth-engine.js actually does: the four dimensions, what data we read, how niche averages work, and the minimum sample rule. No overclaiming. Show me the draft before it ships.

### 5.3 State of Small Creators (template only)

Build an admin export of aggregated, anonymized niche stats: score distributions, posting frequency, format mix and engagement by niche. Add a report template that fills in from it. Don't publish anything yet; we'll launch it once there's enough data.

### 5.4 Support for Joe's marketing site

- A public, read-only endpoint serving aggregated benchmark data per niche, only for niches that meet min_n. No individual account data.
- Attribution: accept UTM parameters and a source tag from the marketing site, store them on first visit, and attribute signups and subscriptions the same way as ref codes.
- Document both for Joe.

---

## Earmarked — do not build

Keep the architecture open for these:

- Pre-post check
- Growth sprints
- Live audit stream
- Weekly leagues
- XP
- Predict your post
- Squads
- Transit-themed level names
- Founder story content
- Accuracy study
- The content series
- Affiliate payouts
- Community outreach
- Official Meta and TikTok connection
- Post scheduling
- Creator score marketplace
- White-label reports
- Partner embeds
- Business tiers

---

Start with your plan for Wave 1.
