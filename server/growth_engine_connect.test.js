// Connected accounts: signed state, both OAuth exchanges, token storage,
// refresh, and that API data scores through the same assembly as a scrape.
//   node server/growth_engine_connect.test.js
const assert = require("assert");
const path = require("path");
const fs = require("fs");
process.env.APP_URL = "https://scalecraft.test";
process.env.JWT_SECRET = "test-secret";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.TIKTOK_CLIENT_KEY = "ttk_test";
process.env.TIKTOK_CLIENT_SECRET = "tts_test";
process.env.IG_APP_ID = "1036695342742623";
process.env.IG_APP_SECRET = "igs_test";
process.env.GROWTH_ENGINE_DB = path.join(require("os").tmpdir(), `sc-connect-test-${process.pid}.db`);
delete process.env.DATABASE_URL;

const geDb = require("./growth_engine_db_select");
const connect = require("./growth_engine_connect");
const { scoreProfile } = require("./growth_engine_scoring");

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.log(`✗ ${name}\n  ${e.stack}`); process.exitCode = 1; } }

// A fake network: route by URL prefix, record what was sent.
const calls = [];
const routes = [];
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const r = routes.find((x) => String(url).startsWith(x.prefix));
  if (!r) return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: "no route " + url } }) };
  const body = typeof r.body === "function" ? r.body(String(url), init) : r.body;
  return { ok: r.status ? r.status < 400 : true, status: r.status || 200, text: async () => JSON.stringify(body) };
};
const days = (n) => new Date(Date.now() - n * 86400000);

(async () => {
  await geDb.initDb();
  const accountId = "acct_connect_1";
  // POST /connect/:platform/url sets an httpOnly nonce cookie and the callback
  // now requires it back, so every callback test reproduces that. Tests about
  // the cookie itself pass their own value instead.
  const ck = (state) => ({ cookieNonce: connect.readState(state).nonce });

  await test("state round-trips, is bound to the account, and rejects tampering", async () => {
    const st = connect.makeState({ accountId, platform: "tiktok", returnTo: "#/reports", verifier: "v1" });
    const back = connect.readState(st);
    assert.deepEqual({ ...back, nonce: undefined }, { accountId, platform: "tiktok", returnTo: "#/reports", verifier: "v1", nonce: undefined });
    // The nonce is what the session cookie is matched against on the way back.
    assert.match(back.nonce, /^[0-9a-f]{16}$/);
    const [payload] = st.split(".");
    assert.throws(() => connect.readState(payload + ".AAAA"), /signature/);
    assert.throws(() => connect.readState("nope"), /state/i);
  });

  await test("TikTok auth URL carries PKCE, scopes and the registered redirect", async () => {
    const u = new URL(connect.authUrl("tiktok", accountId, { returnTo: "#/report/r1" }));
    assert.equal(u.origin + u.pathname, "https://www.tiktok.com/v2/auth/authorize/");
    assert.equal(u.searchParams.get("client_key"), "ttk_test");
    assert.equal(u.searchParams.get("scope"), "user.info.basic,user.info.profile,user.info.stats,video.list");
    assert.equal(u.searchParams.get("redirect_uri"), "https://scalecraft.test/api/growth-engine/v1/connect/tiktok/callback");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(connect.readState(u.searchParams.get("state")).returnTo, "#/report/r1");
  });

  await test("Instagram auth URL uses the app id and the two read scopes", async () => {
    const u = new URL(connect.authUrl("instagram", accountId));
    assert.equal(u.origin + u.pathname, "https://www.instagram.com/oauth/authorize");
    assert.equal(u.searchParams.get("client_id"), "1036695342742623");
    assert.equal(u.searchParams.get("scope"), "instagram_business_basic,instagram_business_manage_insights");
    assert.equal(u.searchParams.get("redirect_uri"), "https://scalecraft.test/api/growth-engine/v1/connect/instagram/callback");
  });

  await test("unconfigured platform refuses with 503", async () => {
    const k = process.env.TIKTOK_CLIENT_KEY; delete process.env.TIKTOK_CLIENT_KEY;
    assert.throws(() => connect.authUrl("tiktok", accountId), (e) => e.status === 503);
    process.env.TIKTOK_CLIENT_KEY = k;
    assert.deepEqual(connect.available(), { tiktok: true, instagram: true });
  });

  // ---- TikTok end to end
  routes.push(
    { prefix: "https://open.tiktokapis.com/v2/oauth/token/", body: (u, init) => { const f = new URLSearchParams(init.body); calls.tokForm = f; return f.get("grant_type") === "refresh_token" ? { access_token: "tt_refreshed", refresh_token: "tt_r2", expires_in: 86400, refresh_expires_in: 31536000 } : { access_token: "tt_at", refresh_token: "tt_rt", expires_in: 86400, refresh_expires_in: 31536000, open_id: "open_123", scope: "user.info.basic,user.info.profile,user.info.stats,video.list" }; } },
    { prefix: "https://open.tiktokapis.com/v2/user/info/", body: { data: { user: { open_id: "open_123", username: "talon__wilson", display_name: "Talon", avatar_url: "https://x/a.jpg", bio_description: "Trails and coffee 📍 Seattle", profile_web_link: "https://linktr.ee/talon", is_verified: false, follower_count: 12500, following_count: 300, likes_count: 450000, video_count: 40 } }, error: { code: "ok" } } },
    { prefix: "https://open.tiktokapis.com/v2/video/list/", body: (u, init) => { const b = JSON.parse(init.body); return b.cursor ? { data: { videos: [], has_more: false }, error: { code: "ok" } } : { data: { has_more: true, cursor: 99, videos: Array.from({ length: 14 }, (_, i) => ({ id: `v${i}`, create_time: Math.floor(days(i * 3).getTime() / 1000), title: `Video ${i}`, video_description: `Trail day ${i} #hike #pnw`, duration: 20 + i, cover_image_url: `https://x/c${i}.jpg`, share_url: `https://www.tiktok.com/@talon__wilson/video/${i}`, view_count: 5000 + i * 400, like_count: 300 + i * 20, comment_count: 10 + i, share_count: 5 + i })) }, error: { code: "ok" } }; } },
    { prefix: "https://open.tiktokapis.com/v2/oauth/revoke/", body: { error: { code: "ok" } } },
  );

  let ttUrl;
  await test("TikTok callback exchanges the code with the PKCE verifier and stores an encrypted token", async () => {
    ttUrl = new URL(connect.authUrl("tiktok", accountId, { returnTo: "#/reports" }));
    const r = await connect.handleCallback("tiktok", { code: "abc", state: ttUrl.searchParams.get("state") }, ck(ttUrl.searchParams.get("state")));
    assert.equal(r.platform, "tiktok"); assert.equal(r.handle, "talon__wilson"); assert.equal(r.returnTo, "#/reports");
    assert.equal(calls.tokForm.get("code"), "abc");
    assert.equal(calls.tokForm.get("code_verifier"), connect.readState(ttUrl.searchParams.get("state")).verifier);
    assert.equal(calls.tokForm.get("redirect_uri"), "https://scalecraft.test/api/growth-engine/v1/connect/tiktok/callback");
    const c = await geDb.getConnection(accountId, "tiktok");
    assert.ok(c.tokenEnc && !c.tokenEnc.includes("tt_at"), "token is not stored in the clear");
    assert.equal(c.extUserId, "open_123"); assert.equal(c.handle, "talon__wilson");
    assert.ok(c.expiresAt > Date.now());
  });

  await test("a reused or forged state is refused", async () => {
    // Platform mismatch is caught before the cookie is consulted, and a state
    // that will not even parse never reaches it.
    await assert.rejects(() => connect.handleCallback("instagram", { code: "abc", state: ttUrl.searchParams.get("state") }, { cookieNonce: "whatever" }), /mismatch/);
    await assert.rejects(() => connect.handleCallback("tiktok", { code: "abc", state: "x.y" }, { cookieNonce: "whatever" }), /signature/);
  });

  await test("connectionFor matches only the connected handle and never the demo account", async () => {
    assert.ok(await connect.connectionFor(accountId, "tiktok", "Talon__Wilson"));
    assert.equal(await connect.connectionFor(accountId, "tiktok", "someone_else"), null);
    assert.equal(await connect.connectionFor("demo-account", "tiktok", "talon__wilson"), null);
    assert.equal(await connect.connectionFor(accountId, "instagram", "talon__wilson"), null);
  });

  await test("TikTok fetch through the API yields the scraper's shape and scores", async () => {
    const conn = await geDb.getConnection(accountId, "tiktok");
    const data = await connect.fetchTikTok(conn);
    assert.equal(data.handle, "talon__wilson"); assert.equal(data.follower_count, 12500); assert.equal(data.connected, true); assert.equal(data.source, "tiktok-api");
    assert.equal(data.recent_posts.length, 14);
    assert.ok(data.analysis.posting_frequency.posts_per_week > 0);
    assert.ok(data.analysis.engagement.total_video_views > 0);
    assert.equal(data.analysis.profile_clarity.bio_text, "Trails and coffee 📍 Seattle");
    const scored = scoreProfile(data, "travel");
    assert.ok(scored && scored.dimensions.length === 4 && scored.overall >= 0 && scored.overall <= 100, "scores like a scraped account");
  });

  await test("an expiring TikTok token is refreshed before use", async () => {
    const c = await geDb.getConnection(accountId, "tiktok");
    await geDb.setConnection(accountId, "tiktok", { ...c, expiresAt: Date.now() + 5 * 60 * 1000 });
    const tok = await connect.liveToken(await geDb.getConnection(accountId, "tiktok"));
    assert.equal(tok, "tt_refreshed");
    assert.equal(calls.tokForm.get("grant_type"), "refresh_token");
    assert.ok((await geDb.getConnection(accountId, "tiktok")).expiresAt > Date.now() + 80000 * 1000);
  });

  // ---- Instagram end to end
  routes.push(
    { prefix: "https://api.instagram.com/oauth/access_token", body: (u, init) => { calls.igForm = new URLSearchParams(init.body); return { access_token: "ig_short", user_id: 17841400000, permissions: ["instagram_business_basic", "instagram_business_manage_insights"] }; } },
    { prefix: "https://graph.instagram.com/access_token?", body: { access_token: "ig_long", token_type: "bearer", expires_in: 5184000 } },
    { prefix: "https://graph.instagram.com/refresh_access_token", body: { access_token: "ig_long2", expires_in: 5184000 } },
    { prefix: "https://graph.instagram.com/v21.0/me?", body: { user_id: "17841400000", username: "talon__wilson", name: "Talon Wilson", account_type: "MEDIA_CREATOR", profile_picture_url: "https://x/p.jpg", followers_count: 8000, follows_count: 500, media_count: 30, biography: "Nature. Seattle. DM for prints", website: "https://talon.co" } },
    { prefix: "https://graph.instagram.com/v21.0/me/media?", body: { data: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, caption: `Ridge ${i} #pnw`, media_type: i % 3 === 0 ? "VIDEO" : i % 3 === 1 ? "CAROUSEL_ALBUM" : "IMAGE", media_product_type: i % 3 === 0 ? "REELS" : "FEED", timestamp: days(i * 4).toISOString(), permalink: `https://www.instagram.com/p/m${i}/`, like_count: 200 + i * 10, comments_count: 8 + i, thumbnail_url: `https://x/t${i}.jpg` })), paging: {} } },
    { prefix: "https://graph.instagram.com/v21.0/m", body: (u) => { const isVideo = /metric=reach%2Csaved%2Cshares%2Cviews/.test(u); const d = [{ name: "reach", values: [{ value: 1500 }] }, { name: "saved", values: [{ value: 40 }] }, { name: "shares", values: [{ value: 12 }] }]; if (isVideo) d.push({ name: "views", values: [{ value: 9000 }] }); return { data: d }; } },
  );

  await test("Instagram callback exchanges for a long-lived token and stores it encrypted", async () => {
    const u = new URL(connect.authUrl("instagram", accountId, { returnTo: "#/report/r9" }));
    const r = await connect.handleCallback("instagram", { code: "igcode", state: u.searchParams.get("state") }, ck(u.searchParams.get("state")));
    assert.equal(r.handle, "talon__wilson"); assert.equal(r.returnTo, "#/report/r9");
    assert.equal(calls.igForm.get("code"), "igcode"); assert.equal(calls.igForm.get("client_id"), "1036695342742623");
    const c = await geDb.getConnection(accountId, "instagram");
    assert.ok(c.tokenEnc && !c.tokenEnc.includes("ig_long"));
    assert.equal(c.extUserId, "17841400000");
    assert.ok(c.expiresAt > Date.now() + 50 * 86400000, "60-day token");
  });

  await test("Instagram fetch adds saves, reach and shares and scores through the same assembly", async () => {
    const conn = await geDb.getConnection(accountId, "instagram");
    const data = await connect.fetchInstagram(conn);
    assert.equal(data.source, "instagram-api"); assert.equal(data.connected, true);
    assert.equal(data.recent_posts.length, 12);
    assert.equal(data.recent_posts[0].save_count, 40); assert.equal(data.recent_posts[0].reach, 1500);
    assert.equal(data.recent_posts.find((p) => p.media_type === "VIDEO").video_view_count, 9000);
    assert.equal(data.analysis.engagement.total_saves, 480);
    assert.equal(data.analysis.engagement.avg_reach_per_post, 1500);
    assert.equal(data.analysis.profile_clarity.external_url, "https://talon.co");
    assert.equal(data.analysis.profile_clarity.is_business_account, false);
    const scored = scoreProfile(data, "travel");
    assert.ok(scored && scored.overall >= 0 && scored.overall <= 100);
  });

  await test("a user cancelling on the platform comes back as a soft error with the return target", async () => {
    const u = new URL(connect.authUrl("instagram", accountId, { returnTo: "#/reports" }));
    await assert.rejects(() => connect.handleCallback("instagram", { error: "access_denied", state: u.searchParams.get("state") }, ck(u.searchParams.get("state"))), (e) => e.code === "DENIED" && e.returnTo === "#/reports" && e.accountId === accountId);
  });

  await test("list, public view, and disconnect", async () => {
    const list = await geDb.listConnections(accountId);
    assert.deepEqual(list.map((c) => c.platform), ["instagram", "tiktok"]);
    const pv = connect.publicView(list[1]);
    assert.ok(!("tokenEnc" in pv) && !("refreshEnc" in pv), "no token material in the public view");
    assert.equal(pv.handle, "talon__wilson");
    await connect.revoke(list[1]);
    await geDb.deleteConnection(accountId, "tiktok");
    assert.equal(await geDb.getConnection(accountId, "tiktok"), null);
    assert.ok(calls.some((c) => c.url.includes("/oauth/revoke/")), "revoke was called");
  });

  await test("deleting the account removes its connections", async () => {
    await geDb.deleteAccount(accountId);
    assert.deepEqual(await geDb.listConnections(accountId), []);
  });

  // ---- Wave 2: session binding, the refused half-connections, Meta's callbacks.

  // Restoring env: `process.env.X = undefined` stores the STRING "undefined",
  // which is truthy. Absent has to mean deleted.
  const put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

  await test("a state replayed from another browser is refused; the right cookie passes", async () => {
    const acc = "acct_nonce_1";
    const url = connect.authUrl("tiktok", acc, { returnTo: "#/reports" });
    const state = new URL(url).searchParams.get("state");
    const nonce = connect.nonceOf(url);
    assert.match(nonce, /^[0-9a-f]{16}$/, "nonceOf reads the nonce back out of the URL");
    // Wrong cookie → refused before any token is exchanged.
    await assert.rejects(
      () => connect.handleCallback("tiktok", { code: "c", state }, { cookieNonce: "0000000000000000" }),
      (e) => e.code === "BAD_STATE" && /wasn't started in this browser/.test(e.message));
    // Matching cookie → proceeds (and the fake network completes the exchange).
    const r = await connect.handleCallback("tiktok", { code: "c", state }, { cookieNonce: nonce });
    assert.equal(r.accountId, acc);
    await geDb.deleteAccount(acc);
  });

  await test("a personal Instagram account is refused with a plain-language message", async () => {
    const acc = "acct_personal_1";
    routes.unshift({ prefix: "https://graph.instagram.com/v21.0/me?", body: { user_id: "9", username: "just_me", account_type: "PERSONAL", followers_count: 10, media_count: 3 } });
    const u = new URL(connect.authUrl("instagram", acc, {}));
    await assert.rejects(
      () => connect.handleCallback("instagram", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state"))),
      (e) => e.code === "PERSONAL_ACCOUNT" && /Business or Creator/.test(e.message));
    assert.equal(await geDb.getConnection(acc, "instagram"), null, "nothing was stored");
    routes.shift();
  });

  await test("a connection missing a scope is refused rather than half-stored", async () => {
    const acc = "acct_scope_1";
    assert.deepEqual(connect.missingScopes("tiktok", "user.info.basic,video.list"), ["user.info.profile", "user.info.stats"]);
    assert.deepEqual(connect.missingScopes("tiktok", "user.info.basic,user.info.profile,user.info.stats,video.list"), []);
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/oauth/token/", body: { access_token: "a", refresh_token: "r", expires_in: 86400, open_id: "o", scope: "user.info.basic,video.list" } });
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    await assert.rejects(
      () => connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state"))),
      (e) => e.code === "SCOPE_DENIED" && /user\.info\.profile and user\.info\.stats/.test(e.message));
    assert.equal(await geDb.getConnection(acc, "tiktok"), null, "nothing was stored");
    routes.shift();
  });

  await test("a failed refresh marks the connection needs_reconnect instead of failing silently", async () => {
    const acc = "acct_reconnect_1";
    await geDb.setConnection(acc, "tiktok", {
      extUserId: "o", handle: "someone", tokenEnc: require("./crypto").encrypt("old", process.env.ENCRYPTION_KEY),
      refreshEnc: require("./crypto").encrypt("oldrefresh", process.env.ENCRYPTION_KEY),
      expiresAt: Date.now() + 60000, refreshExpiresAt: Date.now() + 86400000, scopes: "user.info.basic", status: "active",
    });
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/oauth/token/", status: 400, body: { error: "invalid_grant", error_description: "Refresh token is invalid" } });
    const conn = await geDb.getConnection(acc, "tiktok");
    await assert.rejects(() => connect.liveToken(conn), (e) => e.code === "RECONNECT");
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(after.status, "needs_reconnect");
    assert.ok(after.lastError, "the reason is recorded for the UI");
    assert.equal(connect.publicView(after).needs_reconnect, true);
    routes.shift();
    await geDb.deleteAccount(acc);
  });

  await test("the first pull reports how many posts came back", async () => {
    const acc = "acct_pull_1";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    await connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state")));
    const pull = await connect.firstPull(acc, "tiktok");
    assert.ok(pull.ok, `first pull should succeed: ${pull.error || ""}`);
    assert.ok(pull.posts > 0, "pulled at least one post");
    assert.deepEqual(await connect.firstPull("acct_nobody", "tiktok"), { posts: 0, followers: null, ok: false, error: "No connection" });
    await geDb.deleteAccount(acc);
  });

  await test("Meta's signed_request verifies against either app secret, and a bad signature is refused", async () => {
    const crypto = require("crypto");
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "ig_12345", issued_at: Math.floor(Date.now() / 1000) })).toString("base64url");
    const signWith = (secret) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const igSig = signWith(process.env.IG_APP_SECRET);
    const metaSig = signWith("meta_test_secret");

    // Meta signs with the Instagram app secret → accepted (IG_APP_SECRET is set).
    delete process.env.META_APP_SECRET;
    assert.equal(connect.parseSignedRequest(`${igSig}.${payload}`).user_id, "ig_12345");
    // …and if it turns out to sign with the Meta app secret, that works too.
    process.env.META_APP_SECRET = "meta_test_secret";
    assert.equal(connect.parseSignedRequest(`${metaSig}.${payload}`).user_id, "ig_12345");
    assert.equal(connect.parseSignedRequest(`${igSig}.${payload}`).user_id, "ig_12345", "the other secret still works");

    // A signature from neither secret is refused.
    assert.throws(() => connect.parseSignedRequest(`${signWith("not_our_secret")}.${payload}`), (e) => e.code === "BAD_SIGNED_REQUEST");
    assert.throws(() => connect.parseSignedRequest(`AAAA.${payload}`), (e) => e.code === "BAD_SIGNED_REQUEST");
    assert.throws(() => connect.parseSignedRequest("nodot"), (e) => e.code === "BAD_SIGNED_REQUEST");

    // A payload that isn't a deletion/deauth request is refused.
    const noUser = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256" })).toString("base64url");
    assert.throws(() => connect.parseSignedRequest(`${crypto.createHmac("sha256", "meta_test_secret").update(noUser).digest("base64url")}.${noUser}`), (e) => e.code === "BAD_SIGNED_REQUEST");

    // With neither secret set we refuse rather than trusting an unverified body.
    const ig = process.env.IG_APP_SECRET;
    delete process.env.META_APP_SECRET; delete process.env.IG_APP_SECRET;
    assert.throws(() => connect.parseSignedRequest(`${igSig}.${payload}`), (e) => e.code === "NO_META_APP_SECRET");
    // Leave the environment as we found it — a test that leaks state makes the
    // next one pass for the wrong reason.
    put("IG_APP_SECRET", ig); put("META_APP_SECRET", undefined);
  });

  await test("deauthorize forgets every connection for that Instagram user", async () => {
    const acc = "acct_deauth_1";
    await geDb.setConnection(acc, "instagram", {
      extUserId: "ig_999", handle: "gone_soon", tokenEnc: require("./crypto").encrypt("t", process.env.ENCRYPTION_KEY),
      expiresAt: Date.now() + 86400000, scopes: "instagram_business_basic",
    });
    assert.equal((await geDb.findConnectionsByExtUserId("instagram", "ig_999")).length, 1);
    const touched = await connect.forgetInstagramUser("ig_999");
    assert.deepEqual(touched.accounts, [acc]);
    assert.deepEqual(touched.failed, [], "a delete that did not happen must never be reported as done");
    assert.equal(await geDb.getConnection(acc, "instagram"), null);
    assert.deepEqual(await geDb.findConnectionsByExtUserId("instagram", "ig_999"), []);
    assert.deepEqual(await connect.forgetInstagramUser("ig_nobody"), { accounts: [], failed: [] }, "an unknown user is a no-op, not an error");
  });

  await test("a data-deletion confirmation code round-trips and rejects tampering", async () => {
    const code = connect.deletionCode("ig_777");
    assert.equal(connect.readDeletionCode(code), "ig_777");
    assert.throws(() => connect.readDeletionCode(code.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAA"), (e) => e.code === "BAD_CODE");
    assert.throws(() => connect.readDeletionCode("rubbish"), (e) => e.code === "BAD_CODE");
  });

  await test("a platform stays off when its flag is switched off, even with credentials set", async () => {
    assert.equal(connect.available().tiktok, true);
    process.env.CONNECT_TIKTOK_ENABLED = "0";
    assert.equal(connect.available().tiktok, false, "the flag subtracts");
    assert.throws(() => connect.authUrl("tiktok", "acct_x", {}), (e) => e.code === "CONNECT_UNAVAILABLE");
    delete process.env.CONNECT_TIKTOK_ENABLED;
    assert.equal(connect.available().tiktok, true);
    // The flag never adds: no credentials means off whatever the flag says.
    const key = process.env.TIKTOK_CLIENT_KEY; delete process.env.TIKTOK_CLIENT_KEY;
    process.env.CONNECT_TIKTOK_ENABLED = "1";
    assert.equal(connect.available().tiktok, false);
    process.env.TIKTOK_CLIENT_KEY = key; delete process.env.CONNECT_TIKTOK_ENABLED;
  });

  await test("the config report names the URLs to register and never a secret", async () => {
    const savedMeta = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = "meta_test_secret"; // this test owns what it asserts on
    const r = connect.configReport();
    assert.equal(r.platforms.tiktok.redirect_uri, "https://scalecraft.test/api/growth-engine/v1/connect/tiktok/callback");
    assert.equal(r.platforms.instagram.redirect_uri, "https://scalecraft.test/api/growth-engine/v1/connect/instagram/callback");
    assert.equal(r.platforms.instagram.deauthorize_url, "https://scalecraft.test/api/growth-engine/v1/connect/instagram/deauthorize");
    assert.equal(r.platforms.instagram.data_deletion_url, "https://scalecraft.test/api/growth-engine/v1/connect/instagram/data-deletion");
    assert.equal(r.platforms.tiktok.scopes, "user.info.basic,user.info.profile,user.info.stats,video.list");
    assert.equal(r.encryption_key, "configured");
    assert.deepEqual(r.signed_request_secrets, ["IG_APP_SECRET", "META_APP_SECRET"], "names only, so it is clear which secrets can verify Meta's callbacks");
    const blob = JSON.stringify(r);
    for (const secret of ["tts_test", "igs_test", "meta_test_secret", "test-secret", process.env.ENCRYPTION_KEY]) {
      assert.ok(!blob.includes(secret), `config report leaked a secret (${secret.slice(0, 6)}…)`);
    }
    put("META_APP_SECRET", savedMeta);
  });


  // ---- Wave 2 coverage pass: the error vocabulary, the cookie options, the
  // lifecycle writes, Meta's stricter payload checks, and the cost rows.
  const costs = require("./growth_engine_costs");
  const enc = (s) => require("./crypto").encrypt(s, process.env.ENCRYPTION_KEY);

  await test("friendly() turns each kind of platform refusal into an actionable code", async () => {
    const f = (platform, message, extra = {}) => connect.friendly(platform, Object.assign(new Error(message), extra));
    assert.equal(f("tiktok", "TikTok token: access_denied").code, "DENIED");
    assert.match(f("tiktok", "TikTok token: the user canceled").message, /nothing was connected/);
    assert.equal(f("tiktok", "TikTok videos: scope_not_authorized for video.list").code, "SCOPE_DENIED");
    assert.equal(f("instagram", "Instagram media: (#10) Application does not have this capability").code, "SCOPE_DENIED");
    assert.equal(f("instagram", "Instagram profile: this app is in development mode").code, "NOT_A_TESTER");
    assert.match(f("instagram", "Instagram profile: not a tester").message, /only accounts we've added as testers/);
    assert.equal(f("instagram", "Instagram profile: OAuthException code 190, the token has expired").code, "RECONNECT");
    assert.equal(f("tiktok", "TikTok refresh: invalid_grant").code, "RECONNECT");
    // Anything unrecognised still names the platform and keeps the detail.
    const other = f("tiktok", "TikTok token: something strange happened");
    assert.equal(other.code, "PLATFORM_ERROR");
    assert.equal(other.message, "TikTok refused the connection: something strange happened");
    // The HTTP status and the original error are carried through for the caller.
    const kept = f("instagram", "Instagram media: (#200) permission", { status: 403 });
    assert.equal(kept.status, 403);
    assert.ok(kept.cause instanceof Error, "the original error is kept as the cause");
    assert.equal(f("tiktok", "boom").status, 400, "no status on the cause defaults to 400");
    // An unknown platform falls back to its own name rather than throwing.
    assert.match(f("myspace", "nope").message, /^myspace refused the connection/);
  });

  await test("missingScopes is lenient when the platform tells us nothing", async () => {
    assert.deepEqual(connect.missingScopes("tiktok", ""), [], "no scope string means we cannot tell, so do not refuse");
    assert.deepEqual(connect.missingScopes("tiktok", null), []);
    assert.deepEqual(connect.missingScopes("myspace", "anything"), [], "an unknown platform wants nothing");
    // Space-separated is as valid as comma-separated, and extras are ignored.
    assert.deepEqual(connect.missingScopes("instagram", "instagram_business_basic instagram_business_manage_insights extra_thing"), []);
    assert.deepEqual(connect.missingScopes("instagram", "instagram_business_basic"), ["instagram_business_manage_insights"]);
  });

  await test("nonceOf throws rather than handing back an empty nonce", async () => {
    // An empty nonce would be set as an empty cookie, and the callback would then
    // blame the browser for what is really a server-side failure to read state.
    assert.throws(() => connect.nonceOf("not a url"));
    assert.throws(() => connect.nonceOf("https://www.tiktok.com/v2/auth/authorize/"), /Missing state/);
    const url = connect.authUrl("tiktok", "acct_nonceof", {});
    const tampered = url.replace(/state=([^&]*)/, (m, st) => `state=${st.split(".")[0]}.AAAA`);
    assert.throws(() => connect.nonceOf(tampered), /signature/);
    assert.match(connect.nonceOf(url), /^[0-9a-f]{16}$/);
  });

  await test("checkNonce refuses an absent cookie as well as every mismatch", async () => {
    const bad = (a, b) => assert.throws(() => connect.checkNonce(a, b), (e) => e.code === "BAD_STATE" && /wasn't started in this browser/.test(e.message));
    // An absent cookie must NOT fall back to the signed state alone. The victim
    // of a connect-CSRF is precisely the person with no cookie, so accepting
    // that case would store their token against the attacker's account.
    bad("abcdef0123456789", "");
    bad("abcdef0123456789", undefined);
    bad("abcdef0123456789", "abcdef012345678x");       // same length, different value
    bad("abcdef0123456789", "abcdef01234567890");      // longer
    bad("abcdef0123456789", "abcdef");                 // shorter
    bad("", "abcdef0123456789");                       // a state with no nonce cannot satisfy a cookie
    assert.equal(connect.checkNonce("same", "same"), undefined);
  });

  await test("the nonce cookie is httpOnly, short-lived, and only secure in production", async () => {
    assert.equal(connect.NONCE_COOKIE, "sc_connect_nonce");
    const was = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    let o = connect.nonceCookieOpts();
    assert.equal(o.httpOnly, true); assert.equal(o.sameSite, "lax"); assert.equal(o.path, "/");
    assert.equal(o.maxAge, 15 * 60 * 1000, "matches the 15-minute state window");
    assert.equal(o.secure, false, "a local http dev server must still get the cookie");
    process.env.NODE_ENV = "production";
    assert.equal(connect.nonceCookieOpts().secure, true);
    if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was;
  });

  await test("the callback refuses an unknown platform, a missing code, and an unencrypted server", async () => {
    const acc = "acct_cb_guards";
    await assert.rejects(() => connect.handleCallback("myspace", {}), (e) => e.code === "BAD_PLATFORM" && e.status === 400);
    const u = new URL(connect.authUrl("tiktok", acc, { returnTo: "#/reports" }));
    const state = u.searchParams.get("state");
    await assert.rejects(() => connect.handleCallback("tiktok", { state }, ck(state)),
      (e) => e.code === "NO_CODE" && e.accountId === acc && e.returnTo === "#/reports");
    // Refusing to store a token in the clear is a 500: it is our misconfiguration.
    const key = process.env.ENCRYPTION_KEY; delete process.env.ENCRYPTION_KEY;
    await assert.rejects(() => connect.handleCallback("tiktok", { code: "c", state }, ck(state)),
      (e) => e.code === "NO_ENCRYPTION_KEY" && e.status === 500);
    process.env.ENCRYPTION_KEY = key;
    assert.equal(await geDb.getConnection(acc, "tiktok"), null, "nothing was stored by any of the refusals");
  });

  await test("a platform that rejects the exchange comes back friendly, with the return target, storing nothing", async () => {
    const acc = "acct_cb_friendly";
    const u = new URL(connect.authUrl("tiktok", acc, { returnTo: "#/report/r5" }));
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/oauth/token/", status: 400, body: { error: "invalid_client", error_description: "Client key is not approved: invalid_client" } });
    await assert.rejects(
      () => connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state"))),
      (e) => e.code === "NOT_A_TESTER" && e.accountId === acc && e.returnTo === "#/report/r5" && /still in review/.test(e.message));
    routes.shift();
    assert.equal(await geDb.getConnection(acc, "tiktok"), null, "a failed exchange stores nothing");
  });

  await test("a first pull that fails leaves the connection in place and records why", async () => {
    const acc = "acct_pull_fail";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    await connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state")));
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/user/info/", status: 400, body: { error: { code: "scope_not_authorized", message: "scope_not_authorized" } } });
    const pull = await connect.firstPull(acc, "tiktok");
    routes.shift();
    assert.equal(pull.ok, false);
    assert.equal(pull.posts, 0);
    assert.equal(pull.followers, null);
    assert.match(pull.error, /didn't grant everything/, "the reported reason is the friendly one, not the raw platform text");
    const after = await geDb.getConnection(acc, "tiktok");
    assert.ok(after, "the connection survives — the token is good, only this read failed");
    assert.ok(after.lastError, "the reason is on the row for the UI");
    await geDb.deleteAccount(acc);
  });

  await test("firstPull on a platform we do not support is a no-op, not a throw", async () => {
    assert.deepEqual(await connect.firstPull("acct_whatever", "myspace"), { posts: 0, followers: null, ok: false, error: "No connection" });
  });

  await test("a TikTok token near expiry with no refresh token asks the user to reconnect", async () => {
    const acc = "acct_norefresh";
    await geDb.setConnection(acc, "tiktok", { extUserId: "o", handle: "norefresh", tokenEnc: enc("old"), refreshEnc: null, expiresAt: Date.now() + 60000, scopes: "user.info.basic" });
    const conn = await geDb.getConnection(acc, "tiktok");
    await assert.rejects(() => connect.liveToken(conn),
      (e) => e.code === "RECONNECT" && /no refresh token/.test(e.message));
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(after.status, "needs_reconnect");
    assert.equal(connect.publicView(after).needs_reconnect, true);
    await geDb.deleteAccount(acc);
  });

  await test("an expired TikTok refresh token asks the user to reconnect without calling the platform", async () => {
    const acc = "acct_staleref";
    await geDb.setConnection(acc, "tiktok", { extUserId: "o", handle: "staleref", tokenEnc: enc("old"), refreshEnc: enc("r"), expiresAt: Date.now() + 60000, refreshExpiresAt: Date.now() - 1000, scopes: "user.info.basic" });
    const conn = await geDb.getConnection(acc, "tiktok");
    const before = calls.length;
    await assert.rejects(() => connect.liveToken(conn),
      (e) => e.code === "RECONNECT" && /refresh token expired/.test(e.message));
    assert.equal(calls.length, before, "we know it is hopeless, so no request is made");
    assert.equal((await geDb.getConnection(acc, "tiktok")).status, "needs_reconnect");
    await geDb.deleteAccount(acc);
  });

  await test("a successful refresh clears needs_reconnect and the recorded reason", async () => {
    const acc = "acct_recovers";
    await geDb.setConnection(acc, "tiktok", { extUserId: "o", handle: "recovers", tokenEnc: enc("old"), refreshEnc: enc("r"), expiresAt: Date.now() + 60000, refreshExpiresAt: Date.now() + 86400000, scopes: "user.info.basic", status: "needs_reconnect", lastError: "it was revoked" });
    const tok = await connect.liveToken(await geDb.getConnection(acc, "tiktok"));
    assert.equal(tok, "tt_refreshed");
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(after.status, "active");
    assert.equal(after.lastError, null);
    assert.equal(connect.publicView(after).needs_reconnect, false);
    await geDb.deleteAccount(acc);
  });

  await test("a token nowhere near expiry is decrypted and used as it is", async () => {
    const acc = "acct_fresh";
    await geDb.setConnection(acc, "tiktok", { extUserId: "o", handle: "fresh", tokenEnc: enc("still_good"), refreshEnc: enc("r"), expiresAt: Date.now() + 30 * 86400000, scopes: "user.info.basic" });
    const before = calls.length;
    assert.equal(await connect.liveToken(await geDb.getConnection(acc, "tiktok")), "still_good");
    assert.equal(calls.length, before, "no refresh round trip");
    await geDb.deleteAccount(acc);
  });

  await test("the refresh sweep counts each outcome and does not overwrite a reconnect reason", async () => {
    const good = "acct_sweep_ok", dead = "acct_sweep_dead";
    // Inside TikTok's one-hour "about to expire" window, so the sweep acts on both.
    await geDb.setConnection(good, "tiktok", { extUserId: "o1", handle: "sweepok", tokenEnc: enc("old"), refreshEnc: enc("r"), expiresAt: Date.now() + 10 * 60 * 1000, refreshExpiresAt: Date.now() + 86400000, scopes: "user.info.basic" });
    await geDb.setConnection(dead, "tiktok", { extUserId: "o2", handle: "sweepdead", tokenEnc: enc("old"), refreshEnc: null, expiresAt: Date.now() + 10 * 60 * 1000, scopes: "user.info.basic" });
    const r = await connect.refreshDue();
    assert.equal(r.checked, 2); assert.equal(r.refreshed, 1); assert.equal(r.failed, 1);
    assert.equal((await geDb.getConnection(good, "tiktok")).status, "active");
    const d = await geDb.getConnection(dead, "tiktok");
    assert.equal(d.status, "needs_reconnect", "the sweep must not undo the status markNeedsReconnect set");
    assert.match(d.lastError, /reconnect/i);
    await geDb.deleteAccount(good); await geDb.deleteAccount(dead);
  });

  await test("signed_request refuses an algorithm other than HMAC-SHA256 and accepts a payload that omits it", async () => {
    const crypto = require("crypto");
    const signed = (obj) => { const p = Buffer.from(JSON.stringify(obj)).toString("base64url"); return `${crypto.createHmac("sha256", process.env.IG_APP_SECRET).update(p).digest("base64url")}.${p}`; };
    assert.throws(() => connect.parseSignedRequest(signed({ algorithm: "AES-256", user_id: "ig_1" })), (e) => e.code === "BAD_SIGNED_REQUEST" && /algorithm/.test(e.message));
    // Case is not meaningful, and Meta may omit the field entirely.
    assert.equal(connect.parseSignedRequest(signed({ algorithm: "hmac-sha256", user_id: "ig_2" })).user_id, "ig_2");
    assert.equal(connect.parseSignedRequest(signed({ user_id: "ig_3" })).user_id, "ig_3");
    assert.throws(() => connect.parseSignedRequest(signed({ user_id: "" })), (e) => e.code === "BAD_SIGNED_REQUEST" && /user_id/.test(e.message));
    assert.throws(() => connect.parseSignedRequest(undefined), (e) => e.code === "BAD_SIGNED_REQUEST");
  });

  await test("a deletion code is unique per request and refuses a payload with no user", async () => {
    const a = connect.deletionCode("ig_dup"), b = connect.deletionCode("ig_dup");
    assert.equal(connect.readDeletionCode(a), "ig_dup");
    assert.equal(connect.readDeletionCode(b), "ig_dup");
    // Numbers are accepted and read back as the string Meta sent.
    assert.equal(connect.readDeletionCode(connect.deletionCode(12345)), "12345");
    const payload = Buffer.from(JSON.stringify({ t: Date.now() })).toString("base64url");
    const sig = require("crypto").createHmac("sha256", process.env.JWT_SECRET).update(payload).digest("base64url").slice(0, 24);
    assert.throws(() => connect.readDeletionCode(`${payload}.${sig}`), (e) => e.code === "BAD_CODE" && /no user/.test(e.message));
    assert.throws(() => connect.readDeletionCode(""), (e) => e.code === "BAD_CODE");
    assert.throws(() => connect.readDeletionCode(null), (e) => e.code === "BAD_CODE");
  });

  await test("findConnectionsByExtUserId is scoped by platform and safe on empty input", async () => {
    const one = "acct_ext_a", two = "acct_ext_b";
    for (const acc of [one, two]) await geDb.setConnection(acc, "instagram", { extUserId: "ig_shared", handle: acc, tokenEnc: enc("t"), expiresAt: Date.now() + 86400000, scopes: "instagram_business_basic" });
    await geDb.setConnection(one, "tiktok", { extUserId: "ig_shared", handle: "same_id_other_platform", tokenEnc: enc("t"), expiresAt: Date.now() + 86400000, scopes: "user.info.basic" });
    const found = await geDb.findConnectionsByExtUserId("instagram", "ig_shared");
    assert.deepEqual(found.map((c) => c.accountId).sort(), [one, two], "both accounts, and only the Instagram rows");
    assert.deepEqual(await geDb.findConnectionsByExtUserId("instagram", ""), []);
    assert.deepEqual(await geDb.findConnectionsByExtUserId("", "ig_shared"), []);
    assert.deepEqual(await geDb.findConnectionsByExtUserId("instagram", null), []);
    // One deauthorize wipes every account that shares that Instagram user.
    const forgot = await connect.forgetInstagramUser("ig_shared");
    assert.deepEqual(forgot.accounts.sort(), [one, two]);
    assert.deepEqual(forgot.failed, []);
    assert.equal((await geDb.findConnectionsByExtUserId("instagram", "ig_shared")).length, 0);
    assert.ok(await geDb.getConnection(one, "tiktok"), "the TikTok row is untouched");
    await geDb.deleteAccount(one); await geDb.deleteAccount(two);
  });

  await test("status and source default sensibly and round-trip through the connections table", async () => {
    const acc = "acct_cols";
    await geDb.setConnection(acc, "tiktok", { extUserId: "o", handle: "cols", tokenEnc: enc("t"), expiresAt: Date.now() + 86400000, scopes: "user.info.basic" });
    let c = await geDb.getConnection(acc, "tiktok");
    assert.equal(c.status, "active", "an existing connection reads as active without the column being set");
    assert.equal(c.source, "oauth");
    const pv = connect.publicView(c);
    assert.equal(pv.status, "active"); assert.equal(pv.needs_reconnect, false);
    assert.equal(pv.updated_at, c.updatedAt);
    assert.ok(!("source" in pv), "source is internal and stays out of the public view");
    // A non-OAuth origin survives a rewrite, which is what `source` exists for.
    await geDb.setConnection(acc, "tiktok", { ...c, source: "manual", status: "needs_reconnect" });
    c = await geDb.getConnection(acc, "tiktok");
    assert.equal(c.source, "manual"); assert.equal(c.status, "needs_reconnect");
    assert.equal(connect.publicView(null), null);
    await geDb.deleteAccount(acc);
  });

  await test("every official platform API call is recorded as an api cost under the right provider", async () => {
    const settle = () => new Promise((r) => setImmediate(r));
    const apiRows = async () => { await settle(); const c = await geDb.adminCosts(0); return Object.fromEntries((c.by_provider || []).map((r) => [r.key, r.n])); };
    const before = await apiRows();
    const n = (m, k) => m[k] || 0;
    routes.unshift({ prefix: "https://example.test/", body: { ok: true } });
    await connect._call("https://open.tiktokapis.com/v2/user/info/?fields=x", { label: "TikTok user info" });
    await connect._call("https://graph.instagram.com/v21.0/me?x=1", { label: "Instagram profile" });
    await connect._call("https://example.test/anything", { label: "not a platform" });
    routes.shift();
    const after = await apiRows();
    assert.equal(n(after, "tiktok-open") - n(before, "tiktok-open"), 1);
    assert.equal(n(after, "instagram-graph") - n(before, "instagram-graph"), 1);
    assert.equal(n(after, "not a platform"), 0, "a host that is not a platform API records nothing");
    const kinds = Object.fromEntries((await geDb.adminCosts(0)).by_kind.map((r) => [r.key, r.n]));
    assert.ok(kinds.api > 0, "the rows land under the new api kind");
    // Free at our volume, so the money column must stay at zero.
    assert.equal((await geDb.adminCosts(0)).by_kind.find((r) => r.key === "api").cents, 0);
    assert.equal(costs.RATES.api["tiktok-open"], 0);
    assert.equal(costs.RATES.api._default, 0);
    assert.equal(costs.RATES.api.unknown_unit, undefined);
  });

  await test("the config report says why a platform is off, and survives a bare server", async () => {
    const saved = { tt: process.env.TIKTOK_CLIENT_SECRET, jwt: process.env.JWT_SECRET, encKey: process.env.ENCRYPTION_KEY, ig: process.env.IG_APP_SECRET, meta: process.env.META_APP_SECRET };
    try {
    // Credentials missing → off, and the report says which half is missing.
    delete process.env.TIKTOK_CLIENT_SECRET;
    let r = connect.configReport();
    assert.equal(r.platforms.tiktok.enabled, false);
    assert.equal(r.platforms.tiktok.credentials, "missing");
    assert.equal(r.platforms.tiktok.flag, "on", "the flag is on; it is the credentials that are absent");
    process.env.TIKTOK_CLIENT_SECRET = saved.tt;
    // Flag off with credentials present → off, naming the variable to flip.
    process.env.CONNECT_INSTAGRAM_ENABLED = "false";
    r = connect.configReport();
    assert.equal(r.platforms.instagram.enabled, false);
    assert.equal(r.platforms.instagram.credentials, "configured");
    assert.equal(r.platforms.instagram.flag, "off (CONNECT_INSTAGRAM_ENABLED)");
    delete process.env.CONNECT_INSTAGRAM_ENABLED;
    // A server with nothing set still renders, and says so in words an operator can act on.
    delete process.env.JWT_SECRET; delete process.env.ENCRYPTION_KEY; delete process.env.IG_APP_SECRET; delete process.env.META_APP_SECRET;
    r = connect.configReport();
    assert.equal(r.encryption_key, "missing");
    assert.equal(r.jwt_secret, "missing (dev default outside production)");
    assert.deepEqual(r.signed_request_secrets, [], "no secret can verify Meta's callbacks yet");
    assert.equal(r.platforms.instagram.enabled, false);
    } finally {
      // Restore even on a failed assertion: leaving the env stripped turns one
      // red test into a dozen.
      put("TIKTOK_CLIENT_SECRET", saved.tt); put("JWT_SECRET", saved.jwt); put("ENCRYPTION_KEY", saved.encKey);
      put("IG_APP_SECRET", saved.ig); put("META_APP_SECRET", saved.meta); delete process.env.CONNECT_INSTAGRAM_ENABLED;
    }
    assert.equal(connect.configReport().platforms.instagram.enabled, true);
  });

  // ---- Defects found by the ship coverage audit, fixed and pinned here.

  await test("a first pull whose refresh fails keeps needs_reconnect instead of resetting it", async () => {
    const acc = "acct_pull_reconnect";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    await connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state")));
    // Push the stored token to the edge of expiry so the pull has to refresh…
    const c0 = await geDb.getConnection(acc, "tiktok");
    await geDb.setConnection(acc, "tiktok", { ...c0, expiresAt: Date.now() + 60000 });
    // …and make that refresh fail, which marks the row needs_reconnect.
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/oauth/token/", status: 400, body: { error: "invalid_grant", error_description: "Refresh token is invalid" } });
    const pull = await connect.firstPull(acc, "tiktok");
    routes.shift();
    assert.equal(pull.ok, false);
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(after.status, "needs_reconnect", "firstPull must not write the pre-fetch row back over the new status");
    assert.equal(connect.publicView(after).needs_reconnect, true, "so the UI still offers Reconnect");
    await geDb.deleteAccount(acc);
  });

  await test("a first pull that refreshes mid-read does not write the old token back", async () => {
    const acc = "acct_pull_token";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    await connect.handleCallback("tiktok", { code: "c", state: u.searchParams.get("state") }, ck(u.searchParams.get("state")));
    const before = await geDb.getConnection(acc, "tiktok");
    await geDb.setConnection(acc, "tiktok", { ...before, expiresAt: Date.now() + 60000 });
    // The refresh succeeds and hands back a different token.
    routes.unshift({ prefix: "https://open.tiktokapis.com/v2/oauth/token/", body: { access_token: "refreshed-token", refresh_token: "r2", expires_in: 86400, refresh_expires_in: 31536000, open_id: "o" } });
    const pull = await connect.firstPull(acc, "tiktok");
    routes.shift();
    assert.ok(pull.ok, `expected the pull to succeed: ${pull.error || ""}`);
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(require("./crypto").decrypt(after.tokenEnc, process.env.ENCRYPTION_KEY), "refreshed-token", "the refreshed token survives the success write");
    assert.ok(after.expiresAt > Date.now() + 3600000, "and so does its new expiry");
    await geDb.deleteAccount(acc);
  });

  await test("a platform error carrying a description is not reported as a cancellation", async () => {
    const acc = "acct_denied_precedence";
    const mk = () => new URL(connect.authUrl("tiktok", acc, { returnTo: "#/reports" })).searchParams.get("state");
    // access_denied with no description: a real cancellation.
    const s1 = mk();
    await assert.rejects(
      () => connect.handleCallback("tiktok", { error: "access_denied", state: s1 }, ck(s1)),
      (e) => e.code === "DENIED" && /cancelled/i.test(e.message) && e.returnTo === "#/reports");
    // access_denied WITH a description: still a cancellation.
    const s2 = mk();
    await assert.rejects(
      () => connect.handleCallback("tiktok", { error: "access_denied", error_description: "The user denied the request", state: s2 }, ck(s2)),
      (e) => e.code === "DENIED" && /cancelled/i.test(e.message));
    // A different error that happens to carry a description must NOT say "you cancelled".
    const s3 = mk();
    await assert.rejects(
      () => connect.handleCallback("tiktok", { error: "invalid_client", error_description: "Client key is not approved", state: s3 }, ck(s3)),
      (e) => e.code !== "DENIED" && !/cancelled/i.test(e.message) && e.returnTo === "#/reports");
  });

  await test("a connect link started by someone else cannot attach a victim's account", async () => {
    // The attack the nonce cookie exists to stop: the attacker mints a state
    // bound to THEIR account, sends the victim the platform's authorize URL, and
    // the platform redirects the victim's browser to our callback — which has no
    // session of its own. The victim has no cookie, and that must be refused.
    const attacker = "acct_attacker", victim = "acct_victim";
    const url = connect.authUrl("tiktok", attacker, {});
    const state = new URL(url).searchParams.get("state");
    await assert.rejects(
      () => connect.handleCallback("tiktok", { code: "victim-code", state }, { cookieNonce: "" }),
      (e) => e.code === "BAD_STATE");
    assert.equal(await geDb.getConnection(attacker, "tiktok"), null, "no token was stored against the attacker");
    assert.equal(await geDb.getConnection(victim, "tiktok"), null);
  });

  await test("Instagram scopes are recorded only when the platform reports them", async () => {
    const acc = "acct_igscope";
    // Instagram's token response omits `permissions`: we must store "unknown",
    // not the list we asked for — otherwise the scope check passes by construction.
    routes.unshift({ prefix: "https://api.instagram.com/oauth/access_token", body: { access_token: "ig_short", user_id: 17841400000 } });
    const u = new URL(connect.authUrl("instagram", acc, {}));
    const st = u.searchParams.get("state");
    const r = await connect.handleCallback("instagram", { code: "c", state: st }, ck(st));
    routes.shift();
    assert.equal(r.accountId, acc);
    const conn = await geDb.getConnection(acc, "instagram");
    assert.equal(conn.scopes, null, "an unreported grant is unknown, never assumed complete");
    assert.equal(connect.publicView(conn).scopes, null);
    // And when it does report them, they are stored verbatim.
    const acc2 = "acct_igscope2";
    const u2 = new URL(connect.authUrl("instagram", acc2, {}));
    const st2 = u2.searchParams.get("state");
    await connect.handleCallback("instagram", { code: "c", state: st2 }, ck(st2));
    assert.equal((await geDb.getConnection(acc2, "instagram")).scopes, "instagram_business_basic,instagram_business_manage_insights");
    await geDb.deleteAccount(acc); await geDb.deleteAccount(acc2);
  });

  await test("a stale signed_request is refused, a fresh one is accepted", async () => {
    const crypto = require("crypto");
    const mk = (issued_at) => {
      const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "ig_stale", ...(issued_at === undefined ? {} : { issued_at }) })).toString("base64url");
      return `${crypto.createHmac("sha256", process.env.IG_APP_SECRET).update(payload).digest("base64url")}.${payload}`;
    };
    const now = Math.floor(Date.now() / 1000);
    assert.equal(connect.parseSignedRequest(mk(now)).user_id, "ig_stale", "a fresh one goes through");
    assert.equal(connect.parseSignedRequest(mk(now - 60)).user_id, "ig_stale", "a minute old is still inside the window");
    assert.throws(() => connect.parseSignedRequest(mk(now - 3600)), (e) => e.code === "STALE_SIGNED_REQUEST");
    // Absent issued_at stays accepted on the signature alone — see the comment there.
    assert.equal(connect.parseSignedRequest(mk(undefined)).user_id, "ig_stale");
  });

  await test("a first pull that overruns its budget gives up rather than hanging the redirect", async () => {
    const acc = "acct_pull_slow";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    const st = u.searchParams.get("state");
    await connect.handleCallback("tiktok", { code: "c", state: st }, ck(st));
    const before = await geDb.getConnection(acc, "tiktok");
    process.env.CONNECT_FIRST_PULL_MS = "60";
    const realFetch = global.fetch;
    global.fetch = async (...a) => { await new Promise((r) => setTimeout(r, 400)); return realFetch(...a); };
    const t0 = Date.now();
    const pull = await connect.firstPull(acc, "tiktok");
    const elapsed = Date.now() - t0;
    global.fetch = realFetch; delete process.env.CONNECT_FIRST_PULL_MS;
    assert.equal(pull.ok, false);
    assert.equal(pull.posts, 0);
    assert.match(pull.error, /longer than/, "the user is told why there is no count");
    assert.ok(elapsed < 350, `gave up at the budget, not the upstream call (took ${elapsed}ms)`);
    const after = await geDb.getConnection(acc, "tiktok");
    assert.equal(after.status, "active", "a slow read is not a broken connection");
    assert.equal(after.lastError, null, "and leaves no error on the row");
    assert.equal(after.tokenEnc, before.tokenEnc);
    await geDb.deleteAccount(acc);
  });

  await test("a write cannot resurrect a connection that was deleted mid-flight", async () => {
    // setConnection is an upsert. After a Meta data-deletion request, a refresh
    // still in flight used to put the row — and its encrypted token — straight
    // back, undoing a deletion we had already reported as done.
    const acc = "acct_resurrect";
    const u = new URL(connect.authUrl("tiktok", acc, {}));
    const st = u.searchParams.get("state");
    await connect.handleCallback("tiktok", { code: "c", state: st }, ck(st));
    const conn = await geDb.getConnection(acc, "tiktok");
    assert.ok(conn, "connected to begin with");
    await geDb.deleteConnection(acc, "tiktok");            // Meta deauthorizes
    await connect.patchConnection(acc, "tiktok", { status: "active", lastError: null });
    assert.equal(await geDb.getConnection(acc, "tiktok"), null, "the deletion stands");
    // The same guard protects the refresh path's own write.
    await assert.rejects(() => connect.liveToken({ ...conn, expiresAt: Date.now() - 1, refreshEnc: null }), (e) => e.code === "RECONNECT");
    assert.equal(await geDb.getConnection(acc, "tiktok"), null, "a failed refresh does not re-create it either");
  });

  await test("each platform carries its own nonce cookie", async () => {
    // One shared cookie meant connecting the second platform invalidated the
    // first, and finishing either cleared the other's trip.
    assert.equal(connect.nonceCookie("tiktok"), "sc_connect_nonce_tiktok");
    assert.equal(connect.nonceCookie("instagram"), "sc_connect_nonce_instagram");
    assert.notEqual(connect.nonceCookie("tiktok"), connect.nonceCookie("instagram"));
    const acc = "acct_two_tabs";
    const ttNonce = connect.nonceOf(connect.authUrl("tiktok", acc, {}));
    const igUrl = connect.authUrl("instagram", acc, {});
    const igNonce = connect.nonceOf(igUrl);
    assert.notEqual(ttNonce, igNonce);
    // The Instagram trip still completes with its own cookie after the TikTok
    // one was started.
    const r = await connect.handleCallback("instagram", { code: "c", state: new URL(igUrl).searchParams.get("state") }, { cookieNonce: igNonce });
    assert.equal(r.accountId, acc);
    await geDb.deleteAccount(acc);
  });

  await test("a future-dated signed_request is refused, not accepted forever", async () => {
    const crypto = require("crypto");
    const mk = (issued_at) => {
      const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "ig_future", issued_at })).toString("base64url");
      return `${crypto.createHmac("sha256", process.env.IG_APP_SECRET).update(payload).digest("base64url")}.${payload}`;
    };
    const now = Math.floor(Date.now() / 1000);
    assert.throws(() => connect.parseSignedRequest(mk(now + 3600)), (e) => e.code === "STALE_SIGNED_REQUEST", "an hour in the future would otherwise replay for an hour");
    assert.equal(connect.parseSignedRequest(mk(now + 10)).user_id, "ig_future", "small clock skew is tolerated");
    // issued_at: 0 is falsy — it must still be range-checked, not skipped.
    assert.throws(() => connect.parseSignedRequest(mk(0)), (e) => e.code === "STALE_SIGNED_REQUEST");
  });

  await test("the refresh sweep leaves needs_reconnect connections alone", async () => {
    const acc = "acct_sweep";
    await geDb.setConnection(acc, "tiktok", {
      extUserId: "o", handle: "dead", tokenEnc: require("./crypto").encrypt("t", process.env.ENCRYPTION_KEY),
      expiresAt: Date.now() + 1000, scopes: "user.info.basic", status: "needs_reconnect", lastError: "revoked",
    });
    const due = await geDb.listConnectionsExpiringBefore(Date.now() + 8 * 86400000);
    assert.ok(!due.some((c) => c.accountId === acc), "only the user can fix it; retrying every sweep burns rate limit and spams the funnel");
    await geDb.deleteAccount(acc);
  });

  console.log(`${passed} passed`);
  try { fs.unlinkSync(process.env.GROWTH_ENGINE_DB); } catch { /* fine */ }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
