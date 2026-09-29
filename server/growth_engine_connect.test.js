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

  await test("state round-trips, is bound to the account, and rejects tampering", async () => {
    const st = connect.makeState({ accountId, platform: "tiktok", returnTo: "#/reports", verifier: "v1" });
    const back = connect.readState(st);
    assert.deepEqual(back, { accountId, platform: "tiktok", returnTo: "#/reports", verifier: "v1" });
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
    const r = await connect.handleCallback("tiktok", { code: "abc", state: ttUrl.searchParams.get("state") });
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
    await assert.rejects(() => connect.handleCallback("instagram", { code: "abc", state: ttUrl.searchParams.get("state") }), /mismatch/);
    await assert.rejects(() => connect.handleCallback("tiktok", { code: "abc", state: "x.y" }), /signature/);
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
    const r = await connect.handleCallback("instagram", { code: "igcode", state: u.searchParams.get("state") });
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
    await assert.rejects(() => connect.handleCallback("instagram", { error: "access_denied", state: u.searchParams.get("state") }), (e) => e.code === "DENIED" && e.returnTo === "#/reports" && e.accountId === accountId);
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

  console.log(`${passed} passed`);
  try { fs.unlinkSync(process.env.GROWTH_ENGINE_DB); } catch { /* fine */ }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
