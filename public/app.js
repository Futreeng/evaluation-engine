/* Scalecraft — creator-first front end over the Growth Engine API.
   Design: "Field Guide" (Claude Design batch 1).
   Routes: #/  #/evaluating/:jobId  #/report/:reportId  #/pricing  #/signin  #/signup  #/reports  #/business */
(function () {
  'use strict';
  const CFG = window.SCALECRAFT_CONFIG || {};
  // Promo code from a link: scalecraft.app/?promo=CODE or #/pricing?promo=CODE.
  (() => { try {
    const fromSearch = new URLSearchParams(location.search).get('promo');
    const fromHash = new URLSearchParams((location.hash.split('?')[1] || '')).get('promo');
    const c = (fromSearch || fromHash || '').trim().toUpperCase();
    if (c) { sessionStorage.setItem('sc_promo', JSON.stringify({ code: c, pending: true })); if (fromSearch) history.replaceState(null, '', location.pathname + location.hash); }
  } catch { } })();
  const API = CFG.apiBase || '/api/growth-engine/v1';
  const POLL = CFG.pollIntervalMs || 2000;
  const $view = document.getElementById('view');
  const $header = document.getElementById('header');

  // ------------------------------------------------------------ data
  const LIVE = [['instagram', 'Instagram'], ['tiktok', 'TikTok']];
  const SOON = [['youtube', 'YouTube'], ['x', 'X'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['threads', 'Threads'], ['pinterest', 'Pinterest'], ['snapchat', 'Snapchat'], ['twitch', 'Twitch'], ['bluesky', 'Bluesky']];
  const PLATFORMS = [...LIVE, ...SOON];
  const SUPPORTED = CFG.useMock ? LIVE.map(p => p[0]) : (CFG.supportedPlatforms || LIVE.map(p => p[0]));
  const supported = k => SUPPORTED.includes(k);
  const NICHES = [
    ['fitness_creator', 'Fitness'], ['food_cooking', 'Food & Cooking'], ['fashion', 'Fashion'], ['beauty_skincare', 'Beauty & Skincare'],
    ['travel', 'Travel'], ['comedy_entertainment', 'Comedy & Entertainment'], ['education_howto', 'Education & How-to'], ['lifestyle_vlog', 'Lifestyle & Vlog'],
    ['music', 'Music'], ['gaming', 'Gaming'], ['tech_gadgets', 'Tech & Gadgets'], ['finance_business', 'Finance & Business'],
    ['parenting_family', 'Parenting & Family'], ['art_design', 'Art & Design'], ['sports', 'Sports'], ['pets', 'Pets'],
    ['other', 'Other…']
  ];
  // Business categories still resolve to a name on old reports.
  const BUSINESS_CATS = [['boutique_fitness', 'Boutique Fitness'], ['fitness', 'Fitness'], ['food_beverage', 'Food & Beverage'], ['retail', 'Retail'], ['professional_services', 'Professional Services']];
  const DIMS = [
    { label: 'Posting Consistency', hue: 1, how: 'How often you post and how long the gaps get.' },
    { label: 'Content Mix', hue: 2, how: 'The formats you use and what the posts are about.' },
    { label: 'Engagement Quality', hue: 3, how: 'Comments and shares, not just likes.' },
    { label: 'Profile Clarity', hue: 4, how: 'Whether a stranger gets what you’re about in four seconds.' }
  ];
  const STEPS = [
    ['finding', 'Finding the account', 'Found the account'],
    ['reading', 'Reading your recent posts', 'Read your recent posts'],
    ['scoring', 'Scoring the four dimensions', 'Scored the four dimensions'],
    ['writing', 'Writing your 30-60-90 plan', 'Wrote your 30-60-90 plan']
  ];
  const nicheName = k => {
    const hit = NICHES.find(c => c[0] === k) || BUSINESS_CATS.find(c => c[0] === k);
    if (hit) return hit[1].replace('…', '');
    return String(k || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  const platName = k => (PLATFORMS.find(p => p[0] === k) || [, k])[1];
  const hueOf = label => (DIMS.find(d => d.label.toLowerCase() === String(label).toLowerCase()) || {}).hue || 1;

  // ------------------------------------------------------------ utils
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  class Raw { constructor(s) { this.s = s; } }
  const raw = s => new Raw(s);
  const h = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? (vals[i] instanceof Raw ? vals[i].s : esc(vals[i])) : ''), '');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
  const fmtDate = d => new Date(d || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = d => new Date(d || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtN = n => Number(n || 0).toLocaleString();
  const ordinal = n => ['1st', '2nd', '3rd', '4th', '5th'][n - 1] || (n + 'th');
  const sget = (k, d) => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const token = () => { try { return localStorage.getItem('sc_token'); } catch { return null; } };
  const setTokenRaw = t => { try { t ? localStorage.setItem('sc_token', t) : localStorage.removeItem('sc_token'); } catch { } };
  const setToken = t => { setTokenRaw(t); if (t) refreshAdminFlag(); else { try { localStorage.removeItem('sc_admin'); } catch { } } };
  const go = hash => { location.hash = hash; };
  // Funnel attribution (spec 1.13): an anonymous browser id, and the referral
  // code from the first ?ref= link seen (spec 1.8 formalises referrals).
  const anonId = () => { try { let a = localStorage.getItem('sc_anon'); if (!a) { a = 'anon_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('sc_anon', a); } return a; } catch { return null; } };
  (() => { try { const r = new URLSearchParams(location.search).get('ref') || new URLSearchParams(location.hash.split('?')[1] || '').get('ref'); if (r && !localStorage.getItem('sc_ref')) localStorage.setItem('sc_ref', r.trim().slice(0, 32)); } catch { } })();
  const refCode = () => { try { return localStorage.getItem('sc_ref') || ''; } catch { return ''; } };
  // Fire-and-forget event; never blocks the UI.
  function track(name, props, reportId) { try { api('/events', { method: 'POST', body: JSON.stringify({ name, props: props || undefined, report_id: reportId || undefined }) }, { allow401: true }).catch(() => { }); } catch { } }
  // Promo: { code, description, amount_cents, base_cents, product, free_months } once checked; { code, pending } before.
  const promo = () => sget('sc_promo', null);
  async function checkPromo(code, product, billingCycle) {
    const r = await api('/billing/promo/check', { method: 'POST', body: JSON.stringify({ code, product, billingCycle }) }, { allow401: true });
    if (r.valid) sset('sc_promo', { ...r, checked_for: product + ':' + (billingCycle || 'monthly') });
    return r;
  }
  const clearPromo = () => { try { sessionStorage.removeItem('sc_promo'); } catch { } };
  // Prices this visitor sees (may be an A/B variant): used by the report upsell and events.
  function rememberPricing(p) { try { const g = (p.tiers || []).find(t => t.tier === 'growth_plan'); sset('sc_pricing', { variant: p.variant || 'control', growth_plan: g?.monthlyPrice, plan_unlock: p.one_time?.[0]?.price }); } catch { } }
  // Admin link in the nav: ask /auth/me once per token and remember the answer.
  async function refreshAdminFlag() {
    if (!token()) { try { localStorage.removeItem('sc_admin'); } catch { } return; }
    const before = lget('sc_admin', false);
    try { const me = await api('/auth/me', {}, { allow401: true }); lset('sc_admin', !!me.is_admin); } catch { lset('sc_admin', false); }
    if (lget('sc_admin', false) !== before) { const cur = $header.querySelector('.nav a.strong'); renderHeader(cur ? (cur.getAttribute('href') || '').replace('#/', '') : ''); }
  }
  const grade = s => s < 50 ? ['Weak', 'weak'] : s < 70 ? ['Fair', 'fair'] : ['Strong', 'strong'];

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------ api
  class ApiError extends Error { constructor(status, body) { super(body?.error || ('HTTP ' + status)); this.status = status; this.body = body; } }
  async function api(path, init = {}, opts = {}) {
    const url = path.startsWith('/api/') || path.startsWith('http') ? path : API + path;
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    const t = token(); if (t) headers.Authorization = 'Bearer ' + t;
    const a = anonId(); if (a) headers['x-anon-id'] = a;
    const r = refCode(); if (r) headers['x-ref'] = r;
    const doFetch = CFG.useMock && window.scalecraftMockFetch ? window.scalecraftMockFetch : fetch;
    const res = await doFetch(url, { ...init, headers });
    let body = null; try { body = await res.json(); } catch { }
    if (body && body.error && !body.message) body.message = body.error;
    if (res.status === 401 && !opts.allow401) {
      setToken(null);
      sset('sc_next', location.hash || '#/');
      go('#/signin');
      throw new ApiError(401, body);
    }
    if (!res.ok) throw new ApiError(res.status, body);
    return body;
  }

  // ------------------------------------------------------------ header / footer
  function renderHeader(kind) {
    $header.innerHTML = h`
      <div class="wrap"><div class="topbar">
        <a class="brand" href="#/">Scalecraft</a>
        <nav class="nav">
          <a href="#/pricing" class="${kind === 'pricing' ? 'strong' : ''}">Pricing</a>
          <a href="#/business">For businesses</a>
          ${token()
            ? raw(h`<a href="#/reports" class="${kind === 'reports' ? 'strong' : ''}">Reports</a>${lget('sc_admin', false) ? raw(h`<a href="#/admin" class="${kind === 'admin' ? 'strong' : ''}">Admin</a>`) : ''}<a href="#" data-action="signout">Sign out</a>`)
            : raw(h`<a href="#/signin" class="strong">Sign in</a>`)}
        </nav>
      </div></div>`;
  }
  // Support address comes from the server (SUPPORT_EMAIL); hidden until set.
  const supportEmail = () => (CFG.supportEmail || sget('sc_support', '') || '');
  const footer = () => h`<div class="wrap"><div class="footer">
    <a href="#/how">How the score works</a><a href="#/business">For businesses</a><a href="#/pricing">Pricing</a>
    <a href="#/legal/terms">Terms</a><a href="#/legal/privacy">Privacy</a><a href="#/legal/cookies">Cookies</a>${supportEmail() ? raw(h`<a href="mailto:${supportEmail()}">Contact</a>`) : ''}
    <span style="margin-left:auto">© ${new Date().getFullYear()} Scalecraft</span>
  </div></div>`;

  // ------------------------------------------------------------ shared pieces
  function dimRow(d, avg) {
    const sc = clamp(d.score, 0, 100); const [gl] = grade(sc); const hue = hueOf(d.label);
    return h`<div class="dimrow">
      <div class="lbl"><span class="hue${hue}">${d.label}</span><b>${sc} · ${gl}</b></div>
      <div class="bar"><div class="fill bg${hue}" style="width:${sc}%"></div>${avg != null ? raw(h`<div class="mark" style="left:${clamp(avg, 0, 100)}%"></div>`) : ''}</div>
    </div>`;
  }
  // The shipped sample report (public/sample-report.js) — a real Growth Plan
  // run on an account we have permission to show. Powers the landing card
  // and #/report/sample so prospects can read a full paid report.
  const SHIPPED = window.SCALECRAFT_SAMPLE || null;
  const SAMPLE = SHIPPED ? {
    handle: SHIPPED.business.handle, platform: SHIPPED.business.platform, date: SHIPPED.created_at, followers: SHIPPED.business.followers || 0, overall: SHIPPED.scores.overall,
    dims: (SHIPPED.scores.dimensions || []).map(d => ({ label: d.label, score: d.score, category_avg: d.category_avg })), summary: SHIPPED.scores.summary || '', link: '#/report/sample'
  } : {
    handle: 'yourhandle', platform: 'instagram', date: '2026-09-18T00:00:00Z', followers: 4820, overall: 53,
    dims: [{ label: 'Posting Consistency', score: 30, category_avg: 48 }, { label: 'Content Mix', score: 72, category_avg: 60 }, { label: 'Engagement Quality', score: 39, category_avg: 55 }, { label: 'Profile Clarity', score: 70, category_avg: 64 }],
    summary: 'Posting Consistency and Engagement Quality are driving most of the gap.'
  };
  function scoreCardHTML(s) {
    const [gl, gc] = grade(s.overall);
    return h`<div class="card scorecard">
      <div class="head"><b>@${s.handle}</b><span>${platName(s.platform)} · ${fmtDate(s.date)}</span></div>
      <div class="bigrow"><span class="bignum">${s.overall}</span>
        <div class="meta"><span class="tag ${gc}">${gl.toUpperCase()}</span><span class="f">${fmtN(s.followers)} followers</span></div></div>
      <div class="dims">${raw(s.dims.map(d => dimRow(d, d.category_avg)).join(''))}</div>
      <p class="why">${s.summary}</p>
      <div class="foot"><span>Marker = niche average</span><a href="${s.link || '#/report/sample'}">See a real one →</a></div>
    </div>`;
  }

  // ------------------------------------------------------------ landing
  function viewLanding() {
    renderHeader('landing');
    if (!sget('sc_support', null)) api('/billing/pricing', {}, { allow401: true }).then(p => { if (p.support_email) { sset('sc_support', p.support_email); const f = $view.querySelector('.footer'); if (f && !f.querySelector('a[href^=mailto]')) (f.querySelector('span') || f).insertAdjacentHTML(f.querySelector('span') ? 'beforebegin' : 'beforeend', h`<a href="mailto:${p.support_email}">Contact</a>`); } }).catch(() => { });
    const last = sget('sc_form', {});
    const platform = supported(last.platform) ? last.platform : 'instagram';
    const niche = last.category || 'fitness_creator';
    const sample = sget('sc_sample', null);
    const hero = sample ? { ...sample, link: '#/report/' + sample.report_id } : SAMPLE;
    const pr = promo();
    $view.innerHTML = h`
      <div class="wrap">
        ${pr ? raw(h`<div class="promobar">Code <b>${pr.code}</b> ${pr.description ? '— ' + pr.description + '. ' : 'is ready. '}It's applied when you start the plan. <a href="#/pricing">See pricing →</a></div>`) : ''}
        <section class="hero">
          <div class="l">
            <h1>Score your account. See exactly why. Get the plan.</h1>
            <p class="sub">Type your handle. About a minute later you'll know where you stand in your niche, what's working, and the first three things to change.</p>
            <form class="darkform" id="evalForm" novalidate>
              <div class="row">
                <div class="field"><div class="handle"><span>@</span><input type="text" name="handle" placeholder="yourhandle" autocomplete="off" autocapitalize="none" spellcheck="false" value="${CFG.useMock && !last.handle ? 'humansofny' : (last.handle || '')}" aria-label="Your handle"></div></div>
                <div class="field selwrap"><select name="category" aria-label="Niche">${raw(NICHES.map(([k, n]) => h`<option value="${k}" ${k === niche ? 'selected' : ''}>${n}</option>`).join(''))}</select></div>
              </div>
              <div class="field" id="otherWrap" ${niche === 'other' ? '' : 'hidden'}><input type="text" name="other" placeholder="Your niche, in a word or two" value="${last.other || ''}" aria-label="Your niche"></div>
              <div class="optq bizq"><div class="ql">Is this a business account?</div>
                <div class="chips" role="radiogroup" aria-label="Business account"><button type="button" class="chip ${last.is_business ? '' : 'on'}" data-biz="no" role="radio" aria-checked="${!last.is_business}">No — I'm a creator</button><button type="button" class="chip ${last.is_business ? 'on' : ''}" data-biz="yes" role="radio" aria-checked="${!!last.is_business}">Yes</button></div>
                <div class="hint" id="bizHint" ${last.is_business ? '' : 'hidden'}>Business plans are coming — you'll get the creator scoring today and a note when the business version is ready.</div></div>
              <div class="chips" role="radiogroup" aria-label="Platform">
                ${raw(LIVE.map(([k, n]) => h`<button type="button" class="chip ${k === platform ? 'on' : ''}" data-platform="${k}" role="radio" aria-checked="${k === platform}">${n}</button>`).join(''))}
                ${raw(SOON.map(([k, n]) => h`<button type="button" class="chip soon" data-soon="${k}">${n} · soon</button>`).join(''))}
              </div>
              <div id="waitSlot"></div>
              <div class="optq"><div class="ql">Your next 90 days <span>optional</span></div>
                <div class="chips" role="radiogroup" aria-label="Your next 90 days">${raw([['usual', 'Business as usual'], ['fewer_shoots', 'Fewer new shoots'], ['launch', 'Something launching']].map(([k, n]) => h`<button type="button" class="chip ${last.horizon === k ? 'on' : ''}" data-horizon="${k}" role="radio" aria-checked="${last.horizon === k}">${n}</button>`).join(''))}</div>
                <div class="hint">Shapes your first three moves. The Growth Plan asks four more so the whole plan fits.</div></div>
              <div class="field"><input type="email" name="email" placeholder="you@email.com — where to send it" autocomplete="email" value="${last.email || ''}" aria-label="Email"></div>
              <div class="form-error" id="formError" hidden></div>
              <div class="cta">
                <button class="btn" type="submit">Score my account — free</button>
                <div class="reassure">No login to your account · Public data only<br>Score in about a minute</div>
              </div>
            </form>
          </div>
          <div class="r">${raw(scoreCardHTML(hero))}</div>
        </section>

        <section class="howstrip" id="how">
          ${raw(DIMS.map(d => h`<div class="it bd${d.hue}"><b class="hue${d.hue}">${d.label}</b><p>${d.how}</p></div>`).join(''))}
        </section>

        <section class="founders" id="founders">
          <div class="t"><h3>Founding creators</h3><p>The first 50 accounts get the Growth Plan free for a month. Tell us what worked.</p></div>
          <form id="foundersForm"><input type="email" name="email" placeholder="you@email.com" aria-label="Email"><button class="btn light" type="submit">Count me in</button></form>
        </section>

        <section class="card sharepromo">
          <div class="mini"><canvas id="promoCard" width="1080" height="1920"></canvas></div>
          <div class="t"><h3>Post your score</h3><p>Creators post their number. Then they post the one six weeks later.</p></div>
        </section>
      </div>
      ${raw(footer())}`;

    drawShareCard($view.querySelector('#promoCard'), hero, 'story');

    const form = $view.querySelector('#evalForm');
    let chosenPlatform = platform;
    let chosenHorizon = last.horizon || null;
    let chosenBiz = !!last.is_business;
    form.querySelectorAll('[data-biz]').forEach(b => b.addEventListener('click', () => {
      chosenBiz = b.dataset.biz === 'yes';
      form.querySelectorAll('[data-biz]').forEach(x => { const on = (x.dataset.biz === 'yes') === chosenBiz; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      const hint = form.querySelector('#bizHint'); if (hint) hint.hidden = !chosenBiz;
    }));
    form.querySelectorAll('[data-horizon]').forEach(b => b.addEventListener('click', () => {
      chosenHorizon = chosenHorizon === b.dataset.horizon ? null : b.dataset.horizon; // tap again to clear
      form.querySelectorAll('[data-horizon]').forEach(x => { const on = x.dataset.horizon === chosenHorizon; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    }));
    form.querySelectorAll('[data-platform]').forEach(b => b.addEventListener('click', () => {
      chosenPlatform = b.dataset.platform;
      form.querySelectorAll('[data-platform]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      form.querySelectorAll('[data-soon]').forEach(x => x.classList.remove('on'));
      $view.querySelector('#waitSlot').innerHTML = '';
    }));
    form.querySelectorAll('[data-soon]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.soon; const slot = $view.querySelector('#waitSlot');
      const open = b.classList.contains('on');
      form.querySelectorAll('[data-soon]').forEach(x => x.classList.remove('on'));
      if (open) { slot.innerHTML = ''; return; }
      b.classList.add('on');
      slot.innerHTML = h`<div class="waitbox"><div class="t">Leave your email and we'll score ${platName(k)} first.</div>
        <div class="row"><input type="email" placeholder="you@email.com" value="${form.email.value}" aria-label="Email for the ${platName(k)} waitlist"><button type="button" class="btn light">Notify me</button></div></div>`;
      slot.querySelector('button').addEventListener('click', async () => {
        const email = slot.querySelector('input').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Add an email first.'); return; }
        try { await api('/waitlist', { method: 'POST', body: JSON.stringify({ email, platform: k }) }); } catch { }
        slot.innerHTML = h`<div class="waitdone">You're first in line for ${platName(k)}.</div>`;
        if (!form.email.value) form.email.value = email;
      });
    }));
    form.category.addEventListener('change', () => { $view.querySelector('#otherWrap').hidden = form.category.value !== 'other'; });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = form.querySelector('#formError');
      const otherText = (form.other.value || '').trim();
      const payload = {
        handle: form.handle.value.replace(/^@/, '').trim(),
        platform: chosenPlatform,
        category: form.category.value === 'other' ? (otherText ? otherText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'other' : 'other') : form.category.value,
        email: form.email.value.trim(),
        other: otherText,
        horizon: chosenHorizon || undefined,
        is_business: chosenBiz || undefined,
      };
      if (chosenHorizon) { payload.plan_context = { ...(sget('sc_plan_context', null) || {}), horizon: chosenHorizon }; sset('sc_plan_context', payload.plan_context); }
      const problems = [];
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(payload.handle)) problems.push('a handle (letters, numbers, dots or underscores)');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) problems.push('an email we can send the report to');
      if (problems.length) { err.textContent = 'We need ' + problems.join(' and ') + '.'; err.hidden = false; return; }
      err.hidden = true;
      sset('sc_form', payload);
      await submitEvaluation(payload, form.querySelector('button[type=submit]'));
    });
    $view.querySelector('#foundersForm').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.currentTarget; const email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Add an email first.'); return; }
      let r = null; try { r = await api('/waitlist', { method: 'POST', body: JSON.stringify({ email, platform: 'founders' }) }); } catch { }
      if (r && r.promo) { sset('sc_promo', { code: r.promo.code, pending: true }); f.innerHTML = h`<div class="waitdone" style="flex:1">You're in. Your code is <b class="code">${r.promo.code}</b> — ${r.promo.description}. It's applied when you <a href="#/pricing">start the plan</a>.</div>`; }
      else f.innerHTML = h`<div class="waitdone" style="flex:1">You're in. We'll email you when your month starts.</div>`;
    });
    const scrollTo = sget('sc_scroll', null);
    if (scrollTo) { sessionStorage.removeItem('sc_scroll'); document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  async function submitEvaluation(payload, btn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = 'Starting…'; }
    try {
      const body = { handle: payload.handle, platform: payload.platform, category: payload.category, email: payload.email };
      try { body.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { }
      if (payload.competitors && payload.competitors.length) body.competitors = payload.competitors;
      const ctx = payload.plan_context || sget('sc_plan_context', null);
      if (ctx) body.plan_context = ctx;
      if (payload.rerun_of) body.rerun_of = payload.rerun_of;
      if (payload.is_business) body.is_business = true;
      const res = await api('/evaluate/social-snapshot', { method: 'POST', body: JSON.stringify(body) });
      sset('sc_job_' + res.job_id, { ...payload, submitted_at: Date.now() });
      go('#/evaluating/' + encodeURIComponent(res.job_id));
    } catch (e) {
      if (e.status === 401) return;
      if (e.status === 402 && e.body?.code === 'FREE_LIMIT_REACHED') {
        sset('sc_intent_tier', e.body.upgrade_tier || 'growth_plan');
        sset('sc_limit_msg', e.body.message || e.message);
        if (e.body.report_id) { toast(`@${payload.handle} was scored on ${fmtDate(e.body.generated_at)} — here it is.`); go('#/report/' + encodeURIComponent(e.body.report_id)); return; }
        go(token() ? '#/pricing' : '#/signin');
        return;
      }
      toast(e.message || "Couldn't start the evaluation. Try again in a moment.");
      if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
    }
  }

  // ------------------------------------------------------------ evaluating
  let pollHandle = null;
  function stopPolling() { if (pollHandle) { clearTimeout(pollHandle); pollHandle = null; } }

  function viewEvaluating(jobId) {
    renderHeader('eval');
    const meta = sget('sc_job_' + jobId, sget('sc_form', {}));
    const handle = meta.handle || 'your account';
    const startedAt = meta.submitted_at || Date.now();
    const render = job => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      let inner;
      if (job.status === 'queued') {
        const ahead = job.queue_position;
        inner = h`<div class="card evalbox gold"><div class="eyebrow">Queued</div><h2>${ahead ? `You're ${ordinal(ahead + 1)} in line` : "You're in line"}</h2>
          <p>We'll start on @${handle} in a moment. You can close this — the report lands in your inbox either way.</p></div>`;
      } else if (job.status === 'running') {
        const step = clamp(job.step || 1, 1, 4);
        const pct = job.percent != null ? clamp(job.percent, 0, 100) : [14, 42, 68, 91][step - 1];
        const stats = job.stats;
        inner = h`<div class="card evalbox">
          <div class="top"><h2 class="md">${STEPS[step - 1][1]}</h2><span class="pct">${pct}%</span></div>
          <div class="sub">@${handle} · step ${step} of 4</div>
          <div class="track"><div class="fill" style="width:${pct}%"></div></div>
          ${stats ? raw(h`<div class="stats">${stats.posts_found != null ? raw(h`<span class="pill tone">POSTS ${stats.posts_found}</span>`) : ''}${stats.window_days != null ? raw(h`<span class="pill tone">WINDOW ${stats.window_days} d</span>`) : ''}${stats.longest_gap_days != null ? raw(h`<span class="pill tone">LONGEST GAP ${stats.longest_gap_days} d</span>`) : ''}</div>`) : ''}
          <div class="steps">${raw(STEPS.map(([, now, done], i) => { const n = i + 1; const cls = n < step ? 'done' : n === step ? 'now' : ''; return h`<div class="st ${cls}"><span class="ring">${cls === 'done' ? '✓' : ''}</span>${cls === 'done' ? done : now}</div>`; }).join(''))}</div>
          ${elapsed > 75 ? raw('<div class="slownote">This is taking longer than usual. Nothing is wrong — big accounts take a little more reading. We\'ll email you the second it\'s done.</div>') : ''}
        </div>`;
      } else if (job.status === 'failed') {
        const errText = String(job.error || '');
        const profile = /private|not found|no public|does not exist|not a valid/i.test(errText);
        inner = profile
          ? h`<div class="card evalbox warm"><div class="eyebrow" style="color:var(--weak)">Couldn't read the account</div>
              <h2 class="fail">We couldn't read @${handle} — ${/private/i.test(errText) ? 'it looks private.' : 'we couldn\'t find it.'}</h2>
              <p>${/private/i.test(errText) ? 'Make it public for ten minutes and retry. We only ever read what anyone can see.' : 'Check the spelling of the handle and the platform, then try again.'}</p>
              <div class="actions"><button class="btn" data-action="retry">Retry</button><a class="btn ghost" href="#/" data-scroll="evalForm">Try another handle</a></div></div>`
          : h`<div class="card evalbox"><div class="eyebrow">Our side</div>
              <h2 class="fail">We couldn't finish. Nothing was charged.</h2>
              <p>Retry in a few minutes. If it happens twice, reply to the email and we'll run it by hand.</p>
              <div class="actions"><button class="btn dark" data-action="retry">Retry</button></div>
              <div class="ref">REF ${(job.ref || jobId.slice(-7)).toUpperCase()}${errText ? ' · ' + errText.slice(0, 70) : ''}</div></div>`;
      } else if (job.status === 'complete') {
        inner = h`<div class="card evalbox green"><div class="eyebrow">Complete</div><h2>Your score is ${job.overall ?? '…'}</h2><p>Opening your report…</p></div>`;
      }
      $view.innerHTML = h`<div class="wrap"><div class="evalwrap">${raw(inner || '')}</div></div>`;
      $view.querySelector('[data-action=retry]')?.addEventListener('click', e => submitEvaluation(meta, e.currentTarget));
    };
    const tick = async () => {
      let job;
      try { job = await api('/job/' + encodeURIComponent(jobId)); }
      catch (e) {
        if (e.status === 401) return;
        if (e.status === 404) { $view.innerHTML = h`<div class="center-msg"><h2>That evaluation has expired.</h2><a href="#/">Start a new one</a></div>`; return; }
        pollHandle = setTimeout(tick, POLL * 2); return;
      }
      if (job.status === 'complete') {
        const rawReport = job.resultPayload || job.result || null;
        const id = rawReport?.report_id || rawReport?.reportId || job.report_id;
        const report = rawReport && id ? normalizeReport(rawReport, id) : null;
        if (report) { sset('sc_report_' + id, report); rememberSample(report); }
        render({ status: 'complete', overall: report?.scores?.overall });
        setTimeout(() => { if (id) go('#/report/' + encodeURIComponent(id)); else $view.innerHTML = h`<div class="center-msg"><h2>Finished, but no report came back.</h2><a href="#/">Try again</a></div>`; }, 900);
        return;
      }
      render(job);
      if (job.status !== 'failed') pollHandle = setTimeout(tick, POLL);
    };
    render({ status: 'queued' });
    tick();
  }
  // The landing hero shows the visitor's own latest report once they have one.
  function rememberSample(r) {
    if (!r.scores || r.scores.overall == null) return;
    sset('sc_sample', { report_id: r.report_id, handle: r.business?.handle, platform: r.business?.platform, date: r.created_at, followers: r.business?.followers || r.followers || 0, overall: r.scores.overall, dims: (r.scores.dimensions || []).map(d => ({ label: d.label, score: d.score, category_avg: d.category_avg })), summary: r.scores.summary || '' });
  }

  // ------------------------------------------------------------ report normalisation
  function normalizePhase(p, i) {
    const range = p.range || p.days || `${i * 30 + 1}-${(i + 1) * 30}`;
    const days = /^\d+\s*[-–]\s*\d+$/.test(range) ? 'Days ' + range.replace(/\s*[-–]\s*/, '–') : range;
    const locked = p.locked || {};
    const count = locked.count ?? 4;
    const wk = [i * 4 + 1, i * 4 + 4];
    const moves = Array.isArray(p.moves) ? p.moves.filter(m => m && (m.action || m.title)) : [];
    const weeks = Array.isArray(p.calendar_weeks) ? p.calendar_weeks : [];
    const firstLocked = i * 4 + 2; // openers are 01; moves run 02–13 across the three phases
    const teasers = Array.isArray(locked.items) && locked.items.length ? locked.items.map(it => it.meta || it.title || '') : [];
    return {
      key: 'p' + (i + 1), days, label: p.label || `Phase ${i + 1}`,
      action: p.visible_action || p.action || '', detail: p.detail || '',
      moves, weeks, count, firstLocked, teasers, opener: p.opener || null, not_included: !!p.not_included,
      lockedHeader: /\d/.test(locked.teaser || '') ? locked.teaser : `${count} more moves + your weeks ${wk[0]}–${wk[1]} calendar`
    };
  }
  const DIM_KEYS = [['POSTING_CONSISTENCY', 'Posting Consistency'], ['CONTENT_MIX', 'Content Mix'], ['ENGAGEMENT_RATE', 'Engagement Quality'], ['ENGAGEMENT_QUALITY', 'Engagement Quality'], ['DISCOVERY_SIGNAL', 'Discovery Signal'], ['PROFILE_CLARITY', 'Profile Clarity']];
  function normalizeReport(rawR, reportId) {
    const wrapped = rawR && rawR.reportBody && typeof rawR.reportBody === 'object';
    const body = wrapped ? rawR.reportBody : (rawR || {});
    const r = { ...body };
    r.report_id = body.report_id || rawR?.reportId || reportId;
    r.tier = body.tier || rawR?.tier;
    r.business = body.business || rawR?.business || {};
    r.created_at = body.created_at || body.generated_at || rawR?.generatedAt || Date.now();
    r.narrative = typeof body.narrative === 'string' ? body.narrative : null;
    if (!r.scores || r.scores.overall == null) {
      const gap = String(body.raw_personas?.gap_auditor || '').replace(/\*\*|__/g, '');
      const dims = [];
      for (const [key, label] of DIM_KEYS) {
        const m = new RegExp(key.replace('_', '[_ ]') + '\\s*(?:\\([^)]*\\))?[^0-9\\n]{0,40}?(\\d{1,3})(?:\\s*\\/\\s*100)?\\s*[:—–-]?\\s*([^\\n]*)', 'i').exec(gap);
        if (m && !dims.some(d => d.label === label)) dims.push({ label, score: clamp(m[1], 0, 100), explanation: (m[2] || '').trim() });
      }
      const om = /OVERALL[_ ]SCORE[^0-9]{0,40}(\d{1,3})/i.exec(gap);
      if (om || dims.length) r.scores = { overall: om ? clamp(om[1], 0, 100) : Math.round(dims.reduce((a, d) => a + d.score, 0) / dims.length), dimensions: dims, parsed: true };
    }
    return r;
  }

  // ------------------------------------------------------------ share card (canvas)
  function drawShareCard(canvas, s, size, opts = {}) {
    if (!canvas) return;
    const W = 1080, H = size === 'square' ? 1080 : 1920;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const P = 84;
    ctx.fillStyle = '#D2603A'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#FFF6E9';
    const dsp = w => `700 ${w}px "Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif`;
    const sans = (w, wt = 500) => `${wt} ${w}px "Instrument Sans", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.font = sans(40, 600); ctx.globalAlpha = .9;
    ctx.fillText(`@${s.handle}  ·  ${nicheName(s.niche || s.category) || platName(s.platform)}`.toUpperCase(), P, P);
    ctx.globalAlpha = 1;
    let y = size === 'square' ? 250 : 560;
    if (opts.prev != null) {
      ctx.font = dsp(200); ctx.globalAlpha = .55; ctx.fillText(String(opts.prev), P, y + 120); ctx.globalAlpha = 1;
      const pw = ctx.measureText(String(opts.prev)).width;
      ctx.font = dsp(120); ctx.fillText('→', P + pw + 40, y + 180);
      ctx.font = dsp(360); ctx.fillText(String(s.overall), P + pw + 190, y);
      y += 400;
      ctx.font = sans(40, 600); ctx.fillText(opts.span || 'in six weeks', P, y); y += 90;
    } else {
      ctx.font = dsp(size === 'square' ? 420 : 520); ctx.fillText(String(s.overall), P - 14, y);
      y += size === 'square' ? 420 : 520;
      ctx.font = sans(48, 600); ctx.fillText('My Scalecraft score', P, y); y += 110;
    }
    const bw = W - P * 2;
    for (const d of s.dims) {
      ctx.font = sans(38, 600); ctx.fillText(d.label, P, y);
      ctx.textAlign = 'right'; ctx.fillText(String(d.score), W - P, y); ctx.textAlign = 'left';
      y += 58;
      ctx.fillStyle = '#E9977B'; roundRect(ctx, P, y, bw, 28, 14); ctx.fill();
      ctx.fillStyle = '#FFF6E9'; roundRect(ctx, P, y, bw * clamp(d.score, 0, 100) / 100, 28, 14); ctx.fill();
      y += 78;
    }
    ctx.font = sans(34, 500); ctx.globalAlpha = .85;
    ctx.fillText(`${fmtDate(s.date)}  ·  scored by scalecraft`, P, H - P - 30); ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, hh, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function openShareSheet(report) {
    const s = { handle: report.business?.handle, platform: report.business?.platform, niche: report.business?.category, date: report.created_at, overall: report.scores.overall, dims: report.scores.dimensions };
    const prev = report.history?.previous?.overall;
    const el = document.createElement('div'); el.className = 'sheet';
    el.innerHTML = h`<div class="panel" role="dialog" aria-label="Share your score"><div class="grab"></div>
      <div class="row">
        <div class="preview"><canvas id="shareCanvas"></canvas></div>
        <div class="opts"><h3>Post your score</h3>
          <div class="sizes"><button type="button" class="pill dark" data-size="story">Story 1080×1920</button><button type="button" class="pill" data-size="square">Square</button></div>
          ${prev != null && prev !== s.overall ? raw(h`<label class="check"><input type="checkbox" id="thenNow" checked> Show ${prev} → ${s.overall}</label>`) : ''}
          <button type="button" class="btn" data-share="post">Post your score</button>
          <button type="button" class="btn ghost" data-share="save">Save image</button>
          <button type="button" class="btn ghost" data-share="copy">Copy link</button>
        </div></div></div>`;
    document.body.appendChild(el);
    const canvas = el.querySelector('#shareCanvas');
    let size = 'story';
    const redraw = () => { const tn = el.querySelector('#thenNow'); drawShareCard(canvas, s, size, tn && tn.checked ? { prev, span: report.history?.previous?.generated_at ? 'since ' + fmtShort(report.history.previous.generated_at) : 'in six weeks' } : {}); };
    redraw();
    el.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { size = b.dataset.size; el.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('dark', x === b)); redraw(); }));
    el.querySelector('#thenNow')?.addEventListener('change', redraw);
    const close = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) close(); });
    const toBlob = () => new Promise(r => canvas.toBlob(r, 'image/png'));
    el.querySelector('[data-share=save]').addEventListener('click', async () => {
      if (report.report_id !== 'sample') track('card_downloaded', { size }, report.report_id);
      const blob = await toBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `scalecraft-${s.handle}-${size}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    el.querySelector('[data-share=post]').addEventListener('click', async () => {
      const blob = await toBlob(); const file = new File([blob], `scalecraft-${s.handle}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: `My account scored ${s.overall}/100 on Scalecraft` }); return; } catch { } }
      el.querySelector('[data-share=save]').click(); toast('Saved — post it from your camera roll.');
    });
    el.querySelector('[data-share=copy]').addEventListener('click', async () => {
      const url = location.origin + location.pathname + '#/report/' + report.report_id;
      try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); }
    });
  }

  // ------------------------------------------------------------ report
  // ------------------------------------------------------------ plan setup (intake)
  // Four taps and an optional line, asked once, between "start the plan" and
  // payment. Saved on the account per handle; edited from the report.
  const INTAKE = [
    { key: 'horizon', q: 'Your next 90 days', opts: [['usual', 'Business as usual'], ['fewer_shoots', 'Fewer new shoots', 'no trips, off-season, injury, busy'], ['launch', 'Something launching', 'an event, a drop, a move']] },
    { key: 'hours', q: 'Time you can give this each week', opts: [['lt2', 'Under 2 hours'], ['2_5', '2–5 hours'], ['5_10', '5–10 hours'], ['10plus', '10+ hours']] },
    { key: 'goal', q: 'What you want from the next 90 days', opts: [['followers', 'More followers'], ['deals', 'Brand deals'], ['sell', 'Sell something', 'a guide, coaching, a product'], ['bookings', 'Bookings or clients'], ['consistency', 'Just get consistent']] },
    { key: 'style', q: 'How you like to make content', opts: [['on_camera', 'On camera, talking'], ['behind', 'Behind the camera', 'voiceover, b-roll'], ['photos', 'Photos and carousels'], ['help', 'I have help', 'an editor or team']] },
  ];
  const ctxLabel = (k, v) => { const q = INTAKE.find(x => x.key === k); const o = q && q.opts.find(x => x[0] === v); return o ? o[1] : ''; };
  function contextChips(ctx) {
    if (!ctx) return '';
    const parts = INTAKE.map(q => ctxLabel(q.key, ctx[q.key])).filter(Boolean);
    return parts.map(t => h`<span class="chip">${t}</span>`).join('');
  }
  async function viewPlanSetup() {
    renderHeader('report');
    const q = new URLSearchParams((location.hash.split('?')[1] || ''));
    const reportId = q.get('report') || '';
    const path = q.get('path') || 'subscribe';       // subscribe | once | edit | checkin
    const phase = Number(q.get('phase')) || 0;
    const report = reportId ? sget('sc_report_' + reportId, null) : null;
    const biz = report?.business || sget('sc_form', {});
    const saved = sget('sc_plan_context', null) || report?.plan_context || {};
    const state = { ...saved };
    const days = path === 'once' ? 60 : 90;
    const heading = path === 'edit' ? 'Update your next 90 days' : path === 'checkin' ? `Phase ${phase} starts. What changed?` : `60 seconds so the plan fits your life.`;
    let oncePromo = null;
    if (path === 'once' && promo() && promo().code) { try { const r = await checkPromo(promo().code, 'plan_unlock'); if (r.valid) oncePromo = r; } catch { } }
    const sub = path === 'once' ? 'Four taps. The 60-day plan is written around your answers.' : path === 'checkin' ? 'Change what changed. The plan is rewritten tonight.' : path === 'edit' ? 'The plan is rewritten against your new answers.' : 'Four taps. Every move and calendar slot is written around your answers, and we check back at day 30 and 60.';
    const render = () => {
      const needLink = state.goal === 'sell' || state.goal === 'bookings';
      const needContact = state.goal === 'deals';
      const complete = INTAKE.every(x => state[x.key]);
      $view.innerHTML = h`
        <div class="wrap narrow">
          <div class="setup">
            <div class="eyebrow">${biz.handle ? '@' + biz.handle + ' · ' : ''}${days}-day plan</div>
            <h1>${heading}</h1>
            <p class="sub">${sub}</p>
            ${raw(INTAKE.map(x => h`<div class="qblock"><div class="q">${x.q.replace('90', String(days))}</div><div class="opts">${raw(x.opts.map(o => h`<button type="button" class="opt ${state[x.key] === o[0] ? 'on' : ''}" data-q="${x.key}" data-v="${o[0]}"><span>${o[1]}</span>${o[2] ? raw(h`<small>${o[2]}</small>`) : ''}</button>`).join(''))}</div></div>`).join(''))}
            ${needLink ? raw(h`<div class="qblock"><div class="q">Where should the link go?</div><input type="url" id="ctxLink" class="txt" placeholder="yoursite.com/guide" value="${state.link || ''}"><div class="fine">The bio and CTA moves use this exact link instead of a placeholder.</div></div>`) : ''}
            ${needContact ? raw(h`<div class="qblock"><div class="q">Email brands should use <span class="opt-note">optional</span></div><input type="email" id="ctxContact" class="txt" placeholder="collabs@you.com" value="${state.contact || ''}"><div class="fine">Goes into the bio and contact moves exactly as written.</div></div>`) : ''}
            <div class="qblock"><div class="q">Anything else? <span class="opt-note">optional</span></div><input type="text" id="ctxNotes" class="txt" maxlength="140" placeholder="moving in November · just got a drone · off for three weeks" value="${state.notes || ''}"></div>
            ${oncePromo ? raw(h`<div class="promobox inline">Code <b>${oncePromo.code}</b> applied — ${oncePromo.description}.</div>`) : ''}
            <button class="btn block" id="ctxGo" ${complete ? '' : 'disabled'}>${path === 'once' ? (oncePromo ? (oncePromo.amount_cents === 0 ? 'Get the 60-day plan — free' : `Continue to the $${(oncePromo.amount_cents / 100).toFixed(oncePromo.amount_cents % 100 ? 2 : 0)} plan`) : 'Continue to the $' + (sget('sc_once_price', 15)) + ' plan') : path === 'edit' || path === 'checkin' ? 'Rewrite my plan' : 'Continue to the plan'}</button>
            ${path === 'checkin' ? raw(h`<a class="btn ghost block" href="#/report/${reportId}?checkin=${phase}&changed=0">Nothing changed — carry on</a>`) : path === 'edit' ? raw(h`<a class="btn ghost block" href="#/report/${reportId}">Cancel</a>`) : raw(h`<div class="fine center">You can change these any time from your report.</div>`)}
          </div>
        </div>${raw(footer())}`;
      $view.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => { state[b.dataset.q] = b.dataset.v; const l = $view.querySelector('#ctxLink'); const n = $view.querySelector('#ctxNotes'); const c = $view.querySelector('#ctxContact'); if (l) state.link = l.value; if (n) state.notes = n.value; if (c) state.contact = c.value; render(); }));
      $view.querySelector('#ctxGo').addEventListener('click', async e => {
        const l = $view.querySelector('#ctxLink'); const n = $view.querySelector('#ctxNotes'); const c = $view.querySelector('#ctxContact');
        const ctx = { horizon: state.horizon, hours: state.hours, goal: state.goal, style: state.style };
        if (l && l.value.trim()) ctx.link = l.value.trim(); if (n && n.value.trim()) ctx.notes = n.value.trim().slice(0, 140); if (c && c.value.trim()) ctx.contact = c.value.trim();
        sset('sc_plan_context', ctx);
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Saving…';
        if (token() && biz.handle && biz.platform) { try { await api('/account/plan-context', { method: 'PUT', body: JSON.stringify({ handle: biz.handle, platform: biz.platform, plan_context: ctx }) }); } catch { } }
        if (path === 'once') {
          if (!token()) { sset('sc_next', '#/report/' + reportId); sset('sc_unlock_once', reportId); go('#/signup'); return; }
          try {
            const res = await api('/reports/' + encodeURIComponent(reportId) + '/unlock', { method: 'POST', body: JSON.stringify({ plan_context: ctx, ...(oncePromo ? { promo_code: oncePromo.code } : {}) }) });
            if (res.already_unlocked) { go('#/report/' + encodeURIComponent(res.report_id)); return; }
            sset('sc_job_' + res.job_id, { handle: biz.handle, platform: biz.platform, category: biz.category, submitted_at: Date.now(), one_time: true });
            if (oncePromo) clearPromo();
            toast(res.payment?.amount === '$0.00' ? 'Free with your code. Writing your 60-day plan…' : `Charged ${res.payment?.amount || ''} once. Writing your 60-day plan…`); go('#/evaluating/' + encodeURIComponent(res.job_id));
          } catch (e2) { if (e2.status === 401) return; toast(e2.message || 'Unlock failed.'); b.disabled = false; b.textContent = 'Try again'; }
          return;
        }
        if (path === 'edit' || path === 'checkin') {
          try {
            const res = await api('/reports/' + encodeURIComponent(reportId) + '/checkin', { method: 'POST', body: JSON.stringify({ phase: phase || undefined, changed: true, plan_context: ctx }) });
            if (res.job_id) { sset('sc_job_' + res.job_id, { handle: biz.handle, platform: biz.platform, category: biz.category, submitted_at: Date.now(), rerun: true }); sessionStorage.removeItem('sc_report_' + reportId); toast('Rewriting your plan…'); go('#/evaluating/' + encodeURIComponent(res.job_id)); return; }
            toast('Saved — the plan picks this up at the next refresh.'); go('#/report/' + reportId);
          } catch (e2) { if (e2.status === 401) return; if (e2.status === 402) { sset('sc_intent_tier', 'growth_plan'); go('#/pricing'); return; } toast(e2.message || 'Could not save.'); b.disabled = false; b.textContent = 'Rewrite my plan'; }
          return;
        }
        sset('sc_intent_tier', 'growth_plan'); go('#/pricing');
      });
    };
    render();
  }

  async function viewReport(reportId) {
    const isSample = reportId === 'sample';
    if (isSample && !SHIPPED) { renderHeader('report'); $view.innerHTML = h`<div class="center-msg"><h2>Score your own account to see a real one.</h2><a href="#/">Score my account</a></div>`; return; }
    let report = isSample ? SHIPPED : sget('sc_report_' + reportId, null);
    if (!report) {
      renderHeader('report');
      $view.innerHTML = h`<div class="center-msg">Loading your report…</div>`;
      try { report = normalizeReport(await api('/reports/' + encodeURIComponent(reportId)), reportId); sset('sc_report_' + reportId, report); }
      catch (e) {
        if (e.status === 401) return;
        if (e.status === 403) { $view.innerHTML = h`<div class="center-msg"><h2>This report belongs to another account.</h2><a href="#/reports">Your reports</a></div>`; return; }
        $view.innerHTML = h`<div class="center-msg"><h2>We couldn't find that report.</h2><a href="#/">Score an account</a></div>`; return;
      }
    }
    const s = report.scores || {};
    if (s.overall == null) { renderHeader('report'); $view.innerHTML = h`<div class="center-msg"><h2>This report came back without a score.</h2><a href="#/">Score an account</a></div>`; return; }
    const biz = report.business || {};
    const paid = !!report.tier && report.tier !== 'social_snapshot';
    const overall = clamp(s.overall, 0, 100); const [gl, gc] = grade(overall);
    const niche = nicheName(biz.category);
    const nicheKnown = s.niche_known !== false;
    const phases = (report.growth_path?.phases || []).map(normalizePhase);
    const pi = report.post_insights || null;
    const hist = report.history || null;
    const comp = report.competitors || null;
    const calWeeks = Array.isArray(report.calendar?.weeks) ? report.calendar.weeks : [];
    const pending = s.category_baseline_pending;
    const doneKey = 'sc_done_' + report.report_id;
    const done = isSample ? {} : { ...(lget(doneKey, {})), ...(report.moves_done || {}) };
    const isDone = k => !!done[k];
    const pv = sget('sc_pricing', null);
    const price = pv?.growth_plan ?? report.upsell?.monthly_price ?? 12;
    const oneTime = pv?.plan_unlock ?? report.upsell?.one_time_price ?? 15;
    const thisWeek = phases[0];
    const nextPhase = phases[1];
    const followers = biz.followers || report.followers || (report.post_insights && report.post_insights.followers) || null;
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const once = !!report.one_time_unlock;
    const subscriber = paid && !once && !isSample;
    const planDays = report.plan_days || (once ? 60 : 90);
    const ctx = report.plan_context || null;
    const ageDays = report.plan_started_at ? (Date.now() - report.plan_started_at) / 86400000 : 0;
    const checkins = report.checkins || {};
    // Phase check-in window: day 25–45 for phase 2, 55–75 for phase 3
    const duePhase = subscriber ? ([[2, 25, 45], [3, 55, 75]].find(([ph, a, b]) => ageDays >= a && ageDays < b && !checkins['p' + ph]) || [])[0] : 0;
    const nudge = subscriber && report.nudge ? report.nudge : null;
    if (subscriber && qs.get('checkin') && qs.get('changed') === '1') { go(`#/plan-setup?report=${encodeURIComponent(report.report_id)}&path=checkin&phase=${qs.get('checkin')}`); return; }
    if (isSample) sset('sc_once_price', oneTime);

    if (!isSample && !sget('sc_viewed_' + report.report_id, false)) { sset('sc_viewed_' + report.report_id, true); track('report_viewed', { tier: report.tier, paid }, report.report_id); }
    renderHeader('report');
    $view.innerHTML = h`
      <div class="wrap">
        ${isSample ? raw(h`<div class="samplebar"><b>Sample report.</b> A real Growth Plan for a real account, scored ${fmtDate(report.created_at)}. Yours is written from your own posts. <a href="#/" data-scroll="evalForm">Score my account →</a></div>`) : ''}
        <div class="rhead">
          <div class="l"><span class="h">@${biz.handle || ''}</span><span class="ctx">${platName(biz.platform)} · ${niche} · ${fmtDate(report.created_at)}</span>${paid ? raw(h`<span class="tag dark">${once ? '60-DAY PLAN' : 'GROWTH PLAN'}</span>`) : ''}</div>
          <div class="r">${isSample ? '' : raw(h`<button class="btn ghost sm" data-action="email-report">Email me this report</button>`)}<button class="btn dark sm" data-action="share">${isSample ? 'Share this sample' : 'Share my score'}</button></div>
        </div>
        ${paid ? raw(h`<div class="ctxrow">${ctx ? raw(contextChips(ctx) + (ctx.notes ? h`<span class="chip note">“${ctx.notes}”</span>` : '')) : raw(h`<span class="chip empty">Written without your answers</span>`)}${isSample ? '' : once ? '' : raw(h`<a class="edit" href="#/plan-setup?report=${encodeURIComponent(report.report_id)}&path=edit">${ctx ? 'Plans changed? Update' : 'Tell us about your next 90 days'} →</a>`)}</div>`)
        : raw(h`<div class="ctxrow free">${ctx && ctx.horizon ? raw(h`<span class="chip">${ctxLabel('horizon', ctx.horizon)}</span><span class="ex">Your three first moves were written around this. The Growth Plan asks four more — time, goal, how you make content — so every move and calendar slot fits.</span>`) : raw(h`<span class="chip empty">Written as business as usual</span><span class="ex">The Growth Plan asks four short questions — your next 90 days, time, goal, how you make content — so every move and calendar slot fits your life.</span>`)}</div>`)}
        ${duePhase ? raw(h`<div class="checkin"><div class="t"><div class="eb">DAY ${Math.round(ageDays)} · CHECK-IN</div><h3>Phase ${duePhase} starts. Anything change?</h3><p>The next 30 days were written when you started. If your time, goal or next few weeks changed, the plan is rewritten tonight.</p></div><div class="acts"><button class="btn green" data-checkin="${duePhase}" data-changed="0">Nothing changed</button><a class="btn ghost" href="#/plan-setup?report=${encodeURIComponent(report.report_id)}&path=checkin&phase=${duePhase}">Something changed</a></div></div>`) : ''}
        ${nudge ? raw(h`<div class="checkin nudge" id="nudge"><div class="t"><div class="eb">FROM THIS WEEK'S RE-SCORE</div><h3>${nudge.title}</h3><p>${nudge.text}</p></div><div class="acts"><button class="btn" data-nudge="${nudge.key}" data-changed="1">${nudge.cta}</button><button class="btn ghost" data-nudge="${nudge.key}" data-changed="0">Keep the plan as is</button></div></div>`) : ''}
        <div class="report">
          <div class="toprow">
            <div class="card scorebox">
              <div class="bigrow"><span class="bignum">${overall}</span>
                <div class="meta"><span class="tag ${gc}">${gl.toUpperCase()}</span>
                  ${followers ? raw(h`<span class="f">${fmtN(followers)} followers</span>`) : ''}
                  ${hist && hist.delta_overall != null ? raw(h`<span class="delta ${hist.delta_overall > 0 ? 'up' : hist.delta_overall < 0 ? 'down' : 'flat'}">${hist.delta_overall === 0 ? `${overall} → ${overall} · unchanged since ${fmtShort(hist.previous.generated_at)}` : `${hist.delta_overall > 0 ? '+' : ''}${hist.delta_overall} since ${fmtShort(hist.previous.generated_at)}`}</span>`) : ''}
                </div></div>
              <p class="why">${s.summary || ''}</p>
            </div>
            ${thisWeek ? raw(h`<div class="weekcard">
              <div class="eb"><span>This week</span><span>${thisWeek.days} · ${thisWeek.label}</span></div>
              <div class="mv">MOVE 01</div>
              <p class="a">${thisWeek.action}</p>
              ${thisWeek.detail ? raw(h`<p class="w">${thisWeek.detail}</p>`) : ''}
              ${paid && thisWeek.opener ? raw(moveDetailHTML(thisWeek.opener, true)) : ''}
              <button class="done ${isDone('p1m1') ? 'on' : ''}" data-move="p1m1"><span class="box">${isDone('p1m1') ? '✓' : ''}</span>Mark this move done</button>
              ${nextPhase ? raw(h`<div class="next">Next: Day 31 — ${nextPhase.label}</div>`) : ''}
            </div>`) : ''}
          </div>

          <details class="card acc" open>
            <summary>The four dimensions</summary>
            <div class="body">
              ${raw((s.dimensions || []).map(d => { const sc = clamp(d.score, 0, 100); const [g, gcc] = grade(sc); const hue = hueOf(d.label); const dd = hist?.delta_dimensions?.find(x => x.label === d.label);
                return h`<div class="dimcard bd${hue}"><div class="top"><span class="n">${d.label}</span><span class="s hue${hue}">${sc} · ${g}${dd && dd.delta ? raw(h`<span class="dd g-${dd.delta > 0 ? 'strong' : 'weak'}">${dd.delta > 0 ? '+' : ''}${dd.delta}</span>`) : ''}</span></div>
                  <div class="bar in"><div class="fill bg${hue}" style="width:${sc}%"></div>${d.category_avg != null ? raw(h`<div class="mark" style="left:${clamp(d.category_avg, 0, 100)}%"></div>`) : ''}</div>
                  <p>${d.explanation || ''}</p></div>`; }).join(''))}
              <div class="fine">${s.category_avg != null ? `The marker is your ${niche} average (${fmtN(s.category_sample_size)} accounts).` : pending ? `The marker is your niche average. Your ${niche} average appears once ${pending.min_n} accounts are scored — ${pending.n} so far.` : nicheKnown ? 'The marker is your niche average.' : `Scored against all creators — we don't have enough ${niche} accounts yet.`}</div>
            </div>
          </details>

          ${pi && pi.top && pi.top.length ? raw(h`<details class="card acc">
            <summary>Your best and worst posts</summary>
            <div class="body">
              <div class="postmeta"><span class="pill tone">AVG ${fmtN(pi.avg_engagement)} per post</span>${pi.patterns?.best_format ? raw(h`<span class="pill tone">${String(pi.patterns.best_format.format).toUpperCase()}S ${pi.patterns.best_format.vs_avg}×</span>`) : ''}${pi.patterns?.best_day ? raw(h`<span class="pill green">${String(pi.patterns.best_day.day).toUpperCase()} IS YOUR STRONGEST DAY</span>`) : ''}</div>
              <div class="posts">${raw([...pi.top.map(p => [p, 'top']), ...pi.bottom.map(p => [p, 'low'])].map(([p, k]) => h`<div class="post ${k}">
                <div class="k"><div class="x ${k === 'top' ? 'g-strong' : 'g-weak'}">${p.vs_avg}×</div><div class="t">${k === 'top' ? 'TOP' : 'LOW'} · ${String(p.format).toUpperCase()}</div><div class="d">${p.weekday ? p.weekday + ' ' : ''}${p.date ? fmtShort(p.date) : ''}</div></div>
                <div class="c"><p>“${p.caption || 'no caption'}”</p><div class="n">${fmtN(p.likes)} likes · ${fmtN(p.comments)} comments${p.views ? ` · ${fmtN(p.views)} views` : ''}${p.url ? raw(h` · <a href="${p.url}" target="_blank" rel="noopener">open</a>`) : ''}</div></div></div>`).join(''))}</div>
              ${pi.note ? raw(h`<p class="postnote">${pi.note}</p>`) : ''}
            </div>
          </details>`) : ''}

          ${report.best_times ? raw(h`<details class="card acc" open>
            <summary>Best times to post${report.best_times.confident ? '' : raw(h`<span class="tag fair" style="margin-left:10px">STARTING POINT</span>`)}</summary>
            <div class="body">
              <div class="windows">${raw((report.best_times.windows || []).map((w, i) => h`<div class="window bd${(i % 4) + 1}"><div class="d">${w.label}</div>${w.vs_avg ? raw(h`<div class="x">${w.vs_avg}× your usual</div>`) : raw('<div class="x muted">common window</div>')}<p>${w.explanation}</p></div>`).join(''))}</div>
              ${(report.best_times.best_days || []).length ? raw(h`<div class="fine">Strongest days overall: ${report.best_times.best_days.map(d => `${d.day} (${d.vs_avg}× over ${d.n} posts)`).join(' · ')}.</div>`) : ''}
              <div class="fine">${report.best_times.note}</div>
            </div>
          </details>`) : ''}

          ${phases.length ? raw(h`<details class="card acc" ${paid ? 'open' : ''}>
            <summary>Your 30-60-90 path</summary>
            <div class="body">${raw(phases.map((p, i) => {
              const tone = ['var(--gold)', 'var(--green)', 'var(--purple)'][i % 3]; const toneT = ['var(--gold-t)', 'var(--green-t)', 'var(--c4t)'][i % 3];
              const total = 1 + p.moves.length; const doneN = (isDone(p.key + 'm1') ? 1 : 0) + p.moves.filter(m => isDone(p.key + 'm' + m.n)).length;
              return h`<div class="phase">
                <div class="ph" style="background:${raw(tone)}"><span>${p.days} · ${p.label}</span>${paid && p.not_included ? raw(h`<span class="prog" style="color:${raw(toneT)}">Growth Plan only</span>`) : paid && p.moves.length ? raw(h`<span class="prog" style="color:${raw(toneT)}">${doneN} of ${total} done</span>`) : ''}</div>
                <div class="pb">
                  ${paid && p.opener ? raw(h`<div class="mvrow opener ${isSample || i === 0 ? 'open' : ''} ${isDone(p.key + 'm1') ? 'on' : ''}" data-row="${p.key}m1"><button class="box" data-move="${p.key}m1" aria-label="Mark move 01 done">${isDone(p.key + 'm1') ? '✓' : ''}</button><div class="b"><div class="t">01 · ${p.label}</div><p>${p.action}</p>${p.detail ? raw(h`<p class="w">${p.detail}</p>`) : ''}${raw(moveDetailHTML(p.opener))}<span class="more" aria-hidden="true"></span></div></div>`)
                  : raw(h`<div class="move"><span class="n">01</span><p>${p.action}</p></div>`)}
                  ${paid && !p.not_included ? raw(p.moves.map(m => h`<div class="mvrow ${isSample || i === 0 ? 'open' : ''} ${isDone(p.key + 'm' + m.n) ? 'on' : ''}" data-row="${p.key}m${m.n}"><button class="box" data-move="${p.key}m${m.n}" aria-label="Mark move ${m.n} done">${isDone(p.key + 'm' + m.n) ? '✓' : ''}</button><div class="b"><div class="t">${String(m.n).padStart(2, '0')} · ${m.title || ''}</div><p>${m.action}</p>${m.why ? raw(h`<p class="w">Why: ${m.why}</p>`) : ''}${raw(moveDetailHTML(m))}<span class="more" aria-hidden="true"></span></div></div>`).join(''))
                  : raw(h`<div class="locked"><div class="rows">${raw((p.teasers.length ? p.teasers : Array.from({ length: p.count }, () => 'Written from your posts when you unlock')).slice(0, 4).map((t, k) => h`<div>${String(p.firstLocked + k).padStart(2, '0')} · ${t.replace(/^MOVE \d+\s*·?\s*/i, '')}${/…$/.test(t) ? '' : '…'}</div>`).join(''))}
                      <div class="grid">${raw(Array.from({ length: 28 }, (_, k) => `<span style="${[0, 2, 4, 6].includes(k % 7) ? `background:var(--c${(Math.floor(k / 7) % 4) + 1})` : ''}"></span>`).join(''))}</div></div>
                    <div class="lk"><i>🔒</i>${p.lockedHeader}</div></div>`)}
                </div></div>`; }).join(''))}</div>
          </details>`) : ''}

          ${paid && calWeeks.length ? raw(h`<details class="card acc" open>
            <summary>Your ${calWeeks.length}-week calendar</summary>
            <div class="body" style="gap:8px">${raw(calWeeks.map((w, i) => h`<details class="week" ${i === 0 ? 'open' : ''}>
              <summary><span class="wk">WEEK ${w.week} · DAYS ${(w.week - 1) * 7 + 1}–${w.week * 7}</span><span class="sl">${(w.slots || []).map(sl => `${String(sl.day).slice(0, 3)} ${sl.format}`).join(' · ')}</span></summary>
              <div class="slots">${raw((w.slots || []).map((sl, k) => h`<div class="slot bd${(k % 4) + 1}"><div class="d">${String(sl.day).slice(0, 3).toUpperCase()} · ${String(sl.format).toUpperCase()}${sl.source ? raw(h`<span class="src ${sl.source}">${sl.source === 'new' ? 'NEW SHOOT' : sl.source === 'archive' ? 'FROM ARCHIVE' : 'NO CAMERA'}</span>`) : ''}</div><div class="a">${sl.angle}</div>${sl.prompt ? raw(h`<div class="p">${sl.prompt}</div>`) : ''}</div>`).join(''))}</div>
            </details>`).join(''))}</div>
          </details>`) : ''}

          <details class="card acc" ${paid && comp ? 'open' : ''}>
            <summary>Against your competitors</summary>
            <div class="body">
              ${isSample ? raw(comp ? competitorRows(comp) : h`<p class="fine">Growth Plan reports compare you to up to five accounts you pick.</p>`) : paid ? raw(h`<form class="compform" id="compForm"><input type="text" name="handles" placeholder="@handle — add up to 5" value="${comp ? comp.competitors.map(c => c.handle).join(', ') : (report.competitor_handles || []).join(', ')}" aria-label="Competitor handles"><button class="btn dark" type="submit">${comp ? 'Re-run' : 'Compare'}</button></form><div id="compResult">${comp ? raw(competitorRows(comp)) : ''}</div>`)
              : raw(h`<div class="comprows"><div class="crow you"><span>@${biz.handle} (you)</span><span>${overall}</span></div>
                  ${raw(((report.competitor_handles && report.competitor_handles.length) ? report.competitor_handles : ['', '', '']).slice(0, 3).map((hn, i) => h`<div class="crow"><span>${hn ? '@' + hn : raw(`<span style="display:inline-block;width:${[120, 96, 140][i]}px;height:12px;border-radius:6px;background:var(--track2)"></span>`)}</span><span class="ghost">${[63, 48, 57][i]}</span></div>`).join(''))}
                  <p class="fine" style="margin-top:6px">Their scores and what they do differently unlock with the plan.</p></div>`)}
            </div>
          </details>

          <div class="datawindow">${report.data_window || `Based on your last ${pi?.sample || 12} posts. We can't see saves, reach or story views.`}</div>

          ${!paid && sget('sc_limit_msg', null) ? raw(h`<div class="notice">${sget('sc_limit_msg', '')} <a href="#/pricing">See the plan →</a></div>`) : ''}
          ${isSample ? raw(h`<div class="refresh"><div class="t"><h3>This is what $${price} a month gets you</h3><p>Every move with the reason behind it, a 12-week calendar written from the account's own posts, competitors scored the same way, and a fresh score every week. Yours starts with a free Snapshot.</p></div><a class="btn green" href="#/" data-scroll="evalForm">Score my account free</a></div>`)
          : paid && once ? raw(h`<div class="notin"><div class="hd"><h3>Not in your 60-day plan</h3><p>Yours to keep, as bought. This is what the Growth Plan adds, for $${price} a month — less than the $${oneTime} you paid once.</p></div>
              <div class="rows">${raw(['Days 61–90 — phase 3, moves 10 through 13', 'Re-scored every week, with what each move changed', 'Day-30 and day-60 check-ins that reshape the plan', 'Up to 5 competitors, scored the same way', 'Score and follower history', 'A fresh plan every 90 days'].map(t => h`<div><i>🔒</i>${t}</div>`).join(''))}</div>
              <button class="btn green" data-action="unlock">Start the plan · $${price}/mo</button></div>`)
          : paid ? raw(h`<div class="refresh"><div class="t"><h3>This plan refreshes weekly</h3><p>${Object.keys(done).length ? `You did ${Object.keys(done).length} move${Object.keys(done).length === 1 ? '' : 's'} — we'll re-score you and tell you what changed.` : 'Run it again any time — the moves and calendar are rewritten against your latest posts.'}</p></div><a class="btn green" href="#/" data-scroll="evalForm">Run a fresh evaluation</a></div>`)
          : raw(h`<div class="upsell"><h3>Unlock your full Growth Plan</h3><p>${report.upsell?.unlock_count || 12} locked items: the remaining moves and your week-by-week calendar, written from your own posts — and around four quick answers about your next 90 days, so it's a plan you can actually do.</p>
              <div class="paths">
                <div class="path main"><div class="pn">Growth Plan · <b>$${price}/mo</b></div><div class="pd">All 90 days, written around your life. Re-scored every week with check-ins at day 30 and 60.</div><button class="btn" data-action="unlock">Start the plan →</button></div>
                <div class="path"><div class="pn">60-day plan · <b>$${oneTime} once</b></div><div class="pd">Phases 1 and 2 — moves 01–09 and 8 weeks of calendar, written once. No subscription.</div><button class="btn light" data-action="unlock-once">Get the 60-day plan</button></div>
              </div>
              <div class="fine">Cancel anytime. Keep the report either way.</div></div>`)}

          <div class="bridge">Run a business too? The same engine scores a business account against its category and writes the plan for bookings, not just followers. <a href="#/business">For businesses →</a></div>
        </div>
      </div>${raw(footer())}`;

    // move done toggles
    $view.querySelectorAll('.mvrow .b').forEach(b => b.addEventListener('click', e => { if (e.target.closest('a')) return; b.closest('.mvrow').classList.toggle('open'); }));
    $view.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const k = b.dataset.move; const now = !isDone(k);
      if (now) done[k] = Date.now(); else delete done[k];
      if (!isSample) lset(doneKey, done);
      const row = b.closest('.mvrow, .done') || b; row.classList.toggle('on', now); (b.classList.contains('box') ? b : b.querySelector('.box')).textContent = now ? '✓' : '';
      $view.querySelectorAll(`[data-move="${k}"]`).forEach(o => { if (o === b) return; const r = o.closest('.mvrow, .done') || o; r.classList.toggle('on', now); (o.classList.contains('box') ? o : o.querySelector('.box')).textContent = now ? '✓' : ''; });
      if (token() && paid && !isSample) { try { await api('/reports/' + encodeURIComponent(report.report_id) + '/moves', { method: 'POST', body: JSON.stringify({ key: k, done: now }) }); } catch { } }
      if (!isSample) { report.moves_done = done; sset('sc_report_' + report.report_id, report); }
      $view.querySelectorAll('.phase').forEach((ph, i) => { const p = phases[i]; if (!p || !paid) return; const total = 1 + p.moves.length; const dn = (isDone(p.key + 'm1') ? 1 : 0) + p.moves.filter(m => isDone(p.key + 'm' + m.n)).length; const el = ph.querySelector('.prog'); if (el) el.textContent = `${dn} of ${total} done`; });
    }));
    $view.querySelector('[data-action=share]').addEventListener('click', () => { if (!isSample) track('share_clicked', { overall }, report.report_id); openShareSheet(report); });
    // Both paid paths go through the 60-second intake first.
    $view.querySelector('[data-action=unlock]')?.addEventListener('click', () => { sset('sc_intent_tier', 'growth_plan'); sset('sc_form', { handle: biz.handle, platform: biz.platform, category: biz.category, email: sget('sc_form', {}).email || report.email || '' }); go(`#/plan-setup?report=${encodeURIComponent(report.report_id)}&path=subscribe`); });
    $view.querySelector('[data-action=unlock-once]')?.addEventListener('click', () => { sset('sc_once_price', oneTime); go(`#/plan-setup?report=${encodeURIComponent(report.report_id)}&path=once`); });
    // Check-in "nothing changed" and nudge answers
    const answer = async (b, body, doneMsg) => {
      b.disabled = true;
      try {
        const res = await api('/reports/' + encodeURIComponent(report.report_id) + '/checkin', { method: 'POST', body: JSON.stringify(body) });
        if (res.job_id) { sset('sc_job_' + res.job_id, { handle: biz.handle, platform: biz.platform, category: biz.category, submitted_at: Date.now(), rerun: true }); sessionStorage.removeItem('sc_report_' + report.report_id); toast('Rewriting your plan…'); go('#/evaluating/' + encodeURIComponent(res.job_id)); return; }
        report.checkins = res.checkins || report.checkins; if (body.nudge) report.nudge = null; sset('sc_report_' + report.report_id, report); toast(doneMsg); route();
      } catch (e2) { if (e2.status === 401) return; toast(e2.message || 'Could not save.'); b.disabled = false; }
    };
    $view.querySelectorAll('[data-checkin]').forEach(b => b.addEventListener('click', () => answer(b, { phase: Number(b.dataset.checkin), changed: false }, 'Carrying on. We\'ll check in again next phase.')));
    $view.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => answer(b, { nudge: b.dataset.nudge, changed: b.dataset.changed === '1' }, 'Kept as is.')));
    if (subscriber && qs.get('checkin') && qs.get('changed') === '0' && !checkins['p' + qs.get('checkin')]) { const b = $view.querySelector('[data-checkin]'); if (b) b.click(); else answer({ disabled: false }, { phase: Number(qs.get('checkin')), changed: false }, 'Carrying on.'); }
    if (qs.get('nudge')) document.getElementById('nudge')?.scrollIntoView({ behavior: 'smooth' });
    $view.querySelector('#compForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const f = e.currentTarget; const btn = f.querySelector('button'); const out = $view.querySelector('#compResult');
      const handles = f.handles.value.split(/[,\s]+/).map(x => x.replace(/^@/, '').trim()).filter(Boolean).slice(0, 5);
      if (!handles.length) { toast('Add at least one handle.'); return; }
      btn.disabled = true; btn.textContent = `Scoring ${handles.length}…`; out.innerHTML = '<div class="fine">Reading each account — about ten seconds per handle.</div>';
      try { const res = await api('/reports/' + encodeURIComponent(report.report_id) + '/competitors', { method: 'POST', body: JSON.stringify({ handles }) }); report.competitors = res; sset('sc_report_' + report.report_id, report); out.innerHTML = competitorRows(res); }
      catch (e2) { if (e2.status === 401) return; if (e2.status === 402) { sset('sc_intent_tier', 'growth_plan'); go('#/pricing'); return; } out.innerHTML = h`<div class="form-error">${e2.message}</div>`; }
      btn.disabled = false; btn.textContent = 'Re-run';
    });
    if (!paid) api('/billing/pricing', {}, { allow401: true }).then(p => { if (p.support_email) sset('sc_support', p.support_email); rememberPricing(p); const t = (p.tiers || []).find(x => x.tier === 'growth_plan'); if (t && t.monthlyPrice != null) { const el = $view.querySelector('.upsell p'); if (el) el.textContent = el.textContent.replace(/\$\d+\/mo or \$\d+\/yr/, `$${t.monthlyPrice}/mo or $${t.annualPrice ?? Math.round(t.monthlyPrice * 9)}/yr`); } }).catch(() => { });
  }
  // The "how" under a move: numbered steps, paste-ready example, done-when, time.
  function moveDetailHTML(d, dark) {
    if (!d || (!(d.how || []).length && !d.example && !d.done_when)) return '';
    return h`<div class="mvdetail ${dark ? 'dark' : ''}">
      ${(d.how || []).length ? raw(h`<ol class="how">${raw(d.how.map(x => h`<li>${x}</li>`).join(''))}</ol>`) : ''}
      ${d.example ? raw(h`<div class="ex"><div class="exl">Starting point — make it yours</div><div class="ext">${d.example}</div></div>`) : ''}
      <div class="dw">${d.done_when ? raw(h`<span><b>Done when:</b> ${d.done_when}</span>`) : ''}${d.time ? raw(h`<span class="tm">${d.time}</span>`) : ''}</div>
    </div>`;
  }
  function competitorRows(c) {
    const rows = [...c.competitors.filter(x => x.ok !== false).map(x => ({ ...x, you: false })), { handle: c.you.handle, overall: c.you.overall, you: true }].sort((a, b) => b.overall - a.overall);
    return h`<div class="fine" style="margin-bottom:10px">You rank #${c.rank.position} of ${c.rank.of}</div><div class="comprows">${raw(rows.map((r, i) => h`<div class="crow ${r.you ? 'you' : ''}"><div class="h"><span>${i + 1} · @${r.handle}${r.you ? ' (you)' : ''}</span><span>${r.overall}</span></div>${!r.you ? raw(h`<ul>${raw((r.does_differently && r.does_differently.length ? r.does_differently : ['Nothing they do better on these measures.']).map(t => h`<li>${t}</li>`).join(''))}</ul>`) : ''}</div>`).join(''))}${raw(c.competitors.filter(x => x.ok === false).map(x => h`<div class="crow"><span>@${x.handle}</span><span class="fine">${x.error}</span></div>`).join(''))}</div>`;
  }

  // ------------------------------------------------------------ pricing (batch 2)
  async function viewPricing() {
    renderHeader('pricing');
    $view.innerHTML = h`<div class="center-msg">Loading pricing…</div>`;
    let pricing, ent = null;
    try { pricing = await api('/billing/pricing', {}, { allow401: true }); if (pricing.support_email) sset('sc_support', pricing.support_email); rememberPricing(pricing); }
    catch (e) { $view.innerHTML = h`<div class="center-msg"><h2>Pricing is unavailable right now.</h2>${e.message}</div>`; return; }
    if (token()) { try { ent = await api('/account/subscription-status', {}, { allow401: true }); } catch { } }
    const discM = /(\d+)\s*%/.exec(pricing.discount?.annual || ''); const disc = discM ? Number(discM[1]) / 100 : 0.25;
    let billing = sget('sc_billing', 'monthly');
    const intent = sget('sc_intent_tier', null);
    const limitMsg = sget('sc_limit_msg', null);
    const tiers = pricing.tiers || [];
    const free = tiers.find(t => !t.monthlyPrice) || {};
    const growth = tiers.find(t => t.tier === 'growth_plan') || {};
    const pro = tiers.find(t => t.tier === 'growth_plan_pro');
    const yr = t => t.annualPrice ?? Math.round((t.monthlyPrice || 0) * 12 * (1 - disc));
    const cur = t => ent && ent.current_tier === t;
    let promoState = promo();
    track('pricing_viewed', { intent: intent || null, billing, variant: pricing.variant || 'control' });
    const render = () => {
      const annual = billing === 'annual';
      const pcode = promoState && promoState.code;
      const pOk = promoState && !promoState.pending && promoState.checked_for === 'growth_plan:' + billing;
      const growthLine = pOk && promoState.product === 'growth_plan' ? (promoState.free_months ? `$0 for your first ${promoState.free_months === 1 ? 'month' : promoState.free_months + ' months'}, then $${annual ? yr(growth) : growth.monthlyPrice}${annual ? '/yr' : '/mo'}` : `$${(promoState.amount_cents / 100).toFixed(promoState.amount_cents % 100 ? 2 : 0)} ${annual ? 'your first year' : 'your first month'}, then $${annual ? yr(growth) : growth.monthlyPrice}`) : null;
      const proOpen = sget('sc_pro_open', false);
      $view.innerHTML = h`<div class="wrap"><div class="pricing">
        ${limitMsg ? raw(h`<div class="notice" style="margin-bottom:18px">${limitMsg}</div>`) : ''}
        <h1>Pay when the plan is worth doing.</h1>
        <p class="lede">Score first, free. Unlock the rest when you've read it and decided it's right.</p>
        <div class="toggle" role="tablist"><button type="button" class="${annual ? '' : 'on'}" data-billing="monthly">Monthly</button><button type="button" class="${annual ? 'on' : ''}" data-billing="annual">Annual · ${Math.round(disc * 100)}% off</button></div>
        <div class="tiers">
          <div class="card tier">
            <div class="n">Free Snapshot</div>
            <div class="p">$0</div>
            <div class="note">${free.note || 'One report per email'}</div>
            <div class="feats">${raw((free.features || []).map(f => h`<div>${f}</div>`).join(''))}</div>
            <a class="btn ghost" href="#/" data-scroll="evalForm">Score my account</a>
          </div>
          <div class="tier dark ${cur('growth_plan') ? 'cur' : ''}">
            <div class="th"><span class="n">${growth.name || 'Growth Plan'}</span><span class="tag act">${cur('growth_plan') ? 'YOUR PLAN' : 'MOST POPULAR'}</span></div>
            <div class="price"><span class="p">$${annual ? yr(growth) : growth.monthlyPrice}</span><span class="per">${annual ? '/ year' : '/ month'}</span></div>
            <div class="note">${growthLine ? raw(h`<span class="promoline">${promoState.code}: ${growthLine}</span>`) : annual ? 'Two and a bit months free' : `Or $${yr(growth)} a year — ${Math.round(disc * 100)}% off`}</div>
            <div class="feats">${raw((growth.features || []).map(f => h`<div>${f}</div>`).join(''))}</div>
            <button type="button" class="btn" data-subscribe="growth_plan" ${cur('growth_plan') ? 'disabled' : ''}>${cur('growth_plan') ? 'Current plan' : 'Unlock the plan'}</button>
            <div class="fine center">Cancel anytime. Keep the report either way.${SHIPPED ? raw(' · <a href="#/report/sample">See a full report</a>') : ''}</div>
          </div>
          <div class="side">
            ${pro ? raw(h`<div class="card procard ${proOpen ? 'open' : ''}">
              <button type="button" class="prohead" data-expand><div><div class="n">${pro.name}</div><div class="note">$${annual ? yr(pro) + '/yr' : pro.monthlyPrice + '/mo'} · all platforms together</div></div><span class="caret">${proOpen ? '–' : '+'}</span></button>
              ${proOpen ? raw(h`<div class="probody"><div class="feats">${raw((pro.features || []).map(f => h`<div>${f}</div>`).join(''))}</div><button type="button" class="btn ghost block" data-subscribe="growth_plan_pro" ${cur('growth_plan_pro') ? 'disabled' : ''}>${cur('growth_plan_pro') ? 'Current plan' : 'Choose Pro'}</button></div>`) : ''}
            </div>`) : ''}
            ${raw((pricing.one_time || []).map(o => h`<div class="card tier once"><div class="th"><span class="n">${o.name}</span><span class="tag fair">ONE-TIME</span></div><div class="price"><span class="p">$${o.price}</span><span class="per">once</span></div><div class="note">${o.description}</div><div class="feats">${raw((o.features || []).map(f => h`<div>${f}</div>`).join(''))}</div>${(o.not_included || []).length ? raw(h`<div class="notfeats"><div class="l">Not included</div>${raw(o.not_included.map(f => h`<div>${f}</div>`).join(''))}</div>`) : ''}<a class="btn ghost" href="${token() ? '#/reports' : '#/'}" ${token() ? '' : raw('data-scroll="evalForm"')}>${token() ? 'Pick a report to unlock' : 'Score first, then unlock'}</a></div>`).join(''))}
            ${(CFG.testimonials || []).length ? raw((CFG.testimonials || []).slice(0, 1).map(t => h`<div class="quote">
              <p class="q">“${t.quote}”</p>
              <div class="who"><span class="av"></span><div><div class="nm">${t.name}</div><div class="hd">${t.meta || ''}</div></div></div>
            </div>`).join('')) : ''}
          </div>
        </div>
        <div class="promobox" id="promoBox">${pcode && !promoState.pending && promoState.checked_for === 'growth_plan:' + billing
          ? raw(h`<span>Code <b>${pcode}</b> applied — ${promoState.description}.</span> <a href="#" data-promo="clear">Remove</a>`)
          : raw(h`<a href="#" data-promo="open">${pcode ? `Apply code ${pcode}` : 'Have a code?'}</a><form id="promoForm" ${pcode ? '' : 'hidden'}><input type="text" name="code" placeholder="CODE" autocomplete="off" autocapitalize="characters" value="${pcode || ''}"><button class="btn dark sm" type="submit">Apply</button><span class="fine" id="promoMsg"></span></form>`)}</div>
        <div class="pfoot"><div>All tiers keep your report history. Cancel in two clicks.</div><div>${pricing.refund || 'Not useful in the first 7 days? Reply to any email and we refund it.'}${supportEmail() ? raw(h` Or write to <a href="mailto:${supportEmail()}">${supportEmail()}</a>.`) : ''}</div><div class="fine">Business accounts are priced separately — $39 and $99. <a href="#/business">For businesses →</a></div></div>
      </div></div>${raw(footer())}`;
      $view.querySelectorAll('[data-billing]').forEach(b => b.addEventListener('click', () => { billing = b.dataset.billing; sset('sc_billing', billing); render(); }));
      $view.querySelector('[data-expand]')?.addEventListener('click', () => { sset('sc_pro_open', !proOpen); render(); });
      $view.querySelectorAll('[data-subscribe]').forEach(b => b.addEventListener('click', async () => {
        if (!token()) { sset('sc_next', location.hash); sset('sc_intent_tier', b.dataset.subscribe); go('#/signup'); return; }
        b.disabled = true; const label = b.textContent; b.textContent = 'Starting…';
        try {
          const body = { tier: b.dataset.subscribe, billingCycle: billing };
          if (b.dataset.subscribe === 'growth_plan' && promoState && promoState.code) body.promo_code = promoState.code;
          const sub = await api('/billing/subscribe', { method: 'POST', body: JSON.stringify(body) });
          sessionStorage.removeItem('sc_intent_tier'); sessionStorage.removeItem('sc_limit_msg'); clearPromo();
          if (sub.promo) toast(`${sub.promo.code} applied — ${sub.promo.description}.`);
          const last = sget('sc_form', {});
          if (last.handle && last.platform && last.category) { toast(`You're on. Writing the full plan for @${last.handle}…`); await submitEvaluation(last, null); return; }
          toast("You're on. Score an account to get the full plan."); go('#/');
        } catch (e) { if (e.status === 401) return; toast(e.message || 'Subscription failed.'); b.disabled = false; b.textContent = label; }
      }));
      // promo box
      $view.querySelector('[data-promo=open]')?.addEventListener('click', e => { e.preventDefault(); const f = $view.querySelector('#promoForm'); f.hidden = false; f.code.focus(); if (f.code.value) f.requestSubmit(); });
      $view.querySelector('[data-promo=clear]')?.addEventListener('click', e => { e.preventDefault(); clearPromo(); promoState = null; render(); });
      $view.querySelector('#promoForm')?.addEventListener('submit', async e => {
        e.preventDefault(); const f = e.currentTarget; const msg = f.querySelector('#promoMsg'); const code = f.code.value.trim().toUpperCase(); if (!code) return;
        msg.textContent = 'Checking…';
        try { const r = await checkPromo(code, 'growth_plan', billing); if (r.valid) { promoState = promo(); render(); } else { msg.textContent = r.reason; if (r.reason && /60-day/.test(r.reason)) { sset('sc_promo', { code, pending: true }); } } }
        catch (e2) { msg.textContent = e2.message; }
      });
      if (promoState && promoState.pending && !$view.querySelector('#promoMsg')?.textContent) { const f = $view.querySelector('#promoForm'); if (f) { f.hidden = false; f.requestSubmit(); } }
      if (intent === 'growth_plan_pro' && !proOpen) { sset('sc_pro_open', true); render(); }
    };
    render();
  }

  // ------------------------------------------------------------ for businesses (batch 3)
  async function viewBusiness() {
    renderHeader('business');
    let biz = [], checkout = false;
    try { const p = await api('/billing/pricing', {}, { allow401: true }); biz = p.business || []; checkout = !!p.business_checkout_enabled; } catch { }
    const b39 = biz.find(t => t.tier === 'business_growth') || { monthlyPrice: 39 }; const b99 = biz.find(t => t.tier === 'business_evaluator') || { monthlyPrice: 99 };
    $view.innerHTML = h`<div class="wrap"><div class="bizpage">
      <div class="eyebrow">For businesses</div>
      <h1>The same engine, scored for bookings.</h1>
      <p class="lede">Your business account gets a score out of 100 against its category — not against creators. The plan is written for the thing you actually need: people walking in, booking, buying.</p>
      <div class="three">
        <div class="it bd4"><b>Profile Clarity counts differently</b><p>Location, price range and a working booking link are scored — not just a tidy bio.</p></div>
        <div class="it bd1"><b>The plan is written for bookings</b><p>Moves aim at enquiries and repeat customers, not follower count.</p></div>
        <div class="it bd2"><b>Margin-aware moves</b><p>The Business Evaluator weighs what a move costs you against what it's likely to return.</p></div>
      </div>
      <div class="tiers">
        <div class="card tier"><div class="n">Business</div><div class="p">$${b39.monthlyPrice}<span class="per"> /mo</span></div><div class="feats">${raw(['One business account, scored against its category', 'The booking-led plan and calendar', 'Weekly refresh'].map(f => h`<div>${f}</div>`).join(''))}</div></div>
        <div class="tier dark"><div class="n">Business Pro</div><div class="p">$${b99.monthlyPrice}<span class="per"> /mo</span></div><div class="feats">${raw(['Up to five locations or accounts', 'Category benchmarks and competitor set', 'Priority refresh'].map(f => h`<div>${f}</div>`).join(''))}</div></div>
        <div class="tier gold">${checkout
          ? raw(h`<a class="btn" href="#/" data-scroll="evalForm">Score a business account</a><div class="fine">Public data only. No login to your account. Cancel in two clicks.</div>`)
          : raw(h`<form id="bizForm" class="bizlead"><div class="n">Business plans open soon</div><input type="email" name="email" placeholder="you@business.com" aria-label="Email"><input type="text" name="handle" placeholder="@yourbusiness" aria-label="Business handle"><button class="btn" type="submit">Put me on the list</button><div class="fine">We'll email you the day business scoring opens. Score your account free in the meantime.</div></form>`)}</div>
      </div>
    </div></div>${raw(footer())}`;
    $view.querySelector('#bizForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const f = e.currentTarget; const email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Add an email first.'); return; }
      try { await api('/waitlist', { method: 'POST', body: JSON.stringify({ email, platform: 'business' }) }); } catch { }
      f.innerHTML = h`<div class="waitdone">You're on the list. We'll email you when business scoring opens.</div>`;
    });
  }

  // ------------------------------------------------------------ auth
  function viewSignin() {
    renderHeader('signin');
    const next = sget('sc_next', '#/');
    $view.innerHTML = h`<div class="wrap"><div class="authwrap"><div class="brandname">Scalecraft</div>
      ${sget('sc_limit_msg', null) ? raw(h`<div class="notice" style="margin-top:16px">${sget('sc_limit_msg', '')}</div>`) : ''}
      <form class="card lightform" id="signinForm" novalidate><h2>Sign in</h2>
        <div class="field"><label for="siEmail">Email</label><input id="siEmail" type="email" name="email" autocomplete="email" placeholder="you@email.com" value="${sget('sc_form', {}).email || ''}"></div>
        <div class="field"><div class="lblrow"><label for="siPass">Password</label><a href="#" data-action="forgot">Forgot?</a></div><input id="siPass" type="password" name="password" autocomplete="current-password" placeholder="••••••••••"></div>
        <div class="form-error" id="signinError" hidden></div>
        <button class="btn" type="submit">Sign in</button>
        <div class="alt">No account yet? <a href="#/signup">Create one</a> · <a href="#/" data-scroll="evalForm">Score an account free</a></div>
      </form></div></div>${raw(footer())}`;
    const form = $view.querySelector('#signinForm');
    form.querySelector('[data-action=forgot]').addEventListener('click', e => { e.preventDefault(); sset('sc_forgot_email', form.querySelector('#siEmail')?.value || ''); go('#/forgot'); });
    form.addEventListener('submit', async e => {
      e.preventDefault(); const err = form.querySelector('#signinError');
      const email = form.email.value.trim(), password = form.password.value;
      if (!email || !password) { err.textContent = 'Email and password, please.'; err.hidden = false; return; }
      err.hidden = true; const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, { allow401: true });
        const t = res.token || res.access_token; if (!t) throw new Error('No token in response');
        setToken(t); sessionStorage.removeItem('sc_next'); go(next && next !== '#/signin' ? next : (sget('sc_limit_msg', null) ? '#/pricing' : '#/'));
      } catch (e2) { err.textContent = e2.status === 401 ? "That email and password don't match." : (e2.message || 'Sign-in failed.'); err.hidden = false; btn.disabled = false; btn.textContent = 'Sign in'; }
    });
  }
  function viewSignup() {
    renderHeader('signup');
    const next = sget('sc_next', '#/');
    $view.innerHTML = h`<div class="wrap"><div class="authwrap"><div class="brandname">Scalecraft</div>
      <form class="card lightform" id="signupForm" novalidate><h2>Create account</h2>
        <div class="field"><label for="suName">Name or handle</label><input id="suName" type="text" name="company_name" placeholder="@yourhandle" autocapitalize="none"></div>
        <div class="field"><label for="suEmail">Email</label><input id="suEmail" type="email" name="email" autocomplete="email" placeholder="you@email.com" value="${sget('sc_form', {}).email || ''}"></div>
        <div class="field"><label for="suPass">Password</label><input id="suPass" type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
        <div class="field"><label for="suPass2">Confirm password</label><input id="suPass2" type="password" name="password_confirm" autocomplete="new-password" placeholder="••••••••••"></div>
        <div class="field"><label for="suNiche">Your niche</label><div class="selwrap"><select id="suNiche" name="niche">${raw(NICHES.map(([k, n]) => h`<option value="${k}" ${k === (sget('sc_form', {}).category || 'fitness_creator') ? 'selected' : ''}>${n}</option>`).join(''))}</select></div></div>
        <label class="check"><input type="checkbox" name="is_business" ${sget('sc_form', {}).is_business ? 'checked' : ''}> This is a business account</label>
        <label class="check"><input type="checkbox" name="consent"> I agree to the <a href="#/legal/terms">Terms</a> and <a href="#/legal/privacy">Privacy Policy</a>.</label>
        <div class="form-error" id="signupError" hidden></div>
        <button class="btn" type="submit">Create account</button>
        <div class="alt">Already signed up? <a href="#/signin">Sign in</a></div>
      </form></div></div>${raw(footer())}`;
    const form = $view.querySelector('#signupForm');
    form.addEventListener('submit', async e => {
      e.preventDefault(); const err = form.querySelector('#signupError');
      const email = form.email.value.trim(), pass = form.password.value, pass2 = form.password_confirm.value, name = form.company_name.value.trim();
      if (!email || !pass) { err.textContent = 'Email and password, please.'; err.hidden = false; return; }
      if (pass.length < 8) { err.textContent = 'Password needs at least 8 characters.'; err.hidden = false; return; }
      if (pass !== pass2) { err.textContent = 'Passwords don’t match.'; err.hidden = false; return; }
      if (!form.consent.checked) { err.textContent = 'Please agree to the Terms and Privacy Policy.'; err.hidden = false; return; }
      err.hidden = true; const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const res = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: pass, company_name: name || null, is_business: !!form.is_business?.checked, niche: form.niche?.value || undefined }) }, { allow401: true });
        const t = res.token || res.access_token; if (!t) throw new Error('No token in response');
        setToken(t); sessionStorage.removeItem('sc_next');
        const pendingUnlock = sget('sc_unlock_once', null);
        if (pendingUnlock) { sessionStorage.removeItem('sc_unlock_once'); go(`#/plan-setup?report=${encodeURIComponent(pendingUnlock)}&path=once`); toast('Signed up — one more step to your 60-day plan.'); return; }
        go(next && !/signin|signup/.test(next) ? next : '#/');
      } catch (e2) { err.textContent = e2.body?.code === 'EMAIL_EXISTS' ? 'That email already has an account — sign in instead.' : (e2.message || 'Sign-up failed.'); err.hidden = false; btn.disabled = false; btn.textContent = 'Create account'; }
    });
  }

  // ------------------------------------------------------------ reports (history)
  function sparkline(vals) {
    const w = 64, hh = 18, n = vals.length; const lo = Math.min(...vals), hi = Math.max(...vals);
    const pts = vals.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${hh - ((v - lo) / Math.max(1, hi - lo)) * (hh - 2) - 1}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
  }
  async function viewReports() {
    renderHeader('reports');
    if (!token()) { sset('sc_next', '#/reports'); go('#/signin'); return; }
    $view.innerHTML = h`<div class="center-msg">Loading your reports…</div>`;
    let list, subn = null;
    try { [list, subn] = await Promise.all([api('/account/reports'), api('/account/subscription-status').catch(() => null)]); } catch (e) { if (e.status === 401) return; $view.innerHTML = h`<div class="center-msg"><h2>Couldn’t load reports.</h2>${e.message}</div>`; return; }
    const planCard = () => {
      if (!subn) return '';
      const free = subn.status === 'free';
      const pending = subn.status === 'cancel_pending';
      return h`<div class="card plancard ${pending ? 'pending' : ''}"><div class="t"><div class="n">Your plan</div><h2>${subn.tier_name || 'Free Snapshot'}${free ? '' : raw(h` <span class="pr">· $${subn.monthly_price}/mo</span>`)}</h2>
        <p>${free ? 'One free score per account. The Growth Plan writes the whole 90 days and re-scores you weekly.' : pending ? `Cancelled. You keep everything until ${fmtDate(subn.cancel_at)}, then the weekly refresh stops. Your reports stay.` : subn.billing_period_end ? `Renews ${fmtDate(subn.billing_period_end)}. Cancel any time — you keep the plan to the end of the period and every report after.` : 'Cancel any time — you keep the plan to the end of the period and every report after.'}</p></div>
        <div class="acts">${free ? raw(h`<a class="btn" href="#/pricing">See the plan</a>`) : pending ? raw(h`<button type="button" class="btn green" data-action="resume-plan">Resume the plan</button>`) : raw(h`<button type="button" class="btn ghost" data-action="cancel-plan">Cancel plan</button>`)}</div>
        ${free ? '' : raw(h`<label class="pausetog"><input type="checkbox" data-action="email-pause" ${subn.email_paused ? 'checked' : ''}> Pause check-in and score emails${subn.email_paused ? ' — paused' : ''}<span class="fine">Report-ready and password emails still send.</span></label>`)}</div>`;
    };
    const reports = (list.reports || []).map(r => ({ id: r.reportId || r.report_id, tier: r.tier, at: r.generatedAt || r.generated_at, handle: r.business?.handle, platform: r.business?.platform, category: r.business?.category, overall: r.reportBody?.scores?.overall ?? null, known: r.reportBody?.scores?.niche_known !== false })).sort((a, b) => b.at - a.at);
    const byHandle = {}; for (const r of reports) (byHandle[`${r.platform}:${r.handle}`] ||= []).push(r);
    const unknownNiches = [...new Set(reports.filter(r => !r.known).map(r => nicheName(r.category)))];
    $view.innerHTML = h`<div class="wrap"><div class="history">
      <div class="ph"><h1>Your reports</h1><a class="btn pillbtn" href="#/" data-scroll="evalForm">Run a new evaluation</a></div>
      ${raw(planCard())}
      ${reports.length ? raw(Object.values(byHandle).map((rs, gi) => { const asc = [...rs].reverse(); const series = asc.map(r => r.overall).filter(v => v != null); const latest = rs[0], first = asc[0]; const delta = series.length > 1 ? latest.overall - first.overall : null;
        return h`<details class="card hgroup" ${gi === 0 ? 'open' : ''}><summary>
            <div class="who"><div class="handle">@${latest.handle}</div><div class="ctx">${platName(latest.platform)} · ${nicheName(latest.category)} · ${rs.length} run${rs.length === 1 ? '' : 's'}</div></div>
            <div class="sc"><span class="big">${latest.overall ?? '—'}</span>${delta != null ? raw(h`<span class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}">${delta === 0 ? 'unchanged since first run' : (delta > 0 ? '+' : '') + delta + ' since first run'}</span>`) : raw('<span class="delta none">No history yet</span>')}</div>
            ${series.length > 1 ? raw(`<div class="bars">${series.map((v, i) => `<span style="height:${Math.max(8, v)}%;${i >= series.length - 2 ? 'background:var(--act)' : ''}"></span>`).join('')}</div>`) : ''}
            <span class="caret"></span></summary>
          <div class="runs">${raw(rs.map((r, i) => { const prev = rs[i + 1]; const d = prev && r.overall != null && prev.overall != null ? r.overall - prev.overall : null;
            return h`<a class="run" href="#/report/${r.id}"><span>${fmtDate(r.at)}</span><span class="t">${r.tier === 'social_snapshot' ? 'Free Snapshot' : 'Growth Plan'}</span><span class="n">${r.overall ?? '—'} · ${!prev ? 'first run' : d === 0 ? 'unchanged' : (d > 0 ? '+' : '') + d}</span><span class="o">Open</span></a>`; }).join(''))}</div>
        </details>`; }).join(''))
      : raw('<div class="center-msg"><h2>No reports yet.</h2>Run an evaluation while signed in and it will show up here.</div>')}
      ${unknownNiches.length ? raw(h`<div class="fine">Scored against all creators — we don't have enough ${unknownNiches.join(' / ')} accounts yet.</div>`) : ''}
      <div class="card settings"><div class="n">Settings · your data</div><p>Delete my account and reports — removes your account, every report we've written for you and your score history. Payment records we're required to keep are retained by Stripe.</p><button type="button" class="btn danger" data-action="delete-account">Delete my account</button></div>
    </div></div>${raw(footer())}`;
    $view.querySelector('[data-action=delete-account]').addEventListener('click', () => openDeleteDialog(reports.length));
    $view.querySelector('[data-action=cancel-plan]')?.addEventListener('click', () => openCancelDialog(subn));
    $view.querySelector('[data-action=email-pause]')?.addEventListener('change', async e => {
      const on = e.currentTarget.checked;
      try { await api('/account/email/pause', { method: 'POST', body: JSON.stringify({ paused: on }) }); toast(on ? 'Paused. Your plan keeps running.' : 'Emails back on.'); }
      catch (e2) { if (e2.status === 401) return; toast(e2.message); e.currentTarget.checked = !on; }
    });
    $view.querySelector('[data-action=resume-plan]')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      try { await api('/billing/resume', { method: 'POST', body: '{}' }); toast('Welcome back. The plan carries on.'); viewReports(); }
      catch (e2) { if (e2.status === 401) return; toast(e2.message); e.currentTarget.disabled = false; }
    });
  }
  // Cancel is one confirm, no retention screens. Reason is optional and only logged.
  function openCancelDialog(subn) {
    const el = document.createElement('div'); el.className = 'sheet center';
    const until = subn?.billing_period_end ? fmtDate(subn.billing_period_end) : 'the end of this billing period';
    el.innerHTML = h`<div class="panel dialog" role="dialog" aria-label="Cancel plan">
      <h3>Cancel the ${subn?.tier_name || 'Growth Plan'}?</h3>
      <p>You keep everything until ${until} — moves, calendar, competitors, the weekly re-score. After that the plan stops refreshing and you're on the free tier. Every report stays yours.</p>
      <input type="text" id="cancelWhy" placeholder="Why? (optional — one line)" autocomplete="off" maxlength="200">
      <div class="row2"><button type="button" class="btn ghost" data-close>Keep my plan</button><button type="button" class="btn danger" data-cancel>Cancel the plan</button></div>
      <div class="fine center">Changed your mind later? You can resume until ${until}.</div></div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('[data-close]').addEventListener('click', close);
    el.querySelector('[data-cancel]').addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      try { const r = await api('/billing/cancel', { method: 'POST', body: JSON.stringify({ reason: el.querySelector('#cancelWhy').value }) }); close(); toast(r.endsAt ? `Cancelled. Yours until ${fmtDate(r.endsAt)}.` : 'Cancelled.'); viewReports(); }
      catch (e2) { if (e2.status === 401) return; toast(e2.message); e.currentTarget.disabled = false; }
    });
  }
  function openDeleteDialog(n) {
    const el = document.createElement('div'); el.className = 'sheet center';
    el.innerHTML = h`<div class="panel dialog" role="dialog" aria-label="Delete account">
      <h3>Delete your account and all ${n} report${n === 1 ? '' : 's'}?</h3>
      <p>This can't be undone. Your scores, plans and calendars go with it. If you only want to stop paying, cancel the plan instead and keep the reports.</p>
      <input type="text" id="delConfirm" placeholder="Type DELETE to confirm" autocomplete="off">
      <div class="row2"><button type="button" class="btn ghost" data-close>Keep my account</button><button type="button" class="btn danger" data-del disabled>Delete everything</button></div>
      <div class="fine center">Or <a href="#/pricing">cancel the plan</a> and keep your reports.</div></div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('[data-close]').addEventListener('click', close);
    el.querySelector('#delConfirm').addEventListener('input', e => { el.querySelector('[data-del]').disabled = e.target.value.trim() !== 'DELETE'; });
    el.querySelector('[data-del]').addEventListener('click', async () => {
      try { await api('/account', { method: 'DELETE' }); setToken(null); close(); toast('Your account and reports are gone.'); go('#/'); }
      catch (e) { if (e.status === 404) toast('Account deletion isn’t wired up on the server yet.'); else toast(e.message); }
    });
  }

  // ------------------------------------------------------------ password reset
  function viewForgot() {
    renderHeader('signin');
    const last = sget('sc_forgot_email', '');
    $view.innerHTML = h`<div class="wrap"><div class="authwrap"><div class="brandname">Scalecraft</div><form class="card lightform" id="forgotForm" novalidate>
        <h2>Reset your password</h2>
        <p class="sub">Type the email you signed up with. If it has an account, we'll send a link that works once, for an hour.</p>
        <div class="field"><label for="fgEmail">Email</label><input id="fgEmail" type="email" name="email" autocomplete="email" value="${last}" placeholder="you@example.com"></div>
        <button class="btn block" type="submit">Send the link</button>
        <div class="fine center"><a href="#/signin">Back to sign in</a></div>
      </form></div></div>${raw(footer())}`;
    const form = $view.querySelector('#forgotForm');
    form.addEventListener('submit', async e => {
      e.preventDefault(); const email = form.email.value.trim(); if (!email) { toast('Type your email first.'); return; }
      const b = form.querySelector('button'); b.disabled = true; b.textContent = 'Sending…';
      try { await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }, { allow401: true }); } catch { }
      form.innerHTML = h`<h2>Check your inbox</h2><p class="sub">If <b>${email}</b> has an account, a reset link is on its way. It works once and expires in an hour. Nothing arrived in a few minutes? Check spam, or <a href="#/forgot">try again</a>.</p><div class="fine center"><a href="#/signin">Back to sign in</a></div>`;
    });
  }
  function viewReset() {
    renderHeader('signin');
    const tokenParam = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
    if (!tokenParam) { $view.innerHTML = h`<div class="center-msg"><h2>This reset link is missing its code.</h2><a href="#/forgot">Request a new one</a></div>`; return; }
    $view.innerHTML = h`<div class="wrap"><div class="authwrap"><div class="brandname">Scalecraft</div><form class="card lightform" id="resetForm" novalidate>
        <h2>Choose a new password</h2>
        <div class="field"><label for="rsPass">New password</label><input id="rsPass" type="password" name="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
        <div class="field"><label for="rsPass2">Again</label><input id="rsPass2" type="password" name="password2" autocomplete="new-password"></div>
        <button class="btn block" type="submit">Save and sign in</button>
        <div class="form-error" id="rsErr" hidden></div>
      </form></div></div>${raw(footer())}`;
    const form = $view.querySelector('#resetForm'); const err = form.querySelector('#rsErr');
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const p1 = form.password.value, p2 = form.password2.value;
      if (p1.length < 6) { err.textContent = 'At least 6 characters.'; err.hidden = false; return; }
      if (p1 !== p2) { err.textContent = "Those don't match."; err.hidden = false; return; }
      const b = form.querySelector('button'); b.disabled = true; b.textContent = 'Saving…';
      try { const r = await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token: tokenParam, password: p1 }) }, { allow401: true }); if (r.token) setToken(r.token); toast('Password saved. You’re signed in.'); go('#/reports'); }
      catch (e2) { err.textContent = e2.message || 'That link has expired.'; err.hidden = false; b.disabled = false; b.textContent = 'Save and sign in'; }
    });
  }

  // ------------------------------------------------------------ admin
  const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
  async function viewAdmin() {
    renderHeader('admin');
    if (!token()) { sset('sc_next', '#/admin'); go('#/signin'); return; }
    $view.innerHTML = h`<div class="center-msg">Loading…</div>`;
    let ov, reports, failed;
    let funnel = null, costs = null;
    try { [ov, reports, failed, funnel, costs] = await Promise.all([api('/admin/overview'), api('/admin/reports?limit=50'), api('/admin/failed-jobs?limit=30'), api('/admin/funnel?days=30').catch(() => null), api('/admin/costs?days=30').catch(() => null)]); }
    catch (e) {
      if (e.status === 401) return;
      if (e.status === 403 || e.status === 404) { lset('sc_admin', false); $view.innerHTML = h`<div class="center-msg"><h2>This account isn't an admin.</h2>Add your email to <code>ADMIN_EMAILS</code> on the server, then sign in again.</div>`; return; }
      $view.innerHTML = h`<div class="center-msg"><h2>Couldn't load admin.</h2>${e.message}</div>`; return;
    }
    lset('sc_admin', true);
    const t = ov.today, p = ov.people, caps = ov.caps;
    const spend = (t.free_scores + t.paid_runs + t.competitor_pulls) * ov.cost.instagram;
    const tierName = k => ({ social_snapshot: 'Free', growth_plan: 'Growth Plan', growth_plan_pro: 'Pro', business_growth: 'Business Growth', business_evaluator: 'Business Evaluator', agency: 'Agency' }[k] || k);
    const stat = (n, l, sub) => h`<div class="stat"><div class="n">${n}</div><div class="l">${l}</div>${sub ? raw(h`<div class="s">${sub}</div>`) : ''}</div>`;
    const bar = (used, cap) => h`<div class="capbar"><div class="fill ${used / cap > 0.8 ? 'hot' : ''}" style="width:${Math.min(100, Math.round(used / cap * 100))}%"></div></div>`;
    const reportRow = r => h`<a class="arow" href="#/report/${r.report_id}"><span>${fmtDate(r.generated_at)}</span><span class="h">@${r.handle || '—'}</span><span class="t">${platName(r.platform)} · ${r.one_time ? '60-day' : tierName(r.tier)}${r.partial ? ' · partial' : ''}</span><span class="e">${r.email || ''}</span><span class="n">${r.overall ?? '—'}</span></a>`;
    $view.innerHTML = h`<div class="wrap"><div class="admin">
      <div class="ph"><h1>Admin</h1><span class="fine">${ov.mail.configured ? 'Email: sending' : 'Email: logging only (no RESEND_API_KEY)'} · queue: ${ov.queue?.processingCount ?? 0} running of ${ov.queue?.numWorkers ?? '?'}</span></div>

      <section class="card"><h2>Today</h2>
        <div class="stats">
          ${raw(stat(t.free_scores, 'free scores', `cap ${caps.free_runs_per_day_global}`))}
          ${raw(stat(t.paid_runs, 'paid runs', `${caps.paid_runs_per_day}/account cap`))}
          ${raw(stat(t.competitor_pulls, 'competitor pulls', `${caps.competitor_pulls_per_day}/account cap`))}
          ${raw(stat(money(spend), 'est. Apify spend', 'at Instagram rates; TikTok is 20×'))}
          ${raw(stat(t.jobs.failed || 0, 'jobs failed', `${(t.jobs.complete || 0)} completed`))}
        </div>
        <div class="fine">Global free cap</div>${raw(bar(t.free_scores, caps.free_runs_per_day_global))}
      </section>

      <section class="card"><h2>People</h2>
        <div class="stats">
          ${raw(stat(p.users, 'accounts', `+${p.signups_7d} this week · +${p.signups_30d} this month`))}
          ${raw(p.tiers.filter(x => x.tier !== 'social_snapshot').map(x => stat(x.n, tierName(x.tier), x.cancel_pending ? `${x.cancel_pending} cancelling` : 'subscribers')).join(''))}
          ${raw(stat(p.one_time_buyers, '60-day plans sold', 'one-time'))}
          ${raw(stat(p.waitlist.reduce((n, w) => n + w.n, 0), 'on waitlists', p.waitlist.map(w => `${w.platform} ${w.n}`).join(' · ') || '—'))}
        </div>
        ${ov.outcomes && ov.outcomes.n ? raw(h`<div class="fine">Evidence: ${ov.outcomes.n} refreshes recorded · creators who did 3+ moves moved ${ov.outcomes.avg_delta_active ?? '—'} points on average.</div>`) : raw('<div class="fine">Evidence: no refresh outcomes yet.</div>')}
        ${ov.baselines ? raw(h`<div class="fine">Baselines: ${ov.baselines.total} accounts across ${Object.keys(ov.baselines.by_category || {}).length} niches.</div>`) : ''}
      </section>

      ${funnel ? raw(h`<section class="card"><h2>Funnel <span class="fine">last ${funnel.days} days · distinct people</span></h2>
        <div class="funnel">${raw(funnel.steps.map(st => h`<div class="fstep"><div class="n">${st.actors}</div><div class="l">${st.name.replace(/_/g, ' ')}</div>${st.from_previous != null ? raw(h`<div class="c">${Math.round(st.from_previous * 100)}% of previous</div>`) : raw('<div class="c">&nbsp;</div>')}</div>`).join(''))}</div>
        <div class="fine">${Object.entries(funnel.other || {}).filter(([, v]) => v.actors).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.actors}`).join(' · ') || 'No other events yet.'}${funnel.retention_month_two?.cohort ? ` · Month-two retention: ${funnel.retention_month_two.retained} of ${funnel.retention_month_two.cohort} still paying (${Math.round(funnel.retention_month_two.rate * 100)}%)` : ' · Month-two retention: no cohort yet (needs subscribers 30+ days old)'}</div>
        ${funnel.testing ? raw(h`<div class="alist" style="margin-top:10px"><div class="arow head"><span></span><span class="h">price variant</span><span class="t">saw pricing · paid</span><span class="e">conversion</span><span class="n">revenue</span></div>${raw((funnel.variants || []).map(v => { const b = (funnel.by_variant || {})[v.name] || { pricing_viewed: 0, subscribe: 0, unlock: 0, revenue_cents: 0 }; const paidN = b.subscribe + b.unlock; return h`<div class="arow"><span></span><span class="h">${v.name} · $${v.growth_plan / 100}/mo · $${v.plan_unlock / 100} once</span><span class="t">${b.pricing_viewed} · ${paidN}</span><span class="e">${b.pricing_viewed ? Math.round(paidN / b.pricing_viewed * 100) + '%' : '—'}</span><span class="n">${money(b.revenue_cents / 100)}</span></div>`; }).join(''))}</div>`) : ''}
        ${Object.keys(funnel.by_ref || {}).length ? raw(h`<div class="alist" style="margin-top:10px">${raw(Object.entries(funnel.by_ref).map(([ref, v]) => h`<div class="arow promo"><span class="h">ref ${ref}</span><span class="t">${v.evaluate_started || 0} scored · ${v.signup || 0} signed up · ${v.subscribe || 0} paid</span><span class="e"></span><span class="n"></span></div>`).join(''))}</div>`) : ''}
      </section>`) : ''}

      ${costs ? raw(h`<section class="card"><h2>Costs <span class="fine">last ${costs.days} days · measured, not estimated</span></h2>
        <div class="stats">
          ${raw(stat(money(costs.total_cents / 100), 'total spend', `${costs.by_kind.map(k => `${k.key} ${money(k.cents / 100)}`).join(' · ') || '—'}`))}
          ${raw(stat(money(costs.avg_cents_per_report / 100), 'avg per report', 'scrape + every LLM call'))}
          ${raw(costs.by_feature.slice(0, 4).map(f => stat(money(f.cents / 100), f.key.replace(/_/g, ' '), `${f.n} calls`)).join(''))}
        </div>
        <div class="fine">By model: ${costs.by_model.filter(m => m.key).map(m => `${m.key} ${money(m.cents / 100)} (${fmtN(m.quantity)} ${/apify/.test(m.key) ? 'units' : 'tokens'})`).join(' · ') || 'nothing yet'}</div>
        ${costs.users.length ? raw(h`<div class="alist" style="margin-top:10px"><div class="arow head"><span></span><span class="h">account</span><span class="t">cost · reports</span><span class="e">revenue</span><span class="n">margin</span></div>${raw(costs.users.slice(0, 15).map(u => { const m = u.revenue_cents - u.cost_cents; return h`<div class="arow"><span></span><span class="h">${u.email || u.account_id}</span><span class="t">${money(u.cost_cents / 100)} · ${u.reports} report${u.reports === 1 ? '' : 's'}</span><span class="e">${money(u.revenue_cents / 100)}</span><span class="n ${m < 0 ? 'neg' : ''}">${m < 0 ? '−' : ''}${money(Math.abs(m) / 100)}</span></div>`; }).join(''))}</div>`) : ''}
      </section>`) : ''}

      <section class="card"><h2>Look up an account</h2>
        <form class="compform" id="adminFind"><input type="text" name="q" placeholder="email or @handle" autocomplete="off"><button class="btn dark" type="submit">Find</button></form>
        <div id="adminAccount"></div>
      </section>

      <section class="card"><h2>Promo codes</h2>
        <div id="promoList" class="alist"></div>
        <form class="promocreate" id="promoCreate">
          <input name="code" placeholder="CODE" required autocapitalize="characters">
          <select name="kind"><option value="free_months">Free month(s)</option><option value="percent">% off</option><option value="amount">$ off</option><option value="free_unlock">Free 60-day plan</option></select>
          <input name="value" type="number" min="0" placeholder="value (months · % · dollars)">
          <select name="applies_to"><option value="any">Any</option><option value="growth_plan">Growth Plan</option><option value="plan_unlock">60-day plan</option></select>
          <input name="max_redemptions" type="number" min="1" placeholder="max uses">
          <input name="expires_at" type="date">
          <input name="note" placeholder="where it's posted (note)">
          <button class="btn dark sm" type="submit">Create code</button>
          <span class="fine" id="promoCreateMsg"></span>
        </form>
        <div class="fine">Share as a link: <code>${location.origin}/?promo=CODE</code> — it applies itself.</div>
      </section>

      <section class="card"><h2>Phase 2 waitlist <span class="fine">accounts and reports flagged as a business</span></h2>
        <div id="bizList" class="fine">Loading…</div>
        <a class="btn ghost sm" id="bizCsv" href="#" style="margin-top:10px">Download CSV</a>
      </section>

      <section class="card"><h2>Recent reports <span class="fine">last ${reports.reports.length}</span></h2>
        <div class="alist">${raw(reports.reports.map(reportRow).join('') || '<div class="fine">None yet.</div>')}</div>
      </section>

      <section class="card"><h2>Failed jobs <span class="fine">last 24h and older</span></h2>
        <div class="alist">${raw(failed.jobs.map(j => h`<div class="arow fail"><span>${fmtDate(j.created_at)}</span><span class="h">@${j.handle || '—'}</span><span class="t">${platName(j.platform)} · ${tierName(j.tier)} · ${j.stage || ''}</span><span class="e">${j.email || ''}</span><span class="err">${j.error || ''}</span></div>`).join('') || '<div class="fine">No failures.</div>')}</div>
      </section>
    </div></div>${raw(footer())}`;

    // business-flagged accounts (phase 2 waitlist)
    api('/admin/business-accounts').then(d => { const el = $view.querySelector('#bizList'); el.textContent = `${d.users.length} account${d.users.length === 1 ? '' : 's'} · ${d.reports.length} report${d.reports.length === 1 ? '' : 's'} flagged`; }).catch(() => { });
    $view.querySelector('#bizCsv').addEventListener('click', async e => {
      e.preventDefault();
      try { const res = await fetch(API + '/admin/business-accounts?format=csv', { headers: { Authorization: 'Bearer ' + token() } }); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'business-accounts.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      catch (e2) { toast(e2.message); }
    });
    // promo list + create
    const kindLabel = p => p.kind === 'free_months' ? `${p.value} month${p.value === 1 ? '' : 's'} free` : p.kind === 'percent' ? `${p.value}% off` : p.kind === 'amount' ? `$${(p.value / 100).toFixed(p.value % 100 ? 2 : 0)} off` : 'free 60-day plan';
    const applyLabel = a => ({ any: 'any', growth_plan: 'Growth Plan', plan_unlock: '60-day' }[a] || a);
    const renderPromos = async () => {
      const el = $view.querySelector('#promoList');
      try {
        const { promos } = await api('/admin/promos');
        el.innerHTML = promos.length ? promos.map(p => h`<div class="arow promo ${p.active ? '' : 'off'}"><span class="h">${p.code}</span><span class="t">${kindLabel(p)} · ${applyLabel(p.applies_to)}${p.expires_at ? ' · until ' + fmtDate(p.expires_at) : ''}${p.note ? ' · ' + p.note : ''}</span><span class="e">${p.redemptions}${p.max_redemptions != null ? ' / ' + p.max_redemptions : ''} used</span><span class="n"><button class="btn ghost sm" data-promo-toggle="${p.code}" data-active="${p.active ? '1' : '0'}">${p.active ? 'Pause' : 'Resume'}</button></span></div>`).join('') : '<div class="fine">No codes yet.</div>';
        el.querySelectorAll('[data-promo-toggle]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; try { await api('/admin/promos/' + b.dataset.promoToggle, { method: 'PATCH', body: JSON.stringify({ active: b.dataset.active !== '1' }) }); renderPromos(); } catch (e) { toast(e.message); b.disabled = false; } }));
      } catch (e) { el.innerHTML = h`<div class="form-error">${e.message}</div>`; }
    };
    renderPromos();
    $view.querySelector('#promoCreate').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.currentTarget; const msg = f.querySelector('#promoCreateMsg');
      const kind = f.kind.value; let value = Number(f.value.value) || 0; if (kind === 'amount') value = Math.round(value * 100);
      const body = { code: f.code.value, kind, value, applies_to: f.applies_to.value, max_redemptions: f.max_redemptions.value || null, expires_at: f.expires_at.value ? new Date(f.expires_at.value + 'T23:59:59').getTime() : null, note: f.note.value };
      msg.textContent = 'Creating…';
      try { await api('/admin/promos', { method: 'POST', body: JSON.stringify(body) }); msg.textContent = ''; f.reset(); renderPromos(); toast(`${body.code.toUpperCase()} created.`); }
      catch (e2) { msg.textContent = e2.message; }
    });

    const box = $view.querySelector('#adminAccount');
    const showAccount = a => {
      const u = a.user, en = a.entitlement;
      box.innerHTML = h`<div class="acct">
        <div class="top"><div><b>${u.email}</b><div class="fine">${u.user_id} · joined ${fmtDate(u.created_at)}${u.email_paused ? ' · emails paused' : ''}</div></div>
          <div class="tagline"><span class="tag ${en.tier === 'social_snapshot' ? 'fair' : 'dark'}">${tierName(en.tier)}</span>${en.cancel_at ? raw(h`<span class="fine">ends ${fmtDate(en.cancel_at)}</span>`) : en.period_end ? raw(h`<span class="fine">renews ${fmtDate(en.period_end)}</span>`) : ''}</div></div>
        <div class="fine">Today: ${Object.entries(a.usage_today).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no runs'}</div>
        ${a.plan_contexts.length ? raw(h`<div class="ctxrow">${raw(a.plan_contexts.map(c => contextChips(c) + (c.notes ? h`<span class="chip note">“${c.notes}”</span>` : '') + h`<span class="fine">(@${c.handle})</span>`).join(''))}</div>`) : ''}
        <div class="alist">${raw(a.reports.map(r => h`<a class="arow" href="#/report/${r.report_id}"><span>${fmtDate(r.generated_at)}</span><span class="h">@${r.handle}</span><span class="t">${r.one_time ? '60-day' : tierName(r.tier)} · ${r.moves_done} moves done${r.checkins ? ' · check-ins ' + Object.keys(r.checkins).join(',') : ''}${r.emails_sent.length ? ' · emailed ' + r.emails_sent.join(',') : ''}</span><span class="n">${r.overall ?? '—'}</span></a>`).join('') || '<div class="fine">No reports.</div>')}</div>
        <div class="acts"><button class="btn ghost sm" data-adm="resend">Resend latest report email</button><button class="btn ghost sm" data-adm="comp">Comp 30 days</button><button class="btn danger sm" data-adm="delete">Delete account</button></div></div>`;
      box.querySelectorAll('[data-adm]').forEach(b => b.addEventListener('click', async () => {
        const act = b.dataset.adm;
        if (act === 'delete' && !confirm(`Delete ${u.email} and every report? This can't be undone.`)) return;
        b.disabled = true;
        try {
          if (act === 'resend') { await api(`/admin/account/${u.user_id}/resend`, { method: 'POST', body: '{}' }); toast('Sent (or logged, if email isn’t configured).'); }
          if (act === 'comp') { const r = await api(`/admin/account/${u.user_id}/comp`, { method: 'POST', body: JSON.stringify({ days: 30 }) }); toast(`Growth Plan until ${fmtDate(r.until)}.`); showAccount(await api('/admin/account?q=' + encodeURIComponent(u.email))); return; }
          if (act === 'delete') { await api(`/admin/account/${u.user_id}`, { method: 'DELETE' }); toast('Deleted.'); box.innerHTML = ''; return; }
        } catch (e) { toast(e.message); }
        b.disabled = false;
      }));
    };
    $view.querySelector('#adminFind').addEventListener('submit', async e => {
      e.preventDefault(); const q = e.currentTarget.q.value.trim(); if (!q) return;
      box.innerHTML = '<div class="fine">Looking…</div>';
      try { showAccount(await api('/admin/account?q=' + encodeURIComponent(q))); }
      catch (e2) { box.innerHTML = h`<div class="form-error">${e2.status === 404 ? 'No account matches that.' : e2.message}</div>`; }
    });
  }

  // ------------------------------------------------------------ how the score works (batch 3)
  function viewHow() {
    renderHeader('how');
    const dims = [
      ['Posting Consistency', 1, 'How often you post and how long you go quiet. We count your posts across the window, work out your weekly rate against a target of four to five, and look at your longest gap and how recently you last posted.', ['cadence 60', 'gaps 25', 'recency 15'], 'posting on fixed days, and never leaving a gap longer than a week.'],
      ['Content Mix', 2, 'Whether you use enough video and enough different formats. We read the format of each post in the window, the share that is video against your niche target, and how much variety there is between reels, carousels and stills.', ['video share 50', 'format variety 25', 'caption depth 25'], 'adding a second format to a feed that only does one thing.'],
      ['Engagement Quality', 3, 'Not just likes. We take likes and comments against your follower count for an engagement rate, measured against your niche goal, and then look at how much of that is comments rather than taps.', ['engagement rate 60', 'comment share 25', 'video reach 15'], 'captions that ask something answerable, and replying in the first hour.'],
      ['Profile Clarity', 4, 'Whether a stranger knows what you do in five seconds. We read your bio for what you’re about, a working link and whether that link leads somewhere useful, a clear next step, and story highlights.', ['bio 25', 'link 20', 'link goes somewhere 25', 'next step 15', 'highlights 15'], 'one line saying who it’s for, and a link that goes straight to the thing.']
    ];
    $view.innerHTML = h`<div class="wrap"><div class="howpage">
      <h1>How the score works</h1>
      <p class="lede">Your score out of 100 is the plain average of four dimensions. Nothing is weighted secretly at the top level — if one number is low, you can see exactly which one and why. Under 50 is Weak, 50 to 69 is Fair, 70 and up is Strong.</p>
      <div class="dimlist">${raw(dims.map(([l, hue, t, chips, moves]) => h`<div class="card dimx bd${hue}"><div class="n">${l}</div><p>${t}</p><div class="chips2">${raw(chips.map(c => h`<span class="pill tone">${c}</span>`).join(''))}</div><p class="mv">What moves it: ${moves}</p></div>`).join(''))}</div>
      <div class="cannot"><div class="n">What we cannot see</div><p>We read public data only. That means no saves, no reach, no story views, no audience demographics, and nothing from a private account. A report is based on your most recent public posts — usually 30, fewer on a newer account — within the window shown on it. If a number here disagrees with your own analytics, yours is the more complete one — ours is the one a stranger can see.</p></div>
      <p class="lede sm">Your niche average appears once 20 accounts in that niche are scored. Until then the marker is the all-creator average and the report says so.</p>
    </div></div>${raw(footer())}`;
  }

  // ------------------------------------------------------------ legal (batch 3 template; copy is draft)
  const LEGAL = {
    terms: { title: 'Terms of Service', sections: [
      ['What Scalecraft does', 'Scalecraft reads a public social media account, scores it out of 100 across four dimensions, and writes a plan of suggested moves. We are a measurement and recommendation service. We do not guarantee growth, reach, followers, sales or any other outcome.'],
      ['Eligibility', 'You must be 18 or over to use Scalecraft. You may score an account you hold, or one you have the account holder’s consent to score.'],
      ['Your account', 'Keep your password to yourself. You are responsible for what happens under your account. Tell us at once if you think someone else has access to it.'],
      ['Free tier limits', 'One free Snapshot per email address. A second evaluation requires an account and a paid plan.'],
      ['Subscriptions, billing and refunds', 'Paid plans renew monthly or annually until cancelled. Billing is handled by Stripe; we never see your full card details. You can cancel in two clicks from your settings and keep access until the end of the period you paid for. If the plan is not useful in the first seven days, reply to any email from us and we refund it.' + (supportEmail() ? ` Questions about billing: ${supportEmail()}.` : '')],
      ['Acceptable use', 'Do not score an account you intend to harass. Do not scrape, resell or redistribute our scores, plans or calendars. Do not attempt to reverse the engine or use the service to build a competing dataset.'],
      ['Intellectual property', 'Your content and your data stay yours. The scores, plans and calendars we produce are licensed to you for your own use for as long as your account exists.'],
      ['Disclaimers', 'Recommendations are suggestions, not instructions, and results vary. We are not affiliated with, endorsed by or operated by Instagram, TikTok or any other platform.'],
      ['Liability', 'To the extent the law allows, our liability to you is limited to the amount you paid us in the twelve months before the claim. [Counsel to confirm wording.]'],
      ['Termination', 'You can delete your account at any time from settings. We may suspend an account that breaks these terms; we will say why.'],
      ['Governing law', '[Jurisdiction placeholder — to be set by counsel.]'],
      ['Changes and contact', 'If these terms change materially we will email you before the change takes effect. Questions: reply to any email from us.']
    ] },
    privacy: { title: 'Privacy Policy', sections: [
      ['What we collect', 'Your handle, niche, email and — if you create an account — a password hash. The public profile data we read to score you. Your scores and reports. Payment metadata from Stripe (never your full card number). Basic usage analytics.'],
      ['How we read profiles', 'Public data only, through a third-party data provider. We never log in as you, never post, and never read private accounts.'],
      ['Why', 'To produce your report; to improve niche averages in aggregate; to email you what you asked for.'],
      ['Who we share with', 'Our data provider; the language-model providers that write the report text (your data is not used to train their models); Stripe for payments; our email provider; our hosting provider. No one else.'],
      ['Retention', 'Reports are kept while your account exists. Delete your account from settings and they go with it. Anonymous free snapshots are kept for 90 days.'],
      ['Your rights', 'Access, correction and deletion of your data, on request or from settings. If you are in the EU/UK or California, the rights in GDPR and CCPA apply and we honour them. [Counsel to confirm disclosures.]'],
      ['Cookies', 'See the Cookie Notice.'],
      ['Children', 'Scalecraft is not for anyone under 18.'],
      ['Changes and contact', 'We will email you before a material change. Questions: reply to any email from us.']
    ] },
    cookies: { title: 'Cookie Notice', sections: [
      ['Strictly necessary', 'A session token so you stay signed in.'],
      ['Preferences', 'Your billing toggle and a few display settings, stored in your browser.'],
      ['Analytics', '[None yet — if we add a tool, we will name it here.]'],
      ['Advertising', 'None. We do not run advertising cookies.'],
      ['How to control them', 'Clear your browser storage for scalecraft.com, or sign out.']
    ] },
    use: { title: 'Acceptable Use', sections: [
      ['Do not', 'Score an account you intend to harass. Scrape, resell or redistribute our scores, plans or calendars. Attempt to reverse the engine or build a competing dataset from it. Use the service for anyone under 18 without consent.'],
      ['We may', 'Suspend an account that breaks these rules. We will say why.']
    ] }
  };
  function viewLegal(page) {
    renderHeader('legal');
    const doc = LEGAL[page] || LEGAL.terms;
    $view.innerHTML = h`<div class="wrap"><div class="legal">
      <aside class="lnav">
        <div class="eyebrow">Legal</div>
        <div class="pages">${raw(Object.entries(LEGAL).map(([k, v]) => h`<a class="${k === page ? 'on' : ''}" href="#/legal/${k}">${v.title}</a>`).join(''))}</div>
        <div class="toc">${raw(doc.sections.map((sec, i) => h`<a href="#/legal/${page}#s${i + 1}" data-jump="s${i + 1}">${i + 1} · ${sec[0]}</a>`).join(''))}</div>
      </aside>
      <article class="lbody">
        <span class="tag fair">DRAFT, PENDING LEGAL REVIEW</span>
        <h1>${doc.title}</h1>
        <div class="fine">Last updated ${fmtDate('2026-09-19')}</div>
        <div class="sections">${raw(doc.sections.map((sec, i) => h`<section id="s${i + 1}"><h2>${i + 1} · ${sec[0]}</h2><p>${sec[1]}</p></section>`).join(''))}</div>
      </article>
    </div></div>${raw(footer())}`;
    $view.querySelectorAll('[data-jump]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }

  // ------------------------------------------------------------ router
  function route() {
    stopPolling(); window.scrollTo(0, 0);
    const hash = location.hash || '#/';
    const parts = hash.slice(1).split('?')[0].split('/').filter(Boolean);
    if (parts.length === 0) return viewLanding();
    if (parts[0] === 'evaluating' && parts[1]) return viewEvaluating(decodeURIComponent(parts[1]));
    if (parts[0] === 'report' && parts[1]) return viewReport(decodeURIComponent(parts[1]));
    if (parts[0] === 'pricing') return viewPricing();
    if (parts[0] === 'plan-setup') return viewPlanSetup();
    if (parts[0] === 'business') return viewBusiness();
    if (parts[0] === 'signin') return viewSignin();
    if (parts[0] === 'signup') return viewSignup();
    if (parts[0] === 'forgot') return viewForgot();
    if (parts[0] === 'reset') return viewReset();
    if (parts[0] === 'reports') return viewReports();
    if (parts[0] === 'admin') return viewAdmin();
    if (parts[0] === 'how') return viewHow();
    if (parts[0] === 'legal') return viewLegal(parts[1] || 'terms');
    renderHeader('landing');
    $view.innerHTML = h`<div class="center-msg"><h2>Nothing here.</h2><a href="#/">Back to start</a></div>`;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-scroll]');
    if (a) { const target = a.dataset.scroll; if ((location.hash || '#/') === '#/' || location.hash === '#') { e.preventDefault(); document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else sset('sc_scroll', target); return; }
    const act = e.target.closest('[data-action]'); if (!act) return;
    if (act.dataset.action === 'signout') { e.preventDefault(); setToken(null); toast('Signed out.'); route(); }
    if (act.dataset.action === 'email-report') { e.preventDefault(); toast('This report is already on its way to your inbox.'); }
  });
  window.addEventListener('hashchange', route);
  if (CFG.useMock) { const b = document.createElement('div'); b.className = 'mockbadge'; b.textContent = 'Sample data'; document.body.appendChild(b); }
  route();
})();
