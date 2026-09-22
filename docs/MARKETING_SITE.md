# For the marketing site (spec 5.4)

Two things the marketing site can use today: a public benchmark feed per
niche, and attribution that survives from a marketing-page visit to a signup
and a subscription. Both live on the app backend (Render); nothing needs a key.

## 1. Public benchmarks

```
GET https://scalecraft.onrender.com/api/growth-engine/v1/benchmarks/{niche}?platform=instagram
```

- `niche` is one of the category keys the app uses: `fitness_creator`,
  `food_cooking`, `fashion`, `beauty_skincare`, `travel`,
  `comedy_entertainment`, `education_howto`, `lifestyle_vlog`, `music`,
  `gaming`, `tech_gadgets`, `finance_business`, `parenting_family`,
  `art_design`, `sports`, `pets`, `other`. `platform` is `instagram` (default) or `tiktok`.
- CORS is open (`access-control-allow-origin: *`), cached one hour.
- **Only aggregates, only niches with at least `BASELINE_MIN_N` (10) scored
  accounts.** Below the gate you get `{ ready: false, n, min_n }` — render
  nothing, or "coming soon". Never a handle, a post, or anything per account.

Ready shape:

```json
{
  "category": "travel", "platform": "instagram", "n": 142, "min_n": 10,
  "window_days": 180, "generated_at": 1790000000000,
  "score": { "mean": 58.4, "median": 59, "p25": 47, "p75": 70,
             "bands": { "0-39": 14, "40-54": 27, "55-69": 33, "70-84": 21, "85-100": 5 } },
  "dimensions": { "Posting Consistency": 52.1, "Content Mix": 63.8, "Engagement Quality": 55.2, "Profile Clarity": 62.5 },
  "posting": { "posts_per_week_median": 2.8, "posts_per_week_p75": 4.5, "video_share_median": 64 },
  "formats": { "reel": 61, "carousel": 27, "image": 12 },
  "engagement": { "rate_median_pct": 2.1, "rate_p75_pct": 4.3 },
  "audience": { "followers_median": 3400, "followers_p25": 900, "followers_p75": 12800 }
}
```

`bands` are percentages of accounts. Engagement rate is likes + comments per
post ÷ followers, on the posts we read (last 30). The same data feeds the
weekly "What's working in {niche}" brief in the app
(`GET /briefs/{niche}?platform=`), which is also public and adds formats,
opener styles and days that beat the account's own average.

Suggested use: a "Where do {niche} accounts stand?" block with the median
score, the band bar and the top-quartile cadence, and the CTA into the app.

## 2. Attribution from the marketing site

Link into the app with UTM parameters and/or a `src` tag:

```
https://scalecraft.app/?utm_source=marketing&utm_medium=blog&utm_campaign=state-of-creators&src=joe-site
https://scalecraft.app/?src=joe-site#/pricing
```

What happens:

- The app stores `utm_source / utm_medium / utm_campaign / utm_content / utm_term`
  and `src` on the **first** visit (localStorage `sc_utm`, never overwritten),
  and sends them on every API call as an `x-utm` header — the same mechanism
  as `?ref=` referral codes.
- Every funnel event the visitor triggers (`evaluate_started`, `signup`,
  `subscribe`, `unlock`, …) carries `props.utm`.
- At signup the source is stamped on the account (`users.utm`) once.
- Admin view: `GET /admin/sources` (admin token or admin login) → signups and
  paid accounts per source/campaign. It's on `#/admin` under Sources.

Rules: only those six keys are read, each capped at 80 characters, the header
at 600. Anything else on the URL is ignored. Referral codes (`?ref=`) and UTM
coexist — a referred visitor from the blog is credited to both.

## Not exposed on purpose

- Anything per account, per handle or per post.
- Niches below the gate.
- Raw report bodies. The admin export for the *State of Small Creators*
  report (`/admin/state-of-creators`) is admin-only and also aggregate-only.
