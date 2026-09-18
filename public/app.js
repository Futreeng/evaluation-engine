/* Scalecraft front end — single-page funnel over the Growth Engine API.
   Routes: #/  #/evaluating/:jobId  #/report/:reportId  #/pricing  #/signin */
(function () {
  'use strict';
  const CFG = window.SCALECRAFT_CONFIG || {};
  const API = CFG.apiBase || '/api/growth-engine/v1';
  const POLL = CFG.pollIntervalMs || 2000;
  const $view = document.getElementById('view');
  const $header = document.getElementById('header');

  // ------------------------------------------------------------ data
  const PLATFORMS = [
    ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['x', 'X'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn']
  ];
  // Mock supports every platform; the real backend only what config lists.
  const SUPPORTED = CFG.useMock ? PLATFORMS.map(p => p[0]) : (CFG.supportedPlatforms || PLATFORMS.map(p => p[0]));
  const supported = k => SUPPORTED.includes(k);
  const CATEGORIES = [
    ['boutique_fitness', 'Boutique Fitness'], ['fitness', 'Fitness'], ['food_beverage', 'Food & Beverage'],
    ['retail', 'Retail'], ['professional_services', 'Professional Services']
  ];
  const DIMENSIONS = ['Posting consistency', 'Content mix', 'Engagement quality', 'Profile clarity'];
  const STAGE_COPY = {
    'profile clarity': 'Reading your bio, link and highlights for a location, a price and a way to book.',
    'posting consistency': 'Reading the dates on your last public posts and measuring the gaps between them.',
    'content mix': 'Sorting your recent posts by what they are — schedules, coach voice, member results, behind the desk.',
    'engagement quality': 'Counting who comments, how often the same accounts come back, and how many posts get saved or shared.'
  };
  const catName = k => (CATEGORIES.find(c => c[0] === k) || [, k])[1];
  const platName = k => (PLATFORMS.find(p => p[0] === k) || [, k])[1];

  // ------------------------------------------------------------ utils
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? (vals[i] instanceof Raw ? vals[i].s : esc(vals[i])) : ''), '');
  class Raw { constructor(s) { this.s = s; } }
  const raw = s => new Raw(s);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
  const fmtDate = d => new Date(d || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  const fmtTime = d => new Date(d || Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase();
  const ordinal = n => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] || (n + 'th');
  const sget = (k, d) => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const token = () => { try { return localStorage.getItem('sc_token'); } catch { return null; } };
  const setToken = t => { try { t ? localStorage.setItem('sc_token', t) : localStorage.removeItem('sc_token'); } catch { } };
  const go = hash => { location.hash = hash; };
  const grade = s => s < 50 ? ['Weak', 'weak'] : s < 70 ? ['Fair', 'fair'] : ['Strong', 'strong'];

  // Tiny markdown → HTML for the backend's narrative report (headings, bold, lists, paragraphs).
  function md(src) {
    const lines = String(src).replace(/\r/g, '').split('\n');
    const out = []; let list = null; let para = [];
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) { flushP(); continue; } // a blank line ends a paragraph, not a list — LLMs double-space list items
      let m;
      // A locked-teaser line (🔒 …) or an indented line belongs to the list item above it
      if (list && !/^([-*•]|\d+[.)])\s/.test(t) && (/^🔒/.test(t) || /^\s{2,}/.test(ln))) {
        out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, '') + '<div class="lock-note">' + inline(t) + '</div></li>';
        continue;
      }
      if (list && !/^([-*•]|\d+[.)])\s/.test(t) && !/^#/.test(t)) flushL();
      if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) { flushP(); flushL(); const lvl = Math.min(4, m[1].length + 1); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); continue; }
      if (/^(-{3,}|\*{3,})$/.test(t)) { flushP(); flushL(); out.push('<hr>'); continue; }
      if ((m = /^[-*•]\s+(.*)$/.exec(t))) { flushP(); if (list !== 'ul') { flushL(); list = 'ul'; out.push('<ul>'); } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) { flushP(); if (list !== 'ol') { flushL(); list = 'ol'; out.push('<ol>'); } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if (list) flushL();
      para.push(t);
    }
    flushP(); flushL();
    return out.join('');
  }

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

  // ------------------------------------------------------------ header
  function renderHeader(kind, ctx) {
    if (kind === 'report') {
      $header.innerHTML = h`
        <div class="gradbar"></div>
        <div class="topbar reportbar">
          <div class="left">
            <a class="brandname" href="#/">Scalecraft</a>
            <div class="vsep"></div>
            <div class="handle">@${ctx.handle}</div>
            <div class="ctx">${ctx.ctx}</div>
          </div>
          <div class="right"><a class="plain" href="#" data-action="email-report">Email me this report</a></div>
        </div>`;
      return;
    }
    const active = kind === 'pricing' ? 'pricing' : '';
    $header.innerHTML = h`
      <div class="gradbar"></div>
      <div class="topbar">
        <a class="brand" href="#/">
          <div class="mark">S</div>
          <div><div class="name">Scalecraft</div><div class="tag">Social evaluation</div></div>
        </a>
        <nav class="nav">
          <a href="#/" data-scroll="how" class="${active === 'how' ? 'active' : ''}">How it scores</a>
          <a href="#/" data-scroll="dimensions">Dimensions</a>
          <a href="#/pricing" class="${active === 'pricing' ? 'active' : ''}">Pricing</a>
        </nav>
        <div class="right">
          ${token()
            ? raw(h`<a class="plain" href="#" data-action="signout">Sign out</a>`)
            : raw(h`<a class="plain" href="#/signin">Sign in</a>`)}
          <a class="btn sm" href="#/" data-scroll="form">Score my profile <span class="arrow">→</span></a>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------ landing
  function viewLanding() {
    renderHeader('landing');
    const last = sget('sc_form', {});
    const prefill = CFG.useMock && !last.handle ? 'sunrisefitnessbk' : (last.handle || '');
    const platform = supported(last.platform) ? last.platform : 'instagram';
    const category = last.category || 'boutique_fitness';
    $view.innerHTML = h`
      <div class="wrap">
        <div class="hero-band-wrap" id="how">
          <div class="hero-band">
            <div class="h">
              <div class="eyebrow gold"><span class="sq"></span>1,284 Boutique Fitness profiles scored</div>
              <h2>Your feed, scored like a P&amp;L.</h2>
            </div>
            <div class="hero-cards">
              <div class="hcard score">
                <div class="k">Sample score</div>
                <div class="big"><div class="n">47</div><div class="d">/100</div></div>
                <div class="bar"><div style="width:47%"></div></div>
                <div class="under">14 UNDER CATEGORY AVG</div>
              </div>
              <div class="hcard time">
                <div class="k">Delivered in</div>
                <div class="t">~40s</div>
                <div class="s">Four graded dimensions and a 30-60-90 day path.</div>
              </div>
            </div>
          </div>
        </div>
        <div class="landing-grid">
          <div class="pitch">
            <div class="eyebrow accent"><span class="sq"></span>Free profile evaluation</div>
            <h1>Find out what your feed is actually doing for the business.</h1>
            <div class="sub">We score your profile against other businesses in your category and hand you a 30-60-90 day path. Takes about forty seconds. No card, no call.</div>
            <div class="bullets" id="dimensions">
              <div>One number, 0–100, next to your category average — so you know where you stand, not just how you feel.</div>
              <div>Four graded dimensions with the actual reason for each grade.</div>
              <div>The first move of each 30-day phase, in full, free.</div>
            </div>
            <div class="foot"><span>1,284 BOUTIQUE FITNESS PROFILES SCORED</span><span class="sl">/</span><span>NO POSTING ACCESS REQUIRED</span></div>
          </div>
          <div class="form-card" id="form">
            <h3>Score my profile</h3>
            <div class="sub">Five fields. Nothing else.</div>
            <form id="evalForm" novalidate>
              <div class="field">
                <div class="label">Handle</div>
                <div class="handle-wrap"><div class="at">@</div><input type="text" name="handle" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="yourstudio" value="${prefill}"></div>
              </div>
              <div class="field">
                <div class="label">Platform</div>
                <div class="chips" role="radiogroup">
                  ${raw(PLATFORMS.map(([k, n]) => h`<button type="button" class="chip ${k === platform ? 'on' : ''} ${supported(k) ? '' : 'soon'}" data-platform="${k}" role="radio" aria-checked="${k === platform}" title="${supported(k) ? '' : 'Coming soon'}">${n}${supported(k) ? '' : raw('<small>soon</small>')}</button>`).join(''))}
                </div>
              </div>
              <div class="field">
                <div class="label">Business category</div>
                <div class="select-wrap">
                  <select name="category">${raw(CATEGORIES.map(([k, n]) => h`<option value="${k}" ${k === category ? 'selected' : ''}>${n}</option>`).join(''))}</select>
                  <span class="change">CHANGE</span>
                </div>
              </div>
              <div class="field">
                <div class="label">Where to send the report</div>
                <input type="email" name="email" placeholder="maya@sunrisefitness.co" autocomplete="email" value="${last.email || ''}">
              </div>
              <div class="form-error" id="formError" hidden></div>
              <button class="btn block" type="submit">Score my profile — free <span class="arrow">→</span></button>
              <div class="fine">We read only what's public. No password, no posting access, and we don't email you again unless you ask.</div>
            </form>
          </div>
        </div>
      </div>`;

    const form = $view.querySelector('#evalForm');
    let chosenPlatform = platform;
    form.querySelectorAll('[data-platform]').forEach(b => b.addEventListener('click', () => {
      chosenPlatform = b.dataset.platform;
      form.querySelectorAll('[data-platform]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = form.querySelector('#formError');
      const payload = {
        handle: form.handle.value.replace(/^@/, '').trim(),
        platform: chosenPlatform,
        category: form.category.value,
        email: form.email.value.trim()
      };
      const problems = [];
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(payload.handle)) problems.push('a handle (letters, numbers, dots or underscores)');
      if (!supported(payload.platform)) { err.textContent = platName(payload.platform) + " isn't scored yet — Instagram and X are live today."; err.hidden = false; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) problems.push('an email we can send the report to');
      if (problems.length) { err.textContent = 'We need ' + problems.join(' and ') + '.'; err.hidden = false; return; }
      err.hidden = true;
      sset('sc_form', payload);
      await submitEvaluation(payload, form.querySelector('button[type=submit]'));
    });

    const scrollTo = sget('sc_scroll', null);
    if (scrollTo) { sessionStorage.removeItem('sc_scroll'); document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  async function submitEvaluation(payload, btn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = 'Queuing…'; }
    try {
      const res = await api('/evaluate/social-snapshot', { method: 'POST', body: JSON.stringify(payload) });
      sset('sc_job_' + res.job_id, { ...payload, submitted_at: Date.now() });
      go('#/evaluating/' + encodeURIComponent(res.job_id));
    } catch (e) {
      if (e.status === 401) return; // redirected to sign-in; form values are kept in sessionStorage
      toast(e.message || "Couldn't start the evaluation. Try again in a moment.");
      if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
    }
  }

  // ------------------------------------------------------------ evaluating
  let pollHandle = null;
  function stopPolling() { if (pollHandle) { clearTimeout(pollHandle); pollHandle = null; } }

  function viewEvaluating(jobId) {
    renderHeader('landing');
    const meta = sget('sc_job_' + jobId, sget('sc_form', {}));
    const handle = meta.handle || 'your profile';
    const startedAt = meta.submitted_at || Date.now();
    let lastStatus = null;

    const render = job => {
      const status = job.status;
      if (status === 'queued') {
        const ahead = job.queue_position;
        const eta = job.eta_seconds;
        $view.innerHTML = h`
          <div class="wrap"><div class="eval">
            <div class="main">
              <div class="pill queued"><span class="dot"></span>Queued</div>
              <h2>${ahead ? `You're ${ordinal(ahead + 1)} in line.` : "You're in line."}</h2>
              <div class="lead">${ahead ? `We're finishing ${ahead === 1 ? 'one evaluation' : ahead + ' evaluations'} ahead of yours. ` : ''}Nothing has started on <b>@${handle}</b> yet — it usually takes under twenty seconds from here. You can close this tab; the report lands in your inbox either way.</div>
              <div class="progress"><div class="track"><div class="sweep"></div></div>
                <div class="row"><span>${ahead != null ? `${ahead} AHEAD` : 'QUEUED'}${eta ? ` · EST. ${eta}S` : ''}</span><span>${Math.floor((Date.now() - startedAt) / 1000)}S ELAPSED</span></div>
              </div>
            </div>
            <aside class="side">
              <div class="label">What we'll examine</div>
              <div class="checklist">${raw(DIMENSIONS.map(d => h`<div class="it"><div class="ring"></div><div class="t">${d}</div></div>`).join(''))}</div>
              <div class="note">Scope: last 90 days of public posts, bio, and link. 1,284 ${catName(meta.category)} profiles for comparison.</div>
            </aside>
          </div></div>`;
        return;
      }
      if (status === 'running') {
        const stage = String(job.stage || '');
        const stageKey = stage.toLowerCase();
        const known = DIMENSIONS.map(d => d.toLowerCase());
        const idx = known.indexOf(stageKey);
        const total = job.total_steps || DIMENSIONS.length;
        const step = job.step || (idx >= 0 ? idx + 1 : null);
        const pct = job.percent != null ? clamp(job.percent, 0, 100) : step ? Math.round(((step - 0.5) / total) * 100) : null;
        const elapsed = job.elapsed_seconds != null ? job.elapsed_seconds : Math.floor((Date.now() - startedAt) / 1000);
        const heading = idx >= 0 ? `Evaluating ${stageKey}` : stage ? `Working: ${stage}` : 'Evaluating your profile';
        const lead = STAGE_COPY[stageKey] || 'Reading your public posts, bio and link and scoring them against your category.';
        // Order the checklist so completed stages read first, as in the design
        const order = job.stage_order || (idx >= 0 ? ['Profile clarity', 'Posting consistency', 'Content mix', 'Engagement quality'] : DIMENSIONS);
        const doneSet = new Set(job.completed_stages || (idx >= 0 ? order.slice(0, order.map(s => s.toLowerCase()).indexOf(stageKey)) : []));
        const stats = job.stats;
        $view.innerHTML = h`
          <div class="wrap"><div class="eval">
            <div class="main">
              <div class="pill running"><span class="dot"></span>Running</div>
              <h2>${heading}</h2>
              <div class="lead">${lead}</div>
              <div class="progress">
                <div class="track">${pct != null ? raw(h`<div class="fill" style="width:${pct}%"></div>`) : raw('<div class="sweep"></div>')}</div>
                <div class="row"><span>${step ? `STEP ${step} OF ${total}` : 'IN PROGRESS'}${pct != null ? ` · ${pct}%` : ''}</span><span>${elapsed}S ELAPSED</span></div>
              </div>
              ${stats ? raw(h`<div class="statchips">
                ${stats.posts_found != null ? raw(h`<div><div class="k">POSTS FOUND</div><div class="v">${stats.posts_found}</div></div>`) : ''}
                ${stats.window_days != null ? raw(h`<div><div class="k">WINDOW</div><div class="v">${stats.window_days} days</div></div>`) : ''}
                ${stats.longest_gap_days != null ? raw(h`<div><div class="k">LONGEST GAP</div><div class="v">${stats.longest_gap_days} days</div></div>`) : ''}
              </div>`) : ''}
            </div>
            <aside class="side">
              <div class="label">Progress</div>
              <div class="checklist">${raw(order.map(d => {
                const k = d.toLowerCase();
                const cls = doneSet.has(d) || [...doneSet].some(x => String(x).toLowerCase() === k) ? 'done' : k === stageKey ? 'now' : '';
                return h`<div class="it ${cls}"><div class="ring"></div><div class="t">${d}</div>${cls === 'done' ? raw('<div class="st">done</div>') : cls === 'now' ? raw('<div class="st">now</div>') : ''}</div>`;
              }).join(''))}</div>
              ${job.note ? raw(h`<div class="note">${job.note}</div>`) : ''}
            </aside>
          </div></div>`;
        return;
      }
      if (status === 'failed') {
        const ref = job.ref || jobId.slice(-7).toUpperCase();
        const errText = String(job.error || '');
        // Classify so the advice matches the cause: a private/missing profile is the
        // owner's to fix; a data-source or scoring outage is ours.
        const kind = /private|not found|no public|does not exist|404/i.test(errText) ? 'profile'
          : /api key|configured|LLM|token|rate limit|quota|not yet supported|could not fetch/i.test(errText) ? 'ours'
          : 'unknown';
        const lead = kind === 'profile'
          ? errText || `${platName(meta.platform)} returned the profile as private, so there are no public posts for us to score. Nothing was charged and nothing was saved.`
          : kind === 'ours'
            ? 'Our scoring service couldn’t complete this run. Nothing was charged and nothing was saved.'
            : errText || 'The evaluation stopped before it could finish. Nothing was charged and nothing was saved.';
        const boxLabel = kind === 'ours' ? 'What happens now' : 'Two ways forward';
        const boxText = kind === 'ours'
          ? 'This one is on our side, not yours. Retry in a few minutes — the same handle and link will work once the service is back. If it keeps happening, reply to the report email and we’ll run it by hand.'
          : 'Switch the account to public for ten minutes and retry — or run the evaluation on a different handle. If the profile is public and this keeps happening, it’s on our side; the same link will work later.';
        $view.innerHTML = h`
          <div class="wrap"><div class="eval single"><div class="failwrap">
            <div class="pill failed"><span class="dot"></span>Stopped</div>
            <h2>${kind === 'ours' ? `We couldn't finish @${handle}.` : `We couldn't read @${handle}.`}</h2>
            <div class="lead">${lead}</div>
            <div class="failbox">
              <div class="label">${boxLabel}</div>
              <p>${boxText}</p>
            </div>
            <div class="actions">
              <button class="btn md" data-action="retry">Retry evaluation</button>
              <button class="btn md ghost" data-action="another">Use another handle</button>
            </div>
            <div class="ref">REF ${ref} · ${fmtTime()}${kind === 'ours' && errText ? raw(h` · <span title="${errText}">${errText.length > 60 ? errText.slice(0, 57) + '…' : errText}</span>`) : ''}</div>
          </div></div></div>`;
        $view.querySelector('[data-action=retry]').addEventListener('click', e => submitEvaluation(meta, e.currentTarget));
        $view.querySelector('[data-action=another]').addEventListener('click', () => { sset('sc_scroll', 'form'); go('#/'); });
        return;
      }
    };

    const tick = async () => {
      let job;
      try { job = await api('/job/' + encodeURIComponent(jobId)); }
      catch (e) {
        if (e.status === 401) return;
        if (e.status === 404) { $view.innerHTML = h`<div class="center-msg"><h2>That evaluation has expired.</h2><a href="#/">Start a new one</a></div>`; return; }
        pollHandle = setTimeout(tick, POLL * 2); return; // transient — keep polling, slower
      }
      if (job.status === 'complete') {
        const rawReport = job.resultPayload || job.result || null;
        const id = rawReport?.report_id || rawReport?.reportId || job.report_id;
        if (rawReport && id) sset('sc_report_' + id, normalizeReport(rawReport, id));
        if (id) { go('#/report/' + encodeURIComponent(id)); return; }
        $view.innerHTML = h`<div class="center-msg"><h2>Finished, but no report came back.</h2><a href="#/">Try again</a></div>`;
        return;
      }
      if (job.status !== lastStatus || job.status !== 'queued') render(job);
      lastStatus = job.status;
      if (job.status !== 'failed') pollHandle = setTimeout(tick, POLL);
    };
    render({ status: 'queued' });
    tick();
  }

  // ------------------------------------------------------------ report
  function normalizePhase(p, i, total) {
    const range = p.range || p.days || `${i * 30 + 1}-${(i + 1) * 30}`;
    const days = /^\d+\s*[-–]\s*\d+$/.test(range) ? 'Days ' + range.replace(/\s*[-–]\s*/, '–') : range;
    const locked = p.locked || {};
    const defaultSlots = [[0, 2, 5], [1, 3, 5], [0, 3, 6]][i % 3];
    const calendar = Array.isArray(locked.calendar) && locked.calendar.length === 28
      ? locked.calendar.map(Boolean)
      : Array.from({ length: 28 }, (_, k) => defaultSlots.includes(k % 7));
    const wk = [i * 4 + 1, i * 4 + 4];
    const count = locked.count ?? 4;
    // Locked moves are numbered continuously across phases: phase 1 has
    // MOVE 01 free + 02..(1+count) locked, phase 2 picks up from there.
    const firstLocked = i * (1 + count) + 2;
    const items = Array.isArray(locked.items) && locked.items.length ? locked.items : Array.from({ length: Math.min(3, Math.max(1, count - 1)) }, (_, k) => ({
      meta: `MOVE ${String(firstLocked + k).padStart(2, '0')} · LOCKED`, w1: ['94%', '88%', '97%'][k], w2: ['61%', '44%', '72%'][k]
    }));
    return {
      days, label: p.label || `Phase ${i + 1}`,
      action: p.visible_action || p.action || '',
      detail: p.detail || '',
      // Use the model's teaser only if it names a count; the design promises one.
      lockedHeader: /\d/.test(locked.teaser || '') ? locked.teaser : `${count} specific moves + your weeks ${wk[0]}–${wk[1]} calendar`,
      calendarLabel: locked.calendar_label || `WEEKS ${wk[0]}–${wk[1]} · ${calendar.filter(Boolean).length} POST SLOTS`,
      calendar, items, count
    };
  }

  // The backend's free-tier report is a narrative (markdown) plus the raw persona
  // outputs; scores live inside that text. Pull what we can into the scored shape
  // the report page renders, and keep the narrative for the sections we can't fill.
  const DIM_KEYS = [
    ['POSTING_CONSISTENCY', 'Posting Consistency'], ['CONTENT_MIX', 'Content Mix'],
    ['ENGAGEMENT_RATE', 'Engagement Rate'], ['ENGAGEMENT_QUALITY', 'Engagement Quality'],
    ['DISCOVERY_SIGNAL', 'Discovery Signal'], ['PROFILE_CLARITY', 'Profile Clarity']
  ];
  function num(re, text) { const m = re.exec(text || ''); return m ? clamp(m[1], 0, 100) : null; }
  function normalizeReport(raw, reportId) {
    const wrapped = raw && raw.reportBody && typeof raw.reportBody === 'object';
    const body = wrapped ? raw.reportBody : (raw || {});
    const r = { ...body };
    r.report_id = body.report_id || raw?.reportId || reportId;
    r.tier = body.tier || raw?.tier;
    r.business = body.business || raw?.business || {};
    r.created_at = body.created_at || body.generated_at || raw?.generatedAt || Date.now();
    r.narrative = typeof body.narrative === 'string' ? body.narrative : (typeof body === 'string' ? body : null);
    if (!r.scores || r.scores.overall == null) {
      const gap = body.raw_personas?.gap_auditor || '';
      const text = (gap + '\n' + (r.narrative || '')).replace(/\*\*|__/g, '');
      const overall = num(/OVERALL[_ ]SCORE\s*(?:\([^)]*\))?[^0-9]{0,40}(\d{1,3})(?:\s*\/\s*100)?/i, text);
      // Only trust a category average that is an actual 0-100 figure, not a benchmark list
      const avgM = /CATEGORY[_ ]AVG(?:ERAGE)?\s*(?:\([^)]*\))?[^0-9\n]{0,30}(\d{1,3})(?:\s*\/\s*100)?\b(?![^\n]*(?:posts|%|week))/i.exec(text);
      const avg = avgM ? clamp(avgM[1], 0, 100) : null;
      const dims = [];
      const plain = gap.replace(/\*\*|__|\\\[|\\\]|`/g, '').replace(/\r/g, '');
      const glines = plain.split('\n');
      for (const [key, label] of DIM_KEYS) {
        const keyRe = new RegExp(key.replace('_', '[_ ]'), 'i');
        const idx = glines.findIndex(l => keyRe.test(l));
        if (idx < 0) continue;
        const line = glines[idx].replace(keyRe, '');
        const sm = /(?:\(\s*0\s*[-–]\s*100\s*\)\s*)?[^0-9\n]{0,40}?(\d{1,3})(?:\s*\/\s*100)?/.exec(line);
        if (!sm) continue;
        let expl = line.slice(sm.index + sm[0].length).replace(/^[\s:—–\-]+/, '').trim();
        if (expl.length < 20) {
          const next = glines.slice(idx + 1).find(l => l.trim().length > 20 && !/^[-*#]/.test(l.trim()));
          expl = next ? next.trim() : expl;
        }
        dims.push({ label, score: clamp(sm[1], 0, 100), explanation: expl });
      }
      if (overall != null || dims.length) r.scores = { overall: overall ?? (dims.length ? Math.round(dims.reduce((a, d) => a + d.score, 0) / dims.length) : null), category_avg: avg, dimensions: dims, parsed: true };
    }
    return r;
  }

  async function viewReport(reportId) {
    let report = sget('sc_report_' + reportId, null);
    if (!report) {
      renderHeader('landing');
      $view.innerHTML = h`<div class="center-msg">Loading your report…</div>`;
      try { report = normalizeReport(await api('/reports/' + encodeURIComponent(reportId)), reportId); sset('sc_report_' + reportId, report); }
      catch (e) {
        if (e.status === 401) return;
        $view.innerHTML = h`<div class="center-msg"><h2>We couldn't find that report.</h2><a href="#/">Score a profile</a></div>`; return;
      }
    }
    const hasScores = report.scores && report.scores.overall != null;
    if (!hasScores && !report.narrative) {
      renderHeader('landing');
      $view.innerHTML = h`<div class="center-msg"><h2>This report came back empty.</h2><a href="#/">Score a profile</a></div>`; return;
    }
    const s = report.scores || {};
    const biz = report.business || {};
    const overall = clamp(s.overall, 0, 100);
    const avg = s.category_avg != null ? clamp(s.category_avg, 0, 100) : null;
    const top = s.category_top_quartile != null ? clamp(s.category_top_quartile, 0, 100) : null;
    const sample = s.category_sample_size ? Number(s.category_sample_size).toLocaleString() : null;
    const cat = biz.category_name || catName(biz.category) || 'your category';
    const diff = avg != null ? overall - avg : null;
    const chip = diff == null ? null : diff < 0 ? ['Below category', 'below'] : diff > 0 ? ['Above category', 'above'] : ['At category average', 'even'];
    const phases = (report.growth_path?.phases || []).map((p, i, a) => normalizePhase(p, i, a.length));
    const unlocked = report.growth_path?.unlocked_steps ?? phases.length;
    const totalSteps = report.growth_path?.total_steps ?? phases.reduce((n, p) => n + 1 + p.count, 0);
    const up = report.upsell || {};
    let price = up.monthly_price || 39;

    renderHeader('report', { handle: biz.handle || '', ctx: [platName(biz.platform), cat, fmtDate(report.created_at)].filter(Boolean).join(' · ').toUpperCase() });

    let narrativeText = report.narrative || '';
    if (phases.length) {
      // The phase cards render the path; keep the prose from repeating it.
      narrativeText = narrativeText.replace(/\n\**\s*YOUR 30[-–]60[-–]90[^\n]*\n[\s\S]*?(?=\n\**\s*WHAT THE FULL PLAN|\n\**\s*WHAT COMES NEXT|$)/i, '\n');
    }
    const narrativeHtml = narrativeText.trim() ? md(narrativeText) : '';
    $view.innerHTML = h`
      <div class="wrap"><div class="report">
        ${hasScores ? raw(h`<section class="scorepanel">
          <div>
            <div class="eyebrow">Overall score</div>
            <div class="big"><div class="n">${overall}</div><div class="d">/100</div></div>
            ${chip ? raw(h`<div class="tagchip ${chip[1]}">${chip[0]}</div>`) : ''}
          </div>
          <div class="textcol">
            <div class="summary">${diff != null ? raw(h`You're <b>${Math.abs(diff)} points ${diff < 0 ? 'under' : diff > 0 ? 'over' : 'from'}</b> the ${cat} average. `) : ''}${s.summary || ''}</div>
            <div class="cmp">
              <div><div class="row you"><span class="l">@${biz.handle || 'you'}</span><span class="n">${overall}</span></div><div class="bar you"><div style="width:${overall}%"></div></div></div>
              ${avg != null ? raw(h`<div><div class="row"><span class="l">${cat} average ${sample ? raw(h`<small>(${sample} profiles)</small>`) : ''}</span><span class="n">${avg}</span></div><div class="bar avg"><div style="width:${avg}%"></div></div></div>`) : ''}
              ${top != null ? raw(h`<div><div class="row"><span class="l">Top quartile in your category</span><span class="n">${top}</span></div><div class="bar top"><div style="width:${top}%"></div></div></div>`) : ''}
            </div>
          </div>
        </section>`) : ''}

        ${(s.dimensions || []).length ? raw(h`<section>
          <h2 class="sec-h">${(s.dimensions || []).length === 4 ? 'Four dimensions' : 'Dimensions'}</h2>
          <p class="sec-s">Each graded on the same 0–100 scale.${(s.dimensions || []).some(d => d.category_avg != null) ? ' The marker on every bar is your category average.' : ''}</p>
          <div class="dims">${raw((s.dimensions || []).map(d => {
            const sc = clamp(d.score, 0, 100); const [gl, gc] = grade(sc);
            const da = d.category_avg != null ? clamp(d.category_avg, 0, 100) : null;
            return h`<article class="dim">
              <div class="head"><div class="t">${d.label}</div><div class="sc"><div class="n g-${gc}">${sc}</div><div class="g g-${gc}">${gl}</div></div></div>
              <div class="bar"><div class="fill bg-${gc}" style="width:${sc}%"></div>${da != null ? raw(h`<div class="mark" style="left:${da}%"></div>`) : ''}</div>
              <div class="avg">${da != null ? `${gl.toUpperCase()} · CATEGORY AVG ${da}` : gl.toUpperCase()}</div>
              <div class="why">${d.explanation || ''}</div>
            </article>`;
          }).join(''))}</div>
        </section>`) : ''}


        ${phases.length ? raw(h`<section>
          <div class="path-head">
            <div><h2 class="sec-h">Your 30-60-90 day path</h2><p class="sec-s">The first move of each phase is yours now. The rest is written and waiting.</p></div>
            <div class="unlockchip">${unlocked} OF ${totalSteps} STEPS UNLOCKED</div>
          </div>
          <div class="phases">${raw(phases.map(p => h`<article class="phase">
            <div class="ph"><div class="days">${p.days}</div><div class="lbl">${p.label}</div></div>
            <div class="pb">
              <div class="move"><div class="movetag">MOVE 01</div><div class="action">${p.action}</div></div>
              ${p.detail ? raw(h`<div class="detail">${p.detail}</div>`) : ''}
            </div>
            <div class="locked">
              <div class="lh"><div class="lock"></div><div class="t">${p.lockedHeader}</div></div>
              <div class="lb">
                ${raw(p.items.map(it => h`<div class="li"><div class="m">${it.meta}</div><div class="sk"><div style="width:${it.w1 || '90%'}"></div><div style="width:${it.w2 || '55%'}"></div></div></div>`).join(''))}
                <div class="cal">
                  <div class="m">${p.calendarLabel}</div>
                  <div class="grid">${raw(p.calendar.map(on => `<div class="${on ? 'slot' : ''}"></div>`).join(''))}</div>
                  <div class="legend"><span><i class="slot"></i>POST SLOT</span><span><i></i>REST</span></div>
                </div>
              </div>
            </div>
          </article>`).join(''))}</div>
        </section>`) : ''}

        ${narrativeHtml ? raw(h`<section class="narrative">
          <h2 class="sec-h">${hasScores ? 'The full read' : 'Your report'}</h2>
          <div class="prose">${raw(narrativeHtml)}</div>
        </section>`) : ''}

        <section class="upsell">
          <div>
            <h3>${up.cta_label || 'Unlock your full Growth Plan'}</h3>
            <div class="p">${up.description || `${up.unlock_count || 12} locked items: the remaining specific moves and the week-by-week posting calendar for all three phases, written against your own posts — not a template.`}</div>
            <div class="chips"><span>${up.unlock_count || 12} LOCKED ITEMS</span><span>12-WEEK CALENDAR</span><span>WEEKLY REFRESH</span></div>
          </div>
          <div class="right">
            <div class="price" id="upPrice">$${price}<span>/mo</span></div>
            <div class="alt" id="upAlt">or $${Math.round(price * 12 * 0.75)}/yr — 25% off</div>
            <button class="btn" data-action="unlock" data-tier="${up.target_tier || 'growth_plan'}">Unlock the plan <span class="arrow">→</span></button>
            <div class="fine">Cancel anytime. Keep the report either way.</div>
          </div>
        </section>
      </div></div>`;

    $view.querySelector('[data-action=unlock]').addEventListener('click', e => { sset('sc_intent_tier', e.currentTarget.dataset.tier); go('#/pricing'); });

    // Never trust a cached price — refresh it from billing.
    api('/billing/pricing', {}, { allow401: true }).then(p => {
      const t = (p.tiers || []).find(x => x.tier === (up.target_tier || 'growth_plan'));
      if (t && t.monthlyPrice != null) {
        price = t.monthlyPrice;
        const dm = /(\d+)\s*%/.exec(p.discount?.annual || ''); const disc = p.annual_discount ?? (dm ? Number(dm[1]) / 100 : 0.25);
        $view.querySelector('#upPrice').innerHTML = h`$${price}<span>/mo</span>`;
        $view.querySelector('#upAlt').textContent = `or $${t.annualPrice != null ? t.annualPrice : Math.round(price * 12 * (1 - disc))}/yr — ${Math.round(disc * 100)}% off`;
      }
    }).catch(() => { });
  }

  // ------------------------------------------------------------ pricing
  async function viewPricing() {
    renderHeader('pricing');
    $view.innerHTML = h`<div class="center-msg">Loading pricing…</div>`;
    let pricing, ent = null;
    try { pricing = await api('/billing/pricing', {}, { allow401: true }); }
    catch (e) { $view.innerHTML = h`<div class="center-msg"><h2>Pricing is unavailable right now.</h2>${e.message}</div>`; return; }
    if (token()) { try { ent = await api('/account/subscription-status', {}, { allow401: true }); } catch { try { ent = await api('/entitlements', {}, { allow401: true }); } catch { } } }
    const discMatch = /(\d+)\s*%/.exec(pricing.discount?.annual || '');
    const disc = pricing.annual_discount ?? (discMatch ? Number(discMatch[1]) / 100 : 0.25);
    let billing = sget('sc_billing', 'monthly');
    const intent = sget('sc_intent_tier', null);

    const render = () => {
      const annual = billing === 'annual';
      const yr = t => t.annualPrice != null ? t.annualPrice : Math.round(t.monthlyPrice * 12 * (1 - disc));
      $view.innerHTML = h`
        <div class="wrap"><div class="pricing">
          <div class="intro">
            <h1>Pay when the plan is worth doing.</h1>
            <p>The score is always free. Paid tiers are for owners who want the whole ninety days written out and kept current.</p>
            <div class="toggle" role="tablist">
              <button type="button" class="${annual ? '' : 'on'}" data-billing="monthly">Monthly</button>
              <button type="button" class="${annual ? 'on' : ''}" data-billing="annual">Annual <b>−${Math.round(disc * 100)}%</b></button>
            </div>
          </div>
          <div class="tiers">${raw((pricing.tiers || []).map(t => {
            const free = !t.monthlyPrice;
            const popular = t.popular ?? t.tier === 'growth_plan';
            const current = ent && ent.current_tier === t.tier;
            const price = free ? 'Free' : '$' + (annual ? yr(t) : t.monthlyPrice);
            const per = free ? '' : annual ? '/yr' : '/mo';
            const note = free ? (t.note || 'No card, ever') : t.note && t.tier === 'agency' ? t.note : annual ? `Billed yearly — ${Math.round(disc * 100)}% off` : `$${yr(t)}/yr saves ${Math.round(disc * 100)}%`;
            const cta = current ? 'Current plan' : t.cta || (free ? 'Score a profile' : 'Start ' + t.name.split(' /')[0]);
            return h`<article class="tier" data-tier="${t.tier}">
              <div class="th"><div class="n">${t.name}</div>${popular ? raw('<div class="popular">Most popular</div>') : current ? raw('<div class="current">Current plan</div>') : ''}</div>
              <div><div class="price"><div class="p">${price}</div><div class="per">${per}</div></div><div class="note">${note}</div></div>
              ${(t.who || t.description) ? raw(h`<div class="who">${t.who || t.description}</div>`) : ''}
              <div class="feats">${raw((t.features || []).map(f => h`<div>${f}</div>`).join(''))}</div>
              <button type="button" class="btn md ${popular ? '' : 'ghost strong'}" data-subscribe="${t.tier}" data-free="${free}" ${current ? 'disabled' : ''}>${cta}</button>
            </article>`;
          }).join(''))}</div>
          <div class="foot">All tiers keep your report history. Cancel in two clicks — no call, no retention offer.</div>
        </div></div>`;

      $view.querySelectorAll('[data-billing]').forEach(b => b.addEventListener('click', () => { billing = b.dataset.billing; sset('sc_billing', billing); render(); }));
      $view.querySelectorAll('[data-subscribe]').forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.free === 'true') { sset('sc_scroll', 'form'); go('#/'); return; }
        if (!token()) { sset('sc_next', '#/pricing'); sset('sc_intent_tier', b.dataset.subscribe); go('#/signin'); return; }
        b.disabled = true; const label = b.textContent; b.textContent = 'Starting…';
        try {
          await api('/billing/subscribe', { method: 'POST', body: JSON.stringify({ tier: b.dataset.subscribe, billingCycle: billing }) });
          sessionStorage.removeItem('sc_intent_tier');
          // Re-read entitlements from the backend — the tier is never set client-side.
          try { ent = await api('/account/subscription-status'); } catch { try { ent = await api('/entitlements'); } catch { } }
          toast('You’re on ' + ((pricing.tiers.find(t => t.tier === b.dataset.subscribe) || {}).name || 'the new plan') + '.');
          render();
        } catch (e) {
          if (e.status === 401) return;
          toast(e.message || 'Subscription failed.'); b.disabled = false; b.textContent = label;
        }
      }));
      if (intent) { $view.querySelector(`[data-tier="${intent}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
    render();
  }

  // ------------------------------------------------------------ sign in
  function viewSignin() {
    renderHeader('signin');
    const next = sget('sc_next', '#/');
    $view.innerHTML = h`
      <div class="signin"><div class="box">
        <div class="brandname">Scalecraft</div>
        <form class="card" id="signinForm" novalidate>
          <h2>Sign in</h2>
          <div class="field"><div class="label">Email</div><input type="email" name="email" autocomplete="email" placeholder="maya@sunrisefitness.co" value="${sget('sc_form', {}).email || ''}"></div>
          <div class="field">
            <div class="lblrow"><div class="label">Password</div><a href="#" data-action="forgot">Forgot?</a></div>
            <input type="password" name="password" autocomplete="current-password" placeholder="••••••••••">
          </div>
          <div class="form-error" id="signinError" hidden></div>
          <button class="btn" type="submit">Sign in</button>
          <div class="alt">No account yet? <a href="#/" data-scroll="form">Score a profile free</a></div>
        </form>
      </div></div>`;
    const form = $view.querySelector('#signinForm');
    form.querySelector('[data-action=forgot]').addEventListener('click', e => { e.preventDefault(); toast('Password reset isn’t wired up yet.'); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = form.querySelector('#signinError');
      const email = form.email.value.trim(), password = form.password.value;
      if (!email || !password) { err.textContent = 'Email and password, please.'; err.hidden = false; return; }
      err.hidden = true;
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, { allow401: true });
        const t = res.token || res.access_token || res.jwt;
        if (!t) throw new Error('No token in response');
        setToken(t);
        sessionStorage.removeItem('sc_next');
        go(next && next !== '#/signin' ? next : '#/');
      } catch (e2) {
        err.textContent = e2.status === 401 ? "That email and password don't match." : (e2.message || 'Sign-in failed.');
        err.hidden = false; btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
  }

  // ------------------------------------------------------------ router
  function route() {
    stopPolling();
    window.scrollTo(0, 0);
    const hash = location.hash || '#/';
    const [path] = hash.slice(1).split('?');
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return viewLanding();
    if (parts[0] === 'evaluating' && parts[1]) return viewEvaluating(decodeURIComponent(parts[1]));
    if (parts[0] === 'report' && parts[1]) return viewReport(decodeURIComponent(parts[1]));
    if (parts[0] === 'pricing') return viewPricing();
    if (parts[0] === 'signin') return viewSignin();
    renderHeader('landing');
    $view.innerHTML = h`<div class="center-msg"><h2>Nothing here.</h2><a href="#/">Back to start</a></div>`;
  }

  // Global click handling: header actions, in-page scroll targets
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-scroll]');
    if (a) {
      const target = a.dataset.scroll;
      if ((location.hash || '#/') === '#/' || location.hash === '#') { e.preventDefault(); document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else sset('sc_scroll', target);
      return;
    }
    const act = e.target.closest('[data-action]');
    if (!act) return;
    if (act.dataset.action === 'signout') { e.preventDefault(); setToken(null); toast('Signed out.'); route(); }
    if (act.dataset.action === 'email-report') { e.preventDefault(); toast('This report is already on its way to your inbox.'); }
  });

  window.addEventListener('hashchange', route);
  if (CFG.useMock) { const b = document.createElement('div'); b.className = 'mockbadge'; b.textContent = 'Mock API'; document.body.appendChild(b); }
  route();
})();
