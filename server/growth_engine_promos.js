/**
 * Promo codes — validation and price math, shared by billing, the routes and
 * the admin page. Storage lives in the DB modules (growth_engine_promo_codes,
 * growth_engine_promo_redemptions).
 *
 * Kinds:
 *   free_months  value = months     Growth Plan only, monthly billing: $0 for
 *                                   the first N months, then full price
 *   percent      value = 1..100     % off the charge (either product)
 *   amount       value = cents      fixed amount off (either product)
 *   free_unlock  —                  the 60-day plan for $0
 *
 * When real Stripe is on, a code with stripe_coupon_id is passed through as
 * the coupon instead of being applied here, so tax and invoices stay right.
 */

const KINDS = ["free_months", "percent", "amount", "free_unlock"];
const APPLIES = ["growth_plan", "plan_unlock", "any"];

const normalizeCode = (c) => String(c || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);

function validateShape(p) {
  const out = {
    code: normalizeCode(p.code),
    kind: String(p.kind || ""),
    value: Number(p.value) || 0,
    applies_to: String(p.applies_to || "any"),
    max_redemptions: p.max_redemptions == null || p.max_redemptions === "" ? null : Math.max(1, Number(p.max_redemptions) || 0),
    expires_at: p.expires_at ? (typeof p.expires_at === "number" ? p.expires_at : Date.parse(p.expires_at)) : null,
    active: p.active === undefined ? true : !!p.active,
    note: String(p.note || "").slice(0, 200),
    stripe_coupon_id: p.stripe_coupon_id ? String(p.stripe_coupon_id).slice(0, 80) : null,
  };
  if (out.code.length < 3) throw new Error("Code must be at least 3 letters or digits");
  if (!KINDS.includes(out.kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  if (!APPLIES.includes(out.applies_to)) throw new Error(`applies_to must be one of ${APPLIES.join(", ")}`);
  if (out.kind === "free_months" && (out.value < 1 || out.value > 12)) throw new Error("free_months needs a value of 1–12 months");
  if (out.kind === "percent" && (out.value < 1 || out.value > 100)) throw new Error("percent needs a value of 1–100");
  if (out.kind === "amount" && out.value < 1) throw new Error("amount needs a value in cents");
  if (out.kind === "free_months") out.applies_to = "growth_plan";
  if (out.kind === "free_unlock") out.applies_to = "plan_unlock";
  if (out.expires_at != null && !Number.isFinite(out.expires_at)) throw new Error("expires_at is not a date");
  return out;
}

// Can this code be used for this product right now? Returns { ok, reason }.
function checkUsable(promo, product, { redeemedByAccount = false } = {}) {
  if (!promo) return { ok: false, reason: "That code doesn't exist." };
  if (!promo.active) return { ok: false, reason: "That code is no longer active." };
  if (promo.expires_at && promo.expires_at < Date.now()) return { ok: false, reason: "That code has expired." };
  if (promo.max_redemptions != null && promo.redemptions >= promo.max_redemptions) return { ok: false, reason: "That code has been used up." };
  if (redeemedByAccount) return { ok: false, reason: "You've already used that code." };
  if (promo.applies_to !== "any" && promo.applies_to !== product) {
    return { ok: false, reason: promo.applies_to === "growth_plan" ? "That code is for the Growth Plan subscription." : "That code is for the 60-day plan." };
  }
  return { ok: true };
}

// Price after the code. baseCents is the charge before the code.
function quote(promo, product, baseCents, billingCycle = "monthly") {
  const base = Number(baseCents) || 0;
  switch (promo.kind) {
    case "free_months":
      if (product !== "growth_plan") return null;
      if (billingCycle !== "monthly") return { amountCents: base, freeMonths: 0, description: "Free-month codes apply to monthly billing — switch to monthly to use it." , applicable: false };
      return { amountCents: 0, freeMonths: promo.value, description: `First ${promo.value === 1 ? "month" : promo.value + " months"} free, then $${(base / 100).toFixed(0)}/mo`, applicable: true };
    case "percent": {
      const amt = Math.max(0, Math.round(base * (1 - promo.value / 100)));
      return { amountCents: amt, freeMonths: 0, description: `${promo.value}% off${product === "growth_plan" ? (billingCycle === "annual" ? " your first year" : " your first month") : ""}`, applicable: true };
    }
    case "amount": {
      const amt = Math.max(0, base - promo.value);
      return { amountCents: amt, freeMonths: 0, description: `$${(promo.value / 100).toFixed(promo.value % 100 ? 2 : 0)} off`, applicable: true };
    }
    case "free_unlock":
      if (product !== "plan_unlock") return null;
      return { amountCents: 0, freeMonths: 0, description: "60-day plan, free", applicable: true };
    default:
      return null;
  }
}

module.exports = { KINDS, APPLIES, normalizeCode, validateShape, checkUsable, quote };
