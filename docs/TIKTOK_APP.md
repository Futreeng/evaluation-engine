# TikTok developer app (Login Kit + Display API)

Created 29 Sept 2026 by Haron (driven through the browser). Portal:
https://developers.tiktok.com/app/7691060702467000340

| Item | Value |
|---|---|
| Developer account | hello@futreeng.com (org owner) |
| Organization | FutureEng LLC, org id 7691041004744524821 (name cannot be changed) |
| App name / id | Scalecraft Social / 7691060702467000340 |
| App type | Other (Login with TikTok). Cannot be changed |
| Status | **Draft**, not submitted |
| Client key / secret | App details → Credentials (eye icon). Render env `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`; never in git or chat. Since Wave 2 there is also `CONNECT_TIKTOK_ENABLED`, an optional off switch — unset means on as long as the credentials are set |
| Category | Business |
| Platform | Web, `https://scalecraftsocial.com/` |
| Terms / Privacy URLs | `https://scalecraftsocial.com/#/legal/terms`, `/#/legal/privacy` |
| URL property | `https://scalecraftsocial.com/` **verified** (URL prefix) via signature file `public/tiktokRyhS5v3bg5Sd2HuP4Sh9jMLgAthBFwP7.txt` — keep that file |
| Product | Login Kit |
| Redirect URI | `https://scalecraftsocial.com/api/growth-engine/v1/connect/tiktok/callback` |
| Scopes | `user.info.basic` (Login Kit), `user.info.profile`, `user.info.stats`, `video.list` (these are the Display API read scopes; there is no separate "Display API" product card) |
| App icon | `~/Desktop/scalecraft-app-icon.png` uploaded |
| App Review explanation | written (per-scope, 863 chars) |
| Demo video | **PLACEHOLDER** — a 7-second slideshow of the live site so the draft would save. TikTok refuses to save a draft with any required field empty. **Replace with a real screencast of the connect flow before submitting**, or the review is rejected |

## The flow (spec as of 29 Sept; built since, mirror of the Instagram flow in docs/META_APP.md)

Built in `server/growth_engine_connect.js`. How it behaves now — reconnect
lifecycle, the post-connect first pull, the plain-language error states, the
per-platform nonce cookie, the env names and the review recording script — is in
`docs/CONNECT_FLOW.md`. TikTok has no deauthorize or data-deletion callback to
register; those two are Meta-only.

1. Button on the report/Path: "Connect TikTok". Link:
   `https://www.tiktok.com/v2/auth/authorize/?client_key=<TIKTOK_CLIENT_KEY>&scope=user.info.basic,user.info.profile,user.info.stats,video.list&response_type=code&redirect_uri=https%3A%2F%2Fscalecraftsocial.com%2Fapi%2Fgrowth-engine%2Fv1%2Fconnect%2Ftiktok%2Fcallback&state=<signed accountId>` (PKCE `code_challenge` is required for web).
2. `GET /connect/tiktok/callback?code=…&state=…`: verify state, POST
   `https://open.tiktokapis.com/v2/oauth/token/` (client_key, client_secret,
   code, grant_type=authorization_code, redirect_uri, code_verifier). Access token
   lasts 24 h, refresh token 365 days; refresh with `grant_type=refresh_token`.
   Store encrypted with `ENCRYPTION_KEY`.
3. Fetcher: `GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,bio_description,profile_web_link,is_verified,follower_count,following_count,likes_count,video_count`
   and `POST https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,title,video_description,duration,cover_image_url,share_url,view_count,like_count,comment_count,share_count`
   (max_count 20, paginate with cursor). Map onto the existing report shape.
4. Sandbox: the portal's Sandbox tab issues test credentials that work before
   review; add the test TikTok account there.
5. Before submitting: record the real connect flow on scalecraftsocial.com
   (domain must match), replace the placeholder video, keep only the four scopes.
   Review: 3–7 days clean, ~3 weeks with one rejection.

## Still to do (Haron)

- Add Joe to the organization (Roles and access → Invite) so he can read the secret.
- Nothing else until the flow exists.
