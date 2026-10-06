# Connected accounts — operating notes

What a user gets: a "Connect TikTok" / "Connect Instagram" button, the platform's
own approval screen, and a return trip that says "Connected, pulled 24 posts."
From then on their report reads the official API instead of the public scrape.

Code: `server/growth_engine_connect.js`, routes in `server/routes/growth-engine.js`,
UI in `public/app.js` (reports page + the line under each report's data window).
Developer-app records: `docs/TIKTOK_APP.md`, `docs/META_APP.md`.
Tests: `node server/growth_engine_connect.test.js` (24).

**Users who never connect are unaffected.** The API path only runs for a
signed-in account that owns a connection for the exact handle being scored, and
any API failure falls back to the public read (`growth_engine_evaluator.js`).

---

## 1. Environment variables to add on Render

Names only. Never paste a value into git, a chat, or this file.

| Name | Notes |
|---|---|
| `META_APP_SECRET` | **New, optional — see below.** The *Meta* app secret for app `1617940326404118` (Settings → Basic). A **different value** from `IG_APP_SECRET`. |
| `CONNECT_TIKTOK_ENABLED` | **New, optional.** Set to `0` to force TikTok off while leaving credentials in place. Unset = on if credentials are set. |
| `CONNECT_INSTAGRAM_ENABLED` | **New, optional.** Same for Instagram. |

### Which secret verifies Meta's callbacks

Meta signs the deauthorize and data-deletion `signed_request` with "your app
secret". Which one that means here is genuinely ambiguous: Meta's generic
data-deletion page describes a Facebook-app-scoped callback, but our callbacks
are configured under the **Instagram** use case, whose `client_id` is the
Instagram app. Published implementations go both ways and the docs never say.

So the code **accepts either**. It checks the signature against `IG_APP_SECRET`
and `META_APP_SECRET`, in constant time, and proceeds if either matches. This
weakens nothing — a forger needs one of the two secrets either way — and it
means the flow cannot break on a coin-flip.

**What this means for you:** `IG_APP_SECRET` is already set in production, so
the callbacks will work without you doing anything. Setting `META_APP_SECRET`
as well is belt-and-braces, worth doing while you are in the dashboard but not
blocking. If neither is set, both callbacks refuse rather than trusting an
unverified body.

The first real callback logs `[Connect] signed_request verified with
<NAME>` — the name only, never the value. Once you have seen that line you know
which secret Meta actually uses and can drop the other.

Already declared in `render.yaml`; confirm each actually has a value set:

`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `IG_APP_ID`, `IG_APP_SECRET`,
`ENCRYPTION_KEY`, `JWT_SECRET`, `APP_URL`.

`APP_URL` must be exactly `https://scalecraftsocial.com` — every callback URL is
derived from it, and they must match the dashboards character for character.

Check what the running server thinks: **`GET /api/growth-engine/v1/health`** →
the `connect` block reports each platform's enabled/credentials/flag state and
prints the exact URLs below. It never prints a secret (there is a test for that).

## 2. URLs to register on the developer apps

Derived from `APP_URL`. All already correct in the dashboards except the two
marked **NEW**.

### TikTok — developers.tiktok.com/app/7691060702467000340

| Field | Value |
|---|---|
| Redirect URI | `https://scalecraftsocial.com/api/growth-engine/v1/connect/tiktok/callback` |

Already registered. Scopes registered (`user.info.basic`, `user.info.profile`,
`user.info.stats`, `video.list`) match the code exactly — no change needed.

### Meta — developers.facebook.com/apps/1617940326404118

| Field | Value |
|---|---|
| Business login redirect URL | `https://scalecraftsocial.com/api/growth-engine/v1/connect/instagram/callback` |
| **Deauthorize callback URL** | **NEW** → `https://scalecraftsocial.com/api/growth-engine/v1/connect/instagram/deauthorize` |
| **Data deletion request URL** | **NEW** → `https://scalecraftsocial.com/api/growth-engine/v1/connect/instagram/data-deletion` |

Permissions registered (`instagram_business_basic`,
`instagram_business_manage_insights`) match the code exactly — no change needed.

The data-deletion URL answers both verbs: Meta `POST`s the deletion request and
gets back `{url, confirmation_code}`; a person opening that `url` (a `GET` with
`?code=`) sees a plain page saying whether we still hold anything.

## 3. Test checklist — also the app-review recording script

Run on `https://scalecraftsocial.com` signed in as yourself. The domain must
match what's registered or the recording is rejected. Record one clean take per
platform covering steps 1–6.

**Before you start:** confirm `GET /api/growth-engine/v1/health` shows
`connect.platforms.<platform>.enabled: true`. If it doesn't, the button won't
appear and nothing below will work.

### Instagram (needs a Business or Creator account added as an Instagram Tester)

1. Sign in → **Your reports**. The "Connected accounts" card shows Instagram,
   "Not connected", and the note about needing a Professional account.
2. Click **Connect Instagram** → Instagram's own approval screen appears on
   instagram.com. Confirm the permissions listed are only the two read scopes.
3. Approve → you land back on `#/reports` with a toast:
   *"Instagram connected as @handle — pulled N posts."* N must be > 0.
4. The card now shows `@handle` and a **Disconnect** button.
5. Open a report for that handle → the line under the data window offers
   **"Score again from the API →"**. Click it; the new report should show saves
   and reach, which the public scrape cannot see.
6. Click **Disconnect** → card returns to "Not connected".

### TikTok (needs the account added as a sandbox target user)

Same six steps with **Connect TikTok**. TikTok's screen will list the four
scopes. Step 5 shows TikTok's own view/share counts.

### Error states — check each shows a sentence, never a stack trace

| What to do | Expected |
|---|---|
| Click Connect, then **Cancel** on the platform screen | "You cancelled on TikTok's screen — nothing was connected. You can try again any time." |
| Connect an account that is **not** a tester / sandbox user | "Scalecraft's Instagram app is still in review, so only accounts we've added as testers can connect…" |
| Connect a **personal** Instagram account | "That Instagram account is a personal one… switch to Business or Creator…" — and nothing is stored. |
| Untick a permission on the approval screen | "Instagram didn't grant instagram_business_manage_insights. Connect again and leave every permission switched on…" — nothing is stored. |
| Revoke Scalecraft inside the Instagram app, then reload reports | The row shows **needs reconnecting** with the reason and a **Reconnect** button. |
| Open the connect link in a different browser | "This connect link was not started in this browser — start again from your account page." |

### Meta's callbacks (do these once; they are what review checks)

1. In Instagram → Settings → Apps and websites, **remove** Scalecraft.
   Meta POSTs the deauthorize callback; the connection disappears from the
   reports page without you clicking Disconnect.
2. Request your data be deleted via Meta's flow. The confirmation URL Meta shows
   should open our page and say we no longer hold anything.

### Regression — the thing that must not break

7. Sign out. Score any public handle you have never connected. It must behave
   exactly as before: same report, same numbers, no connect prompts.

## 4. Still outstanding (not code)

- TikTok app is a **draft with a placeholder demo video**. Replace it with the
  step 1–6 recording before submitting, or review is rejected.
- Meta business verification for portfolio `381235392320983` was *in review* as
  of 29 Sept — confirm the outcome.
- Confirm the TikTok sandbox exists and the test account is a target user.
- Confirm the Instagram Testers invite was sent **and accepted**.
- `META_APP_SECRET` is optional (see "Which secret verifies Meta's callbacks");
  set it while you are in the dashboard, but the callbacks work without it.

## 5. Notes for whoever works on this next

- No mock is needed for the two Meta callbacks or the deletion status page:
  `app.js` never calls them (Meta calls one; a person opens the other). Every
  route the front end *does* call has a mock in `public/mock-api.js`, and the
  mock is stateful — `?mock_connect=needsfix|none|fail` picks a starting state.
- The connections table carries `status` (`active` / `needs_reconnect`) and
  `source` (always `oauth` today). `source` exists so a connection recorded some
  other way can sit in the same table without a migration.

  That column is the answer to "replace the screenshot-upload data from Wave 1.5
  without a migration". **There is no screenshot-upload feature, and Wave 1.5 was
  never built at all.** Searched on 6 Oct 2026: no upload route, no multipart
  dependency, no mention of screenshots in the build spec, in WHAT_WE_BUILT.md,
  in the uploaded spec boards, or as a product feature in any local session
  transcript. Wave 1.5 itself survives only as a planning doc that references
  `docs/SCALECRAFT_WAVE_1_5.md`, which was never committed; its one surviving
  item (1.5.1, the What/Why/When/How move format, in
  `~/Downloads/SCALECRAFT_1_5_1_PLAN.md`) is not in the code either — no
  `move_id`, no `when`/`how` fields. So nothing needs replacing. If a
  screenshot-upload path is ever built, its rows go in this table with a
  different `source` and the connected-account code does not change.
- Costs: every official-API call is recorded through `growth_engine_costs.api()`
  at a zero rate. The number that matters is the call count, not the money.
