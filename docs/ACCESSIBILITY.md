# Accessibility — WCAG 2.2 AA pass (2026-09-22)

Scalecraft targets **WCAG 2.2 Level AA**. This is what was checked, what changed, and what's still open.

## How it was checked
- **Automated:** axe-core 4 (rules tagged wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa + best-practice) run in a headless Chromium on every page: landing, pricing, sign in, sign up, forgot/reset, how, business, legal, free report (mock), paid report (real data), sample report, reports page, admin, the public share page, the unsubscribe/opt-out pages, and with the share sheet and cancel dialog open. **0 violations** at the end of the pass (started at ~45 across 9 pages).
- **Keyboard:** skip link → main; tab order through the landing form; chips, accordions and move buttons operable; share and cancel sheets trap Tab, close on Escape, return focus to the opener.
- **Semantics:** one `h1` per page, ordered `h2`s; accordion summaries carry a heading role; billing toggle is a real tablist; move buttons expose `aria-pressed`; toasts announced through a polite live region; share canvas has a text alternative; decorative glyphs hidden.
- **Reflow:** no horizontal scroll at 320px on landing, pricing, report, reports.

## What changed
- Accent orange moved from `#D2603A` (3.58:1) to `#B84E2A` (4.71:1 on cream; cream text 4.71:1 on it) across the app, share page, opt-out pages and emails. Dimension hues untouched (they only colour large/bold labels and bars with the score printed next to them).
- Muted text on dark panels lifted to `#B3A08A` (6.25:1); no more text at partial opacity on orange.
- Inline links underlined (1.4.1 — never colour-only).
- Visible labels on the landing form fields; the field `id`s are stable for autofill.
- Every control at least 24×24 (2.5.8); nav links 44px.
- Focus ring visible on dark surfaces (cream outline).
- Reduced-motion respected for the roast reveal, goal bar and moments (already in place).

## Still open (not AA blockers, worth doing)
- Screen-reader walkthrough with VoiceOver/NVDA has not been done; only the semantics were reviewed.
- The PNG share/roast cards are images; their alt is the card title + score, not the full card text.
- Admin page: cheap fixes applied, not audited to AA (internal).
- Charts: the history line has an `aria-label` summary; a data table alternative would be better for AAA.
- Email HTML is not covered by WCAG's web-page scope; buttons use the AA accent and every image has alt.

Re-run: copy `server/node_modules/axe-core/axe.min.js` to `public/axe.min.js` (gitignored) and inject it on a page; or run the `/design-review` skill which repeats the contrast checks.
