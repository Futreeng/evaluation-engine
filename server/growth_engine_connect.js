/**
 * Connected accounts — the official Instagram and TikTok APIs.
 *
 * A signed-in user clicks "Connect", authorizes on the platform's own page,
 * and comes back to our callback. We store the token encrypted (same
 * ENCRYPTION_KEY as the LLM keys) and, from then on, score that handle from
 * the API instead of the public scrape: same report shape, plus the numbers a
 * scrape can't see (Instagram saves, reach and shares; TikTok's own counts).
 *
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET   developers.tiktok.com → app → Credentials
 *   IG_APP_ID / IG_APP_SECRET                  developers.facebook.com → Use cases → Instagram API setup
 *   APP_URL                                    public origin; callbacks are
 *     {APP_URL}/api/growth-engine/v1/connect/tiktok/callback
 *     {APP_URL}/api/growth-engine/v1/connect/instagram/callback
 *   (both are registered in the platform dashboards — docs/TIKTOK_APP.md, docs/META_APP.md)
 *
 * Nothing here posts, messages, or reads any account other than the one that
 * authorized. Disconnect deletes the token; account deletion does too.
 */

const crypto = require("crypto");
const geDb = require("./growth_engine_db_select");
const { encrypt, decrypt } = require("./crypto");
const { buildInstagramData } = require("./instagram_apify_fetcher");
const { buildTikTokData } = require("./tiktok_apify_fetcher");
const costs = require("./growth_engine_costs");

const APP = () => (process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "");
const SECRET = () => process.env.JWT_SECRET || "dev";
const ENC = () => process.env.ENCRYPTION_KEY;
const POSTS = Math.max(12, Math.min(50, Number(process.env.SCRAPE_POSTS || 30)));

// A platform is off unless its credentials are present AND its flag isn't
// explicitly switched off. The flag only ever subtracts: setting it to "1" on a
// server with no credentials still leaves the platform off, so nothing can
// half-work in production.
const flagOff = (name) => ["0", "false", "off", "no"].includes(String(process.env[name] ?? "").trim().toLowerCase());

const PLATFORMS = {
  tiktok: {
    label: "TikTok",
    flag: "CONNECT_TIKTOK_ENABLED",
    credentials: () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    configured: () => PLATFORMS.tiktok.credentials() && !flagOff("CONNECT_TIKTOK_ENABLED"),
    scopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
    redirect: () => `${APP()}/api/growth-engine/v1/connect/tiktok/callback`,
  },
  instagram: {
    label: "Instagram",
    flag: "CONNECT_INSTAGRAM_ENABLED",
    credentials: () => !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET),
    configured: () => PLATFORMS.instagram.credentials() && !flagOff("CONNECT_INSTAGRAM_ENABLED"),
    scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    redirect: () => `${APP()}/api/growth-engine/v1/connect/instagram/callback`,
  },
};
const platformOf = (p) => (PLATFORMS[String(p || "").toLowerCase()] ? String(p).toLowerCase() : null);
const available = () => Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, v.configured()]));

/**
 * Why each platform is on or off, for /health. Names only — never a secret,
 * never a token, so this is safe to expose on an unauthenticated endpoint.
 */
function configReport() {
  const out = {
    app_url: APP(),
    encryption_key: ENC() ? "configured" : "missing",
    jwt_secret: process.env.JWT_SECRET ? "configured" : "missing (using dev default)",
    meta_app_secret: process.env.META_APP_SECRET ? "configured" : "missing",
    platforms: {},
  };
  for (const [k, v] of Object.entries(PLATFORMS)) {
    out.platforms[k] = {
      enabled: v.configured(),
      credentials: v.credentials() ? "configured" : "missing",
      flag: flagOff(v.flag) ? `off (${v.flag})` : "on",
      redirect_uri: v.redirect(),
      scopes: v.scopes.join(","),
    };
  }
  out.platforms.instagram.deauthorize_url = `${APP()}/api/growth-engine/v1/connect/instagram/deauthorize`;
  out.platforms.instagram.data_deletion_url = `${APP()}/api/growth-engine/v1/connect/instagram/data-deletion`;
  return out;
}

// ---- state: who started this, where to send them back, and (TikTok) the PKCE verifier.
// Signed with JWT_SECRET so a forged callback can't attach someone else's account.
const b64u = (b) => Buffer.from(b).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", SECRET()).update(payload).digest("base64url");
function makeState({ accountId, platform, returnTo = "", verifier = "" }) {
  const payload = b64u(JSON.stringify({ a: accountId, p: platform, r: String(returnTo).slice(0, 200), v: verifier, t: Date.now(), n: crypto.randomBytes(8).toString("hex") }));
  return `${payload}.${sign(payload)}`;
}
function readState(state, { maxAgeMs = 15 * 60 * 1000 } = {}) {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) throw Object.assign(new Error("Missing state"), { code: "BAD_STATE" });
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw Object.assign(new Error("State signature failed"), { code: "BAD_STATE" });
  const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!s.a || !s.p || Date.now() - s.t > maxAgeMs) throw Object.assign(new Error("Connect link expired — start again"), { code: "BAD_STATE" });
  return { accountId: s.a, platform: s.p, returnTo: s.r || "", verifier: s.v || "", nonce: s.n || "" };
}

// ---- session binding.
// The signed state already names the account and expires in 15 minutes, so a
// forged callback is impossible. This cookie closes the remaining gap: a valid
// state replayed from a different browser. Set when we mint the URL, required
// to match on the way back. SameSite=Lax so it survives the platform's
// top-level GET redirect back to us.
const NONCE_COOKIE = "sc_connect_nonce";
const nonceCookieOpts = () => ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 15 * 60 * 1000, path: "/" });
/** The nonce inside an auth URL we just produced, for the caller to put in the cookie. */
function nonceOf(url) {
  try { return readState(new URL(url).searchParams.get("state")).nonce; } catch { return ""; }
}
/**
 * Compare the nonce in the returned state against the cookie.
 * A present-but-different cookie is a replay and is refused. An absent cookie
 * (cookies blocked, or a connect started in another browser) falls back to
 * signature-only verification, which is what this flow did before — it is not
 * worth stranding a real user over.
 */
function checkNonce(stateNonce, cookieNonce, { platform = "" } = {}) {
  if (!cookieNonce) { console.warn(`[Connect] ${platform} callback had no ${NONCE_COOKIE} cookie — accepting on the signed state alone`); return; }
  const a = Buffer.from(String(stateNonce || "")), b = Buffer.from(String(cookieNonce));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error("This connect link was not started in this browser — start again from your account page."), { code: "BAD_STATE" });
}

/** The URL to send the browser to. */
function authUrl(platform, accountId, { returnTo = "" } = {}) {
  const p = platformOf(platform); if (!p) throw Object.assign(new Error("Unknown platform"), { status: 400, code: "BAD_PLATFORM" });
  if (!PLATFORMS[p].configured()) throw Object.assign(new Error(`${PLATFORMS[p].label} connect isn't configured on this server yet`), { status: 503, code: "CONNECT_UNAVAILABLE" });
  if (p === "tiktok") {
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = makeState({ accountId, platform: p, returnTo, verifier });
    const q = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, scope: PLATFORMS.tiktok.scopes.join(","), response_type: "code", redirect_uri: PLATFORMS.tiktok.redirect(), state, code_challenge: challenge, code_challenge_method: "S256" });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  }
  const state = makeState({ accountId, platform: p, returnTo });
  const q = new URLSearchParams({ client_id: process.env.IG_APP_ID, redirect_uri: PLATFORMS.instagram.redirect(), response_type: "code", scope: PLATFORMS.instagram.scopes.join(","), state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

// ---- HTTP with readable errors
async function call(url, { method = "GET", headers = {}, form = null, json = null, bearer = null, label = "api" } = {}) {
  const h = { ...headers };
  let body;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  if (json) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  // Every call to an official platform API is recorded under the existing cost
  // tracking: free at our volume, but the call count is what hits rate limits.
  try {
    const host = new URL(url).host;
    const unit = host.includes("tiktokapis") || host.includes("tiktok.com") ? "tiktok-open" : host.includes("instagram") ? "instagram-graph" : null;
    if (unit) costs.api({ unit, endpoint: label, platform: unit === "tiktok-open" ? "tiktok" : "instagram" });
  } catch { /* never let accounting break a fetch */ }
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.message || (typeof data?.error === "string" ? data.error : null) || text.slice(0, 200) || `${res.status}`;
    throw Object.assign(new Error(`${label}: ${msg}`), { status: res.status >= 500 ? 502 : 400, code: "PLATFORM_ERROR", platformStatus: res.status });
  }
  // TikTok wraps errors in a 200 with error.code !== "ok"
  if (data?.error && typeof data.error === "object" && data.error.code && data.error.code !== "ok") {
    throw Object.assign(new Error(`${label}: ${data.error.message || data.error.code}`), { status: 400, code: "PLATFORM_ERROR", platformCode: data.error.code });
  }
  return data;
}

/**
 * Turn a platform error into something a person can act on.
 *
 * Sandbox/development mode is the one that bites during testing: both platforms
 * reject an account that hasn't been added as a tester, but neither says so in
 * plain words. TikTok answers with a scope/permission error on an unapproved
 * app; Meta's Graph errors carry code 190 (bad token) or a subcode for
 * "app not available to this user".
 */
function friendly(platform, err) {
  const label = PLATFORMS[platform]?.label || platform;
  const raw = String(err?.message || "");
  const low = raw.toLowerCase();
  const t = (message, code) => Object.assign(new Error(message), { code, status: err?.status || 400, cause: err });

  if (/access_denied|user_denied|user cancelled|user canceled/.test(low)) {
    return t(`You cancelled on ${label}'s screen — nothing was connected. You can try again any time.`, "DENIED");
  }
  if (/scope_not_authorized|unauthorized_scope|insufficient|missing permission|permission.*denied|\(#10\)|\(#200\)/.test(low)) {
    return t(`${label} didn't grant everything Scalecraft needs. While our app is in review, only accounts we've added as testers can connect — ask us to add yours. If you are a tester, start again and leave every permission switched on.`, "SCOPE_DENIED");
  }
  if (/not available|app.*development mode|development mode|not a tester|invalid_client|unauthorized_client/.test(low)) {
    return t(`Scalecraft's ${label} app is still in review, so only accounts we've added as testers can connect. Ask us to add this account and try again.`, "NOT_A_TESTER");
  }
  if (/code 190|oauthexception.*190|token.*expired|token.*revoked|invalid.*access.?token|invalid_grant/.test(low)) {
    return t(`${label} no longer accepts that login — it expired or was revoked. Connect again to refresh it.`, "RECONNECT");
  }
  return t(`${label} refused the connection: ${raw.replace(/^[A-Za-z ]+: /, "").slice(0, 160)}`, err?.code || "PLATFORM_ERROR");
}

/** Which of the scopes we asked for did the user actually grant. */
function missingScopes(platform, granted) {
  const want = PLATFORMS[platform]?.scopes || [];
  const got = new Set(String(granted || "").split(/[,\s]+/).filter(Boolean));
  return got.size ? want.filter((w) => !got.has(w)) : [];
}

// ---- token exchange, per platform
async function exchangeTikTok(code, verifier) {
  const t = await call("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", label: "TikTok token", form: {
    client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: PLATFORMS.tiktok.redirect(), code_verifier: verifier,
  } });
  if (!t.access_token) throw Object.assign(new Error("TikTok token: no access_token in response"), { status: 502, code: "PLATFORM_ERROR" });
  return { token: t.access_token, refresh: t.refresh_token || null, expiresAt: Date.now() + (Number(t.expires_in) || 86400) * 1000, refreshExpiresAt: t.refresh_expires_in ? Date.now() + Number(t.refresh_expires_in) * 1000 : null, extUserId: t.open_id || null, scopes: t.scope || PLATFORMS.tiktok.scopes.join(",") };
}
async function refreshTikTok(conn) {
  const t = await call("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", label: "TikTok refresh", form: {
    client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: decrypt(conn.refreshEnc, ENC()),
  } });
  return { token: t.access_token, refresh: t.refresh_token || null, expiresAt: Date.now() + (Number(t.expires_in) || 86400) * 1000, refreshExpiresAt: t.refresh_expires_in ? Date.now() + Number(t.refresh_expires_in) * 1000 : conn.refreshExpiresAt };
}
async function exchangeInstagram(code) {
  const s = await call("https://api.instagram.com/oauth/access_token", { method: "POST", label: "Instagram token", form: {
    client_id: process.env.IG_APP_ID, client_secret: process.env.IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: PLATFORMS.instagram.redirect(), code,
  } });
  const short = s.access_token || s.data?.[0]?.access_token;
  const userId = s.user_id || s.data?.[0]?.user_id;
  if (!short) throw Object.assign(new Error("Instagram token: no access_token in response"), { status: 502, code: "PLATFORM_ERROR" });
  // Long-lived (60 days), refreshable while it's still valid.
  const l = await call(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env.IG_APP_SECRET, access_token: short })}`, { label: "Instagram long-lived token" });
  return { token: l.access_token || short, refresh: null, expiresAt: Date.now() + (Number(l.expires_in) || 3600) * 1000, refreshExpiresAt: null, extUserId: userId ? String(userId) : null, scopes: (s.permissions || PLATFORMS.instagram.scopes).join ? (s.permissions || PLATFORMS.instagram.scopes).join(",") : String(s.permissions) };
}
async function refreshInstagram(conn) {
  const l = await call(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: decrypt(conn.tokenEnc, ENC()) })}`, { label: "Instagram refresh" });
  return { token: l.access_token, refresh: null, expiresAt: Date.now() + (Number(l.expires_in) || 3600) * 1000, refreshExpiresAt: null };
}

// ---- profile reads used at connect time (to show who connected) and by the fetchers
const IG_V = process.env.IG_GRAPH_VERSION || "v21.0";
async function tiktokProfile(token) {
  const fields = "open_id,union_id,display_name,avatar_url,bio_description,profile_web_link,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count,username";
  const r = await call(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { bearer: token, label: "TikTok user info" });
  return r.data?.user || {};
}
async function instagramProfile(token) {
  const fields = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website";
  return call(`https://graph.instagram.com/${IG_V}/me?${new URLSearchParams({ fields, access_token: token })}`, { label: "Instagram profile" });
}

/** Finish the OAuth dance: verify state, exchange the code, read the profile, store. */
async function handleCallback(platform, query, { cookieNonce = "" } = {}) {
  const p = platformOf(platform); if (!p) throw Object.assign(new Error("Unknown platform"), { status: 400, code: "BAD_PLATFORM" });
  const st = readState(query.state);
  if (st.platform !== p) throw Object.assign(new Error("State/platform mismatch"), { code: "BAD_STATE" });
  checkNonce(st.nonce, cookieNonce, { platform: p });
  if (query.error) throw Object.assign(new Error(query.error_description || query.error === "access_denied" ? "You cancelled on the platform's page — nothing was connected." : String(query.error)), { code: "DENIED", accountId: st.accountId, returnTo: st.returnTo });
  if (!query.code) throw Object.assign(new Error("No code came back from the platform"), { code: "NO_CODE", accountId: st.accountId, returnTo: st.returnTo });
  if (!ENC()) throw Object.assign(new Error("ENCRYPTION_KEY is not set — refusing to store a token in the clear"), { status: 500, code: "NO_ENCRYPTION_KEY" });

  let tok, prof;
  try {
    tok = p === "tiktok" ? await exchangeTikTok(query.code, st.verifier) : await exchangeInstagram(query.code);
    prof = p === "tiktok" ? await tiktokProfile(tok.token) : await instagramProfile(tok.token);
  } catch (e) {
    throw Object.assign(friendly(p, e), { accountId: st.accountId, returnTo: st.returnTo });
  }

  // Instagram Login only works on a Professional (Business or Creator) account.
  // A personal account can authorize and then return a profile we can't read
  // insights for, so say so plainly instead of failing later on an insights 400.
  if (p === "instagram") {
    const type = String(prof.account_type || "").toUpperCase();
    if (type && !["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(type)) {
      throw Object.assign(new Error("That Instagram account is a personal one. Scalecraft needs a Professional account — switch to Business or Creator in Instagram under Settings → Account type, then connect again. Nothing was saved."), { code: "PERSONAL_ACCOUNT", accountId: st.accountId, returnTo: st.returnTo });
    }
  }

  // If they unticked a permission the report would silently lose a number, so
  // refuse the half-connection rather than storing it.
  const missing = missingScopes(p, tok.scopes);
  if (missing.length) {
    throw Object.assign(new Error(`${PLATFORMS[p].label} didn't grant ${missing.join(" and ")}. Connect again and leave every permission switched on — Scalecraft reads your numbers and never posts.`), { code: "SCOPE_DENIED", accountId: st.accountId, returnTo: st.returnTo });
  }

  const handle = prof.username || null;
  const conn = await geDb.setConnection(st.accountId, p, {
    extUserId: tok.extUserId || (p === "tiktok" ? prof.open_id : prof.user_id) || null,
    handle, displayName: p === "tiktok" ? prof.display_name : prof.name || prof.username, avatarUrl: p === "tiktok" ? prof.avatar_url : prof.profile_picture_url,
    tokenEnc: encrypt(tok.token, ENC()), refreshEnc: tok.refresh ? encrypt(tok.refresh, ENC()) : null,
    expiresAt: tok.expiresAt, refreshExpiresAt: tok.refreshExpiresAt, scopes: tok.scopes,
    status: "active", source: "oauth", lastError: null,
  });
  return { accountId: st.accountId, platform: p, handle: conn.handle, displayName: conn.displayName, returnTo: st.returnTo };
}

/**
 * The proof-of-life pull right after connecting: read the profile and recent
 * posts so we can say "Connected, pulled X posts". Deliberately does not touch
 * scoring — a failure here leaves the connection in place and simply reports 0,
 * because the token is good and the next scheduled score will try again.
 */
async function firstPull(accountId, platform) {
  const p = platformOf(platform);
  const conn = p ? await geDb.getConnection(accountId, p).catch(() => null) : null;
  if (!conn) return { posts: 0, followers: null, ok: false, error: "No connection" };
  try {
    const data = await fetchConnected(conn);
    // Both fetchers return the scraper's shape: recent_posts + follower_count.
    const posts = data?.recent_posts?.length || 0;
    const followers = data?.follower_count ?? null;
    await geDb.setConnection(accountId, p, { ...conn, status: "active", lastError: null }).catch(() => { });
    return { posts, followers, ok: true };
  } catch (e) {
    console.warn(`[Connect] first pull failed for ${p}/${accountId}: ${e.message}`);
    await geDb.setConnection(accountId, p, { ...conn, lastError: e.message }).catch(() => { });
    return { posts: 0, followers: null, ok: false, error: friendly(p, e).message };
  }
}

/** A usable access token, refreshed first if it's about to expire. */
/**
 * Mark a connection as needing the user to reconnect, and say so in the funnel.
 * A connection that needs reconnecting keeps its row (so the UI can prompt)
 * but its token is no longer trusted.
 */
async function markNeedsReconnect(conn, message) {
  await geDb.setConnection(conn.accountId, conn.platform, { ...conn, status: "needs_reconnect", lastError: String(message || "").slice(0, 300) }).catch(() => { });
  try { require("./growth_engine_events").track("account_reconnect_needed", { accountId: conn.accountId, props: { platform: conn.platform, reason: String(message || "").slice(0, 120) } }); } catch { /* analytics must never break a refresh */ }
}

async function liveToken(conn) {
  const soon = Date.now() + (conn.platform === "tiktok" ? 60 * 60 * 1000 : 7 * 86400000);
  if (conn.expiresAt && conn.expiresAt < soon) {
    const giveUp = async (msg) => { await markNeedsReconnect(conn, msg); throw Object.assign(new Error(msg), { code: "RECONNECT" }); };
    if (conn.platform === "tiktok" && !conn.refreshEnc) return giveUp("TikTok token expired and there is no refresh token — reconnect");
    if (conn.platform === "tiktok" && conn.refreshExpiresAt && conn.refreshExpiresAt < Date.now()) return giveUp("TikTok refresh token expired — reconnect");
    let t;
    try {
      t = conn.platform === "tiktok" ? await refreshTikTok(conn) : await refreshInstagram(conn);
    } catch (e) {
      // A refresh that fails is not a transient read error: the user has to act.
      await markNeedsReconnect(conn, friendly(conn.platform, e).message);
      throw Object.assign(friendly(conn.platform, e), { code: "RECONNECT" });
    }
    await geDb.setConnection(conn.accountId, conn.platform, { ...conn, tokenEnc: encrypt(t.token, ENC()), refreshEnc: t.refresh ? encrypt(t.refresh, ENC()) : conn.refreshEnc, expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt, status: "active", lastError: null });
    try { require("./growth_engine_events").track("account_refreshed", { accountId: conn.accountId, props: { platform: conn.platform } }); } catch { /* ignore */ }
    return t.token;
  }
  return decrypt(conn.tokenEnc, ENC());
}

/** Keep tokens alive between visits: run daily from the refresh sweep. */
async function refreshDue() {
  const rows = await geDb.listConnectionsExpiringBefore(Date.now() + 8 * 86400000).catch(() => []);
  let ok = 0, failed = 0;
  for (const c of rows) {
    try { await liveToken(c); ok++; }
    catch (e) { failed++; if (e.code !== "RECONNECT") await geDb.setConnection(c.accountId, c.platform, { ...c, lastError: e.message }).catch(() => { }); }
  }
  return { checked: rows.length, refreshed: ok, failed };
}

// ---- the fetchers: same output shape as the scrapers, built by the same assembly
async function fetchTikTok(conn) {
  const token = await liveToken(conn);
  const prof = await tiktokProfile(token);
  const fields = "id,create_time,title,video_description,duration,cover_image_url,share_url,view_count,like_count,comment_count,share_count";
  let cursor = 0, videos = [];
  for (let i = 0; i < 3 && videos.length < POSTS; i++) {
    const r = await call(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, { method: "POST", bearer: token, label: "TikTok videos", json: { max_count: 20, ...(cursor ? { cursor } : {}) } });
    videos.push(...(r.data?.videos || []));
    if (!r.data?.has_more) break;
    cursor = r.data.cursor;
  }
  if (!videos.length) throw new Error(`No public videos on the connected TikTok account`);
  const posts = videos.slice(0, POSTS).map((v) => ({
    id: String(v.id), caption: v.video_description || v.title || "", media_type: "VIDEO", is_reel: true,
    timestamp: new Date(Number(v.create_time) * 1000).toISOString(),
    like_count: Number(v.like_count) || 0, comments_count: Number(v.comment_count) || 0, video_view_count: Number(v.view_count) || 0,
    share_count: Number(v.share_count) || 0, save_count: 0, duration: Number(v.duration) || 0,
    hashtags: (String(v.video_description || "").match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)), mentions: [], location: null, is_pinned: false,
    permalink: v.share_url || null, thumbnail_url: v.cover_image_url || null,
  })).sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  const author = { fans: prof.follower_count, following: prof.following_count, signature: prof.bio_description || "", bioLink: prof.profile_web_link ? { link: prof.profile_web_link } : null, name: prof.username || conn.handle, id: prof.open_id, nickName: prof.display_name, verified: !!prof.is_verified, heart: prof.likes_count, video: prof.video_count };
  const data = buildTikTokData(author, posts, prof.username || conn.handle, "tiktok-api");
  data.connected = true;
  return data;
}

async function fetchInstagram(conn) {
  const token = await liveToken(conn);
  const prof = await instagramProfile(token);
  const fields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url,is_shared_to_feed";
  let url = `https://graph.instagram.com/${IG_V}/me/media?${new URLSearchParams({ fields, limit: String(Math.min(POSTS, 50)), access_token: token })}`;
  let media = [];
  for (let i = 0; i < 2 && media.length < POSTS && url; i++) {
    const r = await call(url, { label: "Instagram media" });
    media.push(...(r.data || []));
    url = r.paging?.next && media.length < POSTS ? r.paging.next : null;
  }
  media = media.filter((m) => m.timestamp).slice(0, POSTS);
  if (!media.length) throw new Error("No posts on the connected Instagram account");
  // Insights the scrape can never see. Best-effort per post: some media types refuse some metrics.
  const insights = new Map();
  await Promise.all(media.map(async (m) => {
    const isVideo = m.media_type === "VIDEO";
    const metric = isVideo ? "reach,saved,shares,views" : "reach,saved,shares";
    try {
      const r = await call(`https://graph.instagram.com/${IG_V}/${m.id}/insights?${new URLSearchParams({ metric, access_token: token })}`, { label: "Instagram insights" });
      const o = {}; for (const d of r.data || []) o[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
      insights.set(m.id, o);
    } catch { insights.set(m.id, {}); }
  }));
  const posts = media.map((m) => {
    const ins = insights.get(m.id) || {};
    const media_type = m.media_type === "CAROUSEL_ALBUM" ? "CAROUSEL" : m.media_type === "VIDEO" ? "VIDEO" : "IMAGE";
    return {
      id: String(m.id), caption: m.caption || "", media_type, is_reel: m.media_product_type === "REELS" || media_type === "VIDEO",
      timestamp: m.timestamp, like_count: Number(m.like_count) || 0, comments_count: Number(m.comments_count) || 0,
      video_view_count: Number(ins.views) || 0, share_count: ins.shares != null ? Number(ins.shares) : null, save_count: ins.saved != null ? Number(ins.saved) : null, reach: ins.reach != null ? Number(ins.reach) : null,
      hashtags: (String(m.caption || "").match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)), mentions: [], location: null, is_pinned: false,
      permalink: m.permalink || null, thumbnail_url: m.thumbnail_url || m.media_url || null, short_code: null,
    };
  });
  const profile = { username: prof.username, id: prof.user_id || prof.id, fullName: prof.name || null, followersCount: prof.followers_count || 0, followsCount: prof.follows_count || 0, postsCount: prof.media_count || posts.length, biography: prof.biography || "", externalUrl: prof.website || null, verified: false, highlightReelCount: 0, isBusinessAccount: prof.account_type === "BUSINESS", businessCategoryName: prof.account_type || null };
  const data = buildInstagramData(profile, posts, prof.username || conn.handle, "instagram-api");
  // Saves and reach exist now: fold them into the engagement block the scorer and the model read.
  const withSaves = posts.filter((p) => p.save_count != null);
  if (withSaves.length) {
    data.analysis.engagement.total_saves = withSaves.reduce((n, p) => n + p.save_count, 0);
    data.analysis.engagement.saves_per_post = +(data.analysis.engagement.total_saves / withSaves.length).toFixed(1);
  }
  const withReach = posts.filter((p) => p.reach != null);
  if (withReach.length) {
    data.analysis.engagement.total_reach = withReach.reduce((n, p) => n + p.reach, 0);
    data.analysis.engagement.avg_reach_per_post = Math.round(data.analysis.engagement.total_reach / withReach.length);
    if (profile.followersCount) data.analysis.engagement.reach_per_follower_pct = +((data.analysis.engagement.avg_reach_per_post / profile.followersCount) * 100).toFixed(1);
  }
  data.connected = true;
  return data;
}

/** The connection for this account+platform if it matches the handle being scored. */
async function connectionFor(accountId, platform, handle) {
  if (!accountId || accountId === "demo-account") return null;
  const p = platformOf(platform); if (!p) return null;
  const c = await geDb.getConnection(accountId, p).catch(() => null);
  if (!c) return null;
  if (handle && c.handle && String(handle).toLowerCase() !== c.handle) return null;
  return c;
}
async function fetchConnected(conn) { return conn.platform === "tiktok" ? fetchTikTok(conn) : fetchInstagram(conn); }

/** Public view of a connection: no tokens. */
const publicView = (c) => c ? {
  platform: c.platform, handle: c.handle, display_name: c.displayName, avatar_url: c.avatarUrl,
  connected_at: c.connectedAt, updated_at: c.updatedAt, expires_at: c.expiresAt, scopes: c.scopes,
  status: c.status || "active", needs_reconnect: (c.status || "active") === "needs_reconnect", last_error: c.lastError,
} : null;

/**
 * Meta's deauthorize and data-deletion callbacks (required for app review).
 *
 * Both arrive as POST with a `signed_request` body field: "<sig>.<payload>",
 * base64url, HMAC-SHA256 over the payload string with the **Meta app secret**
 * (app 1617940326404118) — which is a different value from IG_APP_SECRET. If
 * META_APP_SECRET isn't set we refuse rather than trusting an unverified body.
 */
function parseSignedRequest(signedRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw Object.assign(new Error("META_APP_SECRET is not set — cannot verify Meta's signed_request"), { status: 503, code: "NO_META_APP_SECRET" });
  const [sig, payload] = String(signedRequest || "").split(".");
  if (!sig || !payload) throw Object.assign(new Error("Malformed signed_request"), { status: 400, code: "BAD_SIGNED_REQUEST" });
  const want = crypto.createHmac("sha256", secret).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw Object.assign(new Error("signed_request signature failed"), { status: 400, code: "BAD_SIGNED_REQUEST" });
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (data.algorithm && String(data.algorithm).toUpperCase() !== "HMAC-SHA256") throw Object.assign(new Error(`Unexpected signed_request algorithm ${data.algorithm}`), { status: 400, code: "BAD_SIGNED_REQUEST" });
  if (!data.user_id) throw Object.assign(new Error("signed_request carried no user_id"), { status: 400, code: "BAD_SIGNED_REQUEST" });
  return data;
}

/**
 * Delete every Instagram connection belonging to that platform user id.
 * Used by both callbacks: deauthorize means they revoked us in Instagram's UI,
 * deletion means they asked for their data to go. Either way our tokens go.
 * Returns the affected account ids so the caller can log it.
 */
async function forgetInstagramUser(extUserId) {
  const rows = await geDb.findConnectionsByExtUserId("instagram", extUserId).catch(() => []);
  const accounts = [];
  for (const c of rows) {
    await geDb.deleteConnection(c.accountId, c.platform).catch((e) => console.warn(`[Connect] deauthorize delete failed: ${e.message}`));
    accounts.push(c.accountId);
  }
  return accounts;
}

/**
 * A confirmation code Meta can show the user, which we can read back later to
 * report status. Carries the Instagram user id signed with JWT_SECRET so the
 * status page can check live state without us keeping a separate table, and so
 * a guessed code reveals nothing.
 */
function deletionCode(extUserId) {
  const payload = b64u(JSON.stringify({ u: String(extUserId), t: Date.now() }));
  return `${payload}.${sign(payload).slice(0, 24)}`;
}
function readDeletionCode(code) {
  const [payload, sig] = String(code || "").split(".");
  if (!payload || !sig) throw Object.assign(new Error("Malformed code"), { code: "BAD_CODE" });
  const want = sign(payload).slice(0, 24);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw Object.assign(new Error("Code signature failed"), { code: "BAD_CODE" });
  const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!s.u) throw Object.assign(new Error("Code carried no user"), { code: "BAD_CODE" });
  return s.u;
}

async function revoke(conn) {
  try {
    if (conn.platform === "tiktok") await call("https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", label: "TikTok revoke", form: { client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, token: decrypt(conn.tokenEnc, ENC()) } });
  } catch (e) { console.warn(`[Connect] revoke failed (${conn.platform}): ${e.message}`); }
}

module.exports = { PLATFORMS, platformOf, available, configReport, NONCE_COOKIE, nonceCookieOpts, nonceOf, checkNonce, parseSignedRequest, forgetInstagramUser, deletionCode, readDeletionCode, firstPull, friendly, missingScopes, authUrl, makeState, readState, handleCallback, liveToken, refreshDue, fetchTikTok, fetchInstagram, fetchConnected, connectionFor, publicView, revoke, _call: call };
