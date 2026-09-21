/**
 * Email service (spec 1.6): one interface — send, preferences, logging — so
 * the provider can change without touching features.
 *
 *   EMAIL_PROVIDER=resend|log     default: resend when RESEND_API_KEY is set, else log
 *   RESEND_API_KEY, MAIL_FROM     Resend; MAIL_FROM must be on a verified domain
 *   EMAIL_POSTAL_ADDRESS          physical address for the CAN-SPAM footer
 *   APP_URL                       public origin for links
 *
 * Types and who can switch them off:
 *   transactional  report ready, password reset, receipts — always sent
 *   weekly_score   weekly re-score results, plan ended
 *   monday_move    plan check-ins and the Monday move
 *   milestones     rank-ups, records, milestone cards (wave 2)
 *   product_news   product updates
 * users.email_paused stays as the master switch (everything but transactional).
 * Every send is logged to growth_engine_email_log with type, user, status and
 * the provider's message id.
 */
const crypto = require("crypto");
const geDb = require("./growth_engine_db_select");

const TYPES = ["transactional", "weekly_score", "monday_move", "milestones", "product_news"];
const PREF_TYPES = TYPES.filter((t) => t !== "transactional");
const DEFAULT_PREFS = { weekly_score: true, monday_move: true, milestones: true, product_news: true };
const APP = (process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "");
const FROM = process.env.MAIL_FROM || "Scalecraft <onboarding@resend.dev>";
const POSTAL = process.env.EMAIL_POSTAL_ADDRESS || "";
const SUPPORT = process.env.SUPPORT_EMAIL || "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- providers
const providers = {
  log: { name: "log", async send({ to, subject, devLink }) { console.log(`[Mail] (log provider) "${subject}" → ${to}${devLink ? ` — ${devLink}` : ""}`); return { id: "log_" + Date.now().toString(36), status: "logged" }; } },
  resend: {
    name: "resend",
    async send({ to, subject, html, text, type }) {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to: [to], subject, html, text: text || undefined, tags: [{ name: "type", value: type }] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Resend ${res.status}`);
      return { id: body.id, status: "sent" };
    },
  },
};
function provider() {
  const want = process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? "resend" : "log");
  if (want === "resend" && !process.env.RESEND_API_KEY) { console.warn("[Mail] EMAIL_PROVIDER=resend but RESEND_API_KEY is unset — logging instead"); return providers.log; }
  return providers[want] || providers.log;
}
const configured = () => provider().name !== "log";
if (configured() && !POSTAL) console.warn("[Mail] EMAIL_POSTAL_ADDRESS is unset — CAN-SPAM needs a physical address in every marketing email footer");

// ---- unsubscribe links: signed per user, no login needed
const sig = (userId, t) => crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(`unsub:${userId}:${t}`).digest("hex").slice(0, 32);
const unsubscribeLink = (userId, t = "all") => `${APP}/api/growth-engine/v1/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(t)}&s=${sig(userId, t)}`;
function verifyUnsub(userId, t, s) { return !!userId && !!t && s === sig(userId, t); }

// ---- preferences
async function prefsFor(userId) {
  const u = await geDb.getUserById(userId).catch(() => null);
  const saved = u?.emailPrefs || {};
  return { ...DEFAULT_PREFS, ...saved, paused: !!u?.emailPaused };
}
async function allowed(userId, type) {
  if (type === "transactional" || !userId) return true;
  const p = await prefsFor(userId);
  if (p.paused) return false;
  return p[type] !== false;
}

// Footer every email gets: postal address, support, unsubscribe.
function footer(userId, type) {
  const unsub = userId && type !== "transactional" ? ` · <a href="${unsubscribeLink(userId, type)}" style="color:#7A6A57">Unsubscribe from these</a> · <a href="${unsubscribeLink(userId, "all")}" style="color:#7A6A57">Pause all but receipts</a>` : "";
  const addr = POSTAL ? esc(POSTAL) : "Scalecraft";
  return `<tr><td style="padding:14px 28px 22px;border-top:1px solid #EADFCB;font-size:11px;line-height:1.7;color:#7A6A57">${addr}${SUPPORT ? ` · <a href="mailto:${esc(SUPPORT)}" style="color:#7A6A57">${esc(SUPPORT)}</a>` : ""} · <a href="${APP}/#/legal/privacy" style="color:#7A6A57">Privacy</a>${unsub}</td></tr>`;
}

// Send one email. `html` is the full document from mailer.layout(); the
// footer row is injected before the closing table row marker.
async function send({ to, userId = null, type = "transactional", subject, html, text = null, devLink = null }) {
  if (!to) return { skipped: "no recipient" };
  if (!TYPES.includes(type)) type = "transactional";
  if (!(await allowed(userId, type))) { await log({ userId, to, type, subject, status: "skipped", error: "preference" }); return { skipped: "preference" }; }
  const full = html.includes("<!--footer-->") ? html.replace("<!--footer-->", footer(userId, type)) : html;
  try {
    const r = await provider().send({ to, subject, html: full, text, type, devLink });
    await log({ userId, to, type, subject, status: r.status, providerId: r.id });
    if (r.status === "sent") console.log(`[Mail] sent "${subject}" to ${to} (${r.id})`);
    return r;
  } catch (e) {
    console.error(`[Mail] failed "${subject}" to ${to}:`, e.message);
    await log({ userId, to, type, subject, status: "failed", error: e.message });
    return { error: e.message };
  }
}
async function log(row) { try { await geDb.insertEmailLog({ ...row, provider: provider().name }); } catch (e) { console.warn("[Mail] log failed:", e.message); } }

module.exports = { TYPES, PREF_TYPES, DEFAULT_PREFS, send, prefsFor, allowed, unsubscribeLink, verifyUnsub, configured, providerName: () => provider().name };
