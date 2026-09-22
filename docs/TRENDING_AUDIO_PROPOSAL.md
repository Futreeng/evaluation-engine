# Trending audio for the weekly brief — proposal (not built)

Spec 3.4 asks for a proposal, with cost, for an external source of trending
audio to sit alongside the brief we build from our own data. This is that
proposal. Nothing here is wired in; the brief today is 100% our own data.

## What we'd add

One line per niche per week in "What's working in {niche}": the two or three
sounds that top posts in the niche used most in the last 7 days, with the
sound name, artist, how many of the top posts used it, and a link to the
sound page so the creator can tap "Use audio". Never a recommendation to use
copyrighted music on a business account — the line carries the platform's
own commercial-use flag when the source exposes it.

## Where the data can come from

| Source | What it gives | Cost | Notes |
|---|---|---|---|
| **Our own scrape (extend what we already run)** | `musicInfo` on every Instagram reel and the `music` object on every TikTok video are already in the Apify results we pay for; we drop them today. | **$0 extra** — the rows are already fetched. | Only sees audio on the accounts we score, so a niche needs the same `BASELINE_MIN_N` gate. Sound name + artist + `original_sound` flag; no play counts. Recommended first step. |
| **TikTok Creative Center (Trending Sounds)** | Ranked trending sounds by country and period, with rank change and a 7-day trend curve. Public web page; an Apify actor ("tiktok-trending-sounds" type scrapers) turns it into rows. | About **$1–3 per run** on Apify (one run per region per week → ~$5–15/month for 3 regions). | Not niche-specific — it's global/regional. Useful as a "rising this week" line, not a per-niche fact. Terms: scraping a public page; no official API for this endpoint. |
| **TikTok Research API** | Official; video + music objects, hashtag/keyword queries. | Free for approved academic/non-profit researchers only. | Not available to a commercial product. Listed so nobody re-investigates it. |
| **Instagram Graph API — Reels audio** | Official `music` metadata on reels of connected accounts. | Free with the Meta app we already have. | Only for accounts that connect via OAuth (Joe's item 4 in the handoff). Same coverage limit as the Graph fetcher: owner-connected accounts only. |
| **Third-party trend services** (Tokboard, Trendpop, Kalodata) | Curated trending sounds by category, dashboards, some with APIs. | **$50–$300/month** depending on tier; APIs usually enterprise-only. | Fastest to ship a "trending now" line, least defensible (their data, their categories, their outage). |

## Recommendation

1. **Phase A (free, ~1 day):** keep `musicInfo` / `music` from the scrape we
   already run, store `{ sound_id, title, artist, original }` per post, and
   let `growth_engine_briefs.js` add one line: *"Among top {niche} posts this
   week, 31% used a trending sound; the two most used were X and Y."* Same
   min-n gate, same anonymisation (sound names are public, handles never).
2. **Phase B (~$10/month):** one weekly Apify run of the TikTok Creative
   Center trending list per main market (US, UK, one more), stored in a
   small table, shown as a separate *"Rising this week on TikTok"* line and
   only on TikTok reports. Budget it under the existing cost table
   (`growth_engine_costs.js`, feature `brief_audio`).
3. **Skip** the paid trend services until a customer asks for audio by name.

## Guardrails

- Sounds are shown as facts about the niche, never as a promise ("this sound
  will get you reach").
- Business accounts (`is_business`) only get sounds flagged commercial-safe;
  otherwise the line is dropped for them.
- Every audio line is dated (week key) like the rest of the brief, and cached
  the same way, so the app and the email never disagree.
