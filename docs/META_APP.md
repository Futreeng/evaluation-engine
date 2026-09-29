# Meta developer app (Instagram API)

Created 29 Sept 2026 by Haron (driven through the browser). Dashboard:
https://developers.facebook.com/apps/1617940326404118/

| Item | Value |
|---|---|
| Meta app name | Scalecraft Social |
| Meta app ID | 1617940326404118 |
| Instagram app name | Scalecraft Social-IG |
| Instagram app ID | 1036695342742623 (this is the OAuth `client_id`) |
| Instagram app secret | dashboard → Use cases → Customize → API setup with Instagram login → Show. Goes in Render as `IG_APP_SECRET`; never in git or chat |
| Contact email | hello@futreeng.com |
| Use case | Manage messaging & content on Instagram (Instagram API with Instagram Login) |
| Permissions added, "Ready for testing" | `instagram_business_basic`, `instagram_business_manage_insights` |
| Business login redirect URL | `https://scalecraftsocial.com/api/growth-engine/v1/connect/instagram/callback` |
| App domain | scalecraftsocial.com; website platform `https://scalecraftsocial.com/` |
| Privacy / Terms / Data deletion URLs | `https://scalecraftsocial.com/#/legal/privacy`, `/#/legal/terms`, `/#/legal/privacy` |
| Category | Business and pages |
| Business portfolio | **Scalecraft Social** (portfolio id 381235392320983, the former "werunnewyork" portfolio, renamed) — owns the app since 29 Sept. Legal details entered as "FutureEng LLC" (confirmed: the formation document says FutureEng), business verification **in review** |
| Status | Unpublished. Works for accounts given the Instagram Tester role until app review passes |

## What "Ready for testing" means

The two permissions work now for any Instagram professional account that is
added as an **Instagram Tester** (App roles → Roles → Add people, then the
account accepts the invite at instagram.com → Settings → Apps and websites →
Tester invites). Real customers need App Review (step 5 on the API setup page):
business verification, a screencast of the connect flow on scalecraftsocial.com,
and a written explanation per permission. Budget 6–8 weeks (`docs/` notes of 29 Sept).

## The connect flow (built 29 Sept in `server/growth_engine_connect.js`; this section is the reference it was built from)

1. Button on the report/Path for a signed-in user: "Connect Instagram to unlock
   saves, reach and story views". It links to
   `https://www.instagram.com/oauth/authorize?client_id=1036695342742623&redirect_uri=https%3A%2F%2Fscalecraftsocial.com%2Fapi%2Fgrowth-engine%2Fv1%2Fconnect%2Finstagram%2Fcallback&response_type=code&scope=instagram_business_basic%2Cinstagram_business_manage_insights&state=<signed accountId>`
2. `GET /api/growth-engine/v1/connect/instagram/callback?code=…&state=…`:
   verify `state`, exchange the code at `https://api.instagram.com/oauth/access_token`
   (POST: client_id, client_secret, grant_type=authorization_code, redirect_uri, code),
   then swap for a long-lived token at `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`
   (60 days; refresh with `ig_refresh_token` before expiry). Store encrypted on the
   account with `ENCRYPTION_KEY` (same as the LLM keys).
3. Fetcher: `GET https://graph.instagram.com/v21.0/me?fields=id,username,followers_count,media_count,biography,profile_picture_url`
   and `/me/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url&limit=50`,
   plus `/{media-id}/insights?metric=reach,saved,shares,views` and
   `/me/insights?metric=reach,profile_views,accounts_engaged&period=day` for the
   connected account. Map onto the same report shape the Apify fetcher produces
   (`server/growth_engine_evaluator.js` fetcher interface); new fields (saves,
   reach) feed Engagement Quality once `growth_engine_scoring.js` learns them.
4. Competitors: Instagram Login cannot read other accounts. Business Discovery
   needs the **Facebook Login for Business** use case (`instagram_manage_insights`
   + `pages_read_engagement` on a Page-linked account). Add that use case and a
   second review later; until then competitors stay on the public snapshot.
5. Env on Render: `IG_APP_ID=1036695342742623`, `IG_APP_SECRET=<dashboard>`. The redirect URI is derived from `APP_URL`.

## Business portfolios, what happened on 29 Sept

- Meta blocked creating a sixth portfolio, so an unused one was repurposed.
- First try: "Old Inurse america" (id 636830694381525) renamed FutreEng LLC and verified
  (came back **Verified** the same day) — but it carries an old advertising
  restriction and Meta refuses app ownership on it ("prohibited from advertising,
  including app sharing"). Meta also refuses names containing "restricted", so it is
  still called FutreEng LLC. Appeal the restriction under Account Quality if it's
  ever wanted for ads; not needed for Scalecraft.
- Second try: "werunnewyork" (id 381235392320983) renamed **Scalecraft Social**,
  app attached (auto-approved), business details filled, verification submitted.
  App Review waits on this verification.
- Legal name in both portfolios is "FutureEng LLC", which Haron confirmed is the
  formation-document spelling. The legal pages were corrected to match (PR
  "Legal name is FutureEng LLC"); the domain and email keep "futreeng".

## Still to do in the dashboard (Haron)

- Wait for the Scalecraft Social portfolio's verification (in review since 29 Sept).
- Upload the app icon: `~/Desktop/scalecraft-app-icon.png` (generated 29 Sept; Meta's uploader needs a manual drag).
- Data Protection Officer block: done (hello@futreeng.com, 5900 Balcones Drive, Ste 100, Austin, TX 78731).
- Add Joe as an app admin (App roles → Roles) so he can read the secret and
  submit review.
- Add test accounts as Instagram Testers (your own and talon__wilson with permission).
- App review (step 5) once the connect flow is live: screencast + per-permission notes.

## TikTok

Separate developer app at https://developers.tiktok.com (Display API,
`user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`). Same
shape of flow; review 1–3 weeks. Not started.
