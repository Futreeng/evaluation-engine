// Scalecraft mock API — serves the @sunrisefitnessbk sample from the design
// through the same routes as the real Growth Engine backend, so app.js needs
// no branches. Installed as window.scalecraftMockFetch(path, init) → Response-like.
(function () {
  const cfg = window.SCALECRAFT_CONFIG || {};
  const M = cfg.mock || {};
  const QUEUED_MS = M.queuedMs ?? 3000;
  const STAGE_MS = M.stageMs ?? 2200;
  const FAIL_KEY = (M.failIfHandleIncludes || 'private').toLowerCase();

  const STAGES = ['finding', 'reading', 'scoring', 'writing'];

  const CATEGORY_NAMES = { fitness_creator: 'Fitness', food_cooking: 'Food & Cooking', lifestyle_vlog: 'Lifestyle & Vlog', other: 'Other', boutique_fitness: 'Boutique Fitness', retail: 'Retail' };

  const cal = slots => Array.from({ length: 28 }, (_, i) => slots.includes(i % 7));

  function sampleReport(handle, platform, category) {
    const catName = CATEGORY_NAMES[category] || 'Boutique Fitness';
    return {
      report_id: 'rpt_' + Math.random().toString(36).slice(2, 10),
      tier: 'social_snapshot',
      created_at: new Date().toISOString(),
      scores: {
        overall: 47,
        category_avg: 61,
        category_top_quartile: 78,
        category_sample_size: 1284,
        summary: "Posting Consistency and Engagement Quality are driving most of the gap.",
        method: 'deterministic-v1', niche_known: true, creator: true,
        dimensions: [
          {
            label: 'Posting Consistency', score: 35, category_avg: 58,
            explanation: "You posted 14 times in the last 90 days with a 19-day silence through August. Studios that hold three posts a week stay in the feed of people who already follow them; gaps reset that and the algorithm treats you like a new account. This isn't about posting more — it's about posting on the same days."
          },
          {
            label: 'Content Mix', score: 52, category_avg: 63,
            explanation: "Nine of your 14 posts are class schedules. Members already know the schedule. There's almost no coach point-of-view, no member results, and nothing from behind the front desk — the three things that make a stranger trust a studio before they ever walk in."
          },
          {
            label: 'Engagement Quality', score: 58, category_avg: 60,
            explanation: "Comments average 2.1 per post and roughly 70% come from the same six accounts — loyal, but not new. Saves and shares, the two signals that put you in front of people within a few miles of the studio, are low for your follower count.",
            evidence: "1.9% engagement rate vs 2.4% target; comments are 3.1% of interactions; video views per post ≈ 11% of followers"
          },
          {
            label: 'Profile Clarity', score: 44, category_avg: 64,
            explanation: "Your bio reads “Move well. Live well.” It doesn't say the neighborhood, what a first class costs, or how to book one. The link goes to your homepage instead of a trial offer. A visitor decides in about four seconds whether you're near them and affordable."
          }
        ]
      },
      growth_path: {
        unlocked_steps: 3,
        total_steps: 15,
        phases: [
          {
            range: '1-30', label: 'Show up on a schedule',
            visible_action: 'Pick three fixed posting days — Mon, Wed, Sat — and publish at 7:15am.',
            detail: 'Your engagement peaks between 6:30 and 8am on weekdays; class-goers check their phones before the commute. Hold the same three days for four weeks even when the post is one photo and a caption.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 1–4 calendar',
              items: [
                { meta: 'MOVE 02 · BIO REWRITE · 12 WORDS · NEIGHBORHOOD + PRICE', w1: '94%', w2: '61%' },
                { meta: 'MOVE 03 · STORY CADENCE · MON + THU · 2 FRAMES EACH', w1: '88%', w2: '44%' },
                { meta: 'MOVE 04 · HIGHLIGHT COVERS · 3 · FIRST CLASS / COACHES / SCHEDULE', w1: '97%', w2: '72%' }
              ],
              calendar_label: 'WEEKS 1–4 · 12 POST SLOTS', calendar: cal([0, 2, 5])
            }
          },
          {
            range: '31-60', label: 'Give people a reason to trust you',
            visible_action: 'Replace two schedule posts a week with a 20-second coach explainer.',
            detail: 'One coach, one movement cue, filmed on a phone, no editing. Your two most-saved posts of the last year are both coach-on-camera — that format already works for you; you just stopped using it.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 5–8 calendar',
              items: [
                { meta: 'MOVE 05 · REELS SCRIPT · 20 SEC · 3 BEATS', w1: '91%', w2: '57%' },
                { meta: 'MOVE 06 · MEMBER STORY · 1 ASK · 4-LINE DM TEMPLATE', w1: '84%', w2: '68%' },
                { meta: 'MOVE 07 · COMMENT WINDOW · 20 MIN/DAY · 8:30PM', w1: '96%', w2: '39%' }
              ],
              calendar_label: 'WEEKS 5–8 · 12 POST SLOTS', calendar: cal([1, 3, 5])
            }
          },
          {
            range: '61-90', label: 'Turn attention into first classes',
            visible_action: 'Point your link at a $15 first-class page with the address above the fold.',
            detail: 'Right now the link goes to your homepage and the address sits in the footer. Anyone who found you through a reel has to work to learn whether you are a reasonable walk from their apartment.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 9–12 calendar',
              items: [
                { meta: 'MOVE 08 · OFFER PAGE · 4 BLOCKS · HEADLINE COPY INCLUDED', w1: '89%', w2: '64%' },
                { meta: 'MOVE 09 · LOCAL TAGS · 6 ACCOUNTS WITHIN 1.2 MI', w1: '93%', w2: '48%' },
                { meta: 'MOVE 10 · RETENTION DM · 2 TEMPLATES · DAY 7 + DAY 21', w1: '86%', w2: '70%' }
              ],
              calendar_label: 'WEEKS 9–12 · 12 POST SLOTS', calendar: cal([0, 3, 6])
            }
          }
        ]
      },
      business: { handle, platform, category, category_name: catName, followers: 12640167 },
      post_insights: {
        sample: 12, avg_engagement: 96,
        note: 'Your top three are all coach-on-camera reels posted before 8am on weekdays. The bottom three are class-schedule graphics posted on Fridays with no caption beyond the times.',
        patterns: { best_format: { format: 'reel', posts: 4, avg_engagement: 168, vs_avg: 1.75 }, best_day: { day: 'Wed', avg_engagement: 151 } },
        top: [
          { date: '2026-09-03T11:40:00Z', format: 'reel', weekday: 'Wed', likes: 214, comments: 19, views: 3980, vs_avg: 2.43, caption: 'Coach Dana on the one hip-hinge cue that fixes most deadlifts. 20 seconds, no music.' },
          { date: '2026-08-13T11:15:00Z', format: 'reel', weekday: 'Wed', likes: 171, comments: 12, views: 2860, vs_avg: 1.91, caption: 'What 6:15am looks like from the front desk. Same eight faces, every week.' },
          { date: '2026-07-29T12:02:00Z', format: 'carousel', weekday: 'Tue', likes: 122, comments: 9, views: 0, vs_avg: 1.36, caption: 'Maya’s first pull-up, six months in. Swipe for the week-one video.' }
        ],
        bottom: [
          { date: '2026-08-29T20:10:00Z', format: 'static', weekday: 'Fri', likes: 31, comments: 0, views: 0, vs_avg: 0.32, caption: 'This week’s schedule ⬇️ Mon 6:15 / 7:30 / 12:00 / 6:00 · Tue 6:15 / 7:30…' },
          { date: '2026-08-08T19:45:00Z', format: 'static', weekday: 'Fri', likes: 36, comments: 1, views: 0, vs_avg: 0.39, caption: 'Schedule for the week of Aug 11. Book via the link in bio.' },
          { date: '2026-07-18T21:00:00Z', format: 'static', weekday: 'Fri', likes: 44, comments: 2, views: 0, vs_avg: 0.48, caption: 'Labor Day hours: closed Monday. Regular schedule resumes Tuesday.' }
        ]
      },
      upsell: {
        cta_label: 'Unlock your full Growth Plan',
        target_tier: 'growth_plan',
        unlock_count: 12,
        monthly_price: 12,
        description: '12 locked items: 11 more specific moves and the week-by-week posting calendar for all three phases, written against your own posts — not a template.'
      }
    };
  }

  const PRICING = {
    audience: 'creators',
    discount: { annual: '25% off', note: 'Annual billing includes 25% discount' },
    refund: 'Not useful in the first 7 days? Reply to any email and we refund it.',
    business_checkout_enabled: false,
    tiers: [
      { tier: 'social_snapshot', name: 'Snapshot', monthlyPrice: 0, annualPrice: 0, note: 'One report per email', features: ['Your score and the four dimensions', 'Why each one landed where it did', 'Your best and worst posts', 'The first move of each phase'], cta: 'Score my account' },
      { tier: 'growth_plan', name: 'Growth Plan', monthlyPrice: 12, annualPrice: 108, popular: true, features: ['Every move, 01 through 13', 'Your 12-week posting calendar', 'Competitor comparison, up to 5 handles', 'Weekly refresh and score history'], cta: 'Unlock the plan' },
      { tier: 'growth_plan_pro', name: 'Growth Plan Pro', monthlyPrice: 29, annualPrice: 261, optional: true, features: ["Every platform you're on, scored together", 'Priority refresh — rescored within the hour', 'One plan that balances all of them'], cta: 'Choose Pro' }
    ],
    business: [
      { tier: 'business_growth', name: 'Business', monthlyPrice: 39, annualPrice: 351, features: ['One business account, scored against its category', 'The booking-led plan and calendar', 'Weekly refresh'] },
      { tier: 'business_evaluator', name: 'Business Pro', monthlyPrice: 99, annualPrice: 891, features: ['Up to five locations or accounts', 'Category benchmarks and competitor set', 'Priority refresh'] }
    ]
  };

  // ---- in-memory state ----
  const jobs = new Map();
  const reports = new Map();
  let entitlement = { account_id: 'acct_mock', current_tier: 'social_snapshot' };
  let queueDepth = 2;

  function jobView(job) {
    const t = Date.now() - job.started;
    if (job.fail) {
      if (t < QUEUED_MS + STAGE_MS) return running(job, t);
      return { status: 'failed', stage: 'failed', error: `${cap(job.platform)} returned the profile as private, so there are no public posts for us to score. Nothing was charged and nothing was saved.`, error_code: 'PROFILE_PRIVATE', ref: job.ref };
    }
    if (t < QUEUED_MS) {
      const ahead = Math.max(0, Math.ceil((QUEUED_MS - t) / (QUEUED_MS / queueDepth)));
      return { status: 'queued', stage: 'queued', queue_position: ahead, eta_seconds: Math.ceil((QUEUED_MS - t) / 1000) + 15 };
    }
    if (t < QUEUED_MS + STAGE_MS * STAGES.length) return running(job, t);
    if (!job.report) {
      job.report = sampleReport(job.handle, job.platform, job.category);
      reports.set(job.report.report_id, job.report);
    }
    return { status: 'complete', stage: 'complete', resultPayload: job.report };
  }
  function running(job, t) {
    const idx = Math.min(STAGES.length - 1, Math.floor((t - QUEUED_MS) / STAGE_MS));
    const within = ((t - QUEUED_MS) % STAGE_MS) / STAGE_MS;
    const pct = Math.round(((idx + within) / STAGES.length) * 100);
    return {
      status: 'running', stage: STAGES[idx], step: idx + 1, total_steps: STAGES.length, percent: pct,
      elapsed_seconds: Math.floor((t - QUEUED_MS) / 1000),
      stats: idx >= 1 ? { posts_found: 47, window_days: 90, longest_gap_days: 19 } : null,
      note: idx >= 1 ? 'Bio and link checked: no city, no price, no booking path.' : null
    };
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function json(status, body) {
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => body, text: async () => JSON.stringify(body)
    };
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));

  window.scalecraftMockFetch = async function (url, init = {}) {
    await delay(180 + Math.random() * 220);
    const base = cfg.apiBase || '/api/growth-engine/v1';
    const path = url.startsWith(base) ? url.slice(base.length) : url;
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    let m;

    if (method === 'POST' && path === '/evaluate/social-snapshot') {
      const handle = String(body.handle || '').replace(/^@/, '').trim();
      if (!handle || !body.platform || !body.category || !body.email) return json(400, { error: 'handle, platform, category and email are required', code: 'INVALID_HANDLE' });
      const paid = entitlement.current_tier !== 'social_snapshot' && (init.headers || {}).Authorization;
      const prior = [...jobs.values()].find(j => !j.paid && !j.fail && j.report && j.handle === handle.toLowerCase() && j.platform === body.platform);
      if (!paid && prior) return json(402, { error: `@${handle} has already been scored for free. Open that report, or start a Growth Plan to score it again and watch it change.`, code: 'FREE_LIMIT_REACHED', report_id: prior.report.report_id, generated_at: prior.report.created_at, upgrade_tier: 'growth_plan' });
      const id = 'job_' + Math.random().toString(36).slice(2, 10);
      jobs.set(id, { paid: !!paid,
        id, handle, platform: body.platform, category: body.category, email: body.email,
        started: Date.now(), fail: handle.toLowerCase().includes(FAIL_KEY),
        ref: (Math.random().toString(16).slice(2, 4) + '-' + Math.floor(1000 + Math.random() * 9000)).toUpperCase()
      });
      return json(202, { job_id: id, status: 'queued' });
    }
    if (method === 'GET' && (m = path.match(/^\/job\/([^/?]+)/))) {
      const job = jobs.get(m[1]);
      return job ? json(200, jobView(job)) : json(404, { error: 'Job not found' });
    }
    if (method === 'GET' && (m = path.match(/^\/reports\/([^/?]+)/))) {
      const r = reports.get(m[1]);
      return r ? json(200, { reportId: r.report_id, accountId: 'usr_mock', tier: r.tier, business: r.business, generatedAt: Date.parse(r.created_at), reportBody: r }) : json(404, { error: 'Report not found' });
    }
    if (method === 'GET' && path === '/reports') return json(200, { reports: [...reports.values()] });
    if (method === 'GET' && path === '/entitlements') return json(200, entitlement);
    if (method === 'GET' && path === '/health') return json(200, { status: 'ok', mock: true });
    if (method === 'POST' && path === '/waitlist') return json(200, { ok: true, platform: body.platform });
    if (method === 'DELETE' && path === '/account') { entitlement = { account_id: 'acct_mock', current_tier: 'social_snapshot' }; return json(200, { deleted: true, reports: reports.size }); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/moves$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); r.moves_done = r.moves_done || {}; if (body.done) r.moves_done[body.key] = Date.now(); else delete r.moves_done[body.key]; return json(200, { moves_done: r.moves_done }); }
    if (method === 'GET' && path === '/billing/pricing') return json(200, PRICING);
    if (method === 'POST' && path === '/billing/subscribe') {
      const tier = [...PRICING.tiers, ...PRICING.business].find(t => t.tier === body.tier);
      if (!tier) return json(400, { error: 'Unknown tier' });
      entitlement = { ...entitlement, current_tier: tier.tier, billing_cycle: body.billingCycle || 'monthly' };
      return json(200, { ok: true, entitlement });
    }
    if (method === 'POST' && path === '/billing/check-access') {
      const order = ['social_snapshot', 'growth_plan', 'growth_plan_pro', 'business_growth', 'business_evaluator', 'agency'];
      const ok = order.indexOf(entitlement.current_tier) >= order.indexOf(body.requiredTier);
      return ok ? json(200, { access: true }) : json(402, { error: 'Upgrade required', required_tier: body.requiredTier });
    }
    // Auth — same shape as routes/growth-engine.js
    if (method === 'POST' && (path === '/auth/login' || path === '/auth/signup')) {
      if (!body.email || !body.password) return json(400, { error: 'Email and password required', code: 'INVALID_EMAIL' });
      if (path === '/auth/login' && body.password === 'wrong') return json(401, { error: 'Invalid email or password', code: 'AUTH_FAILED' });
      return json(200, { token: 'mock.' + btoa(body.email) + '.' + Date.now(), user: { user_id: 'usr_mock', email: body.email, company_name: body.company_name || null } });
    }
    if (method === 'GET' && path === '/auth/me') return json(200, { user_id: 'usr_mock', email: 'maya@sunrisefitness.co' });
    if (method === 'GET' && path === '/account/subscription-status') return json(200, { user_id: 'usr_mock', current_tier: entitlement.current_tier });
    return json(404, { error: 'No mock route for ' + method + ' ' + path });
  };
})();
