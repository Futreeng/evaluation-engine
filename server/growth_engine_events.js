/**
 * Funnel events (spec 1.13). One row per event with account + ref attribution.
 *
 * Every later feature adds its own event here. Names are an allowlist so the
 * public POST /events endpoint can't be used to write junk; props are capped.
 * Attribution: `anon` is a random id the browser keeps in localStorage;
 * `ref` is the referral code stored on first visit (spec 1.8 formalises it).
 */
const EVENTS = [
  "evaluate_started", "evaluate_completed", "evaluate_failed",
  "report_viewed", "share_clicked", "card_downloaded", "share_page_visited",
  "signup", "pricing_viewed", "subscribe", "unlock", "cancel", "resume",
  "promo_applied", "checkin_answered", "move_done", "move_skipped", "post_regenerated", "post_copied", "referral_signup",
  "rank_up", "milestone", "record", "badge", "moment_shared",
  "roast_opened", "roast_generated", "roast_rejected", "roast_skipped_minor", "roast_shared",
  "monday_move_sent", "monday_move_done", "goal_set", "post_reviewed",
  "pause", "unpause", "tier_switch", "winback_sent", "annual_offer_shown", "annual_offer_taken",
  "limit_hit", "founder_priced",
];
// Funnel steps in order, for the admin conversion table.
const FUNNEL = ["evaluate_started", "evaluate_completed", "report_viewed", "signup", "pricing_viewed", "subscribe"];

let geDb = null;
const db = () => (geDb ||= require("./growth_engine_db_select"));

// Fire-and-forget. Never throws; a failed analytics write must not fail a request.
function track(name, { accountId = null, anon = null, ref = null, reportId = null, props = null, ip = null, utm = null } = {}) {
  if (!EVENTS.includes(name)) { console.warn(`[Events] unknown event ${name}`); return; }
  if (utm) props = { ...(props && typeof props === "object" ? props : {}), utm }; // marketing source rides on every attributed event
  const safe = props && typeof props === "object" ? JSON.stringify(props).slice(0, 2000) : null;
  db().insertEvent({ name, accountId: accountId || null, anon: anon ? String(anon).slice(0, 64) : null, ref: ref ? String(ref).slice(0, 32) : null, reportId: reportId || null, props: safe, ip: ip ? String(ip).slice(0, 64) : null })
    .catch((e) => console.warn("[Events] write failed:", e.message));
}

// Pull attribution out of an Express request (headers set by app.js).
// x-utm: JSON {source, medium, campaign, content, term, src} captured by the
// app on first visit (spec 5.4). Kept small and only known keys.
const UTM_KEYS = ["source", "medium", "campaign", "content", "term", "src"];
function utmFrom(req) {
  try { const raw = req.get("x-utm"); if (!raw || raw.length > 600) return null; const o = JSON.parse(raw); const out = {}; for (const k of UTM_KEYS) if (typeof o[k] === "string" && o[k].trim()) out[k] = o[k].trim().slice(0, 80); return Object.keys(out).length ? out : null; } catch { return null; }
}
function attribution(req) {
  const utm = utmFrom(req);
  return { accountId: req.user?.id || null, anon: req.get("x-anon-id") || null, ref: req.get("x-ref") || null, ip: req.ip || null, utm };
}

module.exports = { EVENTS, FUNNEL, track, attribution, utmFrom };
