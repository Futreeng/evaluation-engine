# Official Instagram & TikTok Access: Build Spec

Replaces Apify scraping with the platforms' official APIs. Supersedes the "Official Instagram and TikTok access" section of `HANDOFF_JOE.md`, which has a conflict (see Decision 1).

Status: draft, 2026-09-29. Owners: Joe (Meta/TikTok apps, backend), Haron (connect screens, copy).

---

## Problem

Every report is built from data Apify scrapes from Instagram and TikTok. Both platforms' terms forbid automated collection without written permission. TikTok's terms (updated 15 Jul 2026) say so directly, and Meta's reportedly now cover logged-out scraping too. We carry that risk (Apify's terms put the legality of collected data on the customer). The realistic consequences are a cease-and-desist, blocked scrapers breaking the product overnight, or bans on our own platform accounts.

The official APIs remove that risk for any account whose owner connects it. They also return data scraping can't: reach, saves, shares and real view counts for the creator's own posts. The "What we cannot see" box on How it works exists because we don't have that data today.

## Goals

1. **Paid reports stop depending on scraping.** 100% of paid-tier profile pulls come from an official API before scraping is switched off for paid users.
2. **Connected creators get better data.** Reach, saves and shares for their own posts feed the score and plan (Phase 3).
3. **Competitors work without scraping on Instagram**, via Business Discovery.
4. **We meet the platforms' data rules**: Meta's deletion callback and Data Use Checkup, and deletion on TikTok revoke.
5. **The free Snapshot keeps converting.** Guardrail: free Snapshot completions per week fall by no more than 30% after the switch (proposed threshold; Joe to confirm).

## Non-goals

- **Personal (non-professional) Instagram accounts.** No official API covers them since Basic Display shut down on 4 Dec 2024. They get a "switch to a free Creator account" guide instead.
- **TikTok competitors and TikTok niche baselines.** There's no commercial API for other accounts' TikTok data. The Research API is non-commercial only, and Creator Marketplace is partner-only. See Open Question 3.
- **Posting to either platform.** Read-only scopes only.
- **Story views and audience demographics.** Available as insights, but they're a separate scoring project. Parked for P2.
- **A mobile app.** "App" here means a registered developer integration.

---

## Decisions

### Decision 1: Instagram uses Facebook Login, not Instagram Login

The handoff picked "Instagram API with Instagram Login" because it doesn't need a Facebook Page. It can't do what the rest of the handoff asks for:

| | Instagram Login | Facebook Login |
|---|---|---|
| Needs a Facebook Page linked to the IG account | No | **Yes** (friction) |
| Business Discovery (competitors, lookups by handle) | **No** | Yes |
| `caption` field on media | **No** ("Facebook Login only" per the IG Media reference) | Yes |
| `media_product_type` (tells a Reel from a video) | **No** | Yes |
| Can one app use both | No, one login type per app | |

Without captions and the Reel flag, Content Mix can't be scored. Without Business Discovery there are no competitors and no anonymous Instagram Snapshot. **So: Facebook Login.** The cost is that a creator needs a Facebook Page linked to their Instagram account. We ship a short "link a Page" guide in the connect flow and measure the drop-off (`connect_failed{reason:"no_page"}`).

Verify before building (Phase 0, one day): in Graph API Explorer, call `/me/media?fields=caption,media_product_type` with an Instagram Login token and a Facebook Login token. If Instagram Login does return captions, revisit. Two separate Meta apps, one per login type, is a possible workaround (Open Question 2).

Sources: [IG platform overview](https://developers.facebook.com/docs/instagram-platform/overview), [IG Media reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media), [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/), [App Review](https://developers.facebook.com/docs/instagram-platform/app-review).

### Decision 2: which source serves which request

Each profile pull picks a source in this order and records the one it used on the report (`report.source`):

| Request | 1st choice | 2nd choice | Last resort |
|---|---|---|---|
| Paid report, own account | Connected token (full data + insights) | Business Discovery, if IG | Scrape, if `SCRAPE_FALLBACK` allows it, else ask the user to reconnect |
| Free Snapshot, Instagram | Connected token, if they connected | Business Discovery using **our** discovery account (professional accounts only) | Scrape, if allowed, else "connect your account" |
| Free Snapshot, TikTok | Connected token (TikTok login is required) | none | Scrape, if allowed, else "connect your TikTok" |
| Competitors, Instagram | Business Discovery | none | Scrape, if allowed |
| Competitors, TikTok | not offered (Non-goal) | | |
| Seed baselines | Business Discovery (IG) | none | Scrape, if allowed |

`SCRAPE_FALLBACK` is an env var: `all` (today's behaviour), `free` (free Snapshot only), `off`. **The lawyer's answer sets its value, not this spec.** Launch with `all`, move to `free` when Phase 2 ships, and to `off` if counsel advises it.

Whether Meta allows Business Discovery lookups through our own account on behalf of anonymous visitors is untested. It's the core of the IG free Snapshot, so the App Review screencast must show it explicitly (Open Question 1).

---

## Fix first (bugs found while mapping, independent of this build)

1. **`server/growth_engine_evaluator.js:748`** reads `realData.analysis.profile_clarity`, but the formatted object has `metrics`, not `analysis`. So `highlight_count` and `pinned_posts` are always 0. Path verification then marks the bio-link move as always done and the pin and highlight moves as never done. The no-link fallback string "empty (no link in bio)" (line 285) also counts as a link.
2. **`server/instagram_fetcher.js`** (the Graph API path used when `APIFY_TOKEN` is unset) ignores the submitted handle and always scores the `INSTAGRAM_BUSINESS_ACCOUNT_ID` account. It calls `ig_hashtag_search` as a health check, requests the removed `impressions` metric, and `calculateMetrics` (lines 105–198) double-counts engagement. Delete it in Phase 1. Until then it must never run in production.

---

## User stories

**Creator on a paid plan**
- As a creator, I want to connect my Instagram in a few taps so that my plan uses my real reach and saves, not just what a stranger can see.
- As a creator whose Instagram isn't linked to a Facebook Page, I want clear steps to link one (or to switch to a Creator account) so that I'm not stuck at an error.
- As a creator, I want to disconnect Instagram or TikTok at any time and choose whether the data from it is deleted.
- As a creator whose connection expired, I want the weekly email and the app to tell me to reconnect so that my weekly rescore doesn't silently stop.

**First-time visitor (free Snapshot)**
- As a visitor with a professional Instagram account, I want to type my handle and get a free score without logging in anywhere.
- As a visitor with a TikTok account, I want to connect TikTok and get my free score.
- As a visitor with a personal Instagram account, I want to be told plainly why it can't be scored and how to switch for free.

**Account holder who isn't a user**
- As someone whose public Instagram was scored as a competitor, I want my data deleted on request (already promised in the Privacy Policy).

**Us**
- As the operator, I want each report to record which source built it so that we can prove paid reports no longer use scraping.

---

## Requirements

### P0: Phase 1, connections and own-account data

**P0.1 Connections table.** New table `growth_engine_connections`, in both `growth_engine_db_postgres.js` and `growth_engine_db.js`:

`id, account_id, platform, platform_user_id, username, scopes, access_token_enc, refresh_token_enc, token_expires_at, refresh_expires_at, status (active|expired|revoked|error), last_error, connected_at, last_refreshed_at, meta (JSON: page_id, ig_user_id…)`

- Tokens are encrypted with `server/crypto.js` (`encrypt`/`decrypt`, AES-256-GCM, key from `ENCRYPTION_KEY`) and never returned to the browser.
- Unique on `(platform, platform_user_id)` among active rows: one IG or TikTok account per Scalecraft account.
- [ ] Given a second Scalecraft account connects an IG account already connected elsewhere, then it gets a clear "already connected to another account" error and no row changes.

**P0.2 OAuth routes** in `server/routes/growth-engine.js`, each with a matching mock in `public/mock-api.js` (repo rule):
- `GET /connect/:platform/start`: signed in only. Builds the auth URL with a signed, single-use `state` (HMAC with `JWT_SECRET`, holding the account id, a nonce and a 10-minute expiry) and redirects.
- `GET /connect/:platform/callback`: checks `state`, exchanges `code`, stores the connection, pulls the profile once, then redirects to `#/connect/done?platform=…`.
  - Instagram (Facebook Login) scopes: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_manage_insights`. Add `business_management` only if testing shows it's needed.
  - TikTok scopes: `user.info.basic`, `user.info.profile` (bio and link), `user.info.stats`, `video.list`.
- `GET /account/connections`: platform, username, status and expiry only.
- `DELETE /account/connections/:platform?delete_data=1`: revokes the token (TikTok `POST /v2/oauth/revoke/`; Meta: delete the permission) and deletes the row. With `delete_data=1` it also deletes the reports and cache rows built from that connection.
- [ ] Given a tampered or expired `state`, the callback refuses it and stores nothing.
- [ ] Given the user denies permissions on the platform screen, they land back on the connect screen with "No problem, you can connect any time."
- [ ] Given a connected IG account isn't professional or has no linked Page, the callback returns a specific error code and the guide opens.

**P0.3 Meta data-deletion callback.** `POST /meta/data-deletion` verifies Meta's `signed_request` (HMAC-SHA256 with `META_APP_SECRET`), deletes that user's connection and the data built from it, and returns `{ url, confirmation_code }`. `GET /meta/deletion-status/:code` shows the status page. Required before App Review. ([Meta doc](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback))
- [ ] A request with a bad signature returns 400 and deletes nothing.

**P0.4 Own-account fetchers.** New `server/fetchers/instagram_graph.js` and `server/fetchers/tiktok_display.js`. Both must return exactly the shape the Apify fetchers return today (`instagram_apify_fetcher.js:203–216`, `tiktok_apify_fetcher.js:167–181`), including `analysis.posting_frequency`, `engagement`, `content` and `profile_clarity`. Otherwise `scoreProfile` returns null (`growth_engine_scoring.js:206–207`).
- **Instagram:**
  - `/{ig-user-id}?fields=biography,followers_count,follows_count,media_count,username,website,name`
  - `/{ig-user-id}/media?fields=id,timestamp,media_type,media_product_type,caption,like_count,comments_count,permalink,media_url,thumbnail_url`, paging until 30 posts
  - Per-media insights `views,reach,saved,shares` go into new fields. They are Phase 3 inputs and must not change scores in Phase 1.
  - `is_reel` = `media_product_type === "REELS"`.
- **TikTok:**
  - `/v2/user/info/` (bio, link, stats)
  - `/v2/video/list/` with `max_count: 20`, two pages, to reach 30 videos
  - `source` must contain "tiktok": scoring detects the platform from it (`growth_engine_scoring.js:211`).
- **Fields the APIs don't give** (story highlight count, pinned flag, and on TikTok saves, slideshow flag and original-sound flag) come back as `null`, not 0. See P0.6.
- **Errors** must use the wording `classifyFailure` (`growth_engine_job_queue.js:47–56`) and `public/app.js:487` match: "is private", "not found", "no public posts". Alternatively, update the classifier in the same change.
- [ ] Given the same account, the official fetcher and the Apify fetcher score within ±5 points on each dimension. Checked on the test users before the flag goes on.

**P0.5 One entry point for every pull.** Replace `getRealPostData(handle, platform, category)` (`growth_engine_evaluator.js:249–274`) with `getProfileData({ handle, platform, category, accountId, purpose })`, which applies the Decision 2 table. Pass `accountId` through `runSnapshot`, `compareCompetitors` (`growth_engine_competitors.js:59–95`) and post reviews' `fetchPosts` (`growth_engine_post_reviews.js:36–43`). Delete `server/instagram_fetcher.js`.

**P0.6 Scores stay comparable.** Scoring treats `null` as "unknown": the dimension re-weights over the signals it has, instead of scoring the missing one as 0.
- This matters for Profile Clarity, where highlights are worth 10 or 15 points (`growth_engine_scoring.js:165–197`), and for TikTok Content Mix (sound, slideshows).
- Add `scoring_version` to every report. The history view marks the first report after a version change: "Scored with more data from here on."
- Re-run `seed_baselines.js` after the change, because niche averages built from scrapes will drift.

**P0.7 Keeping tokens alive.** Add a token sweep to `growth_engine_refresh.js`'s 30-minute timer. It covers every active connection, not just paid ones: win-back reaches users who lapsed 30–60 days ago.
- **TikTok:** the access token lasts 24h. Refresh just before each job, and whenever it's under 2h from expiry. Store the new refresh token every time, because it can change. The refresh token lasts 365 days.
- **Meta:** long-lived user tokens last about 60 days, and data access expires after 90 days of inactivity. Refresh when under 10 days from expiry, if Meta allows it server-side (Open Question 4). Otherwise mark the connection `expired` and prompt the user.
- A failed refresh sets `status=expired`. The next weekly email and the app header show "Reconnect Instagram to keep your weekly rescore."
- The sweeps run in-process with no lock across instances. A refresh can rotate the TikTok refresh token, so two instances refreshing at once can strand a connection. Take a per-connection lock before refreshing, e.g. `UPDATE … SET last_refreshed_at = now WHERE id = $1 AND last_refreshed_at = $old` and skip if no row changes.
- [ ] Given a connection expired, the weekly refresh job falls back per Decision 2 and never errors silently.

**P0.8 Profile cache can't leak insights.** `growth_engine_profile_cache` is keyed `platform|handle` today (`growth_engine_db_postgres.js:124–126`). Change the key to `platform|handle|source`. Only public-field sources (Business Discovery, scrape) can be read by another account's run. Insight data from a connected token is never cached across accounts.
- TikTok `cover_image_url` expires after 6h, but cache entries live 24h. On a cache hit older than 5h, re-fetch the video list or skip thumbnails. Today thumbnails are only downloaded at the end of the job (`growth_engine_job_queue.js:303`).

**P0.9 Connect UI** in `public/app.js`:
- A connect screen after signup and in plan setup.
- A "Connected accounts" card in settings: status, reconnect, and "Disconnect / disconnect and delete".
- The "link a Facebook Page / switch to a Creator account" guide.
- `#/connect/done` result states.

**P0.10 Legal and copy.**
- Update the Privacy Policy, Retention and Terms pages. Add Meta and TikTok as sources for connected accounts. Say what connecting grants. Add a retention row for connection tokens: "until you disconnect, or 30 days after your account is deleted". Disconnecting deletes the tokens straight away.
- Bump `LEGAL_VERSION` (`public/app.js`) and `TERMS_VERSION` (`server/legal.js`). The existing re-accept screen asks users again.
- Update the "public only / no login" copy listed under Copy to change.

**P0.11 Instrumentation** through `growth_engine_events`: `connect_started`, `connect_completed`, `connect_failed{platform, reason}`, `connection_expired`, `reconnect_completed`, `disconnect{delete_data}`, and `report_source{source}` on every report. Log official API calls as zero-cost rows in `growth_engine_costs.js` (provider `meta`/`tiktok`) so rate-limit use can be seen next to Apify spend.

### P1: Phase 2, Business Discovery

**P1.1 Discovery account.** `IG_DISCOVERY_USER_ID` plus a token for our own professional IG account, stored in the connections table under a system account id rather than in env. Used for the anonymous IG free Snapshot, competitors and seed baselines.
- Business Discovery returns no insights and works only for professional, non-age-gated accounts. `view_count` is available through it.
- Rate limits: 4,800 × impressions per app-user per rolling 24h, and 200 × users per hour app-wide ([rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)). Watch `X-Business-Use-Case-Usage` and back off when it goes over 80%.

**P1.2 Competitors on Business Discovery.** A personal-account competitor returns "This account is personal, so Instagram doesn't share its numbers" instead of an error.

**P1.3 Seed baselines on Business Discovery.** Re-pull `seeds.instagram.json` and drop the handles that aren't professional. If fewer than `minN` remain, find replacements in that niche.

**P1.4 Landing form.**
- Instagram keeps "type your handle" (Business Discovery), plus a "connect instead" link.
- TikTok becomes a "Connect TikTok" button.
- Personal IG accounts get the switch guide.

**P1.5 Set `SCRAPE_FALLBACK=free`**, once 100% of paid pulls show an official `report_source` for 14 days.

### P2: Phase 3 and later

- **P2.1** Fold reach, saves and shares into Engagement Quality for connected accounts (saves per reach, shares per reach). Tune the weights on the test users first, and bump `scoring_version`.
- **P2.2** Story insights and audience demographics (the rest of the "What we cannot see" box).
- **P2.3** `SCRAPE_FALLBACK=off` and removal of the Apify fetchers, if counsel advises it.
- **P2.4** Data Use Checkup, annually: put a calendar reminder on Joe's calendar.

---

## Copy to change

Found by searching `public/app.js`; the line numbers are from the current branch. Each change is part of P0.10 or P1.4.

- Landing "Free · Public posts only · No card" (307, 322).
- Failure screens "We only ever read what anyone can see" (493, 500).
- Business page "Public data only. No login to your account." (1572).
- How it works: "What we read" lists story highlights (2167); "What we cannot see" (2169); "what a stranger can see" (2171).
- Server-side: `data_window` "We can't see saves, reach or story views" (`growth_engine_evaluator.js:751`), and the LLM prompts that say "public" (`growth_engine_evaluator.js:21, 38`).

## Env vars (add to `server/.env.example` and `render.yaml`)

`META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_REDIRECT_URI`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `IG_DISCOVERY_USER_ID`, `SCRAPE_FALLBACK` (`all|free|off`).

Remove `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_BUSINESS_ACCOUNT_ID`. The health check reads `INSTAGRAM_ACCESS_TOKEN` (`routes/growth-engine.js:110`) and must switch to the Meta vars. The root `.env.example` is stale (`INSTAGRAM_TOKEN`, `TIKTOK_API_KEY`), so tidy it at the same time.

**Every one of these has to be set on the host before the flag goes on.** Nobody can see that from the code.

---

## Success metrics

Proposed targets; Joe to confirm. All are measured from `growth_engine_events` unless noted.

**Leading (first two weeks after each phase)**
- Connect completion (`connect_completed` / `connect_started`): IG ≥ 60%, TikTok ≥ 75%. IG is lower because of the Page requirement.
- `connect_failed{reason:"no_page"}` share of IG failures: tracked. If it's over 40%, the guide needs work.
- Weekly rescores that fail because a connection expired: < 5%.

**Lagging (30–60 days)**
- Paid reports with an official `report_source`: 100% (gates P1.5).
- Apify spend on paid reports: $0 (admin cost view).
- Free Snapshot completions per week: no worse than −30% against the 4 weeks before (Goal 5 guardrail).
- Paid retention in month two for connected vs unconnected users. Expected to be higher for connected users, because their plans use better data. Unproven.

---

## Open questions

Blocking questions must be answered before the phase they block.

1. **Legal (blocks P1.1).** Are Business Discovery lookups through our own account, for anonymous visitors, within Meta's Platform Terms and approvable in App Review? Is it acceptable to keep scraping as a fallback, and for which uses? This question sets `SCRAPE_FALLBACK`.
2. **Engineering (blocks Phase 1, one-day spike).** Does Instagram Login really omit `caption` and `media_product_type`? Could two Meta apps (Instagram Login for connect, Facebook Login for discovery) remove the Page requirement, and would Meta allow it?
3. **Legal/business (non-blocking).** Is there any commercial TikTok route to other accounts' metrics? TikTok API for Business reportedly needs an application form from 20 Mar 2026 (unverified). If not, TikTok competitors stay off, or stay scraped per question 1.
4. **Engineering (blocks P0.7).** Can a Facebook Login long-lived user token be refreshed server-side without the user visiting? How does the 90-day data-access expiry apply to `instagram_*` permissions? ([token docs](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived), [data access expiry](https://developers.facebook.com/docs/facebook-login/auth-vs-data))
5. **Legal (blocks P0.3 wording).** When a user disconnects, must reports already built from Meta data be deleted? Meta's terms say "as soon as reasonably possible" when the user asks or no longer needs it. That's why the default here is to ask the user.
6. **Data (blocks P1.3).** How many of the 320 seed handles are professional accounts that Business Discovery can reach?
7. **Business (blocks App Review).** Business Verification needs the legal entity details, which are also still placeholders on the legal pages.
8. **Engineering (non-blocking).** Can a TikTok photo post be told apart from a video in `video.list`? There's no media-type field. If not, TikTok Content Mix stops using slideshows.

---

## Phasing

Durations for Meta and TikTok review aren't published, so none are given here. `HANDOFF_JOE.md` estimated 2–4 weeks for Meta; that's unverified.

| Phase | What | Can start | Gate to next |
|---|---|---|---|
| 0 | Meta Business app (Facebook Login) and TikTok developer app. Business Verification, test users, TikTok sandbox (up to 10 accounts). Lawyer consult (questions 1, 5). One-day spike (questions 2, 4). Fix-first bugs. | Now | Spike answers, test users working |
| 1 | P0.1–P0.11, behind `OFFICIAL_API=on` for test users only | After Phase 0 | Fetcher parity (±5 points), deletion callback working. Submit App Review (the screencast needs this build) and TikTok review. |
| 2 | P1.1–P1.5 | After Meta approves Business Discovery use | 14 days of 100% official paid pulls, then `SCRAPE_FALLBACK=free` |
| 3 | P2.1, then P2.2 | After Phase 2 | Counsel's answer on `off` |

**Review needs:**
- **Meta:** a 1024×1024 icon, privacy policy URL, the data deletion callback, test instructions, and a per-permission justification with an English-UI screencast. At least one successful API call per permission beforehand.
- **TikTok:** a full public website with Terms and Privacy links visible without opening a menu, 1–5 sandbox demo videos covering every scope, and a justification per scope.

Sources: [Meta App Review](https://developers.facebook.com/docs/instagram-platform/app-review), [Business Verification](https://developers.facebook.com/docs/development/release/business-verification), [Meta Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/), [TikTok app review](https://developers.tiktok.com/doc/app-review-guidelines), [TikTok sandbox](https://developers.tiktok.com/doc/add-a-sandbox), [TikTok user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info), [TikTok video list](https://developers.tiktok.com/doc/tiktok-api-v2-video-list), [TikTok token management](https://developers.tiktok.com/doc/oauth-user-access-token-management), [TikTok rate limits](https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit), [TikTok Research API](https://developers.tiktok.com/products/research-api/), [TikTok Developer Terms](https://www.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en).
