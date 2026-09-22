# Wave 5 drafts — approved and shipped 2026-09-22 (kept as the copy record)

Spec 5.1 and 5.2 both say "show me the draft before it ships". Nothing below
is live. The landing page, `index.html` meta and `#/how` are unchanged until
you say go; then it's a copy swap, no logic.

---

## 5.1 Brand stance — landing page + meta

Stance: **Stop posting into the void. Growth is a system, not luck.**

### Landing hero (replaces "Score your account. See exactly why. Get the plan.")

**H1:** Stop posting into the void.

**Sub:** Growth is a system, not luck. Scalecraft scores your account out of 100 from what you actually post, shows exactly where the points went, and writes the next 90 days — move by move, week by week.

**CTA:** Score my account — free

**Under the form:** About a minute. Public posts only. No card.

### Three proof lines (the strip under the hero)

- **Four numbers, no mystery.** Posting Consistency, Content Mix, Engagement Quality, Profile Clarity — each one shows the posts that cost you the points.
- **A plan, not a pep talk.** Thirteen moves across 90 days, written from your own feed, with the how and a paste-ready example.
- **Re-scored every week.** Do the moves, watch the number move. Your trend first; the niche second.

### Meta

- `<title>`: Scalecraft — Stop posting into the void
- `description`: Growth is a system, not luck. Score your social account out of 100, see exactly why, and get the 90-day plan written from your own posts.
- `og:title`: Stop posting into the void.
- `og:description`: Growth is a system, not luck. Your account scored out of 100, explained, with the next 90 days written for you.

### Where the stance shows up elsewhere (one line each, no rewrite)

- Pricing page lede: "Pay when the plan is worth doing." — keep.
- Report ready email subject: unchanged (it names the score).
- Share page CTA: "Score my account — free" — keep; add the sub-line "Growth is a system, not luck."
- Roast card footer: "Get roasted at scalecraft.app" — keep.

### Notes

- No claims of reach, followers or income anywhere in the copy.
- "System" is the word we own; "algorithm" never appears in our voice.
- The current H1 ("Score your account…") moves to the form's label text so nothing that ranked is lost.

---

## 5.2 Methodology page — plain language, from `growth_engine_scoring.js`

Replaces the current `#/how` copy. Everything below is what the code does today; numbers are the code's numbers.

### How the score works

Your score is the plain average of four dimensions, each 0–100. Nothing is weighted secretly at the top: if the score is 61, you can see which of the four pulled it there. Under 40 is Rookie, 40–54 Rising, 55–69 Consistent, 70–84 Established, 85+ Elite. [If we keep the Weak/Fair/Strong tags on the report as well, say so here; today the report shows both.]

The four numbers are computed by fixed rules from your public posts. The writing — the explanations, the moves, the calendar — is done by a language model that receives those numbers and your posts. It never sets or changes a number, and every fact it cites is checked against the data it was given.

### What we read

Your public profile and your most recent posts (30 on Instagram, fewer if the account has fewer; TikTok videos the same way). For each post: when it went up, its format, the caption, likes, comments and views where the platform shows them. From the profile: your bio, link, follower count and story highlights.

We can't see what the platform doesn't show a visitor: saves, reach, story views, audience demographics, or anything on a private account.

### Posting Consistency

Three parts. **Cadence** (60%): your posts per week over the window against your niche's target — full marks at the target, zero at none. **Gaps** (25%): your longest silence — full marks at or under the niche's gap limit (7 days for most creator niches), zero at four times it. **Recency** (15%): days since your last post — full marks within a week, zero past 30 days.

### Content Mix

Instagram: **Mix** (50%) — how close your share of video is to the niche target (for example 60% for travel, 90% for comedy and gaming). **Diversity** (25%) — whether you use reels, carousels and stills, or only one. **Substance** (25%) — average caption length and how many captions are just a schedule or a promo.

TikTok: **Variety** (45%) — short, standard, long and slideshow videos in use. **Original sound** (20%). **Substance** (35%) — captions that say something.

### Engagement Quality

Instagram: **Rate** (60%) — likes plus comments per post against your follower count, against the niche target (roughly 2–4% depending on niche). **Conversation** (25%) — the share of interactions that are comments rather than likes. **Reach** (15%) — video views per post relative to your followers; neutral if you post no video.

TikTok: **Reach** (40%) — plays per video relative to followers. **Keeping** (35%) — shares and saves as a share of views. **Conversation** (25%) — comment share.

### Profile Clarity

For creators, five checks with fixed points: a bio that says what you're about (25), a link (20), a link that goes somewhere worth going — a channel, a shop, a newsletter, a booking page (25), a next step in the bio (15), story highlights (15; not counted on TikTok). For businesses the checks are location, price or offer, a next step, a link, a booking link and highlights.

### Niche targets and the niche average

Each niche has a target set — posts per week, video share, engagement rate — that the dimensions score against. Those targets are working assumptions until enough accounts are scored to measure them. Separately, the **niche average marker** on your report is measured: it's the average score of accounts we've scored in your niche, shown once the niche has at least **10** scored accounts. Below that the report says the average is pending and scores you against the general creator target. The same rule gates "what's working in your niche" and the public benchmarks.

[Note: the current `#/how` page says 20 accounts; the code's `BASELINE_MIN_N` is 10. This draft uses 10. Say if you want the gate raised instead.]

### What the score is not

It isn't a prediction of reach, followers or income. It's a measurement of habits the platforms reward, from what a stranger can see, plus the plan to change them. A high score with a bad product won't sell; a low score with a good one leaves growth on the table.

### Percentile and history

"Scores higher than X% of {niche} accounts" compares your score with every account we've scored in that niche (same 10-account gate). Your history line compares you with you.

---

Reply with edits or "ship both" and I'll swap the copy in — landing, meta and `#/how` — in one commit.
