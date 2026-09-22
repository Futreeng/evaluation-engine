/**
 * Card engine (spec 1.7): one server-side renderer for every shareable
 * card as PNG at 1080×1920 (story) and 1080×1080 (square). The score card
 * is the first kind; later waves add roast, rank-up, record, milestone,
 * badge cards as more `KINDS` entries that draw on the same canvas.
 *
 * Fonts: server/assets/fonts (Bricolage Grotesque, Instrument Sans),
 * registered once. Rendered PNGs are cached in memory per share+size.
 */
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  for (const f of ["BricolageGrotesque.ttf", "InstrumentSans.ttf"]) { try { GlobalFonts.registerFromPath(path.join(__dirname, "assets", "fonts", f)); } catch (e) { console.warn(`[Cards] font ${f}: ${e.message}`); } }
  fontsReady = true;
}
const DISPLAY = '"Bricolage Grotesque", "Instrument Sans", Helvetica, Arial, sans-serif';
const SANS = '"Instrument Sans", Helvetica, Arial, sans-serif';
const COLORS = { bg: "#D2603A", ink: "#FFF6E9", track: "#E9977B" };
const SITE = (process.env.CARD_SITE_LABEL || (process.env.APP_URL || "scalecraft.app").replace(/^https?:\/\//, "")).replace(/\/$/, "");
const NICHES = { fitness_creator: "Fitness", food_cooking: "Food & Cooking", fashion: "Fashion", beauty_skincare: "Beauty & Skincare", travel: "Travel", comedy_entertainment: "Comedy", education_howto: "Education", lifestyle_vlog: "Lifestyle", music: "Music", gaming: "Gaming", tech_gadgets: "Tech", finance_business: "Finance", parenting_family: "Parenting", art_design: "Art & Design", sports: "Sports", pets: "Pets", other: "Creator" };
const nicheName = (k) => NICHES[k] || String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Creator";
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// data: { handle, platform, niche, date, overall, dims:[{label,score}], niche_avg, prev, span }
function drawScore(ctx, W, H, d, size) {
  const P = 84;
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.ink; ctx.textBaseline = "top";
  const dsp = (px) => `700 ${px}px ${DISPLAY}`; const sans = (px, wt = 500) => `${wt} ${px}px ${SANS}`;
  ctx.font = sans(40, 600); ctx.globalAlpha = 0.9;
  ctx.fillText(`@${d.handle}  ·  ${nicheName(d.niche)}`.toUpperCase(), P, P); ctx.globalAlpha = 1;
  // Two metric sets: the story has room; the square is tight.
  const sq = size === "square";
  const M = sq ? { top: 170, num: 280, numThen: 220, numPrev: 130, label: 36, sub: 30, dimLabel: 32, bar: 22, row: 84, gap: 44, foot: 28, footY: H - 62 }
               : { top: 520, num: 520, numThen: 360, numPrev: 200, label: 48, sub: 36, dimLabel: 38, bar: 28, row: 136, gap: 58, foot: 34, footY: H - P - 30 };
  let y = M.top;
  if (d.prev != null && d.prev !== d.overall) {
    ctx.font = dsp(M.numPrev); ctx.globalAlpha = 0.55; ctx.fillText(String(d.prev), P, y + (M.numThen - M.numPrev) * 0.9); ctx.globalAlpha = 1;
    const pw = ctx.measureText(String(d.prev)).width;
    ctx.font = dsp(Math.round(M.numPrev * 0.6)); ctx.fillText("→", P + pw + 30, y + M.numThen * 0.42);
    ctx.font = dsp(M.numThen); ctx.fillText(String(d.overall), P + pw + 30 + M.numPrev * 0.8, y);
    y += M.numThen * 1.08; ctx.font = sans(M.label, 600); ctx.fillText(d.span || "in six weeks", P, y); y += M.label * 1.9;
  } else {
    ctx.font = dsp(M.num); ctx.fillText(String(d.overall), P - 14, y);
    y += M.num * 1.02;
    ctx.font = sans(M.label, 600); ctx.fillText("My Scalecraft score", P, y); y += M.label * 1.45;
    if (Number.isFinite(d.niche_avg)) { ctx.font = sans(M.sub, 500); ctx.globalAlpha = 0.85; ctx.fillText(`${nicheName(d.niche)} average ${Math.round(d.niche_avg)}`, P, y); ctx.globalAlpha = 1; y += M.sub * 1.5; }
    y += sq ? 14 : 30;
  }
  const bw = W - P * 2;
  for (const dim of d.dims || []) {
    ctx.font = sans(M.dimLabel, 600); ctx.fillText(dim.label, P, y);
    ctx.textAlign = "right"; ctx.fillText(String(dim.score), W - P, y); ctx.textAlign = "left";
    y += M.gap;
    ctx.fillStyle = COLORS.track; roundRect(ctx, P, y, bw, M.bar, M.bar / 2); ctx.fill();
    ctx.fillStyle = COLORS.ink; roundRect(ctx, P, y, bw * clamp(dim.score) / 100, M.bar, M.bar / 2); ctx.fill();
    y += M.row - M.gap;
  }
  ctx.font = sans(M.foot, 500); ctx.globalAlpha = 0.85;
  ctx.fillText(`${fmtDate(d.date)}  ·  Score yours at ${SITE}`, P, M.footY); ctx.globalAlpha = 1;
}

// Moment card (spec 2.2, 2.5): one big line — the rank or milestone — the
// score underneath, handle and the site. Kept sparse so it reads at story size.
function drawMoment(ctx, W, H, d, size) {
  const P = 84, sq = size === "square";
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.bg; ctx.textBaseline = "top";
  const dsp = (px) => `700 ${px}px ${DISPLAY}`; const sans = (px, wt = 500) => `${wt} ${px}px ${SANS}`;
  ctx.font = sans(sq ? 34 : 40, 600); ctx.globalAlpha = 0.85;
  ctx.fillText(`@${d.handle}  ·  ${d.kind === "rank_up" ? "RANK UP" : "MILESTONE"}`.toUpperCase(), P, P); ctx.globalAlpha = 1;
  let y = sq ? 250 : 560;
  // Title wraps by words to the card width.
  const tpx = sq ? 132 : 168; ctx.font = dsp(tpx);
  const words = String(d.title || "").split(" "); let line = "";
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > W - P * 2 && line) { ctx.fillText(line, P - 6, y); y += tpx * 1.02; line = w; } else line = t; }
  if (line) { ctx.fillText(line, P - 6, y); y += tpx * 1.02; }
  y += sq ? 20 : 40;
  ctx.font = sans(sq ? 40 : 52, 600); ctx.globalAlpha = 0.9; ctx.fillText(d.line || "", P, y); ctx.globalAlpha = 1; y += (sq ? 40 : 52) * 1.7;
  if (Number.isFinite(d.overall)) {
    ctx.font = dsp(sq ? 150 : 240); ctx.fillText(String(d.overall), P - 8, y);
    ctx.font = sans(sq ? 32 : 40, 600); ctx.globalAlpha = 0.85; ctx.fillText("MY SCALECRAFT SCORE", P + ctx.measureText("").width + (sq ? 220 : 340), y + (sq ? 100 : 160)); ctx.globalAlpha = 1;
  }
  ctx.font = sans(sq ? 28 : 34, 500); ctx.globalAlpha = 0.85;
  ctx.fillText(`${fmtDate(d.date)}  ·  Score yours at ${SITE}`, P, sq ? H - 62 : H - P - 30); ctx.globalAlpha = 1;
}

// Roast card (spec 2.1): the two best lines, the score, "Get roasted at".
function drawRoast(ctx, W, H, d, size) {
  const P = 84, sq = size === "square";
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.bg; ctx.textBaseline = "top";
  const dsp = (px) => `700 ${px}px ${DISPLAY}`; const sans = (px, wt = 500) => `${wt} ${px}px ${SANS}`;
  ctx.font = sans(sq ? 34 : 40, 600); ctx.globalAlpha = 0.85;
  ctx.fillText(`@${d.handle}  ·  ROASTED  ·  ${String(d.heat_label || "").toUpperCase()}`, P, P); ctx.globalAlpha = 1;
  const wrap = (text, px, y, lh) => { ctx.font = dsp(px); let line = ""; for (const w of String(text).split(" ")) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > W - P * 2 && line) { ctx.fillText(line, P, y); y += px * lh; line = w; } else line = t; } if (line) { ctx.fillText(line, P, y); y += px * lh; } return y; };
  let y = sq ? 190 : 330;
  const px = sq ? 58 : 76;
  for (const l of (d.lines || []).slice(0, 2)) { y = wrap(`“${l}”`, px, y, 1.12); y += sq ? 34 : 60; }
  y += sq ? 10 : 40;
  if (Number.isFinite(d.overall)) {
    ctx.font = dsp(sq ? 150 : 240); ctx.fillText(String(d.overall), P - 8, y);
    ctx.font = sans(sq ? 32 : 40, 600); ctx.globalAlpha = 0.85; ctx.fillText("MY SCALECRAFT SCORE", P + (sq ? 220 : 340), y + (sq ? 100 : 160)); ctx.globalAlpha = 1;
  }
  ctx.font = sans(sq ? 28 : 34, 500); ctx.globalAlpha = 0.85;
  ctx.fillText(`Get roasted at ${SITE}`, P, sq ? H - 62 : H - P - 30); ctx.globalAlpha = 1;
}

const KINDS = { score: drawScore, moment: drawMoment, roast: drawRoast };
const cache = new Map(); const CACHE_MAX = 200;
function render(kind, data, size = "story", cacheKey = null) {
  fonts();
  const key = cacheKey && `${cacheKey}:${size}`;
  if (key && cache.has(key)) return cache.get(key);
  const draw = KINDS[kind]; if (!draw) throw new Error(`Unknown card kind: ${kind}`);
  const W = 1080, H = size === "square" ? 1080 : 1920;
  const canvas = createCanvas(W, H); const ctx = canvas.getContext("2d");
  draw(ctx, W, H, data, size);
  const png = canvas.toBuffer("image/png");
  if (key) { if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); cache.set(key, png); }
  return png;
}
// Snapshot of a report for a score card (only what the card shows — never the full report).
function scoreDataFrom(reportBody, { thenNow = false } = {}) {
  const s = reportBody.scores || {};
  return {
    handle: reportBody.business?.handle, platform: reportBody.business?.platform, niche: reportBody.business?.category, date: reportBody.created_at || reportBody.generated_at || Date.now(),
    overall: s.overall, dims: (s.dimensions || []).map((d) => ({ label: d.label, score: d.score })), niche_avg: Number.isFinite(s.category_avg) ? s.category_avg : null,
    prev: thenNow && reportBody.history?.previous?.overall != null ? reportBody.history.previous.overall : null,
    span: thenNow && reportBody.history?.previous?.generated_at ? `since ${fmtDate(reportBody.history.previous.generated_at)}` : null,
  };
}
// Snapshot for a moment card: the moment itself plus the score it happened at.
function momentDataFrom(reportBody, m) {
  return { handle: reportBody.business?.handle, platform: reportBody.business?.platform, niche: reportBody.business?.category, date: m.at || reportBody.generated_at || Date.now(), kind: m.kind, key: m.key, title: m.title, line: m.line, overall: Number.isFinite(m.score) ? m.score : reportBody.scores?.overall };
}
function roastDataFrom(reportBody) {
  const r = reportBody.roast || {};
  return { handle: reportBody.business?.handle, niche: reportBody.business?.category, date: r.generated_at || Date.now(), heat_label: r.heat_label, lines: (r.lines || []).slice(0, 2).map((l) => l.text), overall: Number.isFinite(r.overall) ? r.overall : reportBody.scores?.overall };
}
module.exports = { render, scoreDataFrom, momentDataFrom, roastDataFrom, KINDS: Object.keys(KINDS) };
