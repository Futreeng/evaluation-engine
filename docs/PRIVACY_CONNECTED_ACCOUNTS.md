# Privacy policy — connected accounts

Status: **APPLIED to the live page on Haron's instruction (6 Oct 2026).**
All four edits below are now in `public/app.js` → `LEGAL.privacy.sections`.
Kept as the record of what changed and why, and of what still needs counsel.

**Still outstanding: counsel review.** The surrounding policy already carries
`[Counsel: …]` markers; this text has not been through that pass. It is an
accurate description of what the code does, which is what app review needs, but
it is not legal sign-off.

## Why the current policy needs changing

The published section "What we collect about scored accounts" says:

> we read what the platform shows a logged-out visitor … **We never log in as
> anyone**, never post, and never read private accounts.

Once a user connects an account that is no longer accurate — we hold an OAuth
token issued by that user and read their account as themselves, including
numbers no logged-out visitor can see (Instagram saves, reach and shares).
Leaving it as-is would be a false statement in a privacy policy, and Meta's and
TikTok's reviewers both read this page.

## The edits (now applied)

### 1. Amend the existing "What we collect about scored accounts" section

Replace the sentence **"We never log in as anyone, never post, and never read
private accounts."** with:

> We never post. Unless you have connected that account to Scalecraft yourself
> (see "Accounts you connect"), we do not log in as anyone and do not read
> private accounts.

### 2. New section, placed directly after it: "Accounts you connect"

> If you connect your own Instagram or TikTok account, that platform asks you to
> approve Scalecraft and then gives us an access token. We store that token
> encrypted and use it only to read your own account: your profile (handle,
> display name, picture, follower and following counts, bio and link) and your
> recent posts with their captions, dates and statistics — including figures a
> logged-out visitor cannot see, such as Instagram saves, reach and shares. We
> use it for nothing else. We never post, never send messages, never read your
> private messages, never read anyone else's account with your token, and never
> sell or share this data. The permissions we request are read-only:
> `instagram_business_basic` and `instagram_business_manage_insights` on
> Instagram, and `user.info.basic`, `user.info.profile`, `user.info.stats` and
> `video.list` on TikTok.
>
> We keep: the platform's own account id, your handle and display name, which
> permissions you granted, when the token expires, and the connection's status
> and dates. The token itself is encrypted at rest and is readable only by the
> service.
>
> Our legal basis is performance of our contract with you; you are never
> required to connect an account, and Scalecraft works without it.
>
> You can disconnect at any time from your reports page. Disconnecting tells the
> platform to revoke the token where that platform supports it, and deletes our
> copy of the token and the connection record immediately. You can also revoke
> Scalecraft from Instagram (Settings → Apps and websites) or TikTok (Settings →
> Security → Manage app permissions); when you do, the platform tells us and we
> delete the same records. Deleting your Scalecraft account deletes them too.
> Reports already produced from connected data stay under the retention windows
> in "How long we keep it".

### 3. Amend "How long we keep it"

Add to the end of that section:

> Connected-account tokens and connection records: until you disconnect, revoke
> Scalecraft on the platform, or delete your account — whichever happens first.

### 4. Amend "Who we share it with"

The subprocessor list should name the platforms we now call directly. Add:

> Meta Platforms (the Instagram API, when you connect an Instagram account) and
> TikTok (the TikTok API, when you connect a TikTok account). These receive only
> the access token they themselves issued, in order to answer our read requests
> for your own account.

## Decisions for Haron

1. **Counsel review.** Section 2 is a factual description of what the code does;
   the surrounding policy already carries `[Counsel: …]` markers, so this should
   go through the same pass before publishing.
2. **Data deletion route.** The policy should point at the deletion callback
   result. Current Meta setting points "Data deletion" at `/#/legal/privacy`.
   See `docs/CONNECT_FLOW.md` for the callback URL now implemented.
3. **Wording of "Professional account".** Section 2 does not mention that
   Instagram requires a Business or Creator account. The UI says it; the policy
   probably does not need to, but say if you want it there.
