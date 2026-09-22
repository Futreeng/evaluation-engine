# The State of Small Creators — {{DATE}}

*Template. Filled by `server/scripts/state_of_creators.js` from the admin export at `/admin/state-of-creators`. Nothing here is published until Haron says so; niches appear only once they have {{MIN_N}} scored accounts, and every number is an aggregate — no account, handle or post is ever shown.*

## In one line

Across {{NICHES_READY}} niches, {{ACCOUNTS_TOTAL}} accounts and {{POSTS_TOTAL}} posts scored in the last {{WINDOW_DAYS}} days, the median Scalecraft score is **{{OVERALL_MEDIAN}}** out of 100.

## By niche

| Niche | Accounts | Median score | Middle half | Posts / week (median) | Video share | Engagement rate (median) |
|---|---:|---:|---:|---:|---:|---:|
{{TABLE_NICHES}}

*Middle half = 25th to 75th percentile. Engagement rate = likes + comments per post ÷ followers, on the posts we read.*

## Where accounts sit

Share of accounts in each score band, by niche.

| Niche | Rookie 0–39 | Rising 40–54 | Consistent 55–69 | Established 70–84 | Elite 85–100 |
|---|---:|---:|---:|---:|---:|
{{TABLE_BANDS}}

## The four dimensions

Average dimension score by niche.

| Niche | Posting Consistency | Content Mix | Engagement Quality | Profile Clarity |
|---|---:|---:|---:|---:|
{{TABLE_DIMS}}

### The weakest dimension in each niche

{{WEAKEST_DIMS}}

## What gets posted

Share of posts by format, by niche.

| Niche | Reels | Carousels | Stills |
|---|---:|---:|---:|
{{TABLE_FORMATS}}

## Method, in short

- Scores are deterministic (see *How the score works*): four dimensions, fixed rules, the same account on the same day gets the same number.
- One row per account: the latest report in the window. Free and paid reports count the same.
- A niche is reported once it has at least {{MIN_N}} scored accounts. Not yet there: {{PENDING}}.
- We read public posts only. No saves, reach or story views; no private accounts.

## Not in this edition

[Add: a trend section once two editions exist — median score movement per niche, format share movement. The export carries `generated_at`; keep each edition's JSON to diff.]

---
*Scalecraft · scalecraft.app · aggregated and anonymised · {{DATE}}*
