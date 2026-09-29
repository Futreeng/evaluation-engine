// Terms / Privacy acceptance. The version is the "Last updated" date on the
// legal pages (public/app.js LEGAL_VERSION) — bump both together, and every
// signed-in user is asked to accept again on their next visit.
//
// An acceptance row is the proof a click-through happened: who, which version,
// when, from where. Rows are append-only and survive account deletion (kept
// to show what was agreed; see the retention page).
const TERMS_VERSION = "2026-09-29";

// Returns the acceptance record for this request, or null if the client didn't
// send the current version (unticked box, or a stale cached page).
function acceptanceFrom(req, context) {
  if (req.body?.accepted_terms_version !== TERMS_VERSION) return null;
  return {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
    ip: req.ip || null,
    userAgent: String(req.get("user-agent") || "").slice(0, 300) || null,
    context,
  };
}

function termsError(req) {
  const sent = req.body?.accepted_terms_version;
  return sent
    ? { code: "TERMS_OUTDATED", message: "Our Terms changed since this page loaded. Reload the page and accept the current version." }
    : { code: "TERMS_REQUIRED", message: "Please agree to the Terms and Privacy Policy." };
}

module.exports = { TERMS_VERSION, acceptanceFrom, termsError };
